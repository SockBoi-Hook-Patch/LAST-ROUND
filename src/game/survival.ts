/**
 * Survival run rules: the ladder of opponents, between-round upgrades and
 * scoring. Pure data in / data out so it can be unit tested without a browser.
 */
import { aiParamsForLevel } from '../sim/ai';
import type { AiParams } from '../sim/ai';
import { CHARS, METER_MAX, PLAYABLE, ROUND_SECONDS, TICK_RATE, defaultMods } from '../sim/data';
import type { FighterInit } from '../sim/match';
import { makeRng, rnd, shuffle } from '../sim/rng';
import type { CharId, FighterMods, MatchState } from '../sim/types';

export const TOTAL_ROUNDS = 8;
/** Share of max health restored between rounds before upgrades. */
export const BASE_RECOVERY = 0.22;

export type UpgradeId =
  | 'secondWind'
  | 'ironCore'
  | 'heavyHands'
  | 'quickFeet'
  | 'tightGuard'
  | 'battery'
  | 'deepBreath'
  | 'closer';

export interface UpgradeDef {
  id: UpgradeId;
  /** Icon name in `src/assets/icons`. */
  icon: string;
  /** Maximum number of times it can be taken. */
  max: number;
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  secondWind: { id: 'secondWind', icon: 'up-second-wind', max: 99 },
  ironCore: { id: 'ironCore', icon: 'up-iron-core', max: 3 },
  heavyHands: { id: 'heavyHands', icon: 'up-heavy-hands', max: 3 },
  quickFeet: { id: 'quickFeet', icon: 'up-quick-feet', max: 3 },
  tightGuard: { id: 'tightGuard', icon: 'up-tight-guard', max: 3 },
  battery: { id: 'battery', icon: 'up-battery', max: 3 },
  deepBreath: { id: 'deepBreath', icon: 'up-deep-breath', max: 3 },
  closer: { id: 'closer', icon: 'up-closer', max: 3 },
};

export const UPGRADE_IDS = Object.keys(UPGRADES) as UpgradeId[];

export const SECOND_WIND_HEAL = 0.4;
export const IRON_CORE_HP = 0.12;
export const HEAVY_HANDS_POWER = 0.1;
export const QUICK_FEET_SPEED = 0.07;
export const QUICK_FEET_DODGE = 0.15;
export const TIGHT_GUARD_GAUGE = 0.25;
export const TIGHT_GUARD_CHIP = 0.35;
export const BATTERY_GAIN = 0.3;
export const DEEP_BREATH_RECOVERY = 0.08;
export const CLOSER_DAMAGE = 0.2;

export interface Opponent {
  char: CharId;
  skin: number;
  /** Ring name of this challenger. */
  name: string;
  round: number;
  level: number;
  hpMul: number;
  powerMul: number;
  boss: boolean;
}

export interface RunStats {
  damageDealt: number;
  damageTaken: number;
  maxCombo: number;
  perfects: number;
  parries: number;
  /** Fight ticks spent over the whole run. */
  ticks: number;
}

export interface RunState {
  char: CharId;
  seed: number;
  /** Round currently being fought, 1-based. */
  round: number;
  score: number;
  hp: number;
  maxHp: number;
  maxHpMul: number;
  maxGuardMul: number;
  meter: number;
  recovery: number;
  mods: FighterMods;
  upgrades: Record<UpgradeId, number>;
  ladder: Opponent[];
  stats: RunStats;
  /** 'active' until the run ends. */
  outcome: 'active' | 'won' | 'lost';
}

/** Per-round difficulty: [AI level, health multiplier, damage multiplier]. */
const CURVE: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0.68, 0.7],
  [2, 0.78, 0.76],
  [3.2, 0.88, 0.82],
  [4.6, 1.0, 0.9],
  [5.5, 1.0, 0.94],
  [6.6, 1.06, 1.0],
  [7.8, 1.12, 1.05],
  [9, 1.0, 1.08],
];

