import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { DebugApi } from '../../src/game/debug';

declare global {
  interface Window {
    __LR?: DebugApi;
  }
}

export type GameState = ReturnType<DebugApi['state']>;

/** Collects everything that should never happen while playing. */
export function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
  });
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  return problems;
}

export async function openGame(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.waitForSelector('#app[data-ready="1"]');
  await expect(page.locator('#screen[data-screen="title"]')).toBeVisible();
  await settled(page);
}

export function state(page: Page): Promise<GameState> {
  return page.evaluate(() => (window.__LR as DebugApi).state());
}

export async function waitState(page: Page, pred: (s: GameState) => boolean, timeout = 30_000): Promise<GameState> {
  await page.waitForFunction((src) => (0, eval)(`(${src})`)((window.__LR as DebugApi).state()), pred.toString(), { timeout });
  return state(page);
}

/** Title → fighter select → into the first round, waiting for FIGHT. */
export async function startSurvival(page: Page, char = 'switch'): Promise<void> {
  await page.locator('[data-act="survival"]').click();
  await expect(page.locator('#screen[data-screen="select"]')).toBeVisible();
  await settled(page);
  await page.locator(`.card[data-char="${char}"]`).click();
  await page.locator('[data-act="go"]').click();
  await waitState(page, (s) => s.kind === 'survival' && s.phase === 'fight');
}

/** Knock the opponent out with one jab (the CPU is frozen and weakened). */
export async function knockOutOpponent(page: Page, press: () => Promise<void>): Promise<void> {
  await page.evaluate(() => {
    const lr = window.__LR as DebugApi;
    lr.freezeCpu(true);
    lr.place(92);
    lr.setHp(1, 5);
  });
  // Give the frozen opponent a moment to finish whatever it was doing.
  await page.waitForTimeout(700);
  await page.evaluate(() => (window.__LR as DebugApi).place(92));
  await press();
  await waitState(page, (s) => s.fighters[1]?.hp === 0, 15_000);
}

/**
 * Menus ignore input for a moment after they open (so a double click cannot
 * leak into the next screen). Wait until the open screen accepts input.
 */
export async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => !document.getElementById('screen')?.hasAttribute('data-locked'));
}
