import type { CharId, FighterMods, MoveId, Strength } from './types';

/* ------------------------------------------------------------------ */
/* World                                                               */
/* ------------------------------------------------------------------ */

export const TICK_RATE = 60;
/** Arena width in world units. */
export const STAGE_W = 1200;
/** Fighters cannot get closer than this to either end of the arena. */
export const WALL = 60;
/** Fighters can never be further apart than this (keeps both on screen). */
export const MAX_SEP = 600;

export const GRAVITY = 0.72;
export const ROUND_SECONDS = 60;

/* ------------------------------------------------------------------ */
/* State durations (ticks)                                             */
/* ------------------------------------------------------------------ */

export const INTRO_TICKS = 110;
export const KO_TICKS = 170;
export const TIMEUP_TICKS = 150;
export const PREJUMP_TICKS = 3;
export const LAND_TICKS = 4;
export const DODGE_TICKS = 22;
/** Invulnerable while `DODGE_INVULN_FROM <= t < DODGE_INVULN_TO`. */
export const DODGE_INVULN_FROM = 1;
export const DODGE_INVULN_TO = 14;
export const DODGE_COOLDOWN = 34;
export const DODGE_DIST_F = 168;
export const DODGE_DIST_B = 142;
export const DOWN_TICKS = 42;
export const GETUP_TICKS = 20;
export const GUARDBREAK_TICKS = 64;
export const PARRY_TICKS = 10;
/** Block must have been held for at most this many ticks to just-guard. */
export const PARRY_WINDOW = 6;
export const PARRY_PUNISH = 14;
/** A new block press cannot just-guard if the previous press was this recent. */
export const PARRY_LOCKOUT = 30;
export const INPUT_BUFFER_TICKS = 9;
export const COMBO_LINGER_TICKS = 50;

/* ------------------------------------------------------------------ */
/* Gauges                                                              */
/* ------------------------------------------------------------------ */

export const METER_MAX = 100;
export const METER_PER_DAMAGE_DEALT = 0.1;
export const METER_PER_DAMAGE_TAKEN = 0.07;
export const METER_ON_PARRY = 14;
export const GUARD_REGEN_DELAY = 50;
export const GUARD_REGEN_PER_TICK = 0.45;
export const CHIP_RATIO = 0.1;
/** Each extra combo hit scales damage by this factor (floored at COMBO_SCALE_MIN). */
export const COMBO_SCALE = 0.9;
export const COMBO_SCALE_MIN = 0.5;
export const COUNTER_BONUS = 1.2;

/* ------------------------------------------------------------------ */
/* Moves                                                               */
/* ------------------------------------------------------------------ */

export interface MoveDef {
  id: MoveId;
  strength: Strength;
  /** Ticks before the hitbox becomes active. */
  startup: number;
  /** Ticks the hitbox stays active. */
  active: number;
  /** Ticks after the active window before the fighter is free again. */
  recovery: number;
  damage: number;
  /** Damage dealt to the guard gauge when blocked. */
  guardDamage: number;
  hitstun: number;
  blockstun: number;
  /** Global freeze frames on contact. */
  hitstop: number;
  /** Horizontal push applied to the victim (units / tick, decays). */
  knockback: number;
  /** Upward launch speed; > 0 knocks the victim off their feet. */
  launch: number;
  /** Forward speed of the attacker during start-up (a small step-in). */
  lunge: number;
  /**
   * Hitbox relative to the attacker's feet, facing right, for a fighter with
   * reach 1 and scale 1. `x` extents are multiplied by the character's reach,
   * `y` extents by the character's scale.
   */
  box: { x0: number; x1: number; y0: number; y1: number };
  /** Moves this one can be cancelled into on contact, by button. */
  cancel: { light?: MoveId; heavy?: MoveId };
}

