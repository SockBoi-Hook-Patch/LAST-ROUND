/**
 * Original procedural music for LAST ROUND.
 *
 * Every track is a 16-bar loop described on a sixteenth-note grid. A track's
 * `schedule` function is called once per grid step, slightly ahead of time,
 * and creates the voices that start on that step.
 */
import { bell, mtof, noise, tone, voice, type Out } from './synth';
import type { MusicId } from './types';

export interface TrackDef {
  bpm: number;
  bars: number;
  /** Track low-pass cutoff at intensity 0 (opens fully at intensity 1). */
  lpMin: number;
  schedule(o: Out, step: number, t: number, stepDur: number, intensity: number, loop: number): void;
}

/* ------------------------------------------------------------------ */
/* Instruments                                                         */
/* ------------------------------------------------------------------ */

function kick(o: Out, t: number, gain = 1): void {
  tone(o, { f: 158, fEnd: 43, glide: 0.11, t, dur: 0.3, gain: 0.9 * gain, attack: 0.002, hold: 0.025 });
  noise(o, { t, dur: 0.018, gain: 0.16 * gain, attack: 0.001, type: 'highpass', f: 2600 });
}

function snare(o: Out, t: number, gain = 1): void {
  noise(o, { t, dur: 0.17, gain: 0.5 * gain, attack: 0.001, f: 1900, q: 0.7, wet: 0.14 });
  tone(o, { type: 'triangle', f: 215, fEnd: 150, glide: 0.06, t, dur: 0.1, gain: 0.26 * gain });
}

function hat(o: Out, t: number, gain = 1, open = false): void {
  noise(o, { t, dur: open ? 0.24 : 0.045, gain: 0.17 * gain, attack: 0.001, type: 'highpass', f: 7400, q: 0.8 });
}

function rim(o: Out, t: number, gain = 1): void {
  tone(o, { type: 'triangle', f: 1750, fEnd: 1500, glide: 0.02, t, dur: 0.05, gain: 0.16 * gain, attack: 0.001, wet: 0.3 });
}

function bass(o: Out, t: number, midi: number, dur: number, gain: number, cutoff: number): void {
  voice(o, {
    oscs: [{ type: 'sawtooth' }, { type: 'square', octave: -1, gain: 0.45 }],
    f: mtof(midi),
    t,
    dur,
    gain,
    attack: 0.004,
    release: 0.05,
    lp: cutoff * 0.38,
    lpPeak: cutoff,
    lpDecay: 0.11,
    q: 3.5,
  });
}

function lead(o: Out, t: number, midi: number, dur: number, gain: number, bright: number): void {
  voice(o, {
    oscs: [{ type: 'sawtooth', detune: -7 }, { type: 'square', detune: 7, gain: 0.55 }],
    f: mtof(midi),
    t,
    dur,
    gain,
    attack: 0.012,
    release: 0.1,
    lp: 1500 + bright * 2200,
    lpPeak: 3200 + bright * 3000,
    lpDecay: 0.22,
    q: 1.8,
    wet: 0.32,
  });
}

function pad(o: Out, t: number, midis: readonly number[], dur: number, gain: number, cutoff: number): void {
  voice(o, {
    oscs: [{ type: 'sawtooth', detune: -9 }, { type: 'sawtooth', detune: 9 }],
    f: midis.map(mtof),
    t,
    dur,
    gain,
    attack: Math.min(0.9, dur * 0.35),
    release: Math.min(1.2, dur * 0.4),
    lp: cutoff,
    q: 0.6,
    wet: 0.45,
  });
}

function stab(o: Out, t: number, midis: readonly number[], dur: number, gain: number): void {
  voice(o, {
    oscs: [{ type: 'sawtooth', detune: -11 }, { type: 'sawtooth', detune: 11 }],
    f: midis.map(mtof),
    t,
    dur,
    gain,
    attack: 0.004,
    release: 0.07,
    lp: 1300,
    lpPeak: 4800,
    lpDecay: 0.1,
    q: 2.2,
    wet: 0.22,
  });
}

function pluck(o: Out, t: number, midi: number, dur: number, gain: number, wet = 0.4): void {
  tone(o, { type: 'triangle', f: mtof(midi), t, dur, gain, attack: 0.004, wet });
}

function keys(o: Out, t: number, midi: number, dur: number, gain: number): void {
  const f = mtof(midi);
  tone(o, { f, t, dur, gain, attack: 0.006, hold: dur * 0.15, wet: 0.4 });
  tone(o, { f: f * 2, t, dur: dur * 0.5, gain: gain * 0.22, attack: 0.004, wet: 0.4 });
}

