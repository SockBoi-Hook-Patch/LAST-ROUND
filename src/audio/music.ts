import { rampTo, type Graph } from './graph';
import type { Out } from './synth';
import { TRACKS, type TrackDef } from './tracks';
import type { MusicId } from './types';

/** How far ahead of the audio clock notes are scheduled, in seconds. */
const LOOKAHEAD = 0.14;
/** Scheduler wake-up interval. */
const TICK_MS = 25;
/** Crossfade length between tracks, in seconds. */
const FADE = 0.6;
const LP_OPEN = 18000;

interface Run {
  def: TrackDef;
  out: Out;
  nodes: AudioNode[];
  dryGain: GainNode;
  wetGain: GainNode | null;
  filter: BiquadFilterNode;
  step: number;
  loop: number;
  nextTime: number;
}

/**
 * Lookahead sequencer. A timer wakes up every few milliseconds and schedules
 * the grid steps that fall inside the lookahead window on the sample-accurate
 * audio clock, so timing stays tight even when timers jitter.
 */
export class MusicPlayer {
  private id: MusicId = 'none';
  private run: Run | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private intensity = 0;

  constructor(private readonly g: Graph) {}

  get current(): MusicId {
    return this.id;
  }

  /** Whether the scheduler timer is currently running (for tests). */
  get scheduling(): boolean {
    return this.timer !== null;
  }

  setTrack(id: MusicId): void {
    if (id === this.id) return;
    const { ctx } = this.g;
    const now = ctx.currentTime;
    if (this.run) this.fadeOut(this.run, now);
    this.run = null;
    this.id = id;

    const def = id === 'none' ? undefined : TRACKS[id];
    if (def) {
      try {
        this.run = this.startRun(def, now);
      } catch {
        this.run = null;
      }
    }
    this.updateTimer();
  }

  setIntensity(v: number): void {
    this.intensity = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
    const run = this.run;
    if (run) rampTo(run.filter.frequency, this.cutoff(run.def), this.g.ctx.currentTime, 0.25);
  }

  /** Start / stop scheduling. Inactive while the context is not running. */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.updateTimer();
  }

  dispose(): void {
    this.active = false;
    this.updateTimer();
    if (this.run) disconnectAll(this.run.nodes);
    this.run = null;
    this.id = 'none';
  }

  private cutoff(def: TrackDef): number {
    return def.lpMin * Math.pow(LP_OPEN / def.lpMin, this.intensity);
  }

  private startRun(def: TrackDef, now: number): Run {
    const { ctx } = this.g;
    const input = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.5;
    filter.frequency.value = this.cutoff(def);
    const dryGain = ctx.createGain();
    dryGain.gain.setValueAtTime(0, now);
    dryGain.gain.linearRampToValueAtTime(1, now + FADE);
    input.connect(filter);
    filter.connect(dryGain);
    dryGain.connect(this.g.musicBus);
    const nodes: AudioNode[] = [input, filter, dryGain];

    let wetIn: GainNode | null = null;
    let wetGain: GainNode | null = null;
    if (this.g.musicSend) {
      wetIn = ctx.createGain();
      wetGain = ctx.createGain();
      wetGain.gain.setValueAtTime(0, now);
      wetGain.gain.linearRampToValueAtTime(1, now + FADE);
      wetIn.connect(wetGain);
      wetGain.connect(this.g.musicSend);
      nodes.push(wetIn, wetGain);
    }

    return {
      def,
      out: { ctx, dry: input, wet: wetIn, noise: this.g.noise, end: now },
      nodes,
      dryGain,
      wetGain,
      filter,
      step: 0,
      loop: 0,
      nextTime: now + 0.08,
    };
  }

  private fadeOut(run: Run, now: number): void {
    rampTo(run.dryGain.gain, 0, now, FADE / 4);
    if (run.wetGain) rampTo(run.wetGain.gain, 0, now, FADE / 4);
    setTimeout(() => disconnectAll(run.nodes), (FADE + 0.9) * 1000);
  }

  private updateTimer(): void {
    const want = this.active && this.run !== null;
    if (want && this.timer === null) {
      this.timer = setInterval(this.tick, TICK_MS);
      this.tick();
    } else if (!want && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private readonly tick = (): void => {
    const run = this.run;
    if (!run || !this.active) return;
    let now: number;
    try {
      now = this.g.ctx.currentTime;
    } catch {
      return;
    }
    // Timers were throttled (background tab, long frame): do not burst the
    // missed notes, pick the groove back up from here.
    if (run.nextTime < now) run.nextTime = now + 0.05;
    const stepDur = 60 / run.def.bpm / 4;
    const total = run.def.bars * 16;
    let budget = 16;
    while (run.nextTime < now + LOOKAHEAD && budget-- > 0) {
      try {
        run.def.schedule(run.out, run.step, run.nextTime, stepDur, this.intensity, run.loop);
      } catch {
        /* a failed step must never stop the groove or the game */
      }
      run.step += 1;
      if (run.step >= total) {
        run.step = 0;
        run.loop += 1;
      }
      run.nextTime += stepDur;
    }
  };
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
