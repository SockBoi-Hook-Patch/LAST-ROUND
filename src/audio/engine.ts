import { buildGraph, DEFAULT_VOLUMES, rampTo, volumeToGain, type Graph, type Volumes } from './graph';
import { MusicPlayer } from './music';
import { SfxPlayer } from './sfx';
import type { AudioEngine, MusicId, SfxId, SfxOptions, VolumeKind } from './types';

type ContextCtor = new (options?: AudioContextOptions) => AudioContext;

function findCtor(): ContextCtor | null {
  try {
    const g = globalThis as unknown as { AudioContext?: ContextCtor; webkitAudioContext?: ContextCtor };
    const ctor = g.AudioContext ?? g.webkitAudioContext;
    return typeof ctor === 'function' ? ctor : null;
  } catch {
    return null;
  }
}

const noop = (): void => {};

/** Resolve when `p` settles or after `ms`, whichever comes first. */
function settle(p: unknown, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = (): void => {
      clearTimeout(timer);
      resolve();
    };
    Promise.resolve(p).then(done, done);
  });
}

/**
 * Web Audio implementation of the game's audio engine.
 *
 * The context is created lazily on the first `unlock()` (browsers only allow
 * sound after a user gesture). Every public method swallows its own errors:
 * audio is decoration and may never take the game down with it.
 */
export class WebAudioEngine implements AudioEngine {
  private ctx: AudioContext | null = null;
  private graph: Graph | null = null;
  private sfx: SfxPlayer | null = null;
  private music: MusicPlayer | null = null;

  /** Creating the context or its graph failed: stay silent for good. */
  private failed = false;
  /** The context has been running at least once. */
  private everRan = false;
  /** `suspend()` was called by the game (pause menu). */
  private paused = false;
  /** The page is hidden. */
  private hidden = false;
  private muted = false;
  private readonly vol: Volumes = { ...DEFAULT_VOLUMES };
  private track: MusicId = 'none';
  private intensity = 0;
  private unlocking: Promise<boolean> | null = null;

