import { defineConfig } from 'vitest/config';

// `base` is relative so the build works from any sub-path (GitHub Pages
// project sites, itch.io, a plain file server, ...).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0,
  },
  server: { host: true },
  preview: { host: true },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
});
