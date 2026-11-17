import type { Graph } from './graph';
import { bell, mtof, noise, rand, tone, voice, type Out } from './synth';
import type { SfxId, SfxOptions } from './types';

/** A recipe schedules one sound effect starting at context time `t`. */
export type Recipe = (o: Out, t: number) => void;

/** Seconds the passing train takes to cross the stereo field. */
const TRAIN_SECONDS = 3.6;

function thump(o: Out, t: number, f0: number, f1: number, dur: number, gain: number): void {
  tone(o, { f: f0, fEnd: f1, glide: dur * 0.6, t, dur, gain, attack: 0.002, hold: dur * 0.12 });
}

function notes(
  o: Out,
  t: number,
  midis: readonly number[],
  gap: number,
  dur: number,
  gain: number,
  type: OscillatorType = 'triangle',
  wet = 0.25,
): void {
  midis.forEach((m, i) => {
    tone(o, { type, f: mtof(m), t: t + i * gap, dur, gain, attack: 0.005, hold: dur * 0.2, wet });
  });
}

export const RECIPES: Record<SfxId, Recipe> = {
  /* ---------------------------- interface ---------------------------- */
  uiMove: (o, t) => {
    tone(o, { type: 'triangle', f: 740, fEnd: 880, glide: 0.03, t, dur: 0.07, gain: 0.26 });
  },
  uiSelect: (o, t) => {
    tone(o, { type: 'triangle', f: 660, t, dur: 0.09, gain: 0.3 });
    tone(o, { type: 'triangle', f: 990, t: t + 0.06, dur: 0.16, gain: 0.3, wet: 0.2 });
    tone(o, { type: 'square', f: 1980, t: t + 0.06, dur: 0.05, gain: 0.035, lp: 4200 });
  },
  uiBack: (o, t) => {
    tone(o, { type: 'triangle', f: 560, t, dur: 0.08, gain: 0.28 });
    tone(o, { type: 'triangle', f: 392, t: t + 0.055, dur: 0.14, gain: 0.28 });
  },

  /* ----------------------------- movement ---------------------------- */
  swingLight: (o, t) => {
    const k = rand(0.9, 1.14);
    noise(o, { t, dur: 0.13, gain: 0.55, attack: 0.035, f: 1100 * k, fEnd: 3300 * k, q: 1.3 });
  },
  swingHeavy: (o, t) => {
    const k = rand(0.9, 1.1);
    noise(o, { t, dur: 0.26, gain: 0.75, attack: 0.08, f: 380 * k, fEnd: 2200 * k, q: 1.1 });
    tone(o, { f: 150 * k, fEnd: 82 * k, t, dur: 0.22, gain: 0.14, attack: 0.06 });
  },
  jump: (o, t) => {
    tone(o, { f: 230, fEnd: 430, glide: 0.08, t, dur: 0.11, gain: 0.16, attack: 0.01 });
    noise(o, { t, dur: 0.08, gain: 0.18, attack: 0.01, type: 'lowpass', f: 900 });
  },
  land: (o, t) => {
    thump(o, t, 125, 58, 0.09, 0.4);
    noise(o, { t, dur: 0.06, gain: 0.26, type: 'lowpass', f: 520 });
  },
  dodge: (o, t) => {
    const k = rand(0.94, 1.08);
    noise(o, { t, dur: 0.17, gain: 0.5, attack: 0.03, f: 2400 * k, fEnd: 620 * k, q: 0.9 });
    tone(o, { f: 520 * k, fEnd: 240 * k, t, dur: 0.13, gain: 0.07, attack: 0.02 });
  },

  /* ------------------------------ contact ---------------------------- */
  hitLight: (o, t) => {
    const k = rand(0.92, 1.1);
    thump(o, t, 200 * k, 72 * k, 0.1, 0.6);
    noise(o, { t, dur: 0.04, gain: 0.5, attack: 0.001, f: 2400 * k, q: 0.8 });
  },
  hitHeavy: (o, t) => {
    const k = rand(0.93, 1.07);
    thump(o, t, 160 * k, 48 * k, 0.18, 0.85);
    tone(o, { type: 'triangle', f: 310 * k, fEnd: 90 * k, t, dur: 0.09, gain: 0.3 });
    noise(o, { t, dur: 0.07, gain: 0.6, attack: 0.001, f: 1600 * k, q: 0.7, wet: 0.12 });
  },
  hitFinisher: (o, t) => {
    const k = rand(0.95, 1.05);
    thump(o, t, 140 * k, 38 * k, 0.3, 0.95);
    tone(o, { type: 'square', f: 230 * k, fEnd: 60 * k, t, dur: 0.13, gain: 0.2, lp: 900 });
    noise(o, { t, dur: 0.16, gain: 0.7, attack: 0.001, type: 'lowpass', f: 5200, fEnd: 500, wet: 0.25 });
    noise(o, { t, dur: 0.035, gain: 0.35, attack: 0.001, type: 'highpass', f: 4200 });
  },
  hitSpecial: (o, t) => {
    thump(o, t, 120, 32, 0.46, 1);
    tone(o, { type: 'sawtooth', f: 180, fEnd: 45, t, dur: 0.22, gain: 0.22, lp: 1400, lpEnd: 200 });
    noise(o, { t, dur: 0.26, gain: 0.75, attack: 0.001, type: 'lowpass', f: 7000, fEnd: 380, wet: 0.35 });
    // Bright shimmer: a fan of rising inharmonic partials.
    const base = rand(1700, 1900);
    [1, 1.34, 1.79, 2.41, 2.93].forEach((ratio, i) => {
      tone(o, {
        f: base * ratio,
        fEnd: base * ratio * 1.06,
        t: t + 0.02 + i * 0.018,
        dur: 0.55 - i * 0.05,
        gain: 0.075,
        attack: 0.004,
        wet: 0.6,
      });
    });
  },
  block: (o, t) => {
    const k = rand(0.94, 1.06);
    tone(o, { type: 'triangle', f: 330 * k, fEnd: 170 * k, t, dur: 0.06, gain: 0.42 });
    noise(o, { t, dur: 0.05, gain: 0.55, attack: 0.001, f: 900 * k, q: 2 });
  },
  parry: (o, t) => {
    const f = rand(1440, 1520);
    tone(o, { f, t, dur: 0.42, gain: 0.2, attack: 0.001, wet: 0.35 });
    tone(o, { f: f * 1.498, t, dur: 0.34, gain: 0.13, attack: 0.001, wet: 0.35 });
    tone(o, { f: f * 2.11, t, dur: 0.24, gain: 0.09, attack: 0.001, wet: 0.35 });
    tone(o, { f: f * 2.83, t, dur: 0.16, gain: 0.05, attack: 0.001 });
    noise(o, { t, dur: 0.025, gain: 0.3, attack: 0.001, type: 'highpass', f: 5000 });
  },
  guardBreak: (o, t) => {
    [1, 1.26, 1.5].forEach((ratio, i) => {
      tone(o, {
        type: 'triangle',
        f: 2500 * ratio,
        fEnd: 280 * ratio,
        glide: 0.42,
        t: t + i * 0.012,
        dur: 0.48,
        gain: 0.15,
        attack: 0.003,
        hold: 0.08,
        wet: 0.3,
      });
    });
    noise(o, { t, dur: 0.32, gain: 0.34, attack: 0.002, type: 'highpass', f: 3600, fEnd: 900, wet: 0.2 });
    thump(o, t, 130, 50, 0.16, 0.5);
  },
  knockdown: (o, t) => {
    thump(o, t, 105, 40, 0.22, 0.85);
    noise(o, { t, dur: 0.13, gain: 0.5, attack: 0.001, type: 'lowpass', f: 420 });
    thump(o, t + 0.15, 90, 42, 0.12, 0.3);
    noise(o, { t: t + 0.15, dur: 0.07, gain: 0.18, type: 'lowpass', f: 360 });
  },
  ko: (o, t) => {
    tone(o, { f: 92, fEnd: 28, glide: 0.7, t, dur: 1.0, gain: 1, attack: 0.003, hold: 0.1, wet: 0.3 });
    noise(o, { t, dur: 0.8, gain: 0.6, attack: 0.002, type: 'lowpass', f: 1000, fEnd: 110, wet: 0.6 });
    tone(o, { f: 220, t, dur: 1.3, gain: 0.1, attack: 0.004, wet: 0.7 });
    tone(o, { f: 331, t, dur: 1.0, gain: 0.07, attack: 0.004, wet: 0.7 });
  },

  /* ------------------------------ gauges ----------------------------- */
  specialStart: (o, t) => {
    tone(o, {
      type: 'sawtooth',
      f: 110,
      fEnd: 660,
      glide: 0.4,
      t,
      dur: 0.5,
      gain: 0.22,
      attack: 0.3,
      hold: 0.1,
      lp: 420,
      lpEnd: 5200,
      q: 3,
    });
    noise(o, { t, dur: 0.46, gain: 0.3, attack: 0.36, type: 'highpass', f: 1200, fEnd: 6000 });
    tone(o, { f: 1320, t: t + 0.38, dur: 0.3, gain: 0.14, attack: 0.004, wet: 0.5 });
    tone(o, { f: 1980, t: t + 0.38, dur: 0.22, gain: 0.07, attack: 0.004, wet: 0.5 });
  },
  meterFull: (o, t) => {
    for (const [f, dt, dur] of [
      [880, 0, 0.16],
      [1318.5, 0.11, 0.4],
    ] as const) {
      tone(o, { f, t: t + dt, dur, gain: 0.22, attack: 0.003, wet: 0.35 });
      tone(o, { type: 'triangle', f: f * 2, t: t + dt, dur: dur * 0.6, gain: 0.07, attack: 0.003 });
    }
  },

  /* --------------------------- announcements ------------------------- */
  roundStart: (o, t) => {
    bell(o, t, 524, 0.34, 1.7, 0.35);
  },
  fight: (o, t) => {
    bell(o, t, 622, 0.32, 0.5, 0.25);
    bell(o, t + 0.17, 622, 0.36, 1.3, 0.35);
    thump(o, t + 0.17, 110, 46, 0.2, 0.3);
  },
  roundClear: (o, t) => {
    notes(o, t, [72, 76, 79], 0.085, 0.16, 0.24);
    tone(o, { type: 'triangle', f: mtof(84), t: t + 0.255, dur: 0.6, gain: 0.26, attack: 0.005, hold: 0.1, wet: 0.4 });
    tone(o, { f: mtof(79), t: t + 0.255, dur: 0.5, gain: 0.12, attack: 0.005, wet: 0.4 });
  },
  upgrade: (o, t) => {
    notes(o, t, [76, 81, 85, 88], 0.06, 0.22, 0.18, 'sine', 0.45);
    tone(o, { type: 'triangle', f: mtof(100), t: t + 0.24, dur: 0.35, gain: 0.05, attack: 0.004, wet: 0.6 });
  },
  victory: (o, t) => {
    const brass = (midi: number, at: number, dur: number, gain: number): void => {
      voice(o, {
        oscs: [{ type: 'sawtooth', detune: -6 }, { type: 'square', detune: 6, gain: 0.5 }],
        f: mtof(midi),
        t: t + at,
        dur,
        gain,
        attack: 0.015,
        release: 0.12,
        lp: 1700,
        lpPeak: 3600,
        lpDecay: 0.18,
        q: 1.2,
        wet: 0.3,
      });
    };
    brass(67, 0, 0.1, 0.16);
    brass(72, 0.13, 0.1, 0.16);
    brass(76, 0.26, 0.1, 0.16);
    brass(79, 0.39, 0.16, 0.17);
    for (const m of [72, 76, 79, 84]) brass(m, 0.62, 0.85, 0.085);
    tone(o, { f: mtof(96), t: t + 0.62, dur: 0.9, gain: 0.05, attack: 0.01, wet: 0.6 });
  },
  defeat: (o, t) => {
    [76, 74, 72, 69].forEach((m, i) => {
      tone(o, {
        type: 'triangle',
        f: mtof(m),
        t: t + i * 0.24,
        dur: i === 3 ? 1.1 : 0.34,
        gain: 0.22,
        attack: 0.012,
        hold: 0.08,
        lp: 2200 - i * 420,
        wet: 0.45,
      });
    });
    tone(o, { f: mtof(45), t: t + 0.72, dur: 1.4, gain: 0.26, attack: 0.08, hold: 0.3, wet: 0.3 });
  },
  timerTick: (o, t) => {
    tone(o, { f: 1250, fEnd: 940, glide: 0.02, t, dur: 0.04, gain: 0.2, attack: 0.001 });
    noise(o, { t, dur: 0.012, gain: 0.1, attack: 0.001, type: 'highpass', f: 5000 });
  },

  /* ----------------------------- ambience ---------------------------- */
  train: (o, t) => {
    const len = TRAIN_SECONDS;
    noise(o, { t, dur: len, gain: 0.85, attack: len * 0.38, hold: len * 0.12, type: 'lowpass', f: 170, fEnd: 130, q: 0.9 });
    noise(o, { t, dur: len, gain: 0.07, attack: len * 0.42, hold: len * 0.08, f: 1900, q: 0.6 });
    // Wheels over rail joints: paired low knocks, loudest as it passes.
    const pairs = 9;
    for (let i = 0; i < pairs; i++) {
      const at = t + 0.35 + i * 0.33;
      const near = 1 - Math.abs((i + 0.5) / pairs - 0.5) * 2;
      const g = 0.1 + 0.34 * near;
      thump(o, at, 86, 52, 0.09, g);
      thump(o, at + 0.085, 78, 50, 0.09, g * 0.8);
    }
  },
};