function sub(o: Out, t: number, midi: number, dur: number, gain: number): void {
  const f = mtof(midi);
  tone(o, { f, t, dur, gain, attack: 0.02, hold: dur * 0.35 });
  tone(o, { type: 'triangle', f: f * 2, t, dur: dur * 0.8, gain: gain * 0.3, attack: 0.02, hold: dur * 0.2 });
}

/* ------------------------------------------------------------------ */
/* Pattern helpers                                                     */
/* ------------------------------------------------------------------ */

/** [step within the phrase, MIDI note, length in steps] */
type Note = readonly [number, number, number];
type Phrase = readonly Note[];
type NoteMap = Map<number, Array<readonly [number, number]>>;

/** Flatten phrases (placed at a starting bar) into a step -> notes lookup. */
function compile(parts: ReadonlyArray<readonly [number, Phrase]>): NoteMap {
  const map: NoteMap = new Map();
  for (const [bar, phrase] of parts) {
    for (const [s, midi, len] of phrase) {
      const key = bar * 16 + s;
      const list = map.get(key);
      if (list) list.push([midi, len]);
      else map.set(key, [[midi, len]]);
    }
  }
  return map;
}

/** Rest marker for bass patterns. */
const X = -99;

/* ------------------------------------------------------------------ */
/* MENU — 84 bpm, D minor. Sparse pads, a sub heartbeat, a lonely motif */
/* ------------------------------------------------------------------ */

const MENU_BASS = [38, 38, 34, 34, 31, 31, 33, 33];
const MENU_PADS: ReadonlyArray<readonly number[]> = [
  [53, 57, 60, 64], // Dm9
  [53, 57, 60, 64],
  [53, 57, 62, 65], // Bbmaj7
  [53, 57, 62, 65],
  [53, 58, 62, 69], // Gm9
  [53, 58, 62, 69],
  [52, 57, 62, 64], // Asus4
  [52, 57, 61, 64], // A
];
const MENU_MOTIF = compile([
  [0, [[0, 69, 3], [6, 65, 3], [12, 64, 4], [16, 62, 8]]],
  [2, [[0, 69, 3], [6, 65, 3], [12, 62, 4], [20, 60, 4], [24, 62, 6]]],
  [4, [[0, 70, 3], [6, 67, 3], [12, 62, 4], [16, 65, 8]]],
  [6, [[0, 69, 6], [8, 64, 4], [16, 61, 6], [24, 64, 4]]],
  [8, [[0, 69, 3], [6, 65, 3], [12, 64, 4], [16, 62, 6], [26, 74, 2], [28, 76, 4]]],
  [10, [[0, 69, 3], [6, 65, 3], [12, 62, 4], [20, 60, 4], [24, 62, 4], [28, 77, 4]]],
  [12, [[0, 70, 3], [6, 67, 3], [12, 62, 4], [16, 65, 6], [24, 79, 2], [26, 77, 2], [28, 74, 4]]],
  [14, [[0, 69, 6], [8, 64, 4], [16, 73, 6], [24, 76, 8]]],
]);

const menu: TrackDef = {
  bpm: 84,
  bars: 16,
  lpMin: 18000,
  schedule(o, step, t, sd, _intensity, loop) {
    const bar = step >> 4;
    const s = step & 15;
    const slot = bar % 8;
    const second = bar >= 8;

    if (s === 0) {
      // The last chord resolves bar by bar; the others ring for two bars.
      if (slot >= 6) pad(o, t, MENU_PADS[slot]!, sd * 15, 0.05, 900);
      else if (slot % 2 === 0) pad(o, t, MENU_PADS[slot]!, sd * 31, 0.05, second ? 1050 : 850);
      sub(o, t, MENU_BASS[slot]!, sd * 9, 0.34);
      if (second) kick(o, t, 0.42);
    }
    if (s === 10) sub(o, t, MENU_BASS[slot]!, sd * 4, 0.2);
    if (second && s === 10) kick(o, t, 0.3);
    if (second && s % 4 === 2) hat(o, t, s === 14 ? 0.5 : 0.32);

    const hits = MENU_MOTIF.get(step);
    if (hits) {
      for (const [midi, len] of hits) {
        pluck(o, t, midi, Math.max(0.5, len * sd * 1.6), 0.15, 0.55);
        // Every other pass the motif gains a faint octave shadow.
        if (loop % 2 === 1) pluck(o, t + sd * 0.5, midi + 12, 0.4, 0.035, 0.7);
      }
    }
    // A far-off clank from the rail yard every four bars.
    if (bar % 4 === 3 && s === 8) bell(o, t, bar === 15 ? 392 : 294, 0.035, 1.6, 0.8);
  },
};

