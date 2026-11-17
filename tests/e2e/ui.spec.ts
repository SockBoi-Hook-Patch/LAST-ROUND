import { expect, test } from '@playwright/test';
import { openGame, settled, startSurvival, state, watchProblems } from './helpers';

test.describe('menus and settings', () => {
  test('the controls screen lists every action and returns to the title', async ({ page }) => {
    await openGame(page);
    await page.locator('[data-act="howto"]').click();
    await expect(page.locator('#screen[data-screen="howto"]')).toBeVisible();
    await settled(page);
    await expect(page.locator('.keys').first().locator('div')).toHaveCount(8);
    await expect(page.locator('.tips li')).toHaveCount(4);
    await page.keyboard.press('Escape');
    await expect(page.locator('#screen[data-screen="title"]')).toBeVisible();
    await settled(page);
  });

  test('volume, mute, language and motion settings apply and persist', async ({ page }) => {
    const problems = watchProblems(page);
    await openGame(page);
    await page.locator('[data-act="settings"]').click();
    await expect(page.locator('#screen[data-screen="settings"]')).toBeVisible();
    await settled(page);

    // Volume slider.
    await page.locator('#vol-music').fill('20');
    await expect(page.locator('output[for="vol-music"]')).toHaveText('20');

    // Mute toggles.
    const mute = page.locator('[data-set="mute"]');
    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'true');

    // Reduced motion.
    await page.locator('[data-set="motion"][data-value="on"]').click();
    await expect(page.locator('html')).toHaveClass(/reduce-motion/);
    await page.locator('[data-set="motion"][data-value="off"]').click();
    await expect(page.locator('html')).not.toHaveClass(/reduce-motion/);

    // Language: Thai and back.
    await page.locator('[data-set="lang"][data-value="th"]').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'th');
    await expect(page.locator('.h1')).toHaveText('ตั้งค่า');
    await page.locator('[data-set="lang"][data-value="en"]').click();
    await expect(page.locator('.h1')).toHaveText('Settings');

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('last-round:v1') ?? '{}'));
    expect(saved.music).toBeCloseTo(0.2, 5);
    expect(saved.muted).toBe(true);
    expect(saved.motion).toBe('off');
    expect(saved.lang).toBe('en');

    // Everything survives a reload.
    await page.reload();
    await page.waitForSelector('#app[data-ready="1"]');
    await page.locator('[data-act="settings"]').click();
    await expect(page.locator('#vol-music')).toHaveValue('20');
    await expect(page.locator('[data-set="mute"]')).toHaveAttribute('aria-pressed', 'true');
    expect(problems).toEqual([]);
  });

  test('corrupt saved data falls back to defaults instead of breaking the game', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('last-round:v1', '{"master":"loud","lang":42,"bestScore":-5,'));
    const problems = watchProblems(page);
    await openGame(page);
    await page.locator('[data-act="settings"]').click();
    await expect(page.locator('#vol-master')).toHaveValue('80');
    expect(problems).toEqual([]);
  });

  test('the game still plays when Web Audio is missing', async ({ page }) => {
    await page.addInitScript(() => {
      // @ts-expect-error simulate a browser without Web Audio
      delete window.AudioContext;
      // @ts-expect-error simulate a browser without Web Audio
      delete window.webkitAudioContext;
    });
    const problems = watchProblems(page);
    await openGame(page);
    await page.locator('[data-act="settings"]').click();
    await expect(page.locator('.note[role="status"]')).toBeVisible();
    await settled(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#screen[data-screen="title"]')).toBeVisible();
    await settled(page);
    await startSurvival(page);
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(400);
    expect((await state(page)).phase).toBe('fight');
    expect(problems).toEqual([]);
  });

  test('the game still plays when the audio context refuses to start', async ({ page }) => {
    await page.addInitScript(() => {
      class Broken {
        constructor() {
          throw new Error('audio blocked');
        }
      }
      // @ts-expect-error simulate a broken implementation
      window.AudioContext = Broken;
    });
    const problems = watchProblems(page);
    await openGame(page);
    await startSurvival(page);
    await page.keyboard.press('KeyK');
    await page.waitForTimeout(400);
    expect((await state(page)).phase).toBe('fight');
    expect(problems).toEqual([]);
  });

  test('audio actually starts after a user gesture', async ({ page }) => {
    await page.addInitScript(() => {
      const Real = window.AudioContext;
      (window as unknown as { __ctx: AudioContext[] }).__ctx = [];
      window.AudioContext = class extends Real {
        constructor(o?: AudioContextOptions) {
          super(o);
          (window as unknown as { __ctx: AudioContext[] }).__ctx.push(this);
        }
      };
    });
    await openGame(page);
    expect(await page.evaluate(() => (window as unknown as { __ctx: AudioContext[] }).__ctx.length)).toBe(0);
    await page.locator('[data-act="howto"]').click();
    await page.waitForFunction(() => (window as unknown as { __ctx: AudioContext[] }).__ctx.some((c) => c.state === 'running'));
  });
});