interface ActiveSound {
  group: GainNode;
  nodes: AudioNode[];
  out: Out;
  started: number;
}

const MAX_SOUNDS = 16;
const RETRIGGER_SECONDS = 0.03;

/** Plays recipes on the SFX bus with panning, voice limiting and cleanup. */
export class SfxPlayer {
  private readonly active: ActiveSound[] = [];
  private readonly last: Partial<Record<SfxId, number>> = {};

  constructor(private readonly g: Graph) {}

  /** Number of sounds currently holding nodes (for tests / tooling). */
  get activeCount(): number {
    return this.active.length;
  }

  play(id: SfxId, opts?: SfxOptions): void {
    const recipe = RECIPES[id];
    if (!recipe) return;
    const { ctx } = this.g;
    const now = ctx.currentTime;

    const prev = this.last[id];
    if (prev !== undefined && now - prev >= 0 && now - prev < RETRIGGER_SECONDS) return;
    this.last[id] = now;

    this.prune(now);
    while (this.active.length >= MAX_SOUNDS) this.steal(this.active[0]!, now);

    const gain = Math.min(2, Math.max(0, finite(opts?.gain, 1)));
    if (gain <= 0) return;

    const group = ctx.createGain();
    group.gain.value = gain;
    const nodes: AudioNode[] = [group];
    let head: AudioNode = group;

    const wantsPan = opts?.pan !== undefined || id === 'train';
    if (wantsPan && typeof ctx.createStereoPanner === 'function') {
      try {
        const panner = ctx.createStereoPanner();
        const pan = Math.min(1, Math.max(-1, finite(opts?.pan, 0)));
        if (id === 'train') {
          // Sweeps left to right; a negative pan reverses the direction.
          const dir = pan < 0 ? -1 : 1;
          panner.pan.setValueAtTime(-0.9 * dir, now);
          panner.pan.linearRampToValueAtTime(0.9 * dir, now + TRAIN_SECONDS);
        } else {
          panner.pan.value = pan;
        }
        head.connect(panner);
        head = panner;
        nodes.push(panner);
      } catch {
        /* play centred */
      }
    }
    head.connect(this.g.sfxBus);

    let wet: GainNode | null = null;
    if (this.g.sfxSend) {
      wet = ctx.createGain();
      wet.gain.value = gain;
      wet.connect(this.g.sfxSend);
      nodes.push(wet);
    }

    const out: Out = { ctx, dry: group, wet, noise: this.g.noise, end: now };
    const sound: ActiveSound = { group, nodes, out, started: now };
    this.active.push(sound);
    try {
      recipe(out, now + 0.004);
    } catch {
      this.release(sound);
    }
  }

  /** Drop every sound immediately. */
  stopAll(): void {
    for (const s of [...this.active]) this.release(s);
  }

  private prune(now: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i]!;
      if (s.out.end + 0.25 < now) this.release(s);
    }
  }

  private steal(s: ActiveSound, now: number): void {
    const i = this.active.indexOf(s);
    if (i >= 0) this.active.splice(i, 1);
    try {
      s.group.gain.cancelScheduledValues(now);
      s.group.gain.setTargetAtTime(0, now, 0.012);
    } catch {
      /* disconnect below regardless */
    }
    setTimeout(() => disconnectAll(s.nodes), 90);
  }

  private release(s: ActiveSound): void {
    const i = this.active.indexOf(s);
    if (i >= 0) this.active.splice(i, 1);
    disconnectAll(s.nodes);
  }
}

function disconnectAll(nodes: AudioNode[]): void {
  for (const n of nodes) {
    try {
      n.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}

function finite(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
