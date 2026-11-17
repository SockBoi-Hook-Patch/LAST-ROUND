/**
 * Poses and animation timing.
 *
 * A pose is a flat array of joint angles (degrees) for a fighter facing
 * right. "Near" limbs are on the camera side (the rear hand and rear leg of
 * the stance), "far" limbs are the lead hand and lead leg.
 *
 * `poseFor` is a pure function of the simulated fighter state, so the same
 * snapshot always draws the same picture (offline or from the match server).
 */
import {
  DODGE_TICKS,
  GETUP_TICKS,
  INTRO_TICKS,
  LAND_TICKS,
  PARRY_TICKS,
  PREJUMP_TICKS,
  moveFrames,
} from '../../sim/data';
import type { Fighter, MoveId } from '../../sim/types';

/* Indices into a pose array. */
export const SPINE = 0; // lean from vertical, + = forward
export const HEAD = 1; // head tilt relative to the spine, + = chin down
export const ARM_N = 2; // near upper arm from straight down, + = forward / up
export const ELB_N = 3; // near elbow flex
export const ARM_F = 4;
export const ELB_F = 5;
export const LEG_N = 6; // near thigh from straight down, + = forward
export const KNEE_N = 7; // near knee bend (<= 0 folds the shin back)
export const LEG_F = 8;
export const KNEE_F = 9;
export const DX = 10; // hip offset forward
export const LIFT = 11; // extra height above the floor
export const ROT = 12; // whole-body rotation about the hips, + = falling backwards
export const POSE_LEN = 13;

export type Pose = number[];

function P(
  spine: number,
  head: number,
  armN: number,
  elbN: number,
  armF: number,
  elbF: number,
  legN: number,
  kneeN: number,
  legF: number,
  kneeF: number,
  dx = 0,
  lift = 0,
  rot = 0,
): Pose {
  return [spine, head, armN, elbN, armF, elbF, legN, kneeN, legF, kneeF, dx, lift, rot];
}

/* ------------------------------------------------------------------ */
/* Key poses                                                           */
/* ------------------------------------------------------------------ */

const IDLE = P(9, -3, 14, 122, 40, 98, -14, -22, 22, -24);
const STEP_A = P(11, -3, 14, 122, 42, 96, -22, -14, 34, -26, 3);
const STEP_B = P(9, -3, 14, 122, 40, 98, -4, -36, 16, -22, 1, 1.5);

const RELAXED = P(3, 0, 6, 16, 12, 22, -6, -6, 9, -8);
const CROUCH = P(24, -4, -14, 62, 14, 74, 40, -94, 64, -104);
const RISE = P(2, -8, 36, 104, 68, 84, 22, -58, 52, -86);
const APEX = P(8, -3, 26, 112, 56, 92, 34, -78, 64, -100);
const FALL = P(-3, 4, 64, 62, 96, 44, 6, -18, 30, -38);
const LANDP = P(18, 0, 22, 92, 46, 82, 26, -66, 52, -80);

const BLOCK = P(1, 9, 50, 128, 64, 119, -15, -30, 23, -30, -2);
const BLOCK_HIT = P(-8, 12, 56, 124, 70, 114, -22, -26, 16, -34, -7);
const PARRYP = P(11, -5, 22, 118, 78, 34, -19, -24, 28, -24, 3);

const HOP_B = P(-13, 5, 32, 92, 54, 72, 12, -42, 36, -54, -2);
const DASH = P(52, -32, -34, 46, 72, 64, -44, -26, 52, -92, 6);

const JAB_WIND = P(10, -3, 14, 126, 30, 116, -14, -22, 22, -24);
const JAB = P(19, -6, 16, 128, 89, 2, -22, -18, 30, -26, 11);

const CROSS_WIND = P(5, -2, -14, 118, 44, 104, -14, -22, 22, -24, -1);
const CROSS = P(26, -8, 91, 2, 16, 134, -28, -12, 31, -30, 13);

const KICK_WIND = P(-5, 1, 24, 112, 56, 92, 54, -96, 13, -13, 2);
const KICK = P(-16, 6, 34, 104, 66, 72, 86, -5, 7, -9, 12);