/* ------------------------------------------------------------------ */
/* FIGHT — 126 bpm, E minor. Four-on-the-floor, saw bass, a lead hook   */
/* ------------------------------------------------------------------ */

const FIGHT_ROOTS = [40, 40, 43, 43, 45, 45, 48, 47, 48, 48, 50, 50, 40, 40, 50, 47];
const FIGHT_CHORDS: Record<number, readonly number[]> = {
  40: [52, 55, 59, 64], // Em
  43: [55, 59, 62, 67], // G
  45: [57, 60, 64, 69], // Am
  48: [60, 64, 67, 72], // C
  47: [59, 63, 66, 71], // B
  50: [62, 66, 69, 74], // D
};
const FIGHT_BASS_A = [0, X, 0, 0, X, 0, 12, X, 0, X, 0, 0, X, 7, X, 12];
const FIGHT_BASS_BREAK = [0, X, X, 0, X, X, 0, X, X, 0, X, X, 0, X, 7, X];
const FIGHT_BASS_DRIVE = [0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 7, 12, 7];
const FIGHT_ARP = [0, 1, 2, 3, 2, 1, 2, 1, 0, 1, 2, 3, 2, 3, 2, 1];
const FIGHT_LEAD = compile([
  [0, [[0, 71, 3], [3, 67, 3], [6, 64, 2], [10, 64, 1], [11, 67, 1], [12, 69, 2], [14, 71, 2], [16, 74, 4], [20, 71, 4], [28, 69, 2], [30, 67, 2]]],
  [2, [[0, 71, 3], [3, 74, 3], [6, 67, 2], [10, 67, 1], [11, 71, 1], [12, 74, 2], [14, 76, 2], [16, 74, 6], [24, 71, 4], [28, 69, 4]]],
  [4, [[0, 72, 3], [3, 69, 3], [6, 64, 2], [10, 64, 1], [11, 69, 1], [12, 72, 2], [14, 76, 2], [16, 76, 4], [20, 74, 2], [22, 72, 2], [24, 69, 8]]],
  [6, [[0, 67, 2], [2, 72, 2], [4, 76, 4], [8, 74, 2], [10, 72, 2], [12, 67, 4], [16, 66, 3], [19, 71, 3], [22, 75, 2], [24, 78, 6]]],
  // Break: long tones over the stripped-back groove.
  [8, [[0, 76, 14], [16, 79, 8], [24, 76, 8]]],
  [10, [[0, 78, 14], [16, 81, 8], [24, 78, 8]]],
  [12, [[0, 83, 3], [3, 79, 3], [6, 76, 2], [10, 76, 1], [11, 79, 1], [12, 81, 2], [14, 83, 2], [16, 86, 4], [20, 83, 4], [28, 81, 2], [30, 79, 2]]],
  [14, [[0, 74, 3], [3, 69, 3], [6, 66, 2], [8, 74, 2], [10, 78, 2], [12, 81, 4], [16, 71, 1], [17, 75, 1], [18, 78, 1], [19, 83, 1], [20, 87, 4], [24, 90, 6]]],
]);

