import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioEngine } from '../../src/audio';
import { WebAudioEngine } from '../../src/audio/engine';
import { volumeToGain } from '../../src/audio/graph';
import { RECIPES } from '../../src/audio/sfx';
import { TRACKS } from '../../src/audio/tracks';
import type { AudioEngine, MusicId, SfxId, VolumeKind } from '../../src/audio/types';

/* ------------------------------------------------------------------ */
/* A strict, hand-written fake of the parts of Web Audio the engine    */
/* uses. Anything a real browser would reject (negative times,         */
/* exponential ramps to zero, double starts, ...) is recorded in       */
/* `violations` so swallowed errors still fail the tests.              */
/* ------------------------------------------------------------------ */

const violations: string[] = [];
const flag = (msg: string): void => {
  violations.push(msg);
};
const okTime = (t: unknown): boolean => typeof t === 'number' && Number.isFinite(t) && t >= 0;
const okValue = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);

class FakeParam {
  value = 0;
  events = 0;
  setValueAtTime(v: number, t: number): this {
    if (!okValue(v) || !okTime(t)) flag(`setValueAtTime(${v}, ${t})`);
    this.value = v;
    this.events++;
    return this;
  }
  linearRampToValueAtTime(v: number, t: number): this {
    if (!okValue(v) || !okTime(t)) flag(`linearRampToValueAtTime(${v}, ${t})`);
    this.value = v;
    this.events++;
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number): this {
    if (!okValue(v) || v <= 0 || !okTime(t)) flag(`exponentialRampToValueAtTime(${v}, ${t})`);
    this.value = v;
    this.events++;
    return this;
  }
  setTargetAtTime(v: number, t: number, tc: number): this {
    if (!okValue(v) || !okTime(t) || !okValue(tc) || tc < 0) flag(`setTargetAtTime(${v}, ${t}, ${tc})`);
    this.value = v;
    this.events++;
    return this;
  }
  cancelScheduledValues(t: number): this {
    if (!okTime(t)) flag(`cancelScheduledValues(${t})`);
    return this;
  }
}

class FakeNode {
  outputs = 0;
  disconnected = false;
  constructor(readonly ctx: FakeContext) {
    ctx.created++;
  }
  connect(dest: unknown): unknown {
    if (!(dest instanceof FakeNode)) flag('connect() to a non-node');
    this.outputs++;
    return dest;
  }
  disconnect(): void {
    this.disconnected = true;
    this.outputs = 0;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
  constructor(ctx: FakeContext) {
    super(ctx);
    this.gain.value = 1;
  }
}

class FakeSource extends FakeNode {
  onended: (() => void) | null = null;
  started = false;
  stopAt = Infinity;
  start(t = 0, offset = 0): void {
    if (this.started) flag('start() called twice');
    if (!okTime(t) || !okTime(offset)) flag(`start(${t}, ${offset})`);
    this.started = true;
    this.ctx.sources.add(this);
  }
  stop(t = 0): void {
    if (!this.started) flag('stop() before start()');
    if (!okTime(t)) flag(`stop(${t})`);
    this.stopAt = t;
  }
}

class FakeOscillator extends FakeSource {
  type = 'sine';
  frequency = new FakeParam();
  detune = new FakeParam();
  constructor(ctx: FakeContext) {
    super(ctx);
    ctx.oscillators++;
  }
}

class FakeBufferSource extends FakeSource {
  buffer: { duration: number } | null = null;
  loop = false;
  override start(t = 0, offset = 0): void {
    super.start(t, offset);
    // A one-shot buffer ends by itself when it has played through.
    if (!this.loop) this.stopAt = Math.max(t, this.ctx.currentTime) + (this.buffer?.duration ?? 0);
  }
}

class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam();
  Q = new FakeParam();
}

class FakeCompressor extends FakeNode {
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
}

class FakePanner extends FakeNode {
  pan = new FakeParam();
}

class FakeConvolver extends FakeNode {
  buffer: unknown = null;
}