/** Original ring names for the challengers of the Undercroft circuit. */
const RING_NAMES: Record<Exclude<CharId, 'conductor'>, readonly string[]> = {
  kestrel: ['MAGPIE', 'SLIPSTREAM', 'HALFLIGHT'],
  anvil: ['RIVET', 'GRAVEL', 'LOCKJAW'],
  switch: ['SIGNAL', 'CINDER', 'TURNSTILE'],
  pylon: ['TALLBOY', 'OVERPASS', 'LONGWIRE'],
};

function buildLadder(seed: number): Opponent[] {
  const rng = makeRng(seed ^ 0x51ed270b);
  // Two passes over the roster so no style repeats back to back.
  const order: CharId[] = [];
  while (order.length < TOTAL_ROUNDS - 1) {
    const pass = shuffle(rng, [...PLAYABLE]);
    if (order.length > 0 && pass[0] === order[order.length - 1]) pass.push(pass.shift() as CharId);
    order.push(...pass);
  }
  const used = new Set<string>();
  const ladder: Opponent[] = [];
  for (let r = 1; r <= TOTAL_ROUNDS; r++) {
    const [level, hpMul, powerMul] = CURVE[r - 1] as readonly [number, number, number];
    if (r === TOTAL_ROUNDS) {
      ladder.push({ char: 'conductor', skin: 0, name: CHARS.conductor.ringName, round: r, level, hpMul, powerMul, boss: true });
      continue;
    }
    const char = order[r - 1] as Exclude<CharId, 'conductor'>;
    const names = RING_NAMES[char].filter((n) => !used.has(n));
    const name = (names.length ? names : RING_NAMES[char])[Math.floor(rnd(rng) * (names.length || RING_NAMES[char].length))] as string;
    used.add(name);
    // Opponents never wear the default colours, so mirror matches stay readable.
    const skin = 1 + Math.floor(rnd(rng) * 2);
    ladder.push({ char, skin, name, round: r, level, hpMul, powerMul, boss: false });
  }
  return ladder;
}

export function createRun(char: CharId, seed: number): RunState {
  const maxHp = CHARS[char].maxHp;
  const upgrades = {} as Record<UpgradeId, number>;
  for (const id of UPGRADE_IDS) upgrades[id] = 0;
  return {
    char,
    seed: seed >>> 0,
    round: 1,
    score: 0,
    hp: maxHp,
    maxHp,
    maxHpMul: 1,
    maxGuardMul: 1,
    meter: 0,
    recovery: BASE_RECOVERY,
    mods: defaultMods(),
    upgrades,
    ladder: buildLadder(seed >>> 0),
    stats: { damageDealt: 0, damageTaken: 0, maxCombo: 0, perfects: 0, parries: 0, ticks: 0 },
    outcome: 'active',
  };
}

export function currentOpponent(run: Readonly<RunState>): Opponent {
  return run.ladder[Math.min(run.round, TOTAL_ROUNDS) - 1] as Opponent;
}

export function playerInit(run: Readonly<RunState>): FighterInit {
  return {
    char: run.char,
    skin: 0,
    mods: { ...run.mods },
    maxHpMul: run.maxHpMul,
    maxGuardMul: run.maxGuardMul,
    hp: run.hp,
    meter: run.meter,
  };
}

export function opponentInit(opp: Readonly<Opponent>): FighterInit {
  return {
    char: opp.char,
    skin: opp.skin,
    maxHpMul: opp.hpMul,
    mods: { power: opp.powerMul },
  };
}

export function opponentAi(opp: Readonly<Opponent>): AiParams {
  return aiParamsForLevel(opp.level);
}