export const MOVES: Record<MoveId, MoveDef> = {
  // Jab
  L1: {
    id: 'L1',
    strength: 'light',
    startup: 4,
    active: 3,
    recovery: 9,
    damage: 30,
    guardDamage: 9,
    hitstun: 17,
    blockstun: 11,
    hitstop: 5,
    knockback: 2.4,
    launch: 0,
    lunge: 1.6,
    box: { x0: 16, x1: 96, y0: 122, y1: 160 },
    cancel: { light: 'L2', heavy: 'H' },
  },
  // Cross
  L2: {
    id: 'L2',
    strength: 'light',
    startup: 5,
    active: 3,
    recovery: 11,
    damage: 36,
    guardDamage: 11,
    hitstun: 18,
    blockstun: 12,
    hitstop: 5,
    knockback: 2.8,
    launch: 0,
    lunge: 2.2,
    box: { x0: 16, x1: 106, y0: 118, y1: 158 },
    cancel: { light: 'L3', heavy: 'FIN' },
  },
  // Body kick, ends the light chain
  L3: {
    id: 'L3',
    strength: 'light',
    startup: 6,
    active: 4,
    recovery: 15,
    damage: 50,
    guardDamage: 15,
    hitstun: 21,
    blockstun: 13,
    hitstop: 7,
    knockback: 6.2,
    launch: 0,
    lunge: 2.4,
    box: { x0: 16, x1: 118, y0: 78, y1: 128 },
    cancel: {},
  },
  // Heavy strike
  H: {
    id: 'H',
    strength: 'heavy',
    startup: 11,
    active: 4,
    recovery: 19,
    damage: 86,
    guardDamage: 30,
    hitstun: 25,
    blockstun: 16,
    hitstop: 9,
    knockback: 7.6,
    launch: 0,
    lunge: 3,
    box: { x0: 16, x1: 120, y0: 100, y1: 162 },
    cancel: {},
  },
  // Combo finisher (L, L, H): a rising strike that knocks the opponent down
  FIN: {
    id: 'FIN',
    strength: 'finisher',
    startup: 8,
    active: 5,
    recovery: 23,
    damage: 98,
    guardDamage: 34,
    hitstun: 0,
    blockstun: 18,
    hitstop: 12,
    knockback: 6.4,
    launch: 10.5,
    lunge: 3.2,
    box: { x0: 12, x1: 122, y0: 84, y1: 188 },
    cancel: {},
  },
  // Jumping kick: active until landing
  AIR: {
    id: 'AIR',
    strength: 'heavy',
    startup: 4,
    active: 16,
    recovery: 6,
    damage: 58,
    guardDamage: 18,
    hitstun: 21,
    blockstun: 13,
    hitstop: 7,
    knockback: 5,
    launch: 0,
    lunge: 0,
    box: { x0: 4, x1: 96, y0: -22, y1: 74 },
    cancel: {},
  },
  // Overdrive: an invulnerable dashing strike that spends the full meter
  SP: {
    id: 'SP',
    strength: 'special',
    startup: 9,
    active: 11,
    recovery: 25,
    damage: 190,
    guardDamage: 62,
    hitstun: 0,
    blockstun: 22,
    hitstop: 14,
    knockback: 9.5,
    launch: 11.5,
    lunge: 0,
    box: { x0: -6, x1: 112, y0: 44, y1: 166 },
    cancel: {},
  },
};

/** Forward speed during the active window of the Overdrive dash. */
export const SP_DASH_SPEED = 19;
/** Invulnerable from the first tick until this tick of the Overdrive. */
export const SP_INVULN_TICKS = 12;

/* ------------------------------------------------------------------ */
/* Characters                                                          */
/* ------------------------------------------------------------------ */

export interface CharDef {
  id: CharId;
  /** Ring name shown in large type. */
  ringName: string;
  realName: string;
  playable: boolean;
  maxHp: number;
  /** Damage multiplier. */
  power: number;
  /** Walk speed in units / tick. */
  walk: number;
  /** Initial jump speed in units / tick. */
  jumpV: number;
  /** Horizontal speed while jumping forwards / backwards. */
  airSpeed: number;
  /** Multiplies hitbox reach. */
  reach: number;
  /** Multiplies body height (and the vertical extent of hitboxes). */
  scale: number;
  /** Body (hurtbox / push box) width at scale 1. */
  bodyW: number;
  /** Standing body height at scale 1. */
  bodyH: number;
  maxGuard: number;
  /** Multiplies move recovery: < 1 is snappier, > 1 is more committal. */
  tempo: number;
  /** Multiplies overdrive meter gain. */
  meter: number;
  /** 1..5 pips shown on the select screen. */
  pips: { vitality: number; power: number; speed: number; reach: number };
}

