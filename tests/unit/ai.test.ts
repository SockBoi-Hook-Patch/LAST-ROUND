import { describe, expect, it } from 'vitest';
import { aiInput, aiParamsForLevel, createAi } from '../../src/sim/ai';
import { CHARS, MAX_SEP, METER_MAX, PLAYABLE, STAGE_W, WALL } from '../../src/sim/data';
import { createMatch, stepMatch } from '../../src/sim/match';
import type { CharId, MatchState } from '../../src/sim/types';

function cpuFight(a: CharId, b: CharId, la: number, lb: number, seed: number, check?: (m: MatchState) => void): MatchState {
  const m = createMatch({ char: a }, { char: b, skin: 1 });
  const A = createAi(aiParamsForLevel(la), seed * 7919 + 11);
  const B = createAi(aiParamsForLevel(lb), seed * 104729 + 3);
  let guard = 0;
  while (m.phase !== 'over') {
    stepMatch(m, aiInput(A, m, 0), aiInput(B, m, 1));
    check?.(m);
    if (++guard > 6000) throw new Error('match did not finish');
  }
  return m;
}

describe('cpu opponent', () => {
  it('levels are ordered: every skill grows and reactions get faster', () => {
    for (let lv = 1; lv < 10; lv++) {
      const a = aiParamsForLevel(lv);
      const b = aiParamsForLevel(lv + 1);
      expect(b.reaction).toBeLessThanOrEqual(a.reaction);
      expect(b.block).toBeGreaterThan(a.block);
      expect(b.combo).toBeGreaterThan(a.combo);
      expect(b.punish).toBeGreaterThan(a.punish);
    }
    expect(aiParamsForLevel(-3).level).toBe(1);
    expect(aiParamsForLevel(99).level).toBe(10);
  });

  it('is deterministic for a given seed', () => {
    const a = cpuFight('switch', 'anvil', 6, 6, 5);
    const b = cpuFight('switch', 'anvil', 6, 6, 5);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('stays idle outside of the fight phase', () => {
    const m = createMatch({ char: 'switch' }, { char: 'switch' });
    const ai = createAi(aiParamsForLevel(10), 1);
    expect(m.phase).toBe('intro');
    for (let n = 0; n < 30; n++) {
      expect(aiInput(ai, m, 1)).toBe(0);
      stepMatch(m, 0, 0);
    }
  });

  it('actually fights: an idle opponent gets knocked out', () => {
    const m = createMatch({ char: 'switch' }, { char: 'kestrel' });
    const ai = createAi(aiParamsForLevel(5), 99);
    let guard = 0;
    while (m.phase !== 'over' && guard++ < 6000) stepMatch(m, 0, aiInput(ai, m, 1));
    expect(m.winner).toBe(1);
    expect(m.fighters[0].hp).toBe(0);
  });

  it('keeps every invariant across many full matches (fuzz)', () => {
    let finished = 0;
    for (let s = 0; s < 48; s++) {
      const a = PLAYABLE[s % 4] as CharId;
      const b = (s % 5 === 0 ? 'conductor' : PLAYABLE[(s * 3 + 1) % 4]) as CharId;
      const m = cpuFight(a, b, 1 + (s % 10), 1 + ((s * 7) % 10), s + 1, (st) => {
        for (const f of st.fighters) {
          expect(Number.isFinite(f.x) && Number.isFinite(f.y) && Number.isFinite(f.vx) && Number.isFinite(f.vy)).toBe(true);
          expect(f.x).toBeGreaterThanOrEqual(WALL - 1e-6);
          expect(f.x).toBeLessThanOrEqual(STAGE_W - WALL + 1e-6);
          expect(f.y).toBeGreaterThanOrEqual(0);
          expect(f.y).toBeLessThan(260);
          expect(f.hp).toBeGreaterThanOrEqual(0);
          expect(f.hp).toBeLessThanOrEqual(f.maxHp);
          expect(f.guard).toBeGreaterThanOrEqual(0);
          expect(f.guard).toBeLessThanOrEqual(f.maxGuard);
          expect(f.meter).toBeGreaterThanOrEqual(0);
          expect(f.meter).toBeLessThanOrEqual(METER_MAX);
          expect(f.stun).toBeGreaterThanOrEqual(0);
          if (f.state === 'attack') expect(f.move).not.toBeNull();
        }
        expect(Math.abs(st.fighters[0].x - st.fighters[1].x)).toBeLessThanOrEqual(MAX_SEP + 1e-6);
        expect(st.timer).toBeGreaterThanOrEqual(0);
      });
      expect(m.phase).toBe('over');
      expect([0, 1, 2]).toContain(m.winner);
      finished++;
    }
    expect(finished).toBe(48);
  });

  it('a high level reliably beats a low level', () => {
    let strongWins = 0;
    const games = 30;
    for (let s = 0; s < games; s++) {
      const c = PLAYABLE[s % 4] as CharId;
      // Alternate sides so position cannot explain the result.
      const strongFirst = s % 2 === 0;
      const m = strongFirst ? cpuFight(c, c, 9, 2, s + 100) : cpuFight(c, c, 2, 9, s + 100);
      if (m.winner === (strongFirst ? 0 : 1)) strongWins++;
    }
    expect(strongWins).toBeGreaterThanOrEqual(games * 0.85);
  });

  it('no playable fighter dominates or is hopeless in even cpu matches', () => {
    const wins = new Map<CharId, number>();
    const games = new Map<CharId, number>();
    for (const a of PLAYABLE) {
      for (const b of PLAYABLE) {
        if (a === b) continue;
        for (let s = 0; s < 14; s++) {
          const m = cpuFight(a, b, 6, 6, s * 31 + 7);
          games.set(a, (games.get(a) ?? 0) + 1);
          games.set(b, (games.get(b) ?? 0) + 1);
          if (m.winner === 0) wins.set(a, (wins.get(a) ?? 0) + 1);
          if (m.winner === 1) wins.set(b, (wins.get(b) ?? 0) + 1);
        }
      }
    }
    for (const c of PLAYABLE) {
      const rate = (wins.get(c) ?? 0) / (games.get(c) ?? 1);
      expect(rate, `${CHARS[c].ringName} win rate`).toBeGreaterThan(0.3);
      expect(rate, `${CHARS[c].ringName} win rate`).toBeLessThan(0.7);
    }
  });
});
