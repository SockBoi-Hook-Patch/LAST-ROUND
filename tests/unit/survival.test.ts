import { describe, expect, it } from 'vitest';
import {
  BASE_RECOVERY,
  TOTAL_ROUNDS,
  UPGRADES,
  UPGRADE_IDS,
  applyUpgrade,
  createRun,
  currentOpponent,
  finishRound,
  hitScore,
  opponentAi,
  opponentInit,
  playerInit,
  rollUpgrades,
} from '../../src/game/survival';
import type { UpgradeId } from '../../src/game/survival';
import { aiInput, aiParamsForLevel, createAi } from '../../src/sim/ai';
import { CHARS, PLAYABLE } from '../../src/sim/data';
import { createFighter, createMatch, stepMatch } from '../../src/sim/match';
import type { MatchState } from '../../src/sim/types';

/** A finished match with the given winner and the player on `hp`. */
function finished(run: ReturnType<typeof createRun>, winner: 0 | 1 | 2, hp: number, timerTicks = 1200): MatchState {
  const m = createMatch(playerInit(run), opponentInit(currentOpponent(run)), { skipIntro: true });
  m.phase = 'over';
  m.winner = winner;
  m.timer = timerTicks;
  m.fighters[0].hp = hp;
  return m;
}

describe('survival ladder', () => {
  it('has eight rounds of rising difficulty ending with the boss', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const run = createRun('switch', seed);
      expect(run.ladder.length).toBe(TOTAL_ROUNDS);
      for (let i = 1; i < run.ladder.length; i++) {
        expect(run.ladder[i]!.level).toBeGreaterThan(run.ladder[i - 1]!.level);
        expect(run.ladder[i]!.powerMul).toBeGreaterThanOrEqual(run.ladder[i - 1]!.powerMul);
      }
      const last = run.ladder[TOTAL_ROUNDS - 1]!;
      expect(last.boss).toBe(true);
      expect(last.char).toBe('conductor');
      expect(run.ladder.slice(0, -1).every((o) => !o.boss && o.char !== 'conductor')).toBe(true);
    }
  });

  it('never repeats a fighting style back to back, never reuses a ring name, never uses default colours', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { ladder } = createRun('kestrel', seed);
      const names = new Set(ladder.map((o) => o.name));
      expect(names.size).toBe(ladder.length);
      for (let i = 1; i < ladder.length; i++) expect(ladder[i]!.char).not.toBe(ladder[i - 1]!.char);
      for (const o of ladder.slice(0, -1)) expect(o.skin).toBeGreaterThan(0);
    }
  });

  it('is reproducible from the seed and varies between seeds', () => {
    expect(createRun('anvil', 7).ladder).toEqual(createRun('anvil', 7).ladder);
    const orders = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) orders.add(createRun('anvil', seed).ladder.map((o) => o.char).join());
    expect(orders.size).toBeGreaterThan(3);
  });

  it('builds fighters that reflect the run and the opponent scaling', () => {
    const run = createRun('pylon', 4);
    run.hp = 500;
    run.meter = 40;
    const p = createFighter(playerInit(run), 0, 1);
    expect(p.hp).toBe(500);
    expect(p.maxHp).toBe(CHARS.pylon.maxHp);
    expect(p.meter).toBe(40);
    const opp = currentOpponent(run);
    const o = createFighter(opponentInit(opp), 0, -1);
    expect(o.maxHp).toBe(Math.round(CHARS[opp.char].maxHp * opp.hpMul));
    expect(o.mods.power).toBe(opp.powerMul);
    expect(opponentAi(opp)).toEqual(aiParamsForLevel(opp.level));
  });
});

