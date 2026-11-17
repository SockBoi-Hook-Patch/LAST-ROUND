/**
 * Core simulation types.
 *
 * The simulation is deterministic and free of DOM / rendering concerns so the
 * exact same code runs in the browser (single player) and on the authoritative
 * match server (online 1v1).
 *
 * Coordinates: `x` grows to the right along the arena floor, `y` is the height
 * of the fighter's feet above the ground (0 = standing on the floor, up is
 * positive). One unit equals one logical pixel at the 540-high reference view.
 */

export type CharId = 'kestrel' | 'anvil' | 'switch' | 'pylon' | 'conductor';

export type MoveId = 'L1' | 'L2' | 'L3' | 'H' | 'FIN' | 'AIR' | 'SP';

export type Strength = 'light' | 'heavy' | 'finisher' | 'special';

export type FighterStateId =
  | 'intro' // pre-fight pose, no control
  | 'idle'
  | 'walkF' // walking towards the opponent
  | 'walkB' // walking away from the opponent
  | 'prejump' // short crouch before leaving the ground
  | 'jump' // airborne under own control
  | 'land' // landing recovery
  | 'block' // holding guard
  | 'blockstun' // absorbing a blocked attack (uses `stun` / `stunTotal`)
  | 'parry' // a just-guard: brief bright deflect, then free
  | 'dodgeF' // evasive dash through / towards the opponent
  | 'dodgeB' // evasive hop away from the opponent
  | 'attack' // performing `move`
  | 'hit' // light hit reaction (uses `stun` / `stunTotal`)
  | 'hitHeavy' // heavy stagger (uses `stun` / `stunTotal`)
  | 'launch' // knocked off the feet, airborne and tumbling
  | 'down' // lying on the floor (permanent when `hp <= 0`)
  | 'getup' // rising from the floor
  | 'guardbreak' // guard gauge emptied: dazed and open
  | 'win' // round won pose
  | 'lose'; // lost on time: exhausted, hands on knees

/** Bit flags of a single tick of controller input. */
export const IN = {
  LEFT: 1,
  RIGHT: 2,
  JUMP: 4,
  BLOCK: 8,
  DODGE: 16,
  LIGHT: 32,
  HEAVY: 64,
  SPECIAL: 128,
} as const;

export type InputMask = number;

/** Per-fighter multipliers changed by upgrades / difficulty scaling. */
export interface FighterMods {
  /** Multiplies outgoing damage. */
  power: number;
  /** Multiplies walk speed. */
  speed: number;
  /** Multiplies incoming damage. */
  defense: number;
  /** Multiplies chip damage taken while blocking. */
  chip: number;
  /** Multiplies meter gained. */
  meterGain: number;
  /** Multiplies finisher (FIN) and special (SP) damage. */
  finisher: number;
  /** Multiplies dodge cooldown. */
  dodgeCooldown: number;
}

export interface Fighter {
  char: CharId;
  /** Colourway index (0 = default, 1+ = alternates used for opponents). */
  skin: number;

  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 1 = facing right, -1 = facing left. */
  facing: 1 | -1;

  state: FighterStateId;
  /** Ticks spent in the current state (0 on the first tick). */
  t: number;
  /** Move being performed while `state === 'attack'`. */
  move: MoveId | null;
  /** The current move already connected (hit or blocked). */
  moveHit: boolean;
  /** Extra recovery ticks added to the current move (after being parried). */
  moveExtra: number;

  hp: number;
  maxHp: number;
  guard: number;
  maxGuard: number;
  /** Overdrive meter, 0..METER_MAX. */
  meter: number;

  /** Remaining ticks of hit/block stun. */
  stun: number;
  /** Stun length when it was applied (for animation progress). */
  stunTotal: number;
  /** Remaining invulnerability ticks. */
  invuln: number;
  /** Ticks until dodge is available again. */
  dodgeCd: number;
  /** Ticks until the guard gauge starts refilling. */
  guardDelay: number;
  /** Consecutive ticks the block input has been held (for just-guards). */
  blockHeld: number;
  /** Ticks until a fresh block press may just-guard again (anti-mash). */
  parryCd: number;

  /** Hits landed in the current combo against the opponent. */
  combo: number;
  /** Damage dealt in the current combo. */
  comboDmg: number;
  /** Ticks left before the combo display expires once the victim recovers. */
  comboTimer: number;

  /** Input mask from the previous tick (edge detection). */
  prevInput: InputMask;
  /** Buffered action button (one of IN.*) or 0. */
  buffer: InputMask;
  /** Age in ticks of the buffered button. */
  bufferAge: number;

  mods: FighterMods;
}

export type MatchPhase = 'intro' | 'fight' | 'ko' | 'timeup' | 'over';

export type SimEvent =
  | {
      type: 'hit';
      attacker: 0 | 1;
      move: MoveId;
      strength: Strength;
      x: number;
      y: number;
      damage: number;
      combo: number;
      /** Victim was caught during their own attack start-up. */
      counter: boolean;
      /** Victim was knocked off their feet. */
      launch: boolean;
    }
  | {
      type: 'block';
      defender: 0 | 1;
      strength: Strength;
      x: number;
      y: number;
      parry: boolean;
    }
  | { type: 'swing'; who: 0 | 1; move: MoveId; strength: Strength; x: number; y: number }
  | { type: 'guardbreak'; who: 0 | 1; x: number; y: number }
  | { type: 'jump'; who: 0 | 1; x: number }
  | { type: 'land'; who: 0 | 1; x: number; hard: boolean }
  | { type: 'dodge'; who: 0 | 1; x: number; dir: 1 | -1 }
  | { type: 'special'; who: 0 | 1; x: number; y: number }
  | { type: 'meterFull'; who: 0 | 1 }
  | { type: 'ko'; who: 0 | 1; x: number; y: number }
  | { type: 'phase'; phase: MatchPhase };

export interface MatchState {
  tick: number;
  phase: MatchPhase;
  /** Ticks spent in the current phase. */
  phaseT: number;
  /** Remaining fight time in ticks (counts down during `fight`). */
  timer: number;
  /** Remaining global hit-stop ticks (both fighters frozen). */
  hitstop: number;
  /** -1 while undecided, otherwise the winning fighter index, or 2 for a draw. */
  winner: -1 | 0 | 1 | 2;
  fighters: [Fighter, Fighter];
  /** Events produced by the most recent `stepMatch` call. */
  events: SimEvent[];
  /** When true health never drops below 1 and the timer is frozen (training). */
  training: boolean;
}

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
