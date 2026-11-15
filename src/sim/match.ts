/**
 * Deterministic 1-v-1 match simulation.
 *
 * `stepMatch` advances the fight by exactly one tick (1/60 s) from two input
 * masks. It never touches the DOM, timers or randomness, so the same inputs
 * always produce the same fight — in the browser and on the match server.
 */
import { hitbox, hurtbox, overlaps } from './boxes';
import {
  CHARS,
  CHIP_RATIO,
  COMBO_LINGER_TICKS,
  COMBO_SCALE,
  COMBO_SCALE_MIN,
  COUNTER_BONUS,
  DODGE_COOLDOWN,
  DODGE_DIST_B,
  DODGE_DIST_F,
  DODGE_INVULN_TO,
  DODGE_TICKS,
  DOWN_TICKS,
  GETUP_TICKS,
  GRAVITY,
  GUARDBREAK_TICKS,
  GUARD_REGEN_DELAY,
  GUARD_REGEN_PER_TICK,
  INPUT_BUFFER_TICKS,
  INTRO_TICKS,
  KO_TICKS,
  LAND_TICKS,
  MAX_SEP,
  METER_MAX,
  METER_ON_PARRY,
  METER_PER_DAMAGE_DEALT,
  METER_PER_DAMAGE_TAKEN,
  MOVES,
  PARRY_LOCKOUT,
  PARRY_PUNISH,
  PARRY_TICKS,
  PARRY_WINDOW,
  PREJUMP_TICKS,
  ROUND_SECONDS,
  SP_DASH_SPEED,
  SP_INVULN_TICKS,
  STAGE_W,
  TICK_RATE,
  TIMEUP_TICKS,
  WALL,
  defaultMods,
  moveFrames,
} from './data';
import { IN } from './types';
import type {
  CharId,
  Fighter,
  FighterMods,
  FighterStateId,
  InputMask,
  MatchState,
  MoveId,
  SimEvent,
} from './types';

export interface FighterInit {
  char: CharId;
  skin?: number;
  mods?: Partial<FighterMods>;
  /** Multiplies the character's base max health. */
  maxHpMul?: number;
  /** Multiplies the character's base guard gauge. */
  maxGuardMul?: number;
  /** Starting health (defaults to full). */
  hp?: number;
  /** Starting overdrive meter. */
  meter?: number;
}

export interface MatchOptions {
  training?: boolean;
  /** Round length in seconds. */
  seconds?: number;
  skipIntro?: boolean;
}

const START_GAP = 340;

export function createFighter(init: FighterInit, x: number, facing: 1 | -1): Fighter {
  const c = CHARS[init.char];
  const maxHp = Math.max(1, Math.round(c.maxHp * (init.maxHpMul ?? 1)));
  const maxGuard = Math.max(1, Math.round(c.maxGuard * (init.maxGuardMul ?? 1)));
  const hp = init.hp === undefined ? maxHp : Math.max(1, Math.min(maxHp, Math.round(init.hp)));
  const base = defaultMods();
  base.meterGain = c.meter;
  return {
    char: init.char,
    skin: init.skin ?? 0,
    x,
    y: 0,
    vx: 0,
    vy: 0,
    facing,
    state: 'intro',
    t: 0,
    move: null,
    moveHit: false,
    moveExtra: 0,
    hp,
    maxHp,
    guard: maxGuard,
    maxGuard,
    meter: Math.max(0, Math.min(METER_MAX, init.meter ?? 0)),
    stun: 0,
    stunTotal: 0,
    invuln: 0,
    dodgeCd: 0,
    guardDelay: 0,
    blockHeld: 0,
    parryCd: 0,
    combo: 0,
    comboDmg: 0,
    comboTimer: 0,
    prevInput: 0,
    buffer: 0,
    bufferAge: 0,
    mods: { ...base, ...init.mods, meterGain: base.meterGain * (init.mods?.meterGain ?? 1) },
  };
}