const HEAVY_WIND = P(-7, -4, -56, 96, 48, 92, -23, -22, 27, -22, -5);
const HEAVY = P(33, -10, 98, 6, 6, 142, -36, -8, 38, -38, 24);
const HEAVY_REC = P(24, -4, 62, 58, 18, 122, -30, -14, 34, -32, 16);

const FIN_WIND = P(27, 0, -24, 72, 32, 112, 32, -82, 58, -94, 0);
const FIN = P(4, -14, 132, 6, -18, 104, -16, -6, 20, -14, 24, 10);
const FIN_REC = P(4, -6, 104, 44, 6, 96, -14, -16, 20, -20, 18);

const AIR_KICK = P(-11, 7, 44, 92, -34, 62, 42, -104, 63, -3);

const SP_WIND = P(32, -8, -46, 92, 22, 112, 22, -72, 52, -86, -4);
const SP_DASH = P(54, -32, 97, 3, -44, 42, -52, -8, 32, -72, 12, 3);
const SP_REC = P(22, -2, 42, 82, 30, 102, -31, -18, 42, -52, 8);

const HIT_L = P(-15, -15, 22, 82, 46, 72, -11, -28, 27, -20, -5);
const HIT_H = P(-26, -19, 62, 42, 74, 30, -3, -36, 31, -15, -9);
const STAGGER = P(15, 12, 18, 52, 30, 60, -18, -30, 20, -30, -6);

const LAUNCH = P(-34, -12, 84, 22, 108, 12, 42, -34, 64, -22);
const LYING = P(-6, -4, 18, 14, 44, 18, 6, -8, 36, -64, 0, 0, 90);
const LYING_KO = P(-4, -6, 58, 96, 26, 10, 4, -6, 30, -52, 0, 0, 90);
const SIT = P(34, 6, 30, 30, 44, 36, 62, -96, 76, -104, 0, 0, 34);

const DAZED = P(7, 13, 6, 22, 15, 26, -11, -20, 19, -22);
const WINP = P(-5, -9, 172, 10, -22, 74, -8, -4, 11, -7);
const LOSEP = P(44, 15, 44, 8, 56, 5, -7, -24, 21, -36);

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function clamp01(k: number): number {
  return k < 0 ? 0 : k > 1 ? 1 : k;
}
function easeOut(k: number): number {
  const j = 1 - clamp01(k);
  return 1 - j * j * j;
}
function easeIn(k: number): number {
  const c = clamp01(k);
  return c * c;
}
function easeInOut(k: number): number {
  const c = clamp01(k);
  return c * c * (3 - 2 * c);
}

function mix(out: Pose, a: Pose, b: Pose, k: number): Pose {
  for (let i = 0; i < POSE_LEN; i++) out[i] = (a[i] as number) + ((b[i] as number) - (a[i] as number)) * k;
  return out;
}
function copy(out: Pose, a: Pose): Pose {
  for (let i = 0; i < POSE_LEN; i++) out[i] = a[i] as number;
  return out;
}
function add(out: Pose, i: number, v: number): void {
  out[i] = (out[i] as number) + v;
}

interface MoveAnim {
  wind: Pose;
  hit: Pose;
  rec: Pose;
}

const MOVE_ANIM: Record<MoveId, MoveAnim> = {
  L1: { wind: JAB_WIND, hit: JAB, rec: IDLE },
  L2: { wind: CROSS_WIND, hit: CROSS, rec: IDLE },
  L3: { wind: KICK_WIND, hit: KICK, rec: KICK_WIND },
  H: { wind: HEAVY_WIND, hit: HEAVY, rec: HEAVY_REC },
  FIN: { wind: FIN_WIND, hit: FIN, rec: FIN_REC },
  AIR: { wind: APEX, hit: AIR_KICK, rec: FALL },
  SP: { wind: SP_WIND, hit: SP_DASH, rec: SP_REC },
};

const scratchA: Pose = new Array<number>(POSE_LEN).fill(0);

/** Progress through an attack: 0..1 start-up, 1..2 active, 2..3 recovery. */
export function attackPhase(f: Readonly<Fighter>): number {
  if (f.state !== 'attack' || !f.move) return 0;
  const fr = moveFrames(f.char, f.move);
  if (f.t < fr.startup) return f.t / fr.startup;
  if (f.t < fr.startup + fr.active) return 1 + (f.t - fr.startup) / fr.active;
  const rec = fr.recovery + f.moveExtra;
  return 2 + clamp01((f.t - fr.startup - fr.active) / Math.max(1, rec));
}

