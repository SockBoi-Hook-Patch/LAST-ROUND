import type { VolumeKind } from './types';

/**
 * The fixed part of the audio graph:
 *
 *   sfxBus ───────────────┐
 *   musicBus ─────────────┤
 *   sfxSend ─┐            ├─> master ─> limiter ─> destination
 *   musicSend┴─> reverb ──┘
 *
 * The reverb is shared; each send carries its bus volume so the wet signal
 * follows the same sliders as the dry one.
 */
export interface Graph {
  ctx: BaseAudioContext;
  master: GainNode;
  sfxBus: GainNode;
  musicBus: GainNode;
  sfxSend: GainNode | null;
  musicSend: GainNode | null;
  noise: AudioBuffer;
}

export type Volumes = Record<VolumeKind, number>;

export const DEFAULT_VOLUMES: Readonly<Volumes> = { master: 0.8, music: 0.55, sfx: 0.9 };

/** Slider position (0..1) to linear gain; a mild curve feels even to the ear. */
export const volumeToGain = (v: number): number => Math.pow(Math.min(1, Math.max(0, v)), 1.5);

function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 2);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** A short, dark synthetic room: decaying noise, smoothed towards the tail. */
function makeImpulse(ctx: BaseAudioContext): AudioBuffer {
  const seconds = 1.1;
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const p = i / length;
      const white = Math.random() * 2 - 1;
      // One-pole low-pass that closes as the tail decays.
      const k = 0.55 - 0.4 * p;
      low += k * (white - low);
      data[i] = low * Math.pow(1 - p, 2.6);
    }
  }
  return buffer;
}

export function buildGraph(ctx: BaseAudioContext, vol: Readonly<Volumes>, muted = false): Graph {
  const master = ctx.createGain();
  master.gain.value = muted ? 0 : volumeToGain(vol.master);

  let tail: AudioNode = master;
  try {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 10;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    master.connect(limiter);
    tail = limiter;
  } catch {
    tail = master;
  }
  tail.connect(ctx.destination);

  const sfxBus = ctx.createGain();
  sfxBus.gain.value = volumeToGain(vol.sfx);
  sfxBus.connect(master);
  const musicBus = ctx.createGain();
  musicBus.gain.value = volumeToGain(vol.music);
  musicBus.connect(master);

  let sfxSend: GainNode | null = null;
  let musicSend: GainNode | null = null;
  try {
    const reverb = ctx.createConvolver();
    reverb.buffer = makeImpulse(ctx);
    const wetReturn = ctx.createGain();
    wetReturn.gain.value = 0.9;
    reverb.connect(wetReturn);
    wetReturn.connect(master);
    sfxSend = ctx.createGain();
    sfxSend.gain.value = volumeToGain(vol.sfx);
    sfxSend.connect(reverb);
    musicSend = ctx.createGain();
    musicSend.gain.value = volumeToGain(vol.music);
    musicSend.connect(reverb);
  } catch {
    sfxSend = null;
    musicSend = null;
  }

  return { ctx, master, sfxBus, musicBus, sfxSend, musicSend, noise: makeNoise(ctx) };
}

/** Smoothly move a parameter to `value`, falling back to a hard set. */
export function rampTo(param: AudioParam, value: number, now: number, timeConstant = 0.03): void {
  try {
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, timeConstant);
  } catch {
    try {
      param.value = value;
    } catch {
      /* nothing else to try */
    }
  }
}
