import { describe, expect, it } from 'vitest';
import { hitbox, hurtbox, overlaps } from '../../src/sim/boxes';
import {
  CHARS,
  DODGE_TICKS,
  INTRO_TICKS,
  KO_TICKS,
  MAX_SEP,
  METER_MAX,
  MOVES,
  PLAYABLE,
  STAGE_W,
  WALL,
  moveFrames,
} from '../../src/sim/data';
import { createMatch, stepMatch } from '../../src/sim/match';
import type { FighterInit } from '../../src/sim/match';
import { IN } from '../../src/sim/types';
import type { MatchState, SimEvent } from '../../src/sim/types';

const SW: FighterInit = { char: 'switch' };

/** A fight already under way with the two fighters `gap` units apart. */
function duel(gap = 100, a: FighterInit = SW, b: FighterInit = SW, training = false): MatchState {
  const m = createMatch(a, b, { skipIntro: true, training });
  m.fighters[0].x = STAGE_W / 2 - gap / 2;
  m.fighters[1].x = STAGE_W / 2 + gap / 2;
  return m;
}

/** Step with a per-tick input function, collecting every event. */
function run(m: MatchState, ticks: number, in0: (n: number) => number = () => 0, in1: (n: number) => number = () => 0): SimEvent[] {
  const events: SimEvent[] = [];
  for (let n = 0; n < ticks; n++) {
    stepMatch(m, in0(n), in1(n));
    events.push(...m.events);
  }
  return events;
}

/** Tap `button` on tick 0 only. */
const tap = (button: number) => (n: number) => (n === 0 ? button : 0);

function hits(events: SimEvent[]): Extract<SimEvent, { type: 'hit' }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: 'hit' }> => e.type === 'hit');
}