export function createMatch(a: FighterInit, b: FighterInit, o: MatchOptions = {}): MatchState {
  const f0 = createFighter(a, STAGE_W / 2 - START_GAP / 2, 1);
  const f1 = createFighter(b, STAGE_W / 2 + START_GAP / 2, -1);
  const m: MatchState = {
    tick: 0,
    phase: 'intro',
    phaseT: 0,
    timer: Math.round((o.seconds ?? ROUND_SECONDS) * TICK_RATE),
    hitstop: 0,
    winner: -1,
    fighters: [f0, f1],
    events: [],
    training: o.training ?? false,
  };
  if (o.skipIntro) {
    m.phase = 'fight';
    enter(f0, 'idle');
    enter(f1, 'idle');
  }
  return m;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function enter(f: Fighter, s: FighterStateId): void {
  f.state = s;
  f.t = 0;
  f.move = null;
  f.moveHit = false;
  f.moveExtra = 0;
}

function isFree(s: FighterStateId): boolean {
  return s === 'idle' || s === 'walkF' || s === 'walkB' || s === 'block';
}

/** States in which a fighter cannot be struck at all. */
function untouchable(f: Fighter): boolean {
  return (
    f.invuln > 0 ||
    f.state === 'launch' ||
    f.state === 'down' ||
    f.state === 'getup' ||
    f.state === 'parry' ||
    f.state === 'intro' ||
    f.state === 'win' ||
    f.state === 'lose'
  );
}

function isReeling(f: Fighter): boolean {
  return (f.state === 'hit' || f.state === 'hitHeavy') && f.stun > 0;
}

function setPhase(m: MatchState, phase: MatchState['phase']): void {
  m.phase = phase;
  m.phaseT = 0;
  m.events.push({ type: 'phase', phase });
}

function addMeter(m: MatchState, i: 0 | 1, amount: number): void {
  const f = m.fighters[i];
  if (f.meter >= METER_MAX) return;
  f.meter = Math.min(METER_MAX, f.meter + amount * f.mods.meterGain);
  if (f.meter >= METER_MAX) m.events.push({ type: 'meterFull', who: i });
}

function heldDir(input: InputMask): -1 | 0 | 1 {
  const d = (input & IN.RIGHT ? 1 : 0) - (input & IN.LEFT ? 1 : 0);
  return d as -1 | 0 | 1;
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

function readButtons(f: Fighter, input: InputMask, frozen: boolean): void {
  const pressed = input & ~f.prevInput;
  f.prevInput = input;

  let b = 0;
  const both = (input & IN.LIGHT) !== 0 && (input & IN.HEAVY) !== 0 && (pressed & (IN.LIGHT | IN.HEAVY)) !== 0;
  if (pressed & IN.SPECIAL) {
    if (f.meter >= METER_MAX) b = IN.SPECIAL;
  } else if (both) {
    b = f.meter >= METER_MAX ? IN.SPECIAL : IN.HEAVY;
  } else if (pressed & IN.HEAVY) b = IN.HEAVY;
  else if (pressed & IN.LIGHT) b = IN.LIGHT;
  else if (pressed & IN.DODGE) b = IN.DODGE;
  else if (pressed & IN.JUMP) b = IN.JUMP;

  if (b) {
    f.buffer = b;
    f.bufferAge = 0;
  } else if (f.buffer && !frozen) {
    f.bufferAge++;
    if (f.bufferAge > INPUT_BUFFER_TICKS) f.buffer = 0;
  }

  if (input & IN.BLOCK) {
    if (f.blockHeld === 0) {
      // A press that follows another too quickly cannot just-guard.
      f.blockHeld = f.parryCd > 0 ? PARRY_WINDOW + 1 : 1;
      f.parryCd = PARRY_LOCKOUT;
    } else if (!frozen) {
      f.blockHeld++;
    }
  } else {
    f.blockHeld = 0;
  }
}

/* ------------------------------------------------------------------ */
/* Per-fighter state machine                                           */
/* ------------------------------------------------------------------ */

function startMove(m: MatchState, i: 0 | 1, move: MoveId): void {
  const f = m.fighters[i];
  enter(f, 'attack');
  f.move = move;
  f.buffer = 0;
  const c = CHARS[f.char];
  m.events.push({
    type: 'swing',
    who: i,
    move,
    strength: MOVES[move].strength,
    x: f.x + f.facing * 40,
    y: f.y + 120 * c.scale,
  });
}

function tryBufferedAction(m: MatchState, i: 0 | 1, input: InputMask): boolean {
  const f = m.fighters[i];
  switch (f.buffer) {
    case IN.SPECIAL:
      if (f.meter < METER_MAX) {
        f.buffer = 0;
        return false;
      }
      f.meter = 0;
      f.vx = 0;
      startMove(m, i, 'SP');
      f.invuln = SP_INVULN_TICKS;
      m.events.push({ type: 'special', who: i, x: f.x, y: f.y + 110 * CHARS[f.char].scale });
      return true;
    case IN.HEAVY:
      startMove(m, i, 'H');
      return true;
    case IN.LIGHT:
      startMove(m, i, 'L1');
      return true;
    case IN.DODGE: {
      if (f.dodgeCd > 0) return false;
      const fwd = heldDir(input) === f.facing;
      enter(f, fwd ? 'dodgeF' : 'dodgeB');
      f.buffer = 0;
      f.invuln = DODGE_INVULN_TO;
      m.events.push({ type: 'dodge', who: i, x: f.x, dir: (fwd ? f.facing : -f.facing) as 1 | -1 });
      return true;
    }
    case IN.JUMP:
      enter(f, 'prejump');
      f.buffer = 0;
      f.vx = 0;
      return true;
    default:
      return false;
  }
}

/** A fighter with full control: act on buffered buttons, guard, or move. */
function actFree(m: MatchState, i: 0 | 1, input: InputMask): void {
  const f = m.fighters[i];
  if (f.buffer && tryBufferedAction(m, i, input)) return;
  if (input & IN.BLOCK) {
    if (f.state !== 'block') enter(f, 'block');
    f.vx = 0;
    return;
  }
  const dir = heldDir(input);
  if (dir !== 0) {
    const fwd = dir === f.facing;
    const want: FighterStateId = fwd ? 'walkF' : 'walkB';
    if (f.state !== want) enter(f, want);
    f.vx = dir * CHARS[f.char].walk * f.mods.speed * (fwd ? 1 : 0.82);
  } else {
    if (f.state !== 'idle') enter(f, 'idle');
    f.vx = 0;
  }
}

function updateFighter(m: MatchState, i: 0 | 1, input: InputMask): void {
  const f = m.fighters[i];
  const c = CHARS[f.char];
  f.t++;
  if (f.invuln > 0) f.invuln--;
  if (f.dodgeCd > 0) f.dodgeCd--;
  if (f.parryCd > 0) f.parryCd--;

  switch (f.state) {
    case 'idle':
    case 'walkF':
    case 'walkB':
    case 'block':
      actFree(m, i, input);
      break;

    case 'prejump':
      if (f.t >= PREJUMP_TICKS) {
        const dir = heldDir(input);
        enter(f, 'jump');
        f.vy = c.jumpV;
        f.vx = dir * c.airSpeed * f.mods.speed;
        m.events.push({ type: 'jump', who: i, x: f.x });
      }
      break;

    case 'jump':
      if (f.buffer === IN.LIGHT || f.buffer === IN.HEAVY) {
        const vx = f.vx;
        const vy = f.vy;
        startMove(m, i, 'AIR');
        f.vx = vx;
        f.vy = vy;
      }
      break;

    case 'land':
      f.vx = 0;
      if (f.t >= LAND_TICKS + f.moveExtra) {
        enter(f, 'idle');
        actFree(m, i, input);
      }
      break;

    case 'dodgeF':
    case 'dodgeB': {
      const fwd = f.state === 'dodgeF';
      const dist = fwd ? DODGE_DIST_F : DODGE_DIST_B;
      const dirSign = fwd ? f.facing : -f.facing;
      // Linear ease-out whose per-tick steps sum to exactly `dist`.
      f.vx = (dirSign * dist * 2 * (DODGE_TICKS - f.t + 0.5)) / (DODGE_TICKS * DODGE_TICKS);
      if (f.t >= DODGE_TICKS) {
        f.dodgeCd = Math.round(DODGE_COOLDOWN * f.mods.dodgeCooldown);
        enter(f, 'idle');
        f.vx = 0;
      }
      break;
    }

    case 'attack': {
      const mv = f.move;
      if (!mv) {
        enter(f, 'idle');
        break;
      }
      if (mv === 'AIR') break; // airborne: resolved on landing
      const def = MOVES[mv];
      const fr = moveFrames(f.char, mv);
      const total = fr.total + f.moveExtra;
      if (mv === 'SP') {
        if (f.t <= fr.startup) f.vx = 0;
        else if (f.t <= fr.startup + fr.active && !f.moveHit) f.vx = f.facing * SP_DASH_SPEED;
        else f.vx *= 0.6;
      } else {
        if (f.t <= fr.startup) f.vx = f.facing * def.lunge * c.reach;
        else f.vx *= 0.6;
        if (f.moveHit && f.buffer && f.t > fr.startup && f.t < total) {
          let next: MoveId | undefined;
          if (f.buffer === IN.LIGHT) next = def.cancel.light;
          else if (f.buffer === IN.HEAVY) next = def.cancel.heavy;
          else if (f.buffer === IN.SPECIAL && f.meter >= METER_MAX) next = 'SP';
          if (next === 'SP') {
            tryBufferedAction(m, i, input);
            break;
          }
          if (next) {
            startMove(m, i, next);
            break;
          }
        }
      }
      if (f.t >= total) {
        enter(f, 'idle');
        f.vx = 0;
        actFree(m, i, input);
      }
      break;
    }

    case 'hit':
    case 'hitHeavy':
    case 'blockstun':
      f.stun--;
      if (f.stun <= 0) {
        f.stun = 0;
        enter(f, 'idle');
        actFree(m, i, input);
      }
      break;

    case 'parry':
      if (f.t >= PARRY_TICKS) {
        enter(f, 'idle');
        actFree(m, i, input);
      }
      break;

    case 'down':
      if (f.hp > 0 && f.t >= DOWN_TICKS) enter(f, 'getup');
      break;

    case 'getup':
      if (f.t >= GETUP_TICKS) {
        enter(f, 'idle');
        actFree(m, i, input);
      }
      break;

    case 'guardbreak':
      if (f.t >= GUARDBREAK_TICKS) {
        f.guard = f.maxGuard;
        enter(f, 'idle');
        actFree(m, i, input);
      }
      break;

    case 'launch':
    case 'intro':
    case 'win':
    case 'lose':
      break;
  }
}

/* ------------------------------------------------------------------ */
/* Physics                                                             */
/* ------------------------------------------------------------------ */

function integrate(m: MatchState, i: 0 | 1): void {
  const f = m.fighters[i];
  if (f.y > 0 || f.vy > 0) {
    f.vy -= GRAVITY;
    f.y += f.vy;
    f.x += f.vx;
    if (f.y <= 0 && f.vy <= 0) {
      f.y = 0;
      f.vy = 0;
      if (f.state === 'launch') {
        enter(f, 'down');
        f.vx *= 0.35;
        m.events.push({ type: 'land', who: i, x: f.x, hard: true });
      } else if (f.state === 'attack') {
        const rec = f.move ? moveFrames(f.char, f.move).recovery : 0;
        enter(f, 'land');
        f.moveExtra = rec;
        f.vx = 0;
        m.events.push({ type: 'land', who: i, x: f.x, hard: false });
      } else if (f.state === 'jump') {
        enter(f, 'land');
        f.vx = 0;
        m.events.push({ type: 'land', who: i, x: f.x, hard: false });
      } else {
        f.vx = 0;
      }
    }
    return;
  }
  f.x += f.vx;
  switch (f.state) {
    case 'hit':
    case 'hitHeavy':
    case 'blockstun':
    case 'guardbreak':
    case 'down':
    case 'getup':
    case 'parry':
    case 'win':
    case 'lose':
    case 'intro':
      f.vx *= 0.86;
      if (Math.abs(f.vx) < 0.05) f.vx = 0;
      break;
    default:
      break;
  }
}

function clampToArena(f: Fighter): number {
  const before = f.x;
  if (f.x < WALL) f.x = WALL;
  else if (f.x > STAGE_W - WALL) f.x = STAGE_W - WALL;
  return f.x - before;
}

function noPush(f: Fighter): boolean {
  // A fighter on the way up passes freely; bodies sort themselves out on the way down.
  return f.state === 'dodgeF' || f.state === 'launch' || (f.y > 0 && f.vy > 0);
}

const MAX_PUSH_PER_TICK = 7;
const PUSH_HEIGHT = 0.55;
const PUSH_MARGIN = 11;

function resolveBodies(m: MatchState): void {
  const [a, b] = m.fighters;
  clampToArena(a);
  clampToArena(b);

  if (!noPush(a) && !noPush(b)) {
    const A = hurtbox(a);
    const B = hurtbox(b);
    // Bodies only push below shoulder height, so a well-timed jump clears
    // the opponent and lands on the other side.
    const topA = A.y0 + (A.y1 - A.y0) * PUSH_HEIGHT;
    const topB = B.y0 + (B.y1 - B.y0) * PUSH_HEIGHT;
    if (A.y0 < topB && B.y0 < topA) {
      // Push boxes are a little wider than hurt boxes so strikes have room.
      const overlap = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0) + PUSH_MARGIN * 2;
      if (overlap > 0) {
        const aLeft = a.x < b.x || (a.x === b.x && a.facing === 1);
        const push = Math.min(overlap / 2, MAX_PUSH_PER_TICK);
        a.x += aLeft ? -push : push;
        b.x += aLeft ? push : -push;
        // Whatever a wall takes away from one fighter is given to the other.
        const ca = clampToArena(a);
        if (ca !== 0) b.x += ca;
        const cb = clampToArena(b);
        if (cb !== 0) a.x += cb;
        clampToArena(a);
      }
    }
  }

  const sep = Math.abs(a.x - b.x);
  if (sep > MAX_SEP) {
    const excess = sep - MAX_SEP;
    const left = a.x < b.x ? a : b;
    const right = left === a ? b : a;
    const leftOut = left.vx < 0;
    const rightOut = right.vx > 0;
    if (leftOut && rightOut) {
      left.x += excess / 2;
      right.x -= excess / 2;
    } else if (rightOut) {
      right.x -= excess;
    } else {
      left.x += excess;
    }
  }
}

function updateFacing(m: MatchState): void {
  const [a, b] = m.fighters;
  if (a.x === b.x) return;
  if (isFree(a.state) || a.state === 'land' || a.state === 'intro') a.facing = b.x > a.x ? 1 : -1;
  if (isFree(b.state) || b.state === 'land' || b.state === 'intro') b.facing = a.x > b.x ? 1 : -1;
}

/* ------------------------------------------------------------------ */
/* Hits                                                                */
/* ------------------------------------------------------------------ */

interface Contact {
  attacker: 0 | 1;
  /** Captured at detection so simultaneous hits (trades) both resolve. */
  move: MoveId;
  x: number;
  y: number;
}

function findContact(m: MatchState, ai: 0 | 1): Contact | null {
  const att = m.fighters[ai];
  const vic = m.fighters[ai === 0 ? 1 : 0];
  if (att.moveHit || !att.move) return null;
  const hb = hitbox(att);
  if (!hb) return null;
  if (untouchable(vic)) return null;
  const hurt = hurtbox(vic);
  if (!overlaps(hb, hurt)) return null;
  return {
    attacker: ai,
    move: att.move,
    x: (Math.max(hb.x0, hurt.x0) + Math.min(hb.x1, hurt.x1)) / 2,
    y: (Math.max(hb.y0, hurt.y0) + Math.min(hb.y1, hurt.y1)) / 2,
  };
}

function applyContact(m: MatchState, ct: Contact, trade: boolean): void {
  const ai = ct.attacker;
  const vi = (ai === 0 ? 1 : 0) as 0 | 1;
  const att = m.fighters[ai];
  const vic = m.fighters[vi];
  const move = ct.move;
  const def = MOVES[move];
  att.moveHit = true;
  if (move === 'SP' && att.state === 'attack') att.vx = 0;

  let dir: 1 | -1 = att.facing;
  if (vic.x > att.x) dir = 1;
  else if (vic.x < att.x) dir = -1;
  const cornered = dir === 1 ? vic.x >= STAGE_W - WALL - 2 : vic.x <= WALL + 2;

  const blocking = vic.y === 0 && vic.blockHeld > 0 && (vic.state === 'block' || vic.state === 'blockstun');

  if (blocking) {
    const parry = vic.state === 'block' && vic.blockHeld <= PARRY_WINDOW;
    if (parry) {
      enter(vic, 'parry');
      vic.invuln = PARRY_TICKS;
      vic.vx = 0;
      att.moveExtra += PARRY_PUNISH;
      addMeter(m, vi, METER_ON_PARRY);
      m.hitstop = Math.max(m.hitstop, 9);
      m.events.push({ type: 'block', defender: vi, strength: def.strength, x: ct.x, y: ct.y, parry: true });
      return;
    }
    const chip = def.damage * CHARS[att.char].power * att.mods.power * CHIP_RATIO * vic.mods.chip * vic.mods.defense;
    vic.hp = Math.max(1, vic.hp - chip);
    vic.guard -= def.guardDamage;
    vic.guardDelay = GUARD_REGEN_DELAY;
    addMeter(m, ai, def.damage * METER_PER_DAMAGE_DEALT * 0.4);
    addMeter(m, vi, def.damage * METER_PER_DAMAGE_TAKEN * 0.5);
    m.hitstop = Math.max(m.hitstop, Math.round(def.hitstop * 0.6));
    if (cornered) att.vx = -dir * def.knockback * 0.7;
    if (vic.guard <= 0) {
      vic.guard = 0;
      enter(vic, 'guardbreak');
      vic.vx = dir * 3;
      m.events.push({ type: 'guardbreak', who: vi, x: ct.x, y: ct.y });
      return;
    }
    enter(vic, 'blockstun');
    vic.stun = def.blockstun;
    vic.stunTotal = def.blockstun;
    vic.vx = dir * def.knockback * 0.6;
    m.events.push({ type: 'block', defender: vi, strength: def.strength, x: ct.x, y: ct.y, parry: false });
    return;
  }

  // Clean hit.
  const counter = vic.state === 'attack' && vic.move !== null && vic.t < moveFrames(vic.char, vic.move).startup + MOVES[vic.move].active;
  att.combo = isReeling(vic) && !trade ? att.combo + 1 : 1;
  if (att.combo === 1) att.comboDmg = 0;
  att.comboTimer = COMBO_LINGER_TICKS;
  const scale = Math.max(COMBO_SCALE_MIN, Math.pow(COMBO_SCALE, att.combo - 1));
  let dmg = def.damage * CHARS[att.char].power * att.mods.power * scale * vic.mods.defense;
  if (counter) dmg *= COUNTER_BONUS;
  if (move === 'FIN' || move === 'SP') dmg *= att.mods.finisher;
  dmg = Math.round(dmg);
  att.comboDmg += dmg;

  // In a trade both strikes land, so neither side's fresh combo is wiped.
  if (!trade) {
    vic.combo = 0;
    vic.comboDmg = 0;
  }
  // A fighter struck out of a guard break gets their guard back afterwards.
  if (vic.state === 'guardbreak') vic.guard = vic.maxGuard;
  vic.hp -= dmg;
  if (m.training && vic.hp < 1) vic.hp = 1;
  addMeter(m, ai, dmg * METER_PER_DAMAGE_DEALT);
  addMeter(m, vi, dmg * METER_PER_DAMAGE_TAKEN);
  m.hitstop = Math.max(m.hitstop, def.hitstop);
  if (cornered) att.vx = -dir * def.knockback * 0.6;

  const ko = vic.hp <= 0;
  const launch = ko || def.launch > 0 || vic.y > 0;
  if (ko) vic.hp = 0;
  if (launch) {
    enter(vic, 'launch');
    vic.stun = 0;
    vic.vy = Math.max(def.launch, ko ? 8.5 : 6.5);
    vic.vx = dir * Math.max(def.knockback * 0.75, ko ? 5 : 3.5);
  } else {
    enter(vic, def.strength === 'light' ? 'hit' : 'hitHeavy');
    vic.stun = def.hitstun;
    vic.stunTotal = def.hitstun;
    vic.vx = dir * def.knockback;
  }
  vic.buffer = 0;

  m.events.push({
    type: 'hit',
    attacker: ai,
    move,
    strength: def.strength,
    x: ct.x,
    y: ct.y,
    damage: dmg,
    combo: att.combo,
    counter,
    launch,
  });
  if (ko) m.events.push({ type: 'ko', who: vi, x: vic.x, y: ct.y });
}

/* ------------------------------------------------------------------ */
/* Gauges                                                              */
/* ------------------------------------------------------------------ */

function updateGauges(m: MatchState, i: 0 | 1): void {
  const f = m.fighters[i];
  const opp = m.fighters[i === 0 ? 1 : 0];

  if (f.state === 'block' || f.state === 'blockstun') {
    if (f.guardDelay < 12) f.guardDelay = 12;
  } else if (f.state !== 'guardbreak') {
    if (f.guardDelay > 0) f.guardDelay--;
    else if (f.guard < f.maxGuard) f.guard = Math.min(f.maxGuard, f.guard + GUARD_REGEN_PER_TICK);
  }

  if (f.combo > 0) {
    const oppHelpless =
      opp.state === 'hit' || opp.state === 'hitHeavy' || opp.state === 'launch' || opp.state === 'down' || opp.state === 'getup';
    if (!oppHelpless) {
      f.comboTimer--;
      if (f.comboTimer <= 0) {
        f.combo = 0;
        f.comboDmg = 0;
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Phases                                                              */
/* ------------------------------------------------------------------ */

function grounded(f: Fighter): boolean {
  return f.y === 0 && f.vy === 0;
}

/** Moves a surviving fighter into a closing pose once they are able to. */
function settle(f: Fighter, pose: 'win' | 'lose', phaseT: number, after: number): void {
  if (f.state === pose || f.hp <= 0) return;
  if (phaseT < after || !grounded(f)) return;
  if (isFree(f.state) || f.state === 'land') {
    enter(f, pose);
    f.vx = 0;
  }
}

function decideTimeUp(m: MatchState): void {
  const [a, b] = m.fighters;
  const ra = a.hp / a.maxHp;
  const rb = b.hp / b.maxHp;
  m.winner = ra === rb ? 2 : ra > rb ? 0 : 1;
  setPhase(m, 'timeup');
}

function stepBodies(m: MatchState, in0: InputMask, in1: InputMask): void {
  updateFighter(m, 0, in0);
  updateFighter(m, 1, in1);
  integrate(m, 0);
  integrate(m, 1);
  resolveBodies(m);
  updateFacing(m);
}

/**
 * Advance the match by one tick. `in0` / `in1` are the controller masks of
 * fighters 0 and 1. Events for this tick are left in `m.events`.
 */
export function stepMatch(m: MatchState, in0: InputMask, in1: InputMask): void {
  m.events.length = 0;
  if (m.phase === 'over') return;
  m.tick++;
  m.phaseT++;
  const [f0, f1] = m.fighters;

  switch (m.phase) {
    case 'intro':
      f0.t++;
      f1.t++;
      f0.prevInput = in0;
      f1.prevInput = in1;
      if (m.phaseT >= INTRO_TICKS) {
        enter(f0, 'idle');
        enter(f1, 'idle');
        setPhase(m, 'fight');
      }
      return;

    case 'fight': {
      if (m.hitstop > 0) {
        m.hitstop--;
        readButtons(f0, in0, true);
        readButtons(f1, in1, true);
        return;
      }
      readButtons(f0, in0, false);
      readButtons(f1, in1, false);
      stepBodies(m, in0, in1);

      const c0 = findContact(m, 0);
      const c1 = findContact(m, 1);
      const trade = c0 !== null && c1 !== null;
      if (c0) applyContact(m, c0, trade);
      if (c1) applyContact(m, c1, trade);

      updateGauges(m, 0);
      updateGauges(m, 1);

      const dead0 = f0.hp <= 0;
      const dead1 = f1.hp <= 0;
      if (dead0 || dead1) {
        m.winner = dead0 && dead1 ? 2 : dead0 ? 1 : 0;
        setPhase(m, 'ko');
        return;
      }
      if (!m.training) {
        m.timer--;
        if (m.timer <= 0) {
          m.timer = 0;
          decideTimeUp(m);
        }
      }
      return;
    }

    case 'ko':
      if (m.hitstop > 0) {
        m.hitstop--;
        return;
      }
      f0.buffer = 0;
      f1.buffer = 0;
      f0.blockHeld = 0;
      f1.blockHeld = 0;
      stepBodies(m, 0, 0);
      settle(f0, 'win', m.phaseT, 55);
      settle(f1, 'win', m.phaseT, 55);
      if (m.phaseT >= KO_TICKS) setPhase(m, 'over');
      return;

    case 'timeup':
      m.hitstop = 0;
      f0.buffer = 0;
      f1.buffer = 0;
      f0.blockHeld = 0;
      f1.blockHeld = 0;
      stepBodies(m, 0, 0);
      settle(f0, m.winner === 0 ? 'win' : 'lose', m.phaseT, 20);
      settle(f1, m.winner === 1 ? 'win' : 'lose', m.phaseT, 20);
      if (m.phaseT >= TIMEUP_TICKS) setPhase(m, 'over');
      return;
  }
}

/** Convenience for tools and tests: collect the events of several ticks. */
export function runTicks(
  m: MatchState,
  ticks: number,
  inputs: (tick: number) => [InputMask, InputMask],
  onEvent?: (e: SimEvent, tick: number) => void,
): void {
  for (let n = 0; n < ticks; n++) {
    const [a, b] = inputs(m.tick);
    stepMatch(m, a, b);
    if (onEvent) for (const e of m.events) onEvent(e, m.tick);
  }
}