/** Three distinct upgrades to choose from after clearing `run.round`. */
export function rollUpgrades(run: Readonly<RunState>): UpgradeId[] {
  const rng = makeRng((run.seed ^ Math.imul(run.round, 0x9e3779b1)) >>> 0);
  const pool = UPGRADE_IDS.filter((id) => run.upgrades[id] < UPGRADES[id].max && id !== 'secondWind');
  shuffle(rng, pool);
  const hurt = run.hp / run.maxHp < 0.75;
  const picks: UpgradeId[] = [];
  // A heal is always on offer once the fighter is worn down.
  if (hurt) picks.push('secondWind');
  for (const id of pool) {
    if (picks.length >= 3) break;
    picks.push(id);
  }
  while (picks.length < 3) picks.push('secondWind');
  return hurt ? picks : shuffle(rng, picks);
}

export function applyUpgrade(run: RunState, id: UpgradeId): void {
  if (run.upgrades[id] >= UPGRADES[id].max) return;
  run.upgrades[id]++;
  switch (id) {
    case 'secondWind':
      run.hp = Math.min(run.maxHp, run.hp + Math.round(run.maxHp * SECOND_WIND_HEAL));
      break;
    case 'ironCore': {
      const before = run.maxHp;
      run.maxHpMul += IRON_CORE_HP;
      run.maxHp = Math.round(CHARS[run.char].maxHp * run.maxHpMul);
      run.hp = Math.min(run.maxHp, run.hp + (run.maxHp - before));
      break;
    }
    case 'heavyHands':
      run.mods.power += HEAVY_HANDS_POWER;
      break;
    case 'quickFeet':
      run.mods.speed += QUICK_FEET_SPEED;
      run.mods.dodgeCooldown = Math.max(0.4, run.mods.dodgeCooldown - QUICK_FEET_DODGE);
      break;
    case 'tightGuard':
      run.maxGuardMul += TIGHT_GUARD_GAUGE;
      run.mods.chip = Math.max(0.1, run.mods.chip * (1 - TIGHT_GUARD_CHIP));
      break;
    case 'battery':
      run.mods.meterGain += BATTERY_GAIN;
      break;
    case 'deepBreath':
      run.recovery += DEEP_BREATH_RECOVERY;
      break;
    case 'closer':
      run.mods.finisher += CLOSER_DAMAGE;
      break;
  }
}

export interface RoundBreakdown {
  cleared: boolean;
  /** Points for clearing the round. */
  clear: number;
  time: number;
  health: number;
  perfect: number;
  /** Bonus for finishing the whole circuit. */
  circuit: number;
  total: number;
}

/** Points awarded for a single clean hit. */
export function hitScore(damage: number, combo: number): number {
  return Math.round(damage * 2 * (1 + 0.15 * Math.max(0, combo - 1)));
}

export const PARRY_SCORE = 150;

/**
 * Fold a finished round into the run. Fighter 0 is the player. Returns the
 * score breakdown; advances to the next round when the player won.
 */
export function finishRound(run: RunState, m: Readonly<MatchState>, damageTakenThisRound: number): RoundBreakdown {
  const player = m.fighters[0];
  const won = m.winner === 0;
  const out: RoundBreakdown = { cleared: won, clear: 0, time: 0, health: 0, perfect: 0, circuit: 0, total: 0 };
  run.stats.ticks += Math.max(0, ROUND_SECONDS * TICK_RATE - m.timer);
  run.meter = Math.min(METER_MAX, player.meter);
  if (!won) {
    run.hp = 0;
    run.outcome = 'lost';
    return out;
  }
  run.hp = Math.max(1, Math.round(player.hp));
  out.clear = 1000 * run.round;
  out.time = Math.round((m.timer / TICK_RATE) * 20);
  out.health = Math.round((run.hp / run.maxHp) * 1000);
  if (damageTakenThisRound <= 0) {
    out.perfect = 2500;
    run.stats.perfects++;
  }
  if (run.round >= TOTAL_ROUNDS) {
    out.circuit = 5000;
    run.outcome = 'won';
  }
  out.total = out.clear + out.time + out.health + out.perfect + out.circuit;
  run.score += out.total;
  if (run.outcome === 'active') {
    run.round++;
    run.hp = Math.min(run.maxHp, run.hp + Math.round(run.maxHp * run.recovery));
  }
  return out;
}