interface FakeOptions {
  noPanner?: boolean;
  noConvolver?: boolean;
  noCompressor?: boolean;
  resume?: 'ok' | 'reject' | 'hang';
}

let fakeOptions: FakeOptions = {};
let contexts: FakeContext[] = [];

class FakeContext {
  state = 'suspended';
  currentTime = 0;
  sampleRate = 22050;
  created = 0;
  oscillators = 0;
  sources = new Set<FakeSource>();
  onstatechange: (() => void) | null = null;
  destination: FakeNode;
  resumeCalls = 0;
  suspendCalls = 0;
  createStereoPanner?: () => FakePanner;
  private readonly opts: FakeOptions;

  constructor() {
    this.opts = fakeOptions;
    contexts.push(this);
    this.destination = new FakeNode(this);
    if (!this.opts.noPanner) this.createStereoPanner = () => new FakePanner(this);
  }

  createGain(): FakeGain {
    return new FakeGain(this);
  }
  createOscillator(): FakeOscillator {
    return new FakeOscillator(this);
  }
  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this);
  }
  createBiquadFilter(): FakeFilter {
    return new FakeFilter(this);
  }
  createDynamicsCompressor(): FakeCompressor {
    if (this.opts.noCompressor) throw new Error('no compressor');
    return new FakeCompressor(this);
  }
  createConvolver(): FakeConvolver {
    if (this.opts.noConvolver) throw new Error('no convolver');
    return new FakeConvolver(this);
  }
  createBuffer(channels: number, length: number, sampleRate: number): unknown {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, sampleRate, numberOfChannels: channels, duration: length / sampleRate, getChannelData: (c: number) => data[c] };
  }

  private setState(state: string): void {
    if (this.state === state) return;
    this.state = state;
    this.onstatechange?.();
  }
  resume(): Promise<void> {
    this.resumeCalls++;
    const mode = this.opts.resume ?? 'ok';
    if (mode === 'reject') return Promise.reject(new Error('not allowed'));
    if (mode === 'hang') return new Promise<void>(() => {});
    this.setState('running');
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspendCalls++;
    this.setState('suspended');
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.setState('closed');
    return Promise.resolve();
  }

  /** Test helper: an outside interruption (phone call, device change). */
  interrupt(): void {
    this.setState('interrupted');
  }

  /** Test helper: move the audio clock and end sources that have stopped. */
  advance(seconds: number): void {
    this.currentTime += seconds;
    for (const s of [...this.sources]) {
      if (s.stopAt <= this.currentTime) {
        this.sources.delete(s);
        s.onended?.();
      }
    }
  }
}

const SFX_IDS = Object.keys(RECIPES) as SfxId[];
const MUSIC_IDS: MusicId[] = ['none', 'menu', 'fight', 'boss', 'interlude'];
const KINDS: VolumeKind[] = ['master', 'music', 'sfx'];
const g = globalThis as Record<string, unknown>;

function installFake(options: FakeOptions = {}): void {
  fakeOptions = options;
  g.AudioContext = FakeContext;
}

/** Advance fake timers and the fake audio clock together. */
function run(ctx: FakeContext, seconds: number): void {
  const ticks = Math.round(seconds / 0.025);
  for (let i = 0; i < ticks; i++) {
    ctx.advance(0.025);
    vi.advanceTimersByTime(25);
  }
}

function exerciseEverything(engine: AudioEngine): void {
  engine.setMusic('fight');
  engine.setIntensity(0.5);
  engine.setIntensity(Number.NaN);
  for (const id of SFX_IDS) engine.play(id, { pan: -0.5, gain: 0.8 });
  engine.play('nope' as SfxId);
  engine.setMusic('bogus' as MusicId);
  for (const k of KINDS) engine.setVolume(k, 0.5);
  engine.setVolume('bogus' as VolumeKind, 0.5);
  engine.setMuted(true);
  engine.setMuted(false);
  engine.suspend();
  engine.resume();
  engine.setMusic('none');
}

