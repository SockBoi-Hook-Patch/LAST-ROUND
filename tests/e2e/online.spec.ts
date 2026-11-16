import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { startServer } from '../../server/index';
import type { RunningServer } from '../../server/index';
import { openGame, settled, state, waitState, watchProblems } from './helpers';

let srv: RunningServer;

test.beforeEach(async () => {
  srv = await startServer({ port: 0, host: '127.0.0.1' });
});

test.afterEach(async () => {
  await srv.close();
});

async function player(browser: Browser): Promise<{ page: Page; problems: string[]; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 620 } });
  const page = await ctx.newPage();
  const problems = watchProblems(page);
  await page.goto(`/?e2e=1&server=${encodeURIComponent(`ws://127.0.0.1:${srv.port}`)}`);
  await page.waitForSelector('#app[data-ready="1"]');
  await settled(page);
  return { page, problems, close: () => ctx.close() };
}

async function openLobby(page: Page): Promise<void> {
  await page.locator('[data-act="online"]').click();
  await expect(page.locator('#screen[data-screen="online"]')).toBeVisible();
  await expect(page.locator('.status')).toHaveAttribute('data-state', 'ok');
  await expect(page.locator('[data-set="quick"]')).toBeEnabled();
}

test.describe('online 1v1', () => {
  test('there is no online entry when no match server is configured', async ({ page }) => {
    await openGame(page);
    await expect(page.locator('[data-act="online"]')).toHaveCount(0);
    await expect(page.locator('.menu .btn')).toHaveCount(4);
  });

  test('quick match: two players fight on the server, and a leaver forfeits', async ({ browser }) => {
    const a = await player(browser);
    const b = await player(browser);
    await openLobby(a.page);
    await openLobby(b.page);

    await a.page.locator('[data-set="char"][data-value="kestrel"]').click();
    await a.page.locator('[data-set="quick"]').click();
    await expect(a.page.locator('#screen[data-screen="online-wait"]')).toBeVisible();
    expect((await (await fetch(`http://127.0.0.1:${srv.port}/health`)).json()) as object).toMatchObject({ queued: 1 });

    await b.page.locator('[data-set="char"][data-value="anvil"]').click();
    await b.page.locator('[data-set="quick"]').click();

    const sa = await waitState(a.page, (s) => s.kind === 'online' && s.phase === 'fight');
    const sb = await waitState(b.page, (s) => s.kind === 'online' && s.phase === 'fight');
    await expect(a.page.locator('#hud')).toBeVisible();
    await expect(a.page.locator('[data-plate="p1"] .plate__name')).toContainText('KESTREL');
    await expect(b.page.locator('[data-plate="p2"] .plate__name')).toContainText('ANVIL');
    await expect(a.page.locator('.hud__note')).toContainText(/\d+ ms/);
    // Both screens show the same fight.
    expect(sa.fighters[0]!.maxHp).toBe(sb.fighters[0]!.maxHp);

    // Player A walks right: the move happens on the server and shows up for B.
    const b0 = await state(b.page);
    await a.page.keyboard.down('KeyA');
    await b.page.waitForFunction((x) => window.__LR!.state().fighters[0]!.x < x - 60, b0.fighters[0]!.x, { timeout: 8000 });
    await a.page.keyboard.up('KeyA');
    // ...and B's own fighter did not move.
    expect((await state(b.page)).fighters[1]!.x).toBeCloseTo(b0.fighters[1]!.x, 0);
    // Player B controls the other fighter only.
    await a.page.waitForTimeout(250);
    const a0 = await state(a.page);
    await b.page.keyboard.down('KeyD');
    await a.page.waitForFunction((x) => window.__LR!.state().fighters[1]!.x > x + 60, a0.fighters[1]!.x, { timeout: 8000 });
    await b.page.keyboard.up('KeyD');
    expect((await state(a.page)).fighters[0]!.x).toBeCloseTo(a0.fighters[0]!.x, 0);

    // Tampering with local state does nothing: the next snapshot overwrites it.
    await a.page.evaluate(() => window.__LR!.setHp(1, 1));
    await a.page.waitForTimeout(300);
    const after = await state(a.page);
    expect(after.fighters[1]!.hp).toBe(after.fighters[1]!.maxHp);

    // B closes the tab: A wins by forfeit and is told why.
    await b.close();
    await expect(a.page.locator('#screen[data-screen="online-done"]')).toBeVisible({ timeout: 15_000 });
    await expect(a.page.locator('.result__title')).not.toHaveClass(/result__title--lose/);
    expect(a.problems).toEqual([]);
    await settled(a.page);
    await a.page.locator('[data-act="home"]').click();
    await expect(a.page.locator('#screen[data-screen="title"]')).toBeVisible();
    await a.close();
  });

  test('private room: create, share the code, join, and bad codes are explained', async ({ browser }) => {
    const a = await player(browser);
    const b = await player(browser);
    await openLobby(a.page);
    await openLobby(b.page);

    await a.page.locator('[data-set="create"]').click();
    await expect(a.page.locator('#screen[data-screen="online-wait"]')).toBeVisible();
    const code = (await a.page.locator('[data-code]').textContent())!.trim();
    expect(code).toMatch(/^[A-Z2-9]{4}$/);

    // A wrong code is reported, not silently ignored.
    await b.page.locator('#room-code').fill(code === 'ZZZZ' ? 'YYYY' : 'ZZZZ');
    await b.page.locator('[data-set="join"]').click();
    await expect(b.page.locator('[data-error]')).not.toBeEmpty();
    await expect(b.page.locator('#screen[data-screen="online"]')).toBeVisible();

    await b.page.locator('#room-code').fill(code.toLowerCase());
    await b.page.locator('[data-set="join"]').click();
    await waitState(a.page, (s) => s.kind === 'online' && s.phase === 'fight');
    await waitState(b.page, (s) => s.kind === 'online' && s.phase === 'fight');

    // Leaving through the pause menu forfeits and returns to the title.
    await b.page.keyboard.press('Escape');
    await expect(b.page.locator('#screen[data-screen="pause"]')).toBeVisible();
    await settled(b.page);
    await b.page.locator('[data-act="quit"]').click();
    await expect(b.page.locator('#screen[data-screen="title"]')).toBeVisible();
    await expect(a.page.locator('#screen[data-screen="online-done"]')).toBeVisible({ timeout: 15_000 });
    expect(a.problems).toEqual([]);
    expect(b.problems).toEqual([]);
    await a.close();
    await b.close();
  });

  test('losing the server is shown clearly and reconnecting works', async ({ browser }) => {
    const a = await player(browser);
    await openLobby(a.page);
    const port = srv.port;
    await srv.close();
    await expect(a.page.locator('.status')).toHaveAttribute('data-state', 'bad', { timeout: 15_000 });
    await expect(a.page.locator('[data-set="quick"]')).toBeDisabled();
    await expect(a.page.locator('[data-set="retry"]')).toBeVisible();
    // Bring the server back on the same port and reconnect.
    srv = await startServer({ port, host: '127.0.0.1' });
    await a.page.locator('[data-set="retry"]').click();
    await expect(a.page.locator('.status')).toHaveAttribute('data-state', 'ok', { timeout: 15_000 });
    await expect(a.page.locator('[data-set="quick"]')).toBeEnabled();
    await a.close();
  });
});
