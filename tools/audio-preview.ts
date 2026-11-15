/**
 * Development-only audio lab: `npx vite` then open /tools/audio-preview.html.
 * One button per sound effect and music track, the mix sliders, a level
 * meter, and offline render helpers on `window.__audioLab` for automated
 * checks.
 */
import { WebAudioEngine } from '../src/audio/engine';
import { buildGraph, DEFAULT_VOLUMES } from '../src/audio/graph';
import { RECIPES } from '../src/audio/sfx';
import type { Out } from '../src/audio/synth';
import { TRACKS } from '../src/audio/tracks';
import type { MusicId, SfxId, VolumeKind } from '../src/audio/types';

const engine = new WebAudioEngine();
const SFX_IDS = Object.keys(RECIPES) as SfxId[];
const MUSIC_IDS: MusicId[] = ['none', 'menu', 'fight', 'boss', 'interlude'];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const status = $('status');
const log = $('log');
const meterFill = $('meter').firstElementChild as HTMLElement;

window.addEventListener('error', (e) => {
  log.textContent += `${e.message}\n`;
});

/* ------------------------------ meter ------------------------------ */

let analyser: AnalyserNode | null = null;
let scope: Float32Array<ArrayBuffer> | null = null;
let heldPeak = 0;

function attachMeter(): void {
  const graph = engine.debugGraph();
  if (!graph || analyser) return;
  analyser = graph.ctx.createAnalyser();
  analyser.fftSize = 2048;
  scope = new Float32Array(analyser.fftSize);
  graph.master.connect(analyser);
}

/** Largest absolute sample currently in the analyser window (post master). */
function peak(): number {
  if (!analyser || !scope) return 0;
  analyser.getFloatTimeDomainData(scope);
  let max = 0;
  for (let i = 0; i < scope.length; i++) max = Math.max(max, Math.abs(scope[i]!));
  return max;
}

function frame(): void {
  heldPeak = Math.max(peak(), heldPeak * 0.92);
  meterFill.style.width = `${Math.min(100, heldPeak * 100).toFixed(1)}%`;
  status.textContent = engine.unlocked
    ? `running · music: ${engine.debugPlayers().music?.current ?? 'none'} · sounds: ${engine.debugPlayers().sfx?.activeCount ?? 0}`
    : engine.supported
      ? 'locked — click anything to start audio'
      : 'Web Audio is not available in this browser';
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

async function unlock(): Promise<boolean> {
  const ok = await engine.unlock();
  attachMeter();
  return ok;
}
window.addEventListener('pointerdown', () => void unlock());
window.addEventListener('keydown', () => void unlock());

/* ----------------------------- controls ---------------------------- */

const panInput = $<HTMLInputElement>('pan');

for (const id of SFX_IDS) {
  const b = document.createElement('button');
  b.textContent = id;
  b.dataset.sfx = id;
  b.addEventListener('click', () => {
    void unlock().then(() => engine.play(id, { pan: Number(panInput.value) }));
  });
  $('sfx').append(b);
}

const musicButtons: HTMLButtonElement[] = [];
for (const id of MUSIC_IDS) {
  const b = document.createElement('button');
  b.textContent = id;
  b.dataset.music = id;
  b.setAttribute('aria-pressed', String(id === 'none'));
  b.addEventListener('click', () => {
    engine.setMusic(id);
    for (const other of musicButtons) other.setAttribute('aria-pressed', String(other === b));
    void unlock();
  });
  musicButtons.push(b);
  $('music').append(b);
}

function bindSlider(id: string, initial: number, apply: (v: number) => void): void {
  const input = $<HTMLInputElement>(id);
  const out = input.nextElementSibling as HTMLOutputElement;
  input.value = String(initial);
  const update = (): void => {
    out.textContent = Number(input.value).toFixed(2);
    apply(Number(input.value));
  };
  input.addEventListener('input', update);
  update();
}
for (const kind of ['master', 'music', 'sfx'] as VolumeKind[]) {
  bindSlider(`vol-${kind}`, engine.getVolume(kind), (v) => engine.setVolume(kind, v));
}
bindSlider('intensity', 0, (v) => engine.setIntensity(v));
bindSlider('pan', 0, () => {});

const muteButton = $<HTMLButtonElement>('mute');
muteButton.addEventListener('click', () => {
  engine.setMuted(!engine.isMuted());
  muteButton.setAttribute('aria-pressed', String(engine.isMuted()));
});
$('suspend').addEventListener('click', () => engine.suspend());
$('resume').addEventListener('click', () => engine.resume());

/* -------------------------- offline renders ------------------------- */

export interface Levels {
  peak: number;
  rms: number;
  /** Seconds until the last audible sample. */
  length: number;
  /** Share of 50 ms windows that are effectively silent. */
  silent: number;
  /** Spectral centroid estimate in Hz (zero-crossing based). */
  brightness: number;
}

function measure(buffer: AudioBuffer): Levels {
  const n = buffer.length;
  const chans = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  let peakValue = 0;
  let sum = 0;
  let last = 0;
  let crossings = 0;
  let prev = 0;
  const win = Math.floor(buffer.sampleRate * 0.05);
  let winSum = 0;
  let silentWindows = 0;
  let windows = 0;
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (const ch of chans) v += ch[i]!;
    v /= chans.length;
    const a = Math.abs(v);
    if (a > peakValue) peakValue = a;
    if (a > 0.002) last = i;
    sum += v * v;
    winSum += v * v;
    if ((v >= 0) !== (prev >= 0)) crossings++;
    prev = v;
    if ((i + 1) % win === 0) {
      if (Math.sqrt(winSum / win) < 0.003) silentWindows++;
      windows++;
      winSum = 0;
    }
  }
  return {
    peak: peakValue,
    rms: Math.sqrt(sum / Math.max(1, n)),
    length: last / buffer.sampleRate,
    silent: windows ? silentWindows / windows : 1,
    brightness: (crossings / 2 / n) * buffer.sampleRate,
  };
}