beforeEach(() => {
  violations.length = 0;
  contexts = [];
  fakeOptions = {};
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete g.AudioContext;
  delete g.webkitAudioContext;
  delete g.document;
});

describe('without Web Audio (plain Node)', () => {
  it('reports unsupported and every method is a safe no-op', async () => {
    const engine = createAudioEngine();
    expect(engine.supported).toBe(false);
    expect(engine.unlocked).toBe(false);
    await expect(engine.unlock()).resolves.toBe(false);
    expect(() => exerciseEverything(engine)).not.toThrow();
    expect(engine.unlocked).toBe(false);
  });

  it('still stores volumes and mute so settings screens keep working', () => {
    const engine = createAudioEngine();
    expect(engine.getVolume('master')).toBeCloseTo(0.8);
    expect(engine.getVolume('music')).toBeCloseTo(0.55);
    expect(engine.getVolume('sfx')).toBeCloseTo(0.9);
    engine.setVolume('music', 7);
    expect(engine.getVolume('music')).toBe(1);
    engine.setVolume('sfx', -3);
    expect(engine.getVolume('sfx')).toBe(0);
    engine.setVolume('master', Number.NaN);
    expect(engine.getVolume('master')).toBe(0);
    engine.setMuted(true);
    expect(engine.isMuted()).toBe(true);
  });

  it('exports a shared singleton that can be imported in Node', async () => {
    const mod = await import('../../src/audio');
    expect(mod.audio.supported).toBe(false);
    expect(() => mod.audio.play('hitLight')).not.toThrow();
  });
});