function attackPose(out: Pose, f: Readonly<Fighter>): Pose {
  const move = f.move as MoveId;
  const anim = MOVE_ANIM[move] ?? MOVE_ANIM.L1;
  const ph = attackPhase(f);
  if (move === 'AIR') {
    if (ph < 1) return mix(out, APEX, anim.hit, easeOut(ph));
    if (ph < 2) return copy(out, anim.hit);
    return mix(out, anim.hit, FALL, easeInOut(ph - 2));
  }
  if (ph < 1) {
    // Anticipation, then a late snap so the strike is fully out when it becomes active.
    if (ph < 0.55) return mix(out, IDLE, anim.wind, easeOut(ph / 0.55));
    return mix(out, anim.wind, anim.hit, easeIn((ph - 0.55) / 0.45));
  }
  if (ph < 2) {
    copy(out, anim.hit);
    // A touch of follow-through while the strike is live.
    const push = Math.sin((ph - 1) * Math.PI) * 2;
    add(out, SPINE, push);
    add(out, DX, push * 0.6);
    return out;
  }
  const k = ph - 2;
  if (k < 0.45) return mix(out, anim.hit, anim.rec, easeInOut(k / 0.45));
  return mix(out, anim.rec, IDLE, easeInOut((k - 0.45) / 0.55));
}

/**
 * Compute the pose of fighter `f` into `out`.
 * `time` (seconds) only drives ambient motion such as breathing.
 */
