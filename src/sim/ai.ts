/**
 * CPU opponent. The AI only ever produces a controller mask, exactly like a
 * human player — it has no access to anything a player could not do. It sees
 * the opponent through a reaction-delay buffer, so lower levels respond late.
 */
import { CHARS, METER_MAX, MOVES, PARRY_WINDOW, moveFrames } from './data';
import { makeRng, rnd, rndInt } from './rng';
import type { Rng } from './rng';
import { IN } from './types';
import type { Fighter, FighterStateId, InputMask, MatchState, MoveId } from './types';

export interface AiParams {
  level: number;
  /** Ticks of delay before the AI perceives what the opponent is doing. */
  reaction: number;
  /** Chance to guard an attack it sees coming. */
  block: number;
  /** Chance to evade an attack it sees coming. */
  dodge: number;
  /** Chance that a last-moment guard is timed as a just-guard. */
  parry: number;
  /** Tendency to hold guard pre-emptively while waiting at close range. */
  guard: number;
  /** Chance to continue a string after contact. */
  combo: number;
  /** Chance to punish a recovering opponent. */
  punish: number;
  /** Preference for closing in over waiting. */
  aggression: number;
  /** Chance an opener is a heavy strike. */
  heavyBias: number;
  /** Chance to spend a full meter when there is an opening. */
  special: number;
  /** Chance per decision to jump in from mid range. */
  jump: number;
  /** Idle time between offensive decisions (ticks). */
  idleMin: number;
  idleMax: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Parameters for a difficulty level from 1 (novice) to 10 (expert). */
export function aiParamsForLevel(level: number): AiParams {
  const lv = Math.max(1, Math.min(10, level));
  const t = (lv - 1) / 9;
  return {
    level: lv,
    reaction: Math.round(lerp(24, 6, t)),
    block: lerp(0.08, 0.8, t),
    dodge: lerp(0.02, 0.14, t),
    parry: lerp(0, 0.4, t),
    guard: lerp(0.04, 0.62, t),
    combo: lerp(0.15, 0.95, t),
    punish: lerp(0.05, 0.85, t),
    aggression: lerp(0.35, 0.85, t),
    heavyBias: lerp(0.45, 0.3, t),
    special: lerp(0.2, 0.9, t),
    jump: lerp(0.04, 0.11, t),
    idleMin: Math.round(lerp(50, 8, t)),
    idleMax: Math.round(lerp(110, 28, t)),
  };
}

interface Percept {
  state: FighterStateId;
  move: MoveId | null;
  t: number;
  /** Tick the opponent's current state began: identifies one attack. */
  id: number;
}

const HISTORY = 32;

type Plan = 'approach' | 'hold' | 'retreat';

export interface AiState {
  params: AiParams;
  rng: Rng;
  history: Percept[];
  head: number;
  plan: Plan;
  planT: number;
  /** Ticks left to keep holding guard. */
  blockT: number;
  /** Hold guard pre-emptively during the current `hold` plan. */
  guarding: boolean;
  /** Opponent attack id already reacted to. */
  reactedId: number;
  /** Own attack id whose follow-up was already decided. */
  chainId: number;
  /** Opponent recovery id already considered for a punish. */
  punishId: number;
  /** Ticks until the jump attack is thrown (0 = none planned). */
  airT: number;
  /** Buttons pressed last tick (to generate clean press edges). */
  lastOut: InputMask;
  /** Taps deferred to the next tick. */
  pending: InputMask;
}

export function createAi(params: AiParams, seed: number): AiState {
  const history: Percept[] = [];
  for (let i = 0; i < HISTORY; i++) history.push({ state: 'idle', move: null, t: 0, id: -1 });
  return {
    params,
    rng: makeRng(seed),
    history,
    head: 0,
    plan: 'hold',
    planT: 30,
    blockT: 0,
    guarding: false,
    reactedId: -1,
    chainId: -1,
    punishId: -1,
    airT: 0,
    lastOut: 0,
    pending: 0,
  };
}

const TAP_BUTTONS = IN.JUMP | IN.DODGE | IN.LIGHT | IN.HEAVY | IN.SPECIAL;

function canAct(f: Readonly<Fighter>): boolean {
  return f.state === 'idle' || f.state === 'walkF' || f.state === 'walkB' || f.state === 'block';
}

function strikeRange(me: Readonly<Fighter>, opp: Readonly<Fighter>, move: MoveId): number {
  const c = CHARS[me.char];
  const o = CHARS[opp.char];
  return MOVES[move].box.x1 * c.reach + (o.bodyW * o.scale) / 2;
}

function newPlan(ai: AiState): void {
  const p = ai.params;
  const r = rnd(ai.rng);
  if (r < p.aggression) {
    ai.plan = 'approach';
    ai.planT = rndInt(ai.rng, 50, 130);
  } else if (r < p.aggression + (1 - p.aggression) * 0.6) {
    ai.plan = 'hold';
    ai.planT = rndInt(ai.rng, p.idleMin, p.idleMax);
    ai.guarding = rnd(ai.rng) < p.guard;
  } else {
    ai.plan = 'retreat';
    ai.planT = rndInt(ai.rng, 14, 34);
  }
}

function rest(ai: AiState): void {
  ai.plan = 'hold';
  ai.planT = rndInt(ai.rng, ai.params.idleMin, ai.params.idleMax);
  ai.guarding = rnd(ai.rng) < ai.params.guard;
}

/** Produce the controller mask of fighter `self` for the upcoming tick. */
export function aiInput(ai: AiState, m: Readonly<MatchState>, self: 0 | 1): InputMask {
  const me = m.fighters[self];
  const opp = m.fighters[self === 0 ? 1 : 0];
  const p = ai.params;

  // Record what the opponent is doing now; perceive it `reaction` ticks late.
  ai.head = (ai.head + 1) % HISTORY;
  const slot = ai.history[ai.head] as Percept;
  slot.state = opp.state;
  slot.move = opp.move;
  slot.t = opp.t;
  slot.id = m.tick - opp.t;
  const seen = ai.history[(ai.head - Math.min(p.reaction, HISTORY - 1) + HISTORY * 2) % HISTORY] as Percept;

  if (m.phase !== 'fight') {
    ai.lastOut = 0;
    ai.pending = 0;
    return 0;
  }

  const dx = opp.x - me.x;
  const dist = Math.abs(dx);
  const toward = dx >= 0 ? IN.RIGHT : IN.LEFT;
  const away = dx >= 0 ? IN.LEFT : IN.RIGHT;
  let hold = 0;
  let taps = ai.pending;
  ai.pending = 0;

  /* ---- defence: react to an attack that is on its way ---- */
  if (seen.state === 'attack' && seen.move && seen.id !== ai.reactedId && opp.state === 'attack') {
    const fr = moveFrames(opp.char, seen.move);
    const live = seen.t < fr.startup + fr.active;
    let reach = strikeRange(opp, me, seen.move) + 46;
    if (seen.move === 'SP') reach += 230;
    if (seen.move === 'AIR') reach += 60;
    if (live && dist < reach) {
      ai.reactedId = seen.id;
      if (canAct(me) || me.state === 'blockstun') {
        const r = rnd(ai.rng);
        const keep = fr.startup + fr.active - opp.t + 10;
        const alreadyGuarding = me.state === 'blockstun' || (me.state === 'block' && me.blockHeld > PARRY_WINDOW);
        if (alreadyGuarding) {
          // Staying behind a guard that is already up is the easy part.
          if (r < 0.5 + p.block * 0.5) ai.blockT = Math.max(ai.blockT, keep);
        } else if (r < p.block) {
          // Raising the guard this late would be a just-guard: that takes skill.
          const early = fr.startup - opp.t > PARRY_WINDOW + 1;
          if (early || rnd(ai.rng) < p.parry) ai.blockT = Math.max(ai.blockT, keep);
          else if (me.dodgeCd === 0 && canAct(me) && rnd(ai.rng) < 0.4) {
            taps |= IN.DODGE;
            hold |= away;
          }
        } else if (r < p.block + p.dodge && me.dodgeCd === 0 && canAct(me)) {
          taps |= IN.DODGE;
          // Skilled opponents slip through to the other side for a punish.
          if (rnd(ai.rng) < p.punish * 0.6) hold |= toward;
          else hold |= away;
        }
      }
    }
  }

  if (ai.blockT > 0) {
    ai.blockT--;
    // Let go once the opponent is clearly finished.
    if (opp.state !== 'attack' && me.state !== 'blockstun' && ai.blockT > 4) ai.blockT = 4;
    hold |= IN.BLOCK;
    return finish(ai, hold, taps);
  }

  /* ---- mid-attack: decide whether to continue the string ---- */
  if (me.state === 'attack') {
    const myId = m.tick - me.t;
    if (me.moveHit && me.move && ai.chainId !== myId) {
      ai.chainId = myId;
      const def = MOVES[me.move];
      const confirmed = opp.state === 'hit' || opp.state === 'hitHeavy';
      const chance = confirmed ? p.combo : p.combo * 0.45;
      if (rnd(ai.rng) < chance) {
        if (confirmed && me.meter >= METER_MAX && rnd(ai.rng) < p.special * 0.7) taps |= IN.SPECIAL;
        else if (def.cancel.heavy && (me.move === 'L2' || rnd(ai.rng) < 0.18)) taps |= IN.HEAVY;
        else if (def.cancel.light) taps |= IN.LIGHT;
      } else {
        rest(ai);
      }
    }
    return finish(ai, hold, taps);
  }

  /* ---- airborne: throw the planned jump kick ---- */
  if (me.state === 'jump') {
    if (ai.airT > 0 && --ai.airT === 0) taps |= IN.HEAVY;
    return finish(ai, hold, taps);
  }

  // Keep leaning in through the pre-jump so the jump travels forward.
  if (me.state === 'prejump' && ai.airT > 0) return finish(ai, hold | toward, taps);

  if (!canAct(me)) return finish(ai, hold, taps);

  /* ---- punish a recovering or dazed opponent ---- */
  let opening = false;
  if (seen.state === 'attack' && seen.move && opp.state === 'attack' && opp.move) {
    const fr = moveFrames(opp.char, opp.move);
    opening = opp.t >= fr.startup + fr.active && fr.total + opp.moveExtra - opp.t >= 8;
  } else if (seen.state === 'guardbreak' && opp.state === 'guardbreak') {
    opening = true;
  }
  if (opening && ai.punishId !== seen.id) {
    ai.punishId = seen.id;
    if (rnd(ai.rng) < p.punish) {
      ai.plan = 'approach';
      ai.planT = 40;
    }
  }

  const lightRange = strikeRange(me, opp, 'L1') * 0.94;
  const heavyRange = strikeRange(me, opp, 'H') * 0.9;
  const oppDown = opp.state === 'down' || opp.state === 'launch' || opp.state === 'getup';

  ai.planT--;
  if (ai.planT <= 0) newPlan(ai);

  switch (ai.plan) {
    case 'approach': {
      if (oppDown) {
        // Keep spacing while the opponent is on the floor.
        if (dist < 150) hold |= away;
        break;
      }
      const openNow = opening || opp.state === 'guardbreak';
      if (me.meter >= METER_MAX && dist < 300 && (openNow ? rnd(ai.rng) < p.special : rnd(ai.rng) < p.special * 0.02)) {
        taps |= IN.SPECIAL;
        rest(ai);
        break;
      }
      if (dist <= lightRange) {
        const guarding = opp.state === 'block' || opp.state === 'blockstun';
        const heavy = openNow ? rnd(ai.rng) < 0.6 : rnd(ai.rng) < (guarding ? 0.55 : p.heavyBias);
        taps |= heavy ? IN.HEAVY : IN.LIGHT;
        // The follow-up is decided on contact; give up the turn if it whiffs.
        ai.planT = 18;
        if (rnd(ai.rng) > p.aggression) ai.plan = 'hold';
        break;
      }
      if (dist <= heavyRange && rnd(ai.rng) < 0.08) {
        taps |= IN.HEAVY;
        ai.planT = 24;
        break;
      }
      if (dist > 190 && dist < 330 && ai.airT === 0 && rnd(ai.rng) < p.jump * 0.25) {
        taps |= IN.JUMP;
        hold |= toward;
        ai.airT = rndInt(ai.rng, 15, 22);
        break;
      }
      if (dist > 330 && me.dodgeCd === 0 && rnd(ai.rng) < p.aggression * 0.012) {
        taps |= IN.DODGE;
        hold |= toward;
        break;
      }
      hold |= toward;
      break;
    }
    case 'retreat':
      if (dist < 260) hold |= away;
      break;
    case 'hold':
      if (ai.guarding && !oppDown && dist < strikeRange(opp, me, 'H') + 50) hold |= IN.BLOCK;
      // Drift to a comfortable range rather than standing at point blank.
      else if (dist < lightRange * 0.7) hold |= away;
      break;
  }

  return finish(ai, hold, taps);
}

function finish(ai: AiState, hold: InputMask, taps: InputMask): InputMask {
  // A button must be released for one tick before it can be pressed again.
  const fresh = taps & TAP_BUTTONS & ~ai.lastOut;
  ai.pending = taps & TAP_BUTTONS & ai.lastOut;
  const out = hold | fresh;
  ai.lastOut = out;
  return out;
}