type Mode = 'raw' | 'mix';

/**
 * `raw` renders straight to the destination (no reverb, no bus volumes, no
 * limiter) to calibrate recipe levels; `mix` renders through the real graph
 * at the default volumes, i.e. what a player hears.
 */
function offlineOut(ctx: OfflineAudioContext, mode: Mode, bus: 'sfx' | 'music'): Out {
  if (mode === 'raw') {
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return { ctx, dry: ctx.destination, wet: null, noise, end: 0 };
  }
  const graph = buildGraph(ctx, DEFAULT_VOLUMES);
  return bus === 'sfx'
    ? { ctx, dry: graph.sfxBus, wet: graph.sfxSend, noise: graph.noise, end: 0 }
    : { ctx, dry: graph.musicBus, wet: graph.musicSend, noise: graph.noise, end: 0 };
}

async function renderSfx(id: SfxId, mode: Mode = 'raw'): Promise<Levels> {
  const rate = 44100;
  const ctx = new OfflineAudioContext(2, rate * 5, rate);
  const out = offlineOut(ctx, mode, 'sfx');
  RECIPES[id](out, 0.01);
  return measure(await ctx.startRendering());
}

async function renderMusic(id: Exclude<MusicId, 'none'>, seconds = 12, intensity = 0, mode: Mode = 'raw', fromBar = 0): Promise<Levels> {
  const rate = 44100;
  const ctx = new OfflineAudioContext(2, Math.floor(rate * seconds), rate);
  const out = offlineOut(ctx, mode, 'music');
  const def = TRACKS[id];
  const stepDur = 60 / def.bpm / 4;
  const total = def.bars * 16;
  let step = (fromBar * 16) % total;
  let loop = Math.floor((fromBar * 16) / total);
  for (let t = 0.05; t < seconds; t += stepDur) {
    def.schedule(out, step, t, stepDur, intensity, loop);
    step += 1;
    if (step >= total) {
      step = 0;
      loop += 1;
    }
  }
  return measure(await ctx.startRendering());
}

const lab = { engine, peak, renderSfx, renderMusic, sfxIds: SFX_IDS, musicIds: MUSIC_IDS };
declare global {
  interface Window {
    __audioLab: typeof lab;
  }
}
window.__audioLab = lab;
