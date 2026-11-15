export type SfxId =
  | 'uiMove'
  | 'uiSelect'
  | 'uiBack'
  | 'swingLight'
  | 'swingHeavy'
  | 'hitLight'
  | 'hitHeavy'
  | 'hitFinisher'
  | 'hitSpecial'
  | 'block'
  | 'parry'
  | 'guardBreak'
  | 'jump'
  | 'land'
  | 'dodge'
  | 'knockdown'
  | 'ko'
  | 'specialStart'
  | 'meterFull'
  | 'roundStart'
  | 'fight'
  | 'roundClear'
  | 'upgrade'
  | 'victory'
  | 'defeat'
  | 'timerTick'
  | 'train';

export type MusicId = 'none' | 'menu' | 'fight' | 'boss' | 'interlude';

export type VolumeKind = 'master' | 'music' | 'sfx';

export interface SfxOptions {
  /** Stereo position, -1 (left) .. 1 (right). */
  pan?: number;
  /** Extra gain multiplier, default 1. */
  gain?: number;
}

/**
 * Everything is synthesised with the Web Audio API — there are no audio
 * files. Every method must be safe to call at any time: before `unlock`,
 * when Web Audio is unavailable, or while the context is suspended. None of
 * them may throw.
 */
export interface AudioEngine {
  /** False when the browser has no usable Web Audio implementation. */
  readonly supported: boolean;
  /** True once the context is running after a user gesture. */
  readonly unlocked: boolean;
  /** Create / resume the context. Call from a user gesture; idempotent. */
  unlock(): Promise<boolean>;
  play(id: SfxId, opts?: SfxOptions): void;
  /** Switch background music with a short crossfade. */
  setMusic(id: MusicId): void;
  /** 0..1 — raises the energy of the fight music (e.g. low health). */
  setIntensity(v: number): void;
  setVolume(kind: VolumeKind, v: number): void;
  getVolume(kind: VolumeKind): number;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  /** Pause all sound (game paused / tab hidden). */
  suspend(): void;
  resume(): void;
}