describe('with a fake AudioContext', () => {
  it('unlocks once and is idempotent', async () => {
    installFake();
    const engine = createAudioEngine();
    expect(engine.supported).toBe(true);
    expect(engine.unlocked).toBe(false);
    expect(contexts).toHaveLength(0); // lazy: nothing before the gesture

    const [a, b] = await Promise.all([engine.unlock(), engine.unlock()]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    await expect(engine.unlock()).resolves.toBe(true);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.state).toBe('running');
    expect(engine.unlocked).toBe(true);
    expect(violations).toEqual([]);
  });

  it('uses webkitAudioContext when it is the only constructor', async () => {
    g.webkitAudioContext = FakeContext;
    const engine = createAudioEngine();
    expect(engine.supported).toBe(true);
    await expect(engine.unlock()).resolves.toBe(true);
  });

  it('plays every sound effect without violating the Web Audio contract', async () => {
    installFake();
    const engine = new WebAudioEngine();
    await engine.unlock();
    const ctx = contexts[0]!;
    for (const id of SFX_IDS) {
      const before = ctx.created;
      engine.play(id);
      expect(ctx.created, `${id} should create nodes`).toBeGreaterThan(before);
      engine.play(id, { pan: 0.7, gain: 0.5 }); // retriggered in the same instant: dropped
      run(ctx, 0.1);
    }
    expect(SFX_IDS.length).toBe(27);
    expect(violations).toEqual([]);

    // Everything ends and is cleaned up.
    run(ctx, 6);
    engine.play('uiMove');
    expect(engine.debugPlayers().sfx!.activeCount).toBe(1);
    run(ctx, 1);
    expect(ctx.sources.size).toBe(0);
    expect(violations).toEqual([]);
  });

  it('rate-limits identical retriggers and caps simultaneous sounds', async () => {
    installFake();
    const engine = new WebAudioEngine();
    await engine.unlock();
    const ctx = contexts[0]!;

    engine.play('hitLight');
    const afterFirst = ctx.created;
    engine.play('hitLight');
    expect(ctx.created).toBe(afterFirst);
    ctx.advance(0.04);
    engine.play('hitLight');
    expect(ctx.created).toBeGreaterThan(afterFirst);

    for (let i = 0; i < 40; i++) {
      ctx.currentTime += 0.031; // no source ends: nothing is pruned naturally
      engine.play('ko', { pan: i % 2 ? 1 : -1 });
      expect(engine.debugPlayers().sfx!.activeCount).toBeLessThanOrEqual(16);
    }
    vi.advanceTimersByTime(200);
    expect(violations).toEqual([]);
  });

  it('accepts hostile options', async () => {
    installFake();
    const engine = new WebAudioEngine();
    await engine.unlock();
    const ctx = contexts[0]!;
    const weird = [Number.NaN, Infinity, -Infinity, -5, 50];
    for (const v of weird) {
      ctx.advance(0.05);
      expect(() => engine.play('swingHeavy', { pan: v, gain: v })).not.toThrow();
      expect(() => engine.play('train', { pan: v })).not.toThrow();
    }
    expect(violations).toEqual([]);
  });

  it('schedules every music track for several loops and switches cleanly', async () => {
    installFake();
    const engine = new WebAudioEngine();
    await engine.unlock();
    const ctx = contexts[0]!;
    const music = engine.debugPlayers().music!;

    for (const id of MUSIC_IDS) {
      engine.setMusic(id);
      expect(music.current).toBe(id);
      const createdAtSwitch = ctx.created;
      engine.setMusic(id); // same track: no-op
      expect(ctx.created).toBe(createdAtSwitch);

      const before = ctx.oscillators;
      const bars = id === 'none' ? 0 : TRACKS[id].bars;
      const loopSeconds = id === 'none' ? 2 : (bars * 4 * 60) / TRACKS[id].bpm;
      engine.setIntensity(0);
      run(ctx, loopSeconds * 0.6);
      engine.setIntensity(0.5);
      run(ctx, loopSeconds * 0.6);
      engine.setIntensity(1);
      run(ctx, loopSeconds); // well into the second pass of the loop
      if (id === 'none') {
        expect(music.scheduling).toBe(false);
      } else {
        expect(music.scheduling).toBe(true);
        expect(ctx.oscillators - before).toBeGreaterThan(200);
        expect(bars).toBeGreaterThanOrEqual(8);
      }
      // Voices are released as they end: nothing piles up.
      expect(ctx.sources.size).toBeLessThan(120);
    }

    engine.setMusic('none');
    run(ctx, 4);
    const settled = ctx.created;
    run(ctx, 2);
    expect(ctx.created).toBe(settled);
    expect(ctx.sources.size).toBe(0);
    expect(violations).toEqual([]);
  });

  it('remembers the music requested before unlocking', async () => {
    installFake();
    const engine = new WebAudioEngine();
    engine.setMusic('menu');
    engine.setMusic('fight');
    engine.play('hitLight'); // ignored, nothing exists yet
    expect(contexts).toHaveLength(0);
    await engine.unlock();
    const ctx = contexts[0]!;
    expect(engine.debugPlayers().music!.current).toBe('fight');
    const before = ctx.oscillators;
    run(ctx, 1);
    expect(ctx.oscillators).toBeGreaterThan(before);
  });

  it('clamps volumes, ramps the buses and mutes without losing settings', async () => {
    installFake();
    const engine = new WebAudioEngine();
    await engine.unlock();
    const graph = engine.debugGraph()!;
    const master = graph.master.gain as unknown as FakeParam;
    const musicBus = graph.musicBus.gain as unknown as FakeParam;
    const sfxBus = graph.sfxBus.gain as unknown as FakeParam;
    const sfxSend = graph.sfxSend!.gain as unknown as FakeParam;

    expect(master.value).toBeCloseTo(volumeToGain(0.8));
    expect(musicBus.value).toBeCloseTo(volumeToGain(0.55));
    expect(sfxBus.value).toBeCloseTo(volumeToGain(0.9));

    engine.setVolume('music', 5);
    expect(engine.getVolume('music')).toBe(1);
    expect(musicBus.value).toBe(1);
    engine.setVolume('music', -1);
    expect(engine.getVolume('music')).toBe(0);
    expect(musicBus.value).toBe(0);
    engine.setVolume('sfx', 0.5);
    expect(sfxBus.value).toBeCloseTo(volumeToGain(0.5));
    expect(sfxSend.value).toBeCloseTo(volumeToGain(0.5));

    engine.setMuted(true);
    expect(engine.isMuted()).toBe(true);
    expect(master.value).toBe(0);
    expect(engine.getVolume('master')).toBeCloseTo(0.8);
    engine.setVolume('master', 0.6); // still silent while muted
    expect(master.value).toBe(0);
    const created = contexts[0]!.created;
    engine.play('hitHeavy'); // muted: no nodes are spent
    expect(contexts[0]!.created).toBe(created);
    engine.setMuted(false);
    expect(master.value).toBeCloseTo(volumeToGain(0.6));
    expect(violations).toEqual([]);
  });

  it('applies settings made before unlocking', async () => {
    installFake();
    const engine = new WebAudioEngine();
    engine.setVolume('master', 0.25);
    engine.setMuted(true);
    await engine.unlock();
    const master = engine.debugGraph()!.master.gain as unknown as FakeParam;
    expect(master.value).toBe(0);
    engine.setMuted(false);
    expect(master.value).toBeCloseTo(volumeToGain(0.25));
  });

  it('suspends and resumes without bursting or losing the groove', async () => {
    installFake();
    const engine = new WebAudioEngine();
    await engine.unlock();
    const ctx = contexts[0]!;
    const music = engine.debugPlayers().music!;
    engine.setMusic('fight');
    run(ctx, 1);

    engine.suspend();
    expect(ctx.state).toBe('suspended');
    expect(music.scheduling).toBe(false);
    expect(engine.unlocked).toBe(true); // paused on purpose, not locked
    const frozen = ctx.created;
    vi.advanceTimersByTime(5000); // audio clock stands still while suspended
    engine.play('hitLight');
    expect(ctx.created).toBe(frozen);
    await expect(engine.unlock()).resolves.toBe(true); // gesture while paused keeps it paused
    expect(ctx.state).toBe('suspended');

    engine.resume();
    expect(ctx.state).toBe('running');
    expect(music.scheduling).toBe(true);
    const before = ctx.oscillators;
    run(ctx, 0.5);
    const perHalfSecond = ctx.oscillators - before;
    expect(perHalfSecond).toBeGreaterThan(0);
    expect(perHalfSecond).toBeLessThan(120);

    // Timers throttled while the clock kept running: no catch-up burst.
    const burstFrom = ctx.oscillators;
    ctx.advance(30);
    vi.advanceTimersByTime(25);
    expect(ctx.oscillators - burstFrom).toBeLessThan(60);
    expect(violations).toEqual([]);
  });

  it('recovers from an outside interruption on the next gesture', async () => {
    installFake();
    const engine = new WebAudioEngine();
    await engine.unlock();
    const ctx = contexts[0]!;
    engine.setMusic('menu');
    fakeOptions.resume = 'reject'; // the browser refuses to resume without a gesture
    ctx.interrupt();
    expect(engine.unlocked).toBe(false);
    expect(engine.debugPlayers().music!.scheduling).toBe(false);
    expect(() => engine.play('block')).not.toThrow();

    fakeOptions.resume = 'ok';
    await expect(engine.unlock()).resolves.toBe(true);
    expect(engine.unlocked).toBe(true);
    expect(engine.debugPlayers().music!.scheduling).toBe(true);
  });

  it('pauses when the page is hidden and returns when it is visible', async () => {
    const listeners: Array<() => void> = [];
    const doc = {
      visibilityState: 'visible',
      addEventListener: (type: string, fn: () => void) => {
        if (type === 'visibilitychange') listeners.push(fn);
      },
    };
    g.document = doc;
    installFake();
    const engine = new WebAudioEngine();
    await engine.unlock();
    const ctx = contexts[0]!;
    engine.setMusic('menu');
    expect(listeners).toHaveLength(1);

    doc.visibilityState = 'hidden';
    listeners[0]!();
    expect(ctx.state).toBe('suspended');
    expect(engine.debugPlayers().music!.scheduling).toBe(false);

    doc.visibilityState = 'visible';
    listeners[0]!();
    expect(ctx.state).toBe('running');
    expect(engine.debugPlayers().music!.scheduling).toBe(true);

    // The game's own pause wins over visibility.
    engine.suspend();
    doc.visibilityState = 'hidden';
    listeners[0]!();
    doc.visibilityState = 'visible';
    listeners[0]!();
    expect(ctx.state).toBe('suspended');
    engine.resume();
    expect(ctx.state).toBe('running');
  });

  it('works without a panner, a reverb or a compressor', async () => {
    installFake({ noPanner: true, noConvolver: true, noCompressor: true });
    const engine = new WebAudioEngine();
    await expect(engine.unlock()).resolves.toBe(true);
    const ctx = contexts[0]!;
    expect(engine.debugGraph()!.sfxSend).toBeNull();
    for (const id of SFX_IDS) {
      const before = ctx.created;
      engine.play(id, { pan: 0.4 });
      expect(ctx.created).toBeGreaterThan(before);
      run(ctx, 0.05);
    }
    engine.setMusic('boss');
    run(ctx, 3);
    expect(violations).toEqual([]);
  });
});