export const CHARS: Record<CharId, CharDef> = {
  kestrel: {
    id: 'kestrel',
    ringName: 'KESTREL',
    realName: 'Mara Voss',
    playable: true,
    maxHp: 950,
    power: 0.95,
    walk: 4.1,
    jumpV: 14.4,
    airSpeed: 4.3,
    reach: 0.95,
    scale: 0.94,
    bodyW: 52,
    bodyH: 180,
    maxGuard: 90,
    tempo: 0.86,
    meter: 1.25,
    pips: { vitality: 3, power: 2, speed: 5, reach: 3 },
  },
  anvil: {
    id: 'anvil',
    ringName: 'ANVIL',
    realName: 'Dante Okafor',
    playable: true,
    maxHp: 1120,
    power: 1.17,
    walk: 2.9,
    jumpV: 12.8,
    airSpeed: 3.1,
    reach: 1.0,
    scale: 1.08,
    bodyW: 66,
    bodyH: 180,
    maxGuard: 125,
    tempo: 1.16,
    meter: 0.9,
    pips: { vitality: 5, power: 5, speed: 1, reach: 2 },
  },
  switch: {
    id: 'switch',
    ringName: 'SWITCH',
    realName: 'Ines Calder',
    playable: true,
    maxHp: 1000,
    power: 1.0,
    walk: 3.5,
    jumpV: 13.6,
    airSpeed: 3.7,
    reach: 1.0,
    scale: 1.0,
    bodyW: 56,
    bodyH: 180,
    maxGuard: 100,
    tempo: 1.0,
    meter: 1.0,
    pips: { vitality: 3, power: 3, speed: 4, reach: 3 },
  },
  pylon: {
    id: 'pylon',
    ringName: 'PYLON',
    realName: 'Oskar Lind',
    playable: true,
    maxHp: 910,
    power: 0.95,
    walk: 3.3,
    jumpV: 13.9,
    airSpeed: 3.5,
    reach: 1.18,
    scale: 1.1,
    bodyW: 52,
    bodyH: 180,
    maxGuard: 95,
    tempo: 1.08,
    meter: 1.0,
    pips: { vitality: 2, power: 3, speed: 3, reach: 5 },
  },
  // Final opponent of the survival circuit. Not selectable.
  conductor: {
    id: 'conductor',
    ringName: 'THE CONDUCTOR',
    realName: 'Circuit Boss',
    playable: false,
    maxHp: 1300,
    power: 1.1,
    walk: 3.4,
    jumpV: 13.4,
    airSpeed: 3.6,
    reach: 1.1,
    scale: 1.12,
    bodyW: 62,
    bodyH: 180,
    maxGuard: 130,
    tempo: 0.98,
    meter: 1.1,
    pips: { vitality: 5, power: 4, speed: 3, reach: 4 },
  },
};

export const PLAYABLE: CharId[] = ['kestrel', 'anvil', 'switch', 'pylon'];

export interface MoveFrames {
  startup: number;
  active: number;
  recovery: number;
  total: number;
}

/** Effective frame data of `move` for `char` (recovery scales with tempo). */
export function moveFrames(char: CharId, move: MoveId): MoveFrames {
  const m = MOVES[move];
  const tempo = CHARS[char].tempo;
  const recovery = Math.max(2, Math.round(m.recovery * tempo));
  const startup = move === 'SP' || move === 'AIR' ? m.startup : Math.max(3, Math.round(m.startup * (0.5 + tempo * 0.5)));
  return { startup, active: m.active, recovery, total: startup + m.active + recovery };
}

export function defaultMods(): FighterMods {
  return { power: 1, speed: 1, defense: 1, chip: 1, meterGain: 1, finisher: 1, dodgeCooldown: 1 };
}
