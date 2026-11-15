/**
 * Test hooks. Only installed when the page is opened with `?e2e=1`, so the
 * automated browser tests can observe the game and shorten long fights. The
 * game is single-player and keeps no server-side records, so there is nothing
 * to cheat — but the hooks stay off for normal visitors all the same.
 */
import type { App } from './app';

export interface DebugApi {
  state(): {
    mode: string;
    screen: string | null;
    kind: string | null;
    paused: boolean;
    phase: string | null;
    tick: number;
    round: number;
    score: number;
    winner: number;
    fighters: { x: number; y: number; hp: number; maxHp: number; state: string; guard: number; meter: number; facing: number; combo: number }[];
  };
  /** Set a fighter's health (clamped to 1..max). */
  setHp(index: 0 | 1, hp: number): void;
  setMeter(index: 0 | 1, meter: number): void;
  /** Place the fighters `gap` units apart around the centre of the arena. */
  place(gap: number): void;
  /** Jump the survival run to the start of `round`. */
  setRound(round: number): void;
  /** Make the CPU opponent stand still (it keeps blocking nothing). */
  freezeCpu(on: boolean): void;
}

declare global {
  interface Window {
    __LR?: DebugApi;
  }
}

export function installDebug(app: App): void {
  let enabled = false;
  try {
    enabled = new URLSearchParams(window.location.search).get('e2e') === '1';
  } catch {
    enabled = false;
  }
  if (!enabled) return;

  let savedAi: unknown = null;
  window.__LR = {
    state() {
      const f = app.fight;
      return {
        mode: document.getElementById('app')?.dataset.mode ?? '',
        screen: app.screens.current,
        kind: f?.kind ?? null,
        paused: app.paused,
        phase: f?.m.phase ?? null,
        tick: f?.m.tick ?? 0,
        round: app.run?.round ?? 0,
        score: app.run?.score ?? 0,
        winner: f?.m.winner ?? -1,
        fighters: (f?.m.fighters ?? []).map((x) => ({
          x: x.x,
          y: x.y,
          hp: x.hp,
          maxHp: x.maxHp,
          state: x.state,
          guard: x.guard,
          meter: x.meter,
          facing: x.facing,
          combo: x.combo,
        })),
      };
    },
    setHp(index, hp) {
      const x = app.fight?.m.fighters[index];
      if (x) x.hp = Math.max(1, Math.min(x.maxHp, hp));
    },
    setMeter(index, meter) {
      const x = app.fight?.m.fighters[index];
      if (x) x.meter = Math.max(0, Math.min(100, meter));
    },
    place(gap) {
      const m = app.fight?.m;
      if (!m) return;
      m.fighters[0].x = 600 - gap / 2;
      m.fighters[1].x = 600 + gap / 2;
    },
    setRound(round) {
      if (!app.run) return;
      app.run.round = Math.max(1, Math.min(8, Math.floor(round)));
      app.startRound();
    },
    freezeCpu(on) {
      const f = app.fight;
      if (!f) return;
      if (on) {
        savedAi = f.ai;
        f.ai = null;
      } else if (savedAi) {
        f.ai = savedAi as typeof f.ai;
        savedAi = null;
      }
    },
  };
}
