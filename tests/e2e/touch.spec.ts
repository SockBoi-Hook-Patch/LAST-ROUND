import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { DebugApi } from '../../src/game/debug';
import { openGame, settled, state, waitState, watchProblems } from './helpers';

async function startByTouch(page: Page): Promise<void> {
  await page.locator('[data-act="survival"]').tap();
  await expect(page.locator('#screen[data-screen="select"]')).toBeVisible();
  await settled(page);
  await page.locator('.card[data-char="switch"]').tap();
  await page.locator('[data-act="go"]').tap();
  await waitState(page, (s) => s.kind === 'survival' && s.phase === 'fight');
}

/** Hold a touch button for `ms` using real pointer events. */
async function hold(page: Page, selector: string, ms: number, id = 11): Promise<void> {
  const el = page.locator(selector);
  await el.dispatchEvent('pointerdown', { pointerId: id, pointerType: 'touch', isPrimary: true, bubbles: true });
  await page.waitForTimeout(ms);
  await el.dispatchEvent('pointerup', { pointerId: id, pointerType: 'touch', isPrimary: true, bubbles: true });
}

test.describe('touch controls', () => {
  test('menus fit the screen and are usable by touch', async ({ page }) => {
    const problems = watchProblems(page);
    await openGame(page);
    const vp = page.viewportSize()!;
    // Nothing forces horizontal scrolling.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // Menu buttons are comfortable touch targets.
    const buttons = page.locator('.menu .btn');
    const n = await buttons.count();
    expect(n).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < n; i++) {
      const b = (await buttons.nth(i).boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 1);
    }
    await page.locator('[data-act="howto"]').tap();
    await expect(page.locator('#screen[data-screen="howto"]')).toBeVisible();
    await settled(page);
    await page.locator('[data-act="back"]').tap();
    await expect(page.locator('#screen[data-screen="title"]')).toBeVisible();
    await settled(page);
    expect(problems).toEqual([]);
  });

  test('on-screen buttons appear in a fight, are large enough and drive the fighter', async ({ page }) => {
    const problems = watchProblems(page);
    await openGame(page);
    await expect(page.locator('#touch')).toBeHidden();
    await startByTouch(page);
    await expect(page.locator('#touch')).toBeVisible();
    await page.evaluate(() => (window.__LR as DebugApi).freezeCpu(true));

    const vp = page.viewportSize()!;
    const portrait = vp.height > vp.width;
    const field = (await page.locator('#playfield').boundingBox())!;

    // Every control: named, at least 44px, on screen, not overlapping another.
    const ctrls = page.locator('#touch .tbtn');
    const count = await ctrls.count();
    expect(count).toBe(8);
    const boxes: { x: number; y: number; width: number; height: number }[] = [];
    for (let i = 0; i < count; i++) {
      const el = ctrls.nth(i);
      await expect(el).toHaveAttribute('aria-label', /.+/);
      const b = (await el.boundingBox())!;
      expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 0.5);
      expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 0.5);
      boxes.push(b);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlap = a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
        expect(overlap, `controls ${i} and ${j} overlap`).toBe(false);
      }
    }
    if (portrait) {
      // Portrait: the controls sit entirely below the playfield.
      for (const b of boxes) expect(b.y).toBeGreaterThanOrEqual(field.y + field.height - 1);
    } else {
      // Landscape: the controls stay in the bottom corners, clear of the centre.
      for (const b of boxes) {
        const cx = b.x + b.width / 2;
        expect(cx < vp.width * 0.3 || cx > vp.width * 0.62).toBe(true);
        expect(b.y).toBeGreaterThan(vp.height * 0.45);
      }
    }

    // The pad moves the fighter.
    const x0 = (await state(page)).fighters[0]!.x;
    const pad = (await page.locator('[data-side="right"]').boundingBox())!;
    await page.locator('[data-pad]').dispatchEvent('pointerdown', {
      pointerId: 3,
      pointerType: 'touch',
      isPrimary: true,
      bubbles: true,
      clientX: pad.x + pad.width / 2,
      clientY: pad.y + pad.height / 2,
    });
    await page.waitForTimeout(400);
    await page.locator('[data-pad]').dispatchEvent('pointerup', { pointerId: 3, pointerType: 'touch', isPrimary: true, bubbles: true });
    const x1 = (await state(page)).fighters[0]!.x;
    expect(x1).toBeGreaterThan(x0 + 30);
    await page.waitForTimeout(150);
    // Released: the fighter stops.
    const x2 = (await state(page)).fighters[0]!.x;
    await page.waitForTimeout(200);
    expect((await state(page)).fighters[0]!.x).toBeCloseTo(x2, 3);

    // Guard is a hold.
    const guard = hold(page, '[data-in="BLOCK"]', 500, 21);
    await waitState(page, (s) => s.fighters[0]!.state === 'block', 3000);
    await guard;
    await waitState(page, (s) => s.fighters[0]!.state === 'idle', 3000);

    // Jump and attack buttons.
    await hold(page, '[data-in="JUMP"]', 60, 22);
    await waitState(page, (s) => s.fighters[0]!.y > 10, 3000);
    await waitState(page, (s) => s.fighters[0]!.y === 0 && s.fighters[0]!.state === 'idle', 5000);
    await page.evaluate(() => (window.__LR as DebugApi).place(92));
    await hold(page, '[data-in="LIGHT"]', 60, 23);
    await waitState(page, (s) => s.fighters[1]!.hp < s.fighters[1]!.maxHp, 3000);

    // Two fingers at once: hold guard and tap another button without losing guard.
    const g2 = hold(page, '[data-in="BLOCK"]', 600, 31);
    await waitState(page, (s) => s.fighters[0]!.state === 'block', 3000);
    await hold(page, '[data-in="DODGE"]', 50, 32);
    await g2;

    // The pause button is reachable by touch and hides the controls.
    await page.locator('.hud__pause').tap();
    await expect(page.locator('#screen[data-screen="pause"]')).toBeVisible();
    await settled(page);
    await expect(page.locator('#touch')).toBeHidden();
    await page.locator('[data-act="resume"]').tap();
    await expect(page.locator('#touch')).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('the playfield keeps its shape and the HUD stays inside it', async ({ page }) => {
    await openGame(page);
    await startByTouch(page);
    const vp = page.viewportSize()!;
    const field = (await page.locator('#playfield').boundingBox())!;
    expect(field.width).toBeLessThanOrEqual(vp.width + 0.5);
    expect(field.height).toBeLessThanOrEqual(vp.height + 0.5);
    const ratio = field.width / field.height;
    expect(ratio).toBeGreaterThan(1.32);
    expect(ratio).toBeLessThan(2.38);
    for (const sel of ['[data-plate="p1"]', '[data-plate="p2"]', '.clock', '.hud__pause']) {
      const b = (await page.locator(sel).boundingBox())!;
      expect(b.x, sel).toBeGreaterThanOrEqual(field.x - 0.5);
      expect(b.x + b.width, sel).toBeLessThanOrEqual(field.x + field.width + 0.5);
      expect(b.y, sel).toBeGreaterThanOrEqual(field.y - 0.5);
    }
    // HUD text is not microscopic.
    const size = await page.locator('.plate__name').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(10);
    // The pause button is a real touch target.
    const pause = (await page.locator('.hud__pause').boundingBox())!;
    expect(Math.min(pause.width, pause.height)).toBeGreaterThanOrEqual(40);
  });
});