  constructor() {
    try {
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        this.hidden = document.visibilityState === 'hidden';
        document.addEventListener('visibilitychange', () => {
          this.hidden = document.visibilityState === 'hidden';
          this.reconcile();
        });
      }
    } catch {
      this.hidden = false;
    }
  }

  get supported(): boolean {
    return !this.failed && findCtor() !== null;
  }

  get unlocked(): boolean {
    const ctx = this.ctx;
    if (!ctx || !this.everRan) return false;
    return ctx.state === 'running' || (this.wantSuspended() && ctx.state === 'suspended');
  }

  unlock(): Promise<boolean> {
    if (this.unlocking) return this.unlocking;
    const attempt = this.doUnlock()
      .catch(() => false)
      .then((ok) => {
        this.unlocking = null;
        return ok;
      });
    this.unlocking = attempt;
    return attempt;
  }

  play(id: SfxId, opts?: SfxOptions): void {
    try {
      const ctx = this.ctx;
      if (!ctx || !this.sfx || this.muted || ctx.state !== 'running') return;
      this.sfx.play(id, opts);
    } catch {
      /* never throw */
    }
  }

  setMusic(id: MusicId): void {
    try {
      this.track = id;
      this.music?.setTrack(id);
    } catch {
      /* never throw */
    }
  }

  setIntensity(v: number): void {
    try {
      this.intensity = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
      this.music?.setIntensity(this.intensity);
    } catch {
      /* never throw */
    }
  }

  setVolume(kind: VolumeKind, v: number): void {
    try {
      if (kind !== 'master' && kind !== 'music' && kind !== 'sfx') return;
      this.vol[kind] = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
      this.applyVolumes();
    } catch {
      /* never throw */
    }
  }

  getVolume(kind: VolumeKind): number {
    return this.vol[kind] ?? 0;
  }

  setMuted(muted: boolean): void {
    try {
      this.muted = !!muted;
      this.applyVolumes();
    } catch {
      /* never throw */
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  suspend(): void {
    this.paused = true;
    this.reconcile();
  }

  resume(): void {
    this.paused = false;
    this.reconcile();
  }

  /** Internal nodes, for the preview tool and tests. Not part of the API. */
  debugGraph(): Graph | null {
    return this.graph;
  }

  /** Internal players, for tests. Not part of the API. */
  debugPlayers(): { sfx: SfxPlayer | null; music: MusicPlayer | null } {
    return { sfx: this.sfx, music: this.music };
  }

  /* ---------------------------------------------------------------- */

  private wantSuspended(): boolean {
    return this.paused || this.hidden;
  }

  private async doUnlock(): Promise<boolean> {
    if (!this.ensureContext()) return false;
    const ctx = this.ctx!;
    // Paused or in the background: the context stays quiet until `resume()`.
    if (this.wantSuspended()) return this.unlocked;
    if (ctx.state !== 'running') {
      this.prime(ctx);
      await settle(ctx.resume(), 500);
    }
    if (ctx.state === 'running') {
      this.onRunning();
      return true;
    }
    return false;
  }

  /** Create the context and graph. Must run synchronously inside a gesture. */
  private ensureContext(): boolean {
    if (this.ctx) return true;
    if (this.failed) return false;
    const Ctor = findCtor();
    if (!Ctor) return false;
    let ctx: AudioContext | null = null;
    try {
      try {
        ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        ctx = new Ctor();
      }
      const graph = buildGraph(ctx, this.vol, this.muted);
      const music = new MusicPlayer(graph);
      music.setIntensity(this.intensity);
      this.ctx = ctx;
      this.graph = graph;
      this.sfx = new SfxPlayer(graph);
      this.music = music;
      ctx.onstatechange = () => this.reconcile();
      return true;
    } catch {
      this.failed = true;
      this.ctx = null;
      this.graph = null;
      this.sfx = null;
      this.music = null;
      try {
        void Promise.resolve(ctx?.close()).catch(noop);
      } catch {
        /* nothing to close */
      }
      return false;
    }
  }

  /** A one-sample silent buffer nudges older mobile browsers awake. */
  private prime(ctx: AudioContext): void {
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* optional */
    }
  }

  private onRunning(): void {
    this.everRan = true;
    const music = this.music;
    if (!music) return;
    music.setTrack(this.track);
    music.setActive(true);
  }

  /** Bring the context in line with what the game and the page want. */
  private reconcile(): void {
    const ctx = this.ctx;
    const music = this.music;
    if (!ctx || !music) return;
    try {
      const state: string = ctx.state;
      if (state === 'closed') {
        music.setActive(false);
      } else if (this.wantSuspended()) {
        music.setActive(false);
        if (state === 'running') void Promise.resolve(ctx.suspend()).catch(noop);
      } else if (state === 'running') {
        this.onRunning();
      } else {
        music.setActive(false);
        // Only contexts that were already allowed to play may resume without
        // a gesture; otherwise the next `unlock()` takes care of it.
        if (this.everRan) void Promise.resolve(ctx.resume()).catch(noop);
      }
    } catch {
      /* never throw */
    }
  }

  private applyVolumes(): void {
    const g = this.graph;
    if (!g) return;
    const now = g.ctx.currentTime;
    const sfx = volumeToGain(this.vol.sfx);
    const music = volumeToGain(this.vol.music);
    rampTo(g.master.gain, this.muted ? 0 : volumeToGain(this.vol.master), now);
    rampTo(g.sfxBus.gain, sfx, now);
    rampTo(g.musicBus.gain, music, now);
    if (g.sfxSend) rampTo(g.sfxSend.gain, sfx, now);
    if (g.musicSend) rampTo(g.musicSend.gain, music, now);
  }
}

export function createAudioEngine(): AudioEngine {
  return new WebAudioEngine();
}