const fight: TrackDef = {
  bpm: 126,
  bars: 16,
  lpMin: 7000,
  schedule(o, step, t, sd, intensity, loop) {
    const bar = step >> 4;
    const s = step & 15;
    const root = FIGHT_ROOTS[bar]!;
    const chord = FIGHT_CHORDS[root]!;
    const brk = bar >= 8 && bar < 12;
    const drive = bar >= 12;
    const hot = intensity >= 0.35;
    const max = intensity >= 0.7;

    // Drums
    if (brk) {
      if (s === 0 || s === 6 || s === 10) kick(o, t, 0.9);
      if (s === 8) snare(o, t, 0.9);
    } else {
      if (s % 4 === 0) kick(o, t);
      if (bar % 4 === 3 && s === 14) kick(o, t, 0.75);
      if (s === 4 || s === 12) snare(o, t);
      if (max && s === 15 && bar % 2 === 1) snare(o, t, 0.4);
    }
    if (bar === 15 && s >= 12) snare(o, t, 0.4 + (s - 12) * 0.16);
    if (hot || drive) hat(o, t, s % 4 === 2 ? 0.95 : s % 2 === 1 ? 0.4 : 0.6);
    else if (s % 4 === 2) hat(o, t, 0.85);
    else if (s % 4 === 0 && !brk) hat(o, t, 0.3);
    if (s === 14 && bar % 2 === 1) hat(o, t, 0.8, true);

    // Bass
    const pattern = brk ? FIGHT_BASS_BREAK : drive ? FIGHT_BASS_DRIVE : FIGHT_BASS_A;
    const b = pattern[s]!;
    if (b !== X) {
      bass(o, t, root + b, sd * (brk ? 2.3 : 0.9), 0.3, 750 + intensity * 1500 + (b === 12 ? 450 : 0));
    }

    // Glue pad, one chord per bar
    if (s === 0) pad(o, t, chord.slice(0, 3), sd * 15, brk ? 0.05 : 0.034, 780 + intensity * 500);

    // Lead hook
    const hits = FIGHT_LEAD.get(step);
    if (hits) {
      const lift = loop % 2 === 1 && bar >= 4 && bar < 8 ? 12 : 0;
      for (const [midi, len] of hits) {
        lead(o, t, midi + lift, len * sd * 0.92, brk ? 0.11 : 0.15, 0.25 + intensity * 0.6);
        if (max && !brk) lead(o, t, midi + lift + 12, len * sd * 0.8, 0.045, 0.8);
      }
    }

    // Arpeggio layer: always in the break, everywhere once things heat up
    if (brk ? s % 2 === 0 : hot) {
      const note = chord[FIGHT_ARP[s]!]! + 12;
      pluck(o, t, note, 0.16, brk ? 0.085 : 0.07, 0.35);
    }
  },
};

/* ------------------------------------------------------------------ */
/* BOSS — 140 bpm, C phrygian. 3-3-2 kicks, galloping bass, chord stabs */
/* ------------------------------------------------------------------ */

const BOSS_ROOTS = [36, 36, 37, 36, 36, 36, 39, 37, 44, 44, 46, 46, 36, 36, 43, 43];
const BOSS_CHORDS: Record<number, readonly number[]> = {
  36: [60, 63, 67], // Cm
  37: [61, 65, 68], // Db
  39: [63, 67, 70], // Eb
  44: [56, 60, 63], // Ab
  46: [58, 62, 65], // Bb
  43: [55, 59, 62], // G
};
const BOSS_BASS = [0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 0, 12, 12];
const BOSS_RIFF_STEPS = [0, 3, 6, 10, 12];
const BOSS_RIFF_TONES = [0, 0, 1, 0, 2];
const BOSS_LEAD = compile([
  [8, [[0, 72, 6], [6, 75, 2], [8, 80, 8], [16, 79, 4], [20, 75, 4], [24, 72, 8]]],
  [10, [[0, 74, 6], [6, 77, 2], [8, 82, 8], [16, 80, 4], [20, 77, 4], [24, 74, 8]]],
  [12, [[0, 84, 3], [3, 82, 3], [6, 79, 2], [8, 75, 3], [11, 74, 3], [14, 72, 2], [16, 75, 3], [19, 74, 3], [22, 72, 2], [24, 67, 8]]],
  [14, [[0, 71, 4], [4, 74, 4], [8, 79, 4], [12, 83, 4], [16, 86, 2], [18, 83, 2], [20, 86, 2], [22, 83, 2], [24, 86, 2], [26, 83, 2], [28, 86, 4]]],
]);

