import { expect, test } from '@playwright/test';
import type { DebugApi } from '../../src/game/debug';
import { knockOutOpponent, openGame, settled, startSurvival, state, waitState, watchProblems } from './helpers';

test.describe('survival run', () => {
  test('boots to the title with no errors, missing assets or failed requests', async ({ page }) => {
    const problems = watchProblems(page);
    await openGame(page);
    await expect(page.locator('.title__logo')).toBeVisible();
    // The logo really decoded (an asset that 404s would have zero size).
    expect(await page.locator('.title__logo').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator('[data-act="survival"]')).toBeFocused();
    // CPU fighters spar behind the menu.
    const a = await state(page);
    expect(a.kind).toBe('attract');
    await page.waitForTimeout(500);
    expect((await state(page)).tick).toBeGreaterThan(a.tick);
    // The stage artwork was drawn: the canvas is not one flat colour.
    const colours = await page.evaluate(() => {
      const c = document.getElementById('game') as HTMLCanvasElement;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      const seen = new Set<string>();
      for (let i = 0; i < 40; i++) {
        const d = g.getImageData(Math.floor((c.width * (i + 0.5)) / 40), Math.floor(c.height * 0.45), 1, 1).data;
        seen.add(`${d[0]},${d[1]},${d[2]}`);
      }
      return seen.size;
    });
    expect(colours).toBeGreaterThan(8);
    expect(problems).toEqual([]);
  });

  test('starts a run and the keyboard moves, jumps, guards, dodges and attacks', async ({ page }) => {
    const problems = watchProblems(page);
    await openGame(page);
    await startSurvival(page);
    await expect(page.locator('#hud')).toBeVisible();
    await expect(page.locator('.clock__round')).toHaveText(/1\/8/);
    await page.evaluate(() => (window.__LR as DebugApi).freezeCpu(true));

    // Walk right.
    const x0 = (await state(page)).fighters[0]!.x;
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(400);
    await page.keyboard.up('KeyD');
    const x1 = (await state(page)).fighters[0]!.x;
    expect(x1).toBeGreaterThan(x0 + 30);

    // Walk left with the arrow key.
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(300);
    await page.keyboard.up('ArrowLeft');
    expect((await state(page)).fighters[0]!.x).toBeLessThan(x1 - 15);

    // Jump.
    await page.keyboard.press('KeyW');
    await waitState(page, (s) => s.fighters[0]!.y > 20, 3000);
    await waitState(page, (s) => s.fighters[0]!.y === 0 && s.fighters[0]!.state === 'idle', 5000);

    // Guard while held.
    await page.keyboard.down('KeyS');
    await waitState(page, (s) => s.fighters[0]!.state === 'block', 3000);
    await page.keyboard.up('KeyS');
    await waitState(page, (s) => s.fighters[0]!.state === 'idle', 3000);

    // Dodge.
    await page.keyboard.press('KeyL');
    await waitState(page, (s) => s.fighters[0]!.state === 'dodgeB', 3000);
    await waitState(page, (s) => s.fighters[0]!.state === 'idle', 3000);

    // A jab in range damages the opponent and scores.
    await page.evaluate(() => (window.__LR as DebugApi).place(92));
    const hp0 = (await state(page)).fighters[1]!.hp;
    await page.keyboard.press('KeyJ');
    const after = await waitState(page, (s) => s.fighters[1]!.hp < s.fighters[1]!.maxHp, 3000);
    expect(after.fighters[1]!.hp).toBeLessThan(hp0);
    expect(after.score).toBeGreaterThan(0);

    // Light, light, heavy: a three hit combo shows on the counter.
    await page.evaluate(() => (window.__LR as DebugApi).place(92));
    await page.waitForTimeout(600);
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(110);
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(130);
    await page.keyboard.press('KeyK');
    await waitState(page, (s) => s.fighters[0]!.combo >= 3, 4000);
    await expect(page.locator('.combo').first()).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('guarding reduces damage from a CPU that is attacking', async ({ page }) => {
    await openGame(page);
    await startSurvival(page);
    await page.evaluate(() => {
      const lr = window.__LR as DebugApi;
      lr.cpuLevel(10);
      lr.place(100);
    });
    await page.keyboard.down('KeyS');
    // Hold guard until the CPU has hit it at least once.
    const s = await waitState(page, (x) => x.fighters[0]!.guard < 99 || x.fighters[0]!.state === 'parry' || x.fighters[0]!.state === 'blockstun', 30_000);
    await page.keyboard.up('KeyS');
    // Blocked strikes only chip: far less than a clean heavy hit.
    expect(s.fighters[0]!.maxHp - s.fighters[0]!.hp).toBeLessThan(40);
  });

  test('pause freezes the fight, resume continues it, and Esc toggles', async ({ page }) => {
    await openGame(page);
    await startSurvival(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#screen[data-screen="pause"]')).toBeVisible();
    await settled(page);
    const a = await state(page);
    expect(a.paused).toBe(true);
    await page.waitForTimeout(500);
    expect((await state(page)).tick).toBe(a.tick);
    // Keys must not reach the fighter while paused.
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(200);
    expect((await state(page)).fighters[0]!.state).toBe(a.fighters[0]!.state);
    await page.keyboard.press('Escape');
    await expect(page.locator('#screen')).toBeHidden();
    await page.waitForTimeout(300);
    const b = await state(page);
    expect(b.paused).toBe(false);
    expect(b.tick).toBeGreaterThan(a.tick);
    // The on-screen pause button works too.
    await page.locator('.hud__pause').click();
    await expect(page.locator('#screen[data-screen="pause"]')).toBeVisible();
    await settled(page);
    await page.locator('[data-act="resume"]').click();
    await expect(page.locator('#screen')).toBeHidden();
  });

  test('clearing a round offers upgrades and starts the next round', async ({ page }) => {
    const problems = watchProblems(page);
    await openGame(page);
    await startSurvival(page);
    await knockOutOpponent(page, () => page.keyboard.press('KeyJ'));
    await expect(page.locator('.announce__main')).toHaveText('K.O.');
    await expect(page.locator('#screen[data-screen="clear"]')).toBeVisible({ timeout: 20_000 });
    await settled(page);
    const s = await state(page);
    expect(s.round).toBe(2);
    expect(s.score).toBeGreaterThan(1000);
    const ups = page.locator('.up');
    await expect(ups).toHaveCount(3);
    // Double activation must not skip a round or stack upgrades.
    await ups.first().dblclick();
    const next = await waitState(page, (x) => x.kind === 'survival' && x.phase === 'fight' && x.screen === null);
    expect(next.round).toBe(2);
    await expect(page.locator('.clock__round')).toHaveText(/2\/8/);
    expect(problems).toEqual([]);
  });

  test('losing ends the run with a summary, and retry starts over', async ({ page }) => {
    await openGame(page);
    await startSurvival(page, 'kestrel');
    await page.evaluate(() => {
      const lr = window.__LR as DebugApi;
      lr.cpuLevel(10);
      lr.setHp(0, 1);
      lr.place(100);
    });
    await expect(page.locator('#screen[data-screen="result"]')).toBeVisible({ timeout: 80_000 });
    await settled(page);
    await expect(page.locator('.result__title--lose')).toBeVisible();
    const s = await state(page);
    expect(s.winner).toBe(1);
    expect(s.fighters[0]!.hp).toBe(0);
    await page.locator('[data-act="retry"]').click();
    const again = await waitState(page, (x) => x.kind === 'survival' && x.phase === 'fight' && x.screen === null);
    expect(again.round).toBe(1);
    expect(again.score).toBe(0);
    expect(again.fighters[0]!.hp).toBe(again.fighters[0]!.maxHp);
  });

  test('beating the final round wins the circuit and records the best score', async ({ page }) => {
    await openGame(page);
    await startSurvival(page, 'anvil');
    await page.evaluate(() => (window.__LR as DebugApi).setRound(8));
    await waitState(page, (s) => s.round === 8 && s.phase === 'fight');
    await expect(page.locator('.clock__round')).toHaveText(/8\/8/);
    await knockOutOpponent(page, () => page.keyboard.press('KeyJ'));
    await expect(page.locator('#screen[data-screen="result"]')).toBeVisible({ timeout: 20_000 });
    await settled(page);
    await expect(page.locator('.result__title')).not.toHaveClass(/result__title--lose/);
    await expect(page.locator('.badge')).toBeVisible();
    const score = (await state(page)).score;
    expect(score).toBeGreaterThan(8000);
    await page.locator('[data-act="home"]').click();
    await expect(page.locator('#screen[data-screen="title"]')).toBeVisible();
    await settled(page);
    await expect(page.locator('.title__best b')).toHaveText(score.toLocaleString('en-US'));
    // The record survives a reload.
    await page.reload();
    await page.waitForSelector('#app[data-ready="1"]');
    await expect(page.locator('.title__best b')).toHaveText(score.toLocaleString('en-US'));
  });

  test('quitting from pause returns to the title', async ({ page }) => {
    await openGame(page);
    await startSurvival(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#screen[data-screen="pause"]')).toBeVisible();
    await settled(page);
    await page.locator('[data-act="quit"]').click();
    await expect(page.locator('#screen[data-screen="title"]')).toBeVisible();
    await settled(page);
    const s = await state(page);
    expect(s.kind).toBe('attract');
    expect(s.mode).toBe('menu');
    await expect(page.locator('#hud')).toBeHidden();
  });

  test('mashing start does not launch twice or corrupt the run', async ({ page }) => {
    await openGame(page);
    await page.locator('[data-act="survival"]').dblclick();
    await expect(page.locator('#screen[data-screen="select"]')).toBeVisible();
    await settled(page);
    // Mash confirm.
    const go = page.locator('[data-act="go"]');
    await go.click();
    await go.click({ force: true, noWaitAfter: true, timeout: 1000 }).catch(() => {});
    await page.keyboard.press('Enter');
    const s = await waitState(page, (x) => x.kind === 'survival' && x.phase === 'fight');
    expect(s.round).toBe(1);
    expect(s.screen).toBeNull();
    expect(s.fighters[0]!.hp).toBe(s.fighters[0]!.maxHp);
  });
});

test.describe('training', () => {
  test('never ends, and the dummy can be switched from the pause menu', async ({ page }) => {
    const problems = watchProblems(page);
    await openGame(page);
    await page.locator('[data-act="training"]').click();
    await page.locator('.card[data-char="pylon"]').click();
    await page.locator('[data-act="go"]').click();
    await waitState(page, (s) => s.kind === 'training' && s.phase === 'fight');
    await expect(page.locator('.clock__time')).toHaveText('∞');
    await expect(page.locator('.clock__score')).toBeHidden();

    // Hitting the dummy never knocks it out; its health comes back.
    await page.evaluate(() => (window.__LR as DebugApi).place(100));
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('KeyK');
      await page.waitForTimeout(650);
    }
    const s = await state(page);
    expect(s.phase).toBe('fight');
    expect(s.fighters[1]!.hp).toBeGreaterThan(0);
    await waitState(page, (x) => x.fighters[1]!.hp === x.fighters[1]!.maxHp, 15_000);

    // Switch the dummy to guard.
    await page.keyboard.press('Escape');
    await expect(page.locator('#screen[data-screen="pause"]')).toBeVisible();
    await settled(page);
    await page.locator('[data-set="dummy"][data-value="guard"]').click();
    await expect(page.locator('[data-set="dummy"][data-value="guard"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-act="resume"]').click();
    await waitState(page, (x) => x.fighters[1]!.state === 'block', 5000);

    // Overdrive: the meter refills in training, so the special comes out.
    await waitState(page, (x) => x.fighters[0]!.meter >= 100, 30_000);
    await page.keyboard.press('KeyI');
    await waitState(page, (x) => x.fighters[0]!.meter < 100, 3000);
    expect(problems).toEqual([]);
  });
});