describe('match flow', () => {
  it('holds fighters during the intro, then starts the fight', () => {
    const m = createMatch(SW, SW);
    expect(m.phase).toBe('intro');
    const x0 = m.fighters[0].x;
    const ev = run(m, INTRO_TICKS, () => IN.RIGHT | IN.LIGHT);
    expect(m.phase).toBe('fight');
    expect(m.fighters[0].x).toBe(x0);
    expect(ev.some((e) => e.type === 'phase' && e.phase === 'fight')).toBe(true);
    // A button held through the intro must not fire on the first fight tick.
    stepMatch(m, IN.RIGHT | IN.LIGHT, 0);
    expect(m.fighters[0].state).not.toBe('attack');
  });

  it('is deterministic for identical inputs', () => {
    const script = (n: number) => {
      const k = (n * 2654435761) >>> 0;
      return (k >>> 7) & 0xff;
    };
    const a = createMatch({ char: 'kestrel' }, { char: 'anvil' });
    const b = createMatch({ char: 'kestrel' }, { char: 'anvil' });
    run(a, 900, script, (n) => script(n + 17));
    run(b, 900, script, (n) => script(n + 17));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('survives a JSON round trip mid-fight (network snapshots)', () => {
    const script = (n: number) => ((n * 40503) >>> 3) & 0xff;
    const a = createMatch({ char: 'pylon' }, { char: 'switch' }, { skipIntro: true });
    run(a, 240, script, (n) => script(n + 5));
    const b = JSON.parse(JSON.stringify(a)) as MatchState;
    run(a, 240, script, (n) => script(n + 9));
    run(b, 240, script, (n) => script(n + 9));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('ends the round on time and awards the healthier fighter', () => {
    const m = createMatch(SW, SW, { skipIntro: true, seconds: 2 });
    m.fighters[1].hp -= 100;
    const ev = run(m, 2 * 60);
    expect(m.phase).toBe('timeup');
    expect(m.winner).toBe(0);
    expect(ev.some((e) => e.type === 'phase' && e.phase === 'timeup')).toBe(true);
    run(m, 400);
    expect(m.phase).toBe('over');
    expect(m.fighters[0].state).toBe('win');
    expect(m.fighters[1].state).toBe('lose');
  });

  it('calls a draw when health ratios are equal at time up', () => {
    const m = createMatch(SW, SW, { skipIntro: true, seconds: 1 });
    run(m, 60);
    expect(m.winner).toBe(2);
  });
});

describe('movement', () => {
  it('walks, and walking backwards is slower', () => {
    const m = duel(400);
    const [a] = m.fighters;
    const x0 = a.x;
    run(m, 30, () => IN.RIGHT);
    const fwd = a.x - x0;
    expect(a.state).toBe('walkF');
    expect(fwd).toBeCloseTo(CHARS.switch.walk * 30, 5);
    const x1 = a.x;
    run(m, 30, () => IN.LEFT);
    expect(a.state).toBe('walkB');
    expect(x1 - a.x).toBeLessThan(fwd);
  });

  it('keeps fighters inside the arena and within the maximum separation', () => {
    const m = duel(300);
    run(m, 600, () => IN.LEFT, () => IN.RIGHT);
    const [a, b] = m.fighters;
    expect(a.x).toBeGreaterThanOrEqual(WALL);
    expect(b.x).toBeLessThanOrEqual(STAGE_W - WALL);
    expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(MAX_SEP + 1e-6);
  });

  it('does not let fighters walk through each other', () => {
    const m = duel(200);
    run(m, 200, () => IN.RIGHT, () => IN.LEFT);
    const [a, b] = m.fighters;
    expect(a.x).toBeLessThan(b.x);
    expect(overlaps(hurtbox(a), hurtbox(b))).toBe(false);
  });

  it('jumps and lands back on the floor', () => {
    const m = duel(400);
    const [a] = m.fighters;
    const ev = run(m, 6, tap(IN.JUMP));
    expect(a.state).toBe('jump');
    expect(a.y).toBeGreaterThan(0);
    expect(ev.some((e) => e.type === 'jump')).toBe(true);
    let peak = 0;
    const more: SimEvent[] = [];
    for (let n = 0; n < 80; n++) {
      stepMatch(m, 0, 0);
      more.push(...m.events);
      peak = Math.max(peak, a.y);
    }
    expect(peak).toBeGreaterThan(100);
    expect(a.y).toBe(0);
    expect(a.state).toBe('idle');
    expect(more.some((e) => e.type === 'land')).toBe(true);
  });

  it('faces the opponent after jumping over them', () => {
    const m = duel(80);
    const [a, b] = m.fighters;
    run(m, 90, (n) => (n < 6 ? IN.JUMP | IN.RIGHT : 0));
    expect(a.x).toBeGreaterThan(b.x);
    expect(a.facing).toBe(-1);
    expect(b.facing).toBe(1);
  });
});

describe('attacks', () => {
  it('lands a jab on the tick its start-up ends, for the listed damage', () => {
    const m = duel(100);
    const fr = moveFrames('switch', 'L1');
    const ev: SimEvent[] = [];
    let hitTick = -1;
    for (let n = 0; n < 12 && hitTick < 0; n++) {
      stepMatch(m, n === 0 ? IN.LIGHT : 0, 0);
      ev.push(...m.events);
      if (m.events.some((e) => e.type === 'hit')) hitTick = n;
    }
    expect(hitTick).toBe(fr.startup);
    const h = hits(ev)[0]!;
    expect(h.damage).toBe(MOVES.L1.damage);
    expect(m.fighters[1].hp).toBe(CHARS.switch.maxHp - MOVES.L1.damage);
    expect(m.fighters[1].state).toBe('hit');
    expect(m.hitstop).toBe(MOVES.L1.hitstop);
  });

  it('holding the button does not repeat the attack', () => {
    const m = duel(400);
    const ev = run(m, 120, () => IN.LIGHT);
    expect(ev.filter((e) => e.type === 'swing').length).toBe(1);
  });

  it('whiffs out of range and cannot chain on a whiff', () => {
    const m = duel(400);
    const ev = run(m, 60, (n) => (n % 6 === 0 ? IN.LIGHT : 0));
    expect(hits(ev).length).toBe(0);
    const swings = ev.filter((e): e is Extract<SimEvent, { type: 'swing' }> => e.type === 'swing');
    expect(swings.every((s) => s.move === 'L1')).toBe(true);
  });

  it('chains light, light, light into a three hit combo with damage scaling', () => {
    const m = duel(100);
    const ev = run(m, 90, (n) => (n % 4 === 0 ? IN.LIGHT : 0));
    const h = hits(ev);
    expect(h.slice(0, 3).map((e) => e.move)).toEqual(['L1', 'L2', 'L3']);
    expect(h.slice(0, 3).map((e) => e.combo)).toEqual([1, 2, 3]);
    expect(h[1]!.damage).toBe(Math.round(MOVES.L2.damage * 0.9));
    expect(h[2]!.damage).toBe(Math.round(MOVES.L3.damage * 0.81));
  });

  it('light, light, heavy ends in a finisher that knocks the opponent down, then they get up', () => {
    const m = duel(100);
    const b = m.fighters[1];
    let step = 0;
    const ev: SimEvent[] = [];
    for (let n = 0; n < 60; n++) {
      // Press light twice, then heavy, one press every 8 ticks.
      const press = n % 8 === 0 ? (step++ < 2 ? IN.LIGHT : IN.HEAVY) : 0;
      stepMatch(m, press, 0);
      ev.push(...m.events);
    }
    const h = hits(ev);
    expect(h.map((e) => e.move)).toEqual(['L1', 'L2', 'FIN']);
    expect(h[2]!.launch).toBe(true);
    let sawDown = false;
    for (let n = 0; n < 200; n++) {
      stepMatch(m, 0, 0);
      if (b.state === 'down') sawDown = true;
    }
    expect(sawDown).toBe(true);
    expect(b.state).toBe('idle');
    expect(b.y).toBe(0);
  });

  it('a heavy strike hurts more than a jab and is slower', () => {
    expect(moveFrames('switch', 'H').startup).toBeGreaterThan(moveFrames('switch', 'L1').startup);
    const m = duel(110);
    const ev = run(m, 40, tap(IN.HEAVY));
    expect(hits(ev)[0]!.damage).toBe(MOVES.H.damage);
    expect(m.fighters[1].state).toBe('hitHeavy');
  });

  it('a jump kick hits a standing opponent', () => {
    const m = duel(190);
    const ev = run(m, 80, (n) => (n === 0 ? IN.JUMP | IN.RIGHT : n < 6 ? IN.RIGHT : n === 22 ? IN.HEAVY : 0));
    const h = hits(ev);
    expect(h.length).toBe(1);
    expect(h[0]!.move).toBe('AIR');
  });

  it('counter hits a fighter caught in start-up for bonus damage', () => {
    const m = duel(100);
    // Fighter 1 starts a slow heavy; fighter 0 jabs first.
    const ev = run(m, 12, tap(IN.LIGHT), tap(IN.HEAVY));
    const h = hits(ev)[0]!;
    expect(h.attacker).toBe(0);
    expect(h.counter).toBe(true);
    expect(h.damage).toBe(Math.round(MOVES.L1.damage * 1.2));
  });

  it('simultaneous strikes trade: both fighters are hit', () => {
    const m = duel(100);
    const ev = run(m, 12, tap(IN.LIGHT), tap(IN.LIGHT));
    const h = hits(ev);
    expect(h.length).toBe(2);
    expect(new Set(h.map((e) => e.attacker)).size).toBe(2);
    expect(m.fighters[0].hp).toBe(m.fighters[1].hp);
  });

  it('hitboxes only exist during active frames', () => {
    const m = duel(400);
    const a = m.fighters[0];
    const fr = moveFrames('switch', 'H');
    let activeTicks = 0;
    for (let n = 0; n < fr.total + 2; n++) {
      stepMatch(m, n === 0 ? IN.HEAVY : 0, 0);
      if (hitbox(a)) activeTicks++;
    }
    expect(activeTicks).toBe(fr.active);
    expect(a.state).toBe('idle');
  });
});

describe('defence', () => {
  it('blocking takes chip damage, guard damage and block stun instead of a hit', () => {
    const m = duel(110);
    const b = m.fighters[1];
    // Guard is raised well before the heavy lands (no just-guard).
    const ev = run(m, 40, (n) => (n === 20 ? IN.HEAVY : 0), () => IN.BLOCK);
    expect(hits(ev).length).toBe(0);
    const blk = ev.find((e): e is Extract<SimEvent, { type: 'block' }> => e.type === 'block')!;
    expect(blk.parry).toBe(false);
    expect(b.hp).toBeCloseTo(CHARS.switch.maxHp - MOVES.H.damage * 0.1, 5);
    expect(b.guard).toBeLessThan(b.maxGuard);
    expect(b.state).toBe('blockstun');
  });

  it('a guard raised at the last moment is a just-guard: no damage, attacker left open', () => {
    const m = duel(110);
    const [a, b] = m.fighters;
    const fr = moveFrames('switch', 'H');
    const ev = run(m, fr.startup + 1, tap(IN.HEAVY), (n) => (n >= fr.startup - 3 ? IN.BLOCK : 0));
    const blk = ev.find((e): e is Extract<SimEvent, { type: 'block' }> => e.type === 'block')!;
    expect(blk.parry).toBe(true);
    expect(b.hp).toBe(b.maxHp);
    expect(b.guard).toBe(b.maxGuard);
    expect(b.state).toBe('parry');
    expect(a.moveExtra).toBeGreaterThan(0);
    expect(b.meter).toBeGreaterThan(0);
  });

  it('mashing block does not produce just-guards', () => {
    const m = duel(110);
    const fr = moveFrames('switch', 'H');
    // Block is tapped every other tick; the press before impact follows a recent one.
    const ev = run(m, fr.startup + 1, tap(IN.HEAVY), (n) => (n % 2 === 0 ? IN.BLOCK : 0));
    const blk = ev.find((e): e is Extract<SimEvent, { type: 'block' }> => e.type === 'block');
    expect(blk?.parry ?? false).toBe(false);
  });

  it('breaks a guard that absorbs too much, leaving the defender dazed', () => {
    const m = duel(110, SW, SW, true);
    const b = m.fighters[1];
    const ev = run(m, 400, (n) => (n % 40 === 0 ? IN.HEAVY : 0), () => IN.BLOCK);
    expect(ev.some((e) => e.type === 'guardbreak')).toBe(true);
    const m2 = duel(110, SW, SW, true);
    const b2 = m2.fighters[1];
    let dazed = false;
    for (let n = 0; n < 400 && !dazed; n++) {
      stepMatch(m2, n % 40 === 0 ? IN.HEAVY : 0, IN.BLOCK);
      dazed = b2.state === 'guardbreak';
    }
    expect(dazed).toBe(true);
    expect(b.guard).toBeGreaterThanOrEqual(0);
  });

  it('chip damage can never knock a fighter out', () => {
    const m = duel(110);
    const b = m.fighters[1];
    b.hp = 2;
    b.maxGuard = 100000;
    b.guard = 100000;
    run(m, 300, (n) => (n % 40 === 0 ? IN.HEAVY : 0), () => IN.BLOCK);
    expect(b.hp).toBeGreaterThanOrEqual(1);
    expect(m.phase).toBe('fight');
  });

  it('a dodge passes through an attack untouched and then goes on cooldown', () => {
    const m = duel(110);
    const [a, b] = m.fighters;
    const fr = moveFrames('switch', 'H');
    const ev = run(m, 40, tap(IN.HEAVY), (n) => (n === fr.startup - 4 ? IN.DODGE : 0));
    expect(hits(ev).length).toBe(0);
    expect(ev.some((e) => e.type === 'dodge')).toBe(true);
    expect(b.hp).toBe(b.maxHp);
    expect(b.dodgeCd).toBeGreaterThan(0);
    expect(a.hp).toBe(a.maxHp);
  });

  it('a forward dodge slips through to the other side', () => {
    const m = duel(120);
    const [a, b] = m.fighters;
    run(m, DODGE_TICKS + 30, (n) => (n === 0 ? IN.DODGE | IN.RIGHT : 0));
    expect(a.x).toBeGreaterThan(b.x);
    expect(a.facing).toBe(-1);
  });

  it('a downed fighter cannot be hit until they are back up', () => {
    const m = duel(100);
    const b = m.fighters[1];
    let step = 0;
    run(m, 60, (n) => (n % 8 === 0 ? (step++ < 2 ? IN.LIGHT : IN.HEAVY) : 0));
    expect(['launch', 'down']).toContain(b.state);
    const hpAfterCombo = b.hp;
    // Walk in and keep swinging while they are on the floor.
    for (let n = 0; n < 200 && b.state !== 'idle'; n++) {
      stepMatch(m, n % 10 === 0 ? IN.LIGHT : IN.RIGHT, 0);
      if (b.state === 'launch' || b.state === 'down' || b.state === 'getup') expect(b.hp).toBe(hpAfterCombo);
    }
  });
});

describe('overdrive meter', () => {
  it('cannot be used without a full meter', () => {
    const m = duel(200);
    const ev = run(m, 30, tap(IN.SPECIAL));
    expect(ev.some((e) => e.type === 'special')).toBe(false);
    expect(m.fighters[0].state).not.toBe('attack');
  });

  it('spends the whole meter on a dashing strike that knocks down', () => {
    const m = duel(260);
    const [a, b] = m.fighters;
    a.meter = METER_MAX;
    const ev = run(m, 60, tap(IN.SPECIAL));
    expect(ev.some((e) => e.type === 'special')).toBe(true);
    const h = hits(ev)[0]!;
    expect(h.move).toBe('SP');
    expect(h.strength).toBe('special');
    expect(h.launch).toBe(true);
    expect(h.damage).toBe(MOVES.SP.damage);
    expect(a.meter).toBeLessThan(METER_MAX);
    expect(b.hp).toBe(b.maxHp - MOVES.SP.damage);
  });

  it('light + heavy together triggers the overdrive when the meter is full', () => {
    const m = duel(260);
    m.fighters[0].meter = METER_MAX;
    const ev = run(m, 5, tap(IN.LIGHT | IN.HEAVY));
    expect(ev.some((e) => e.type === 'special')).toBe(true);
  });

  it('builds from dealing and taking damage and announces when full', () => {
    const m = duel(100, SW, SW, true);
    const a = m.fighters[0];
    const ev = run(m, 4000, (n) => (n % 5 === 0 ? IN.LIGHT : 0));
    expect(a.meter).toBe(METER_MAX);
    expect(ev.filter((e) => e.type === 'meterFull' && e.who === 0).length).toBe(1);
  });
});

describe('knockouts', () => {
  it('a knockout ends the fight with the survivor winning', () => {
    const m = duel(100);
    const b = m.fighters[1];
    b.hp = 10;
    const ev = run(m, 12, tap(IN.LIGHT));
    expect(ev.some((e) => e.type === 'ko' && e.who === 1)).toBe(true);
    expect(m.phase).toBe('ko');
    expect(m.winner).toBe(0);
    expect(b.hp).toBe(0);
    run(m, KO_TICKS + 5);
    expect(m.phase).toBe('over');
    expect(b.state).toBe('down');
    expect(m.fighters[0].state).toBe('win');
    // Nothing changes once the match is over.
    const frozen = JSON.stringify(m);
    stepMatch(m, IN.LIGHT, IN.LIGHT);
    expect(JSON.stringify(m)).toBe(frozen);
  });

  it('a double knockout is a draw', () => {
    const m = duel(100);
    m.fighters[0].hp = 5;
    m.fighters[1].hp = 5;
    run(m, 12, tap(IN.LIGHT), tap(IN.LIGHT));
    expect(m.winner).toBe(2);
    expect(m.phase).toBe('ko');
  });

  it('training mode never knocks anyone out and freezes the clock', () => {
    const m = duel(100, SW, SW, true);
    const timer = m.timer;
    m.fighters[1].hp = 5;
    run(m, 600, (n) => (n % 5 === 0 ? IN.LIGHT : 0));
    expect(m.fighters[1].hp).toBeGreaterThanOrEqual(1);
    expect(m.phase).toBe('fight');
    expect(m.timer).toBe(timer);
  });
});

describe('roster', () => {
  it('every playable fighter can land every ground move from its own reach', () => {
    for (const id of PLAYABLE) {
      const c = CHARS[id];
      for (const mv of ['L1', 'H'] as const) {
        const gap = MOVES[mv].box.x1 * c.reach;
        const m = duel(gap, { char: id }, { char: 'switch' });
        const ev = run(m, 40, tap(mv === 'L1' ? IN.LIGHT : IN.HEAVY));
        expect(hits(ev).length, `${id} ${mv}`).toBe(1);
      }
    }
  });

  it('pip totals are equal across the playable roster (balanced on paper)', () => {
    const totals = PLAYABLE.map((id) => {
      const p = CHARS[id].pips;
      return p.vitality + p.power + p.speed + p.reach;
    });
    expect(new Set(totals).size).toBe(1);
  });
});