const boss: TrackDef = {
  bpm: 140,
  bars: 16,
  lpMin: 9000,
  schedule(o, step, t, sd, intensity, loop) {
    const bar = step >> 4;
    const s = step & 15;
    const root = BOSS_ROOTS[bar]!;
    const chord = BOSS_CHORDS[root]!;
    const second = bar >= 8;
    const straight = bar >= 8 && bar < 12;

    // Drums
    if (straight) {
      if (s % 4 === 0 || s === 14) kick(o, t);
    } else if (s === 0 || s === 3 || s === 6 || s === 8 || s === 11 || s === 14) {
      kick(o, t, s === 0 || s === 8 ? 1 : 0.85);
    }
    if (s === 4 || s === 12) snare(o, t, 1.05);
    if (bar % 2 === 1 && s === 15) snare(o, t, 0.45);
    if (bar >= 14 && s >= 8 && s % 2 === 0) snare(o, t, 0.35 + (bar - 14) * 0.2);
    if (bar === 15 && s >= 12) snare(o, t, 0.5 + (s - 12) * 0.15);
    hat(o, t, s % 4 === 2 ? 1 : s % 2 === 1 ? 0.42 : 0.6);
    if (s === 10 && bar % 2 === 0) hat(o, t, 0.75, true);

    // Bass gallop
    const b = BOSS_BASS[s]!;
    bass(o, t, root + b, sd * 0.85, b === 12 ? 0.25 : 0.3, 900 + intensity * 1400 + (s % 3 === 0 ? 500 : 0));

    // First half: stabs answer a low riff, bar by bar
    if (!second) {
      if (bar % 2 === 0) {
        if (s === 0 || s === 3 || s === 6) stab(o, t, chord, sd * 1.6, 0.085);
        if (loop % 2 === 1 && s === 12) stab(o, t, chord.map((m) => m + 12), sd * 1.4, 0.05);
      } else {
        const i = BOSS_RIFF_STEPS.indexOf(s);
        if (i >= 0) lead(o, t, chord[BOSS_RIFF_TONES[i]!]! - 12, sd * 1.7, 0.15, 0.2 + intensity * 0.4);
      }
    } else if (s === 0 || (straight && s === 8)) {
      stab(o, t, chord, sd * 3, 0.07);
    }

    // Second half: the brooding melody
    const hits = BOSS_LEAD.get(step);
    if (hits) {
      for (const [midi, len] of hits) {
        lead(o, t, midi, len * sd * 0.92, 0.15, 0.4 + intensity * 0.5);
        if (intensity >= 0.6) lead(o, t, midi - 12, len * sd * 0.9, 0.06, 0.3);
      }
    }
    if (s === 0) pad(o, t, chord, sd * 15, 0.03, 900 + intensity * 400);
  },
};

/* ------------------------------------------------------------------ */
/* INTERLUDE — 72 bpm, A minor / C major. Warm keys for the corner stool */
/* ------------------------------------------------------------------ */

const REST_BASS = [45, 45, 41, 41, 48, 48, 43, 43];
const REST_PADS: ReadonlyArray<readonly number[]> = [
  [60, 64, 67, 71], // Am9
  [53, 57, 60, 64], // Fmaj7
  [55, 59, 64, 67], // Cmaj7
  [55, 59, 62, 64], // G6
];
const REST_ARP_UP = [0, 1, 2, 3, 2, 1, 2, 3];
const REST_ARP_DOWN = [3, 2, 1, 0, 1, 2, 3, 2];
const REST_MELODY = compile([
  [8, [[0, 76, 6], [8, 74, 4], [12, 72, 4], [16, 71, 12]]],
  [10, [[0, 72, 6], [8, 69, 4], [12, 72, 4], [16, 76, 12]]],
  [12, [[0, 79, 6], [8, 76, 4], [12, 74, 4], [16, 76, 12]]],
  [14, [[0, 74, 6], [8, 71, 4], [12, 67, 4], [16, 69, 8], [24, 71, 8]]],
]);

const interlude: TrackDef = {
  bpm: 72,
  bars: 16,
  lpMin: 18000,
  schedule(o, step, t, sd, _intensity, loop) {
    const bar = step >> 4;
    const s = step & 15;
    const slot = bar % 8;
    const tones = REST_PADS[slot >> 1]!;

    if (s === 0) {
      if (slot % 2 === 0) pad(o, t, tones, sd * 31, 0.05, 1100);
      sub(o, t, REST_BASS[slot]!, sd * 10, 0.3);
      kick(o, t, 0.3);
    }
    if (s === 8) rim(o, t, 0.7);
    if (s === 4 || s === 12) hat(o, t, 0.3);

    // Eighth-note keys rising in the first bar of each chord, falling in the next
    if (s % 2 === 0) {
      const order = slot % 2 === 0 ? REST_ARP_UP : REST_ARP_DOWN;
      const note = tones[order[s >> 1]!]! + 12;
      keys(o, t, note, sd * 5, s % 4 === 0 ? 0.1 : 0.075);
    }

    const hits = REST_MELODY.get(step);
    if (hits) {
      for (const [midi, len] of hits) {
        pluck(o, t, midi + (loop % 2 === 1 ? 0 : 12), len * sd * 1.3, 0.1, 0.6);
      }
    }
  },
};

export const TRACKS: Record<Exclude<MusicId, 'none'>, TrackDef> = { menu, fight, boss, interlude };
