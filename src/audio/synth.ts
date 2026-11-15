/**
 * Small synthesis building blocks shared by the SFX recipes and the music
 * tracks. Everything works on a `BaseAudioContext` so the exact same code can
 * be rendered through an `OfflineAudioContext` by tooling.
 */

/** Where a voice sends its sound. */
export interface Out {
  ctx: BaseAudioContext;
  /** Dry destination (a bus or a per-sound group node). */
  dry: AudioNode;
  /** Reverb send, or null when the reverb is unavailable. */
  wet: AudioNode | null;
  /** Shared white-noise buffer. */
  noise: AudioBuffer;
  /** Latest stop time scheduled through this output, in context time. */
  end: number;
}

const MIN = 0.0001;

export const mtof = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

export const rand = (a: number, b: number): number => a + Math.random() * (b - a);

const hz = (f: number): number => Math.min(20000, Math.max(10, f));
const at = (t: number): number => Math.max(0, t);

/** Percussive envelope: linear attack, optional hold, exponential decay. */
function percEnv(p: AudioParam, t: number, peak: number, attack: number, hold: number, dur: number): void {
  const top = Math.max(MIN, peak);
  const a = Math.max(0.001, attack);
  p.setValueAtTime(MIN, at(t));
  p.linearRampToValueAtTime(top, at(t + a));
  const h = t + a + Math.max(0, hold);
  if (hold > 0) p.setValueAtTime(top, at(h));
  p.exponentialRampToValueAtTime(MIN, at(Math.max(h + 0.01, t + dur)));
}

function finish(
  o: Out,
  sources: AudioScheduledSourceNode[],
  amp: GainNode,
  extra: Array<AudioNode | null>,
  t: number,
  end: number,
  wet: number | undefined,
  offset?: number,
): void {
  amp.connect(o.dry);
  let send: GainNode | null = null;
  if (wet && wet > 0 && o.wet) {
    send = o.ctx.createGain();
    send.gain.value = wet;
    amp.connect(send);
    send.connect(o.wet);
  }
  const first = sources[0];
  if (first) {
    first.onended = () => {
      try {
        amp.disconnect();
        send?.disconnect();
        for (const s of sources) s.disconnect();
        for (const n of extra) n?.disconnect();
      } catch {
        /* already gone */
      }
    };
  }
  for (const s of sources) {
    if (offset !== undefined) (s as AudioBufferSourceNode).start(at(t), offset);
    else s.start(at(t));
    s.stop(at(end));
  }
  if (end > o.end) o.end = end;
}

export interface ToneSpec {
  type?: OscillatorType;
  /** Start frequency in Hz. */
  f: number;
  /** Frequency reached after `glide` seconds (defaults to `dur`). */
  fEnd?: number;
  glide?: number;
  t: number;
  /** Total audible length including the decay. */
  dur: number;
  gain: number;
  attack?: number;
  hold?: number;
  /** Detune in cents. */
  detune?: number;
  /** Optional low-pass cutoff, swept to `lpEnd` over the duration. */
  lp?: number;
  lpEnd?: number;
  q?: number;
  /** Reverb send level, 0..1. */
  wet?: number;
}

/** A single decaying oscillator. */
export function tone(o: Out, s: ToneSpec): void {
  const { ctx } = o;
  const osc = ctx.createOscillator();
  osc.type = s.type ?? 'sine';
  osc.frequency.setValueAtTime(hz(s.f), at(s.t));
  if (s.fEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(hz(s.fEnd), at(s.t + (s.glide ?? s.dur)));
  }
  if (s.detune) osc.detune.setValueAtTime(s.detune, at(s.t));
  const amp = ctx.createGain();
  percEnv(amp.gain, s.t, s.gain, s.attack ?? 0.004, s.hold ?? 0, s.dur);
  let filter: BiquadFilterNode | null = null;
  if (s.lp !== undefined) {
    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = s.q ?? 0.7;
    filter.frequency.setValueAtTime(hz(s.lp), at(s.t));
    if (s.lpEnd !== undefined) filter.frequency.exponentialRampToValueAtTime(hz(s.lpEnd), at(s.t + s.dur));
    osc.connect(filter);
    filter.connect(amp);
  } else {
    osc.connect(amp);
  }
  finish(o, [osc], amp, [filter], s.t, s.t + s.dur + 0.03, s.wet);
}

export interface NoiseSpec {
  t: number;
  dur: number;
  gain: number;
  attack?: number;
  hold?: number;
  /** Filter type, default band-pass. */
  type?: BiquadFilterType;
  /** Filter frequency, swept to `fEnd` over the duration. */
  f: number;
  fEnd?: number;
  q?: number;
  wet?: number;
}

