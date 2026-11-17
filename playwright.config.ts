import { defineConfig, devices } from '@playwright/test';

// Set PW_CHROMIUM_PATH to reuse a system Chromium instead of the one
// `npx playwright install chromium` downloads.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    launchOptions: {
      executablePath,
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  // The suite runs against the production build.
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'desktop',
      testMatch: /(game|ui|online)\.spec\.ts/,
      use: { viewport: { width: 1280, height: 720 } },
    },
    {
      name: 'phone-portrait',
      testMatch: /touch\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'phone-landscape',
      testMatch: /touch\.spec\.ts/,
      use: { ...devices['Pixel 7 landscape'] },
    },
  ],
});