test.describe('accessibility basics', () => {
  test('every control has a name, text is readable and focus is managed', async ({ page }) => {
    await openGame(page);
    await expect(page.locator('html')).toHaveAttribute('lang', /^(th|en)$/);
    expect(await page.title()).toContain('LAST ROUND');

    const unnamed = async (): Promise<string[]> =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], input, a[href]'))
          .filter((el) => el.offsetParent !== null)
          .filter((el) => {
            const label = el.getAttribute('aria-label') ?? '';
            const text = el.textContent?.trim() ?? '';
            const forLabel = el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() ?? '' : '';
            return !(label || text || forLabel);
          })
          .map((el) => el.outerHTML.slice(0, 90)),
      );

    expect(await unnamed()).toEqual([]);
    await expect(page.locator('.title__logo')).toHaveAttribute('alt', 'LAST ROUND');

    // Menus are fully keyboard operable.
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-act="training"]')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(page.locator('#screen[data-screen="select"]')).toBeVisible();
    await settled(page);
    expect(await unnamed()).toEqual([]);
    await expect(page.locator('.roster')).toHaveAttribute('role', 'radiogroup');
    await expect(page.locator('.card[aria-checked="true"]')).toHaveCount(1);
    await page.locator('[data-act="go"]').click();

    // In the fight the gauges are exposed as progress bars with values.
    await page.waitForFunction(() => document.querySelector('#hud')?.hasAttribute('hidden') === false);
    const bars = page.locator('#hud [role="progressbar"]');
    await expect(bars).toHaveCount(6);
    for (let i = 0; i < 6; i++) {
      await expect(bars.nth(i)).toHaveAttribute('aria-valuenow', /\d+/);
      await expect(bars.nth(i)).toHaveAttribute('aria-label', /.+/);
    }
    await expect(page.locator('.hud__pause')).toHaveAttribute('aria-label', /.+/);
    expect(await unnamed()).toEqual([]);

    // Body text contrast against the darkest panel colour is comfortably above 4.5:1.
    const ratio = await page.evaluate(() => {
      const lum = (hex: string): number => {
        const n = parseInt(hex.slice(1), 16);
        const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
      };
      const css = getComputedStyle(document.documentElement);
      const pair = (a: string, b: string): number => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
        return (hi + 0.05) / (lo + 0.05);
      };
      const ink = css.getPropertyValue('--ink-600').trim();
      return Math.min(pair(css.getPropertyValue('--bone-100').trim(), ink), pair(css.getPropertyValue('--fog-200').trim(), ink));
    });
    expect(ratio).toBeGreaterThan(4.5);
  });

  test('prefers-reduced-motion is honoured by default', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const problems = watchProblems(page);
    await openGame(page);
    await expect(page.locator('html')).toHaveClass(/reduce-motion/);
    await startSurvival(page);
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(300);
    expect(problems).toEqual([]);
    await ctx.close();
  });

  test('the layout holds on a small desktop window and a very wide one', async ({ page }) => {
    for (const size of [
      { width: 800, height: 600 },
      { width: 1920, height: 720 },
      { width: 1024, height: 1366 },
    ]) {
      await page.setViewportSize(size);
      await openGame(page);
      const box = await page.locator('#playfield').boundingBox();
      expect(box).not.toBeNull();
      const ratio = box!.width / box!.height;
      expect(ratio).toBeGreaterThan(1.32);
      expect(ratio).toBeLessThan(2.38);
      expect(box!.width).toBeLessThanOrEqual(size.width + 1);
      expect(box!.height).toBeLessThanOrEqual(size.height + 1);
      // No horizontal scrolling anywhere.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });
});

test.describe('keyboard and pause regressions', () => {
  test('menu keys keep working when focus has left the menu, and Tab stays inside it', async ({ page }) => {
    await openGame(page);
    await page.locator('[data-act="settings"]').click();
    await expect(page.locator('#screen[data-screen="settings"]')).toBeVisible();
    await settled(page);
    // Move focus out of the screen entirely.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Escape');
    await expect(page.locator('#screen[data-screen="title"]')).toBeVisible();
    await settled(page);
    // Tab from the last control wraps to the first one.
    const n = await page.locator('#screen button').count();
    for (let i = 0; i < n + 2; i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('#screen'))).toBe(true);
  });

  test('pausing during the intro keeps the round banner', async ({ page }) => {
    await openGame(page);
    await page.locator('[data-act="survival"]').click();
    await settled(page);
    await page.locator('[data-act="go"]').click();
    await expect(page.locator('.announce__main')).toHaveText(/ROUND 1/);
    await page.waitForTimeout(250);
    await page.keyboard.press('Escape');
    await expect(page.locator('#screen[data-screen="pause"]')).toBeVisible();
    await page.waitForTimeout(2000);
    await settled(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#screen')).toBeHidden();
    await expect(page.locator('.announce__main')).toHaveText(/ROUND 1/);
  });

  test('English result screen uses the singular for one round', async ({ page }) => {
    await openGame(page);
    await startSurvival(page);
    await page.evaluate(() => {
      const lr = window.__LR!;
      lr.freezeCpu(true);
      lr.place(92);
      lr.setHp(1, 5);
    });
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__LR!.place(92));
    await page.keyboard.press('KeyJ');
    await expect(page.locator('#screen[data-screen="clear"]')).toBeVisible({ timeout: 20_000 });
    await settled(page);
    await page.locator('.up').first().click();
    await waitStateUi(page);
    await page.evaluate(() => {
      const lr = window.__LR!;
      lr.cpuLevel(10);
      lr.setHp(0, 1);
      lr.place(100);
    });
    await expect(page.locator('#screen[data-screen="result"]')).toBeVisible({ timeout: 80_000 });
    if ((await page.locator('html').getAttribute('lang')) === 'en') await expect(page.locator('.figures')).toContainText('1 round');
  });
});

async function waitStateUi(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => {
    const s = window.__LR!.state();
    return s.kind === 'survival' && s.phase === 'fight' && s.screen === null && s.round === 2;
  });
}