/** A filtered burst of the shared noise buffer. */
export function noise(o: Out, s: NoiseSpec): void {
  const { ctx } = o;
  const src = ctx.createBufferSource();
  src.buffer = o.noise;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = s.type ?? 'bandpass';
  filter.Q.value = s.q ?? 1;
  filter.frequency.setValueAtTime(hz(s.f), at(s.t));
  if (s.fEnd !== undefined) filter.frequency.exponentialRampToValueAtTime(hz(s.fEnd), at(s.t + s.dur));
  const amp = ctx.createGain();
  percEnv(amp.gain, s.t, s.gain, s.attack ?? 0.002, s.hold ?? 0, s.dur);
  src.connect(filter);
  filter.connect(amp);
  const span = Math.max(0, (o.noise.duration || 1) - 0.05);
  finish(o, [src], amp, [filter], s.t, s.t + s.dur + 0.03, s.wet, Math.random() * span);
}

export interface VoiceOsc {
  type: OscillatorType;
  /** Detune in cents. */
  detune?: number;
  /** Octave shift. */
  octave?: number;
  /** Relative level, default 1. */
  gain?: number;
}

export interface VoiceSpec {
  oscs: readonly VoiceOsc[];
  /** One frequency, or several for a chord sharing one filter and envelope. */
  f: number | readonly number[];
  t: number;
  /** Gate length; the release follows. */
  dur: number;
  gain: number;
  attack: number;
  release: number;
  /** Resting low-pass cutoff. */
  lp?: number;
  /** Cutoff at note start, decaying to `lp` over `lpDecay`. */
  lpPeak?: number;
  lpDecay?: number;
  q?: number;
  wet?: number;
}

/** A sustained subtractive voice: oscillators -> low-pass -> gated amp. */
export function voice(o: Out, s: VoiceSpec): void {
  const { ctx } = o;
  const freqs = typeof s.f === 'number' ? [s.f] : s.f;
  const amp = ctx.createGain();
  const top = Math.max(MIN, s.gain);
  const t0 = at(s.t);
  const tEnd = s.t + Math.max(0.01, s.dur);
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(top, at(s.t + Math.max(0.002, s.attack)));
  amp.gain.setValueAtTime(top, at(Math.max(tEnd, s.t + s.attack + 0.001)));
  const stop = Math.max(tEnd, s.t + s.attack + 0.001) + Math.max(0.01, s.release);
  amp.gain.linearRampToValueAtTime(0, at(stop));

  let head: AudioNode = amp;
  let filter: BiquadFilterNode | null = null;
  if (s.lp !== undefined) {
    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = s.q ?? 0.8;
    if (s.lpPeak !== undefined) {
      filter.frequency.setValueAtTime(hz(s.lpPeak), t0);
      filter.frequency.exponentialRampToValueAtTime(hz(s.lp), at(s.t + (s.lpDecay ?? 0.15)));
    } else {
      filter.frequency.setValueAtTime(hz(s.lp), t0);
    }
    filter.connect(amp);
    head = filter;
  }

  const sources: OscillatorNode[] = [];
  const extra: Array<AudioNode | null> = [filter];
  for (const f of freqs) {
    for (const d of s.oscs) {
      const osc = ctx.createOscillator();
      osc.type = d.type;
      osc.frequency.setValueAtTime(hz(f * Math.pow(2, d.octave ?? 0)), t0);
      if (d.detune) osc.detune.setValueAtTime(d.detune, t0);
      if (d.gain !== undefined && d.gain !== 1) {
        const g = ctx.createGain();
        g.gain.value = d.gain;
        osc.connect(g);
        g.connect(head);
        extra.push(g);
      } else {
        osc.connect(head);
      }
      sources.push(osc);
    }
  }
  finish(o, sources, amp, extra, s.t, stop + 0.02, s.wet);
}

/** Relative frequencies, levels and decay factors of a struck ring bell. */
const BELL = [
  [1, 1, 1],
  [1.48, 0.45, 0.9],
  [2.37, 0.6, 0.7],
  [2.93, 0.32, 0.55],
  [4.02, 0.22, 0.4],
  [5.13, 0.12, 0.3],
] as const;

/** An inharmonic struck-metal bell. */
export function bell(o: Out, t: number, f0: number, gain: number, decay: number, wet = 0.3): void {
  for (const [ratio, level, life] of BELL) {
    tone(o, { f: f0 * ratio, t, dur: decay * life, gain: gain * level, attack: 0.002, wet });
  }
  noise(o, { t, dur: 0.03, gain: gain * 0.5, type: 'highpass', f: 4500, attack: 0.001 });
}