export function poseFor(out: Pose, f: Readonly<Fighter>, time: number, reducedMotion: boolean): Pose {
  const t = f.t;
  const amb = reducedMotion ? 0 : 1;
  const seed = f.char.length * 1.7 + f.skin;

  switch (f.state) {
    case 'idle': {
      copy(out, IDLE);
      const b = Math.sin(time * 2.4 + seed) * amb;
      add(out, SPINE, b * 1.2);
      add(out, ELB_N, b * 2);
      add(out, ELB_F, -b * 2.5);
      add(out, KNEE_N, b * 1.5);
      add(out, KNEE_F, b * 1.5);
      return out;
    }

    case 'walkF':
    case 'walkB': {
      const period = f.state === 'walkF' ? 24 : 28;
      let ph = (t % period) / period;
      if (f.state === 'walkB') ph = 1 - ph;
      // IDLE -> STEP_A -> IDLE -> STEP_B -> IDLE
      const seg = ph * 4;
      if (seg < 1) return mix(out, IDLE, STEP_A, easeInOut(seg));
      if (seg < 2) return mix(out, STEP_A, IDLE, easeInOut(seg - 1));
      if (seg < 3) return mix(out, IDLE, STEP_B, easeInOut(seg - 2));
      return mix(out, STEP_B, IDLE, easeInOut(seg - 3));
    }

    case 'prejump':
      return mix(out, IDLE, CROUCH, easeOut(t / PREJUMP_TICKS));

    case 'jump': {
      if (f.vy >= 0) mix(out, APEX, RISE, clamp01(f.vy / 8));
      else mix(out, APEX, FALL, clamp01(-f.vy / 9));
      if (t < 3) mix(out, CROUCH, copy(scratchA, out), t / 3);
      return out;
    }

    case 'land':
      return mix(out, LANDP, IDLE, easeInOut(t / (LAND_TICKS + f.moveExtra)));

    case 'block':
      return mix(out, IDLE, BLOCK, easeOut(t / 4));

    case 'blockstun': {
      const p = f.stunTotal > 0 ? 1 - f.stun / f.stunTotal : 1;
      return mix(out, BLOCK_HIT, BLOCK, easeOut(p));
    }

    case 'parry': {
      const p = t / PARRY_TICKS;
      if (p < 0.6) return mix(out, BLOCK, PARRYP, easeOut(p / 0.25));
      return mix(out, PARRYP, IDLE, easeInOut((p - 0.6) / 0.4));
    }

    case 'dodgeB': {
      const p = t / DODGE_TICKS;
      if (p < 0.25) mix(out, IDLE, HOP_B, easeOut(p / 0.25));
      else if (p < 0.7) copy(out, HOP_B);
      else mix(out, HOP_B, IDLE, easeInOut((p - 0.7) / 0.3));
      add(out, LIFT, Math.sin(clamp01(p / 0.8) * Math.PI) * 13);
      return out;
    }

    case 'dodgeF': {
      const p = t / DODGE_TICKS;
      if (p < 0.2) return mix(out, IDLE, DASH, easeOut(p / 0.2));
      if (p < 0.72) return copy(out, DASH);
      return mix(out, DASH, IDLE, easeInOut((p - 0.72) / 0.28));
    }

    case 'attack':
      if (!f.move) return copy(out, IDLE);
      return attackPose(out, f);

    case 'hit': {
      const p = f.stunTotal > 0 ? 1 - f.stun / f.stunTotal : 1;
      if (p < 0.2) return mix(out, IDLE, HIT_L, easeOut(p / 0.2));
      return mix(out, HIT_L, IDLE, easeInOut((p - 0.2) / 0.8));
    }

    case 'hitHeavy': {
      const p = f.stunTotal > 0 ? 1 - f.stun / f.stunTotal : 1;
      if (p < 0.16) return mix(out, IDLE, HIT_H, easeOut(p / 0.16));
      if (p < 0.6) return mix(out, HIT_H, STAGGER, easeInOut((p - 0.16) / 0.44));
      return mix(out, STAGGER, IDLE, easeInOut((p - 0.6) / 0.4));
    }

    case 'launch': {
      mix(out, HIT_H, LAUNCH, easeOut(t / 6));
      out[ROT] = Math.min(84, t * 4.4);
      return out;
    }

    case 'down': {
      const ko = f.hp <= 0;
      const rest = ko ? LYING_KO : LYING;
      // Settle from the tumble, with one small bounce.
      mix(out, LYING, rest, easeInOut(t / 26));
      add(out, LIFT, t < 12 ? Math.sin((t / 12) * Math.PI) * 5 : 0);
      const breath = Math.sin(time * (ko ? 3.2 : 4)) * amb;
      add(out, SPINE, breath * 1.6);
      add(out, ELB_N, breath * 2.4);
      return out;
    }

    case 'getup': {
      const p = t / GETUP_TICKS;
      if (p < 0.45) return mix(out, LYING, SIT, easeInOut(p / 0.45));
      if (p < 0.75) return mix(out, SIT, CROUCH, easeInOut((p - 0.45) / 0.3));
      return mix(out, CROUCH, IDLE, easeInOut((p - 0.75) / 0.25));
    }

    case 'guardbreak': {
      mix(out, STAGGER, DAZED, easeOut(t / 10));
      const sway = Math.sin(t * 0.21);
      add(out, SPINE, sway * 7);
      add(out, HEAD, Math.sin(t * 0.21 + 1.1) * 10);
      add(out, ARM_N, sway * 6);
      add(out, ARM_F, -sway * 5);
      add(out, DX, sway * 3);
      return out;
    }

    case 'win': {
      mix(out, IDLE, WINP, easeOut(t / 16));
      const b = Math.sin(time * 3) * amb;
      add(out, ARM_N, b * 2);
      add(out, LIFT, 0);
      return out;
    }

    case 'lose': {
      mix(out, IDLE, LOSEP, easeInOut(t / 24));
      const b = Math.sin(time * 4.2) * amb;
      add(out, SPINE, b * 2.2);
      add(out, HEAD, b * 1.5);
      return out;
    }

    case 'intro': {
      const settle = INTRO_TICKS - 34;
      if (t < settle) {
        copy(out, RELAXED);
        const hop = Math.abs(Math.sin(t * 0.17)) * amb;
        add(out, LIFT, hop * 4);
        add(out, KNEE_N, -hop * 8);
        add(out, KNEE_F, -hop * 8);
        add(out, ELB_N, hop * 14);
        add(out, ELB_F, hop * 14);
        return out;
      }
      return mix(out, RELAXED, IDLE, easeInOut((t - settle) / 30));
    }

    default:
      return copy(out, IDLE);
  }
}

/** Named poses used by portraits. */
export const PORTRAIT_POSES = { neutral: IDLE, win: WINP, lose: HIT_L } as const;