describe('when Web Audio misbehaves', () => {
  it('stays safe when the AudioContext constructor throws', async () => {
    g.AudioContext = class {
      constructor() {
        throw new Error('blocked by policy');
      }
    };
    const engine = createAudioEngine();
    expect(engine.supported).toBe(true); // a constructor exists...
    await expect(engine.unlock()).resolves.toBe(false);
    expect(engine.supported).toBe(false); // ...but it is unusable
    expect(engine.unlocked).toBe(false);
    expect(() => exerciseEverything(engine)).not.toThrow();
    await expect(engine.unlock()).resolves.toBe(false);
  });

  it('stays safe when building the graph throws', async () => {
    g.AudioContext = class extends FakeContext {
      override createGain(): FakeGain {
        throw new Error('out of nodes');
      }
    };
    const engine = createAudioEngine();
    await expect(engine.unlock()).resolves.toBe(false);
    expect(engine.supported).toBe(false);
    expect(contexts[0]!.state).toBe('closed');
    expect(() => exerciseEverything(engine)).not.toThrow();
  });

  it('resolves false when resume() is rejected, then succeeds on a later gesture', async () => {
    installFake({ resume: 'reject' });
    const engine = createAudioEngine();
    await expect(engine.unlock()).resolves.toBe(false);
    expect(engine.supported).toBe(true);
    expect(engine.unlocked).toBe(false);
    expect(() => exerciseEverything(engine)).not.toThrow();

    fakeOptions.resume = 'ok';
    engine.resume();
    await expect(engine.unlock()).resolves.toBe(true);
    expect(contexts).toHaveLength(1);
    expect(engine.unlocked).toBe(true);
  });

  it('does not hang when resume() never settles', async () => {
    installFake({ resume: 'hang' });
    const engine = createAudioEngine();
    const pending = engine.unlock();
    await vi.advanceTimersByTimeAsync(600);
    await expect(pending).resolves.toBe(false);
    expect(() => engine.play('fight')).not.toThrow();
  });

  it('survives a node that throws in the middle of a sound', async () => {
    installFake();
    const engine = new WebAudioEngine();
    await engine.unlock();
    const ctx = contexts[0]!;
    engine.setMusic('fight');
    ctx.createOscillator = () => {
      throw new Error('boom');
    };
    expect(() => {
      for (const id of SFX_IDS) {
        engine.play(id);
        run(ctx, 0.05);
      }
      run(ctx, 2);
    }).not.toThrow();
    // Failed sounds give their slot back.
    expect(engine.debugPlayers().sfx!.activeCount).toBeLessThanOrEqual(16);
  });
});