describe('upgrades', () => {
  it('offers three distinct, available upgrades', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const run = createRun('switch', seed);
      for (let round = 2; round <= TOTAL_ROUNDS; round++) {
        run.round = round;
        const picks = rollUpgrades(run);
        expect(picks.length).toBe(3);
        expect(new Set(picks).size).toBe(3);
        for (const id of picks) expect(run.upgrades[id]).toBeLessThan(UPGRADES[id].max);
        expect(rollUpgrades(run)).toEqual(picks);
      }
    }
  });

  it('always offers a heal to a worn-down fighter and stops offering maxed upgrades', () => {
    const run = createRun('switch', 3);
    run.round = 2;
    run.hp = run.maxHp * 0.4;
    expect(rollUpgrades(run)[0]).toBe('secondWind');
    for (const id of UPGRADE_IDS) if (id !== 'secondWind' && id !== 'closer') run.upgrades[id] = UPGRADES[id].max;
    const picks = rollUpgrades(run);
    expect(picks).toContain('closer');
    expect(picks.filter((p) => p !== 'secondWind' && p !== 'closer').length).toBe(0);
  });

  it('applies each effect', () => {
    const base = createRun('switch', 1);
    const apply = (id: UpgradeId, prep?: (r: typeof base) => void) => {
      const r = createRun('switch', 1);
      prep?.(r);
      applyUpgrade(r, id);
      return r;
    };
    const healed = apply('secondWind', (r) => (r.hp = 100));
    expect(healed.hp).toBe(100 + Math.round(base.maxHp * 0.4));
    expect(apply('secondWind').hp).toBe(base.maxHp);
    const core = apply('ironCore', (r) => (r.hp = 500));
    expect(core.maxHp).toBeGreaterThan(base.maxHp);
    expect(core.hp).toBe(500 + (core.maxHp - base.maxHp));
    expect(createFighter(playerInit(core), 0, 1).maxHp).toBe(core.maxHp);
    expect(apply('heavyHands').mods.power).toBeGreaterThan(1);
    const feet = apply('quickFeet');
    expect(feet.mods.speed).toBeGreaterThan(1);
    expect(feet.mods.dodgeCooldown).toBeLessThan(1);
    const guard = apply('tightGuard');
    expect(guard.maxGuardMul).toBeGreaterThan(1);
    expect(guard.mods.chip).toBeLessThan(1);
    expect(createFighter(playerInit(guard), 0, 1).maxGuard).toBeGreaterThan(CHARS.switch.maxGuard);
    expect(apply('battery').mods.meterGain).toBeGreaterThan(1);
    expect(apply('deepBreath').recovery).toBeGreaterThan(BASE_RECOVERY);
    expect(apply('closer').mods.finisher).toBeGreaterThan(1);
  });

  it('respects the level cap', () => {
    const run = createRun('switch', 1);
    for (let i = 0; i < 10; i++) applyUpgrade(run, 'heavyHands');
    expect(run.upgrades.heavyHands).toBe(UPGRADES.heavyHands.max);
    expect(run.mods.power).toBeCloseTo(1 + 0.1 * UPGRADES.heavyHands.max, 6);
  });
});

describe('scoring and progression', () => {
  it('rewards combos more than single hits', () => {
    expect(hitScore(50, 1)).toBe(100);
    expect(hitScore(50, 3)).toBeGreaterThan(hitScore(50, 1));
  });

  it('a won round scores, advances and restores some health', () => {
    const run = createRun('switch', 1);
    const out = finishRound(run, finished(run, 0, 400, 30 * 60), 600);
    expect(out.cleared).toBe(true);
    expect(out.clear).toBe(1000);
    expect(out.time).toBe(600);
    expect(out.health).toBe(400);
    expect(out.perfect).toBe(0);
    expect(out.total).toBe(2000);
    expect(run.score).toBe(2000);
    expect(run.round).toBe(2);
    expect(run.hp).toBe(400 + Math.round(run.maxHp * BASE_RECOVERY));
    expect(run.outcome).toBe('active');
  });

  it('awards a perfect bonus when no damage was taken', () => {
    const run = createRun('switch', 1);
    const out = finishRound(run, finished(run, 0, run.maxHp), 0);
    expect(out.perfect).toBe(2500);
    expect(run.stats.perfects).toBe(1);
  });

  it('a loss or a draw ends the run', () => {
    for (const winner of [1, 2] as const) {
      const run = createRun('switch', 1);
      const out = finishRound(run, finished(run, winner, 0), 900);
      expect(out.cleared).toBe(false);
      expect(out.total).toBe(0);
      expect(run.outcome).toBe('lost');
      expect(run.round).toBe(1);
    }
  });

  it('clearing the last round wins the circuit', () => {
    const run = createRun('switch', 1);
    run.round = TOTAL_ROUNDS;
    const out = finishRound(run, finished(run, 0, 300), 100);
    expect(out.circuit).toBe(5000);
    expect(run.outcome).toBe('won');
    expect(run.round).toBe(TOTAL_ROUNDS);
  });

  it('a cpu-driven fighter can play a whole run end to end without breaking state', () => {
    // Plays the real loop: fight, fold the result in, take an upgrade, repeat.
    let cleared = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const run = createRun(PLAYABLE[seed % 4]!, seed);
      while (run.outcome === 'active') {
        const opp = currentOpponent(run);
        const m = createMatch(playerInit(run), opponentInit(opp));
        const me = createAi(aiParamsForLevel(8), seed * 17 + run.round);
        const cpu = createAi(opponentAi(opp), seed * 29 + run.round);
        const hpStart = run.hp;
        let guard = 0;
        while (m.phase !== 'over' && guard++ < 8000) stepMatch(m, aiInput(me, m, 0), aiInput(cpu, m, 1));
        expect(m.phase).toBe('over');
        const before = run.round;
        finishRound(run, m, Math.max(0, hpStart - m.fighters[0].hp));
        expect(run.hp).toBeGreaterThanOrEqual(0);
        expect(run.hp).toBeLessThanOrEqual(run.maxHp);
        if (run.outcome === 'active') {
          expect(run.round).toBe(before + 1);
          const picks = rollUpgrades(run);
          applyUpgrade(run, picks[0]!);
          cleared++;
        }
      }
      expect(['won', 'lost']).toContain(run.outcome);
    }
    expect(cleared).toBeGreaterThan(0);
  });
});
