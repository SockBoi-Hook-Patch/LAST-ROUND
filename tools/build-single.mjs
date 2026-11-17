/**
 * Builds the single-player game as ONE self-contained HTML file
 * (`dist-single/last-round.html`): scripts, styles, fonts and artwork are all
 * inlined, so the file can be opened directly, e-mailed, or dropped onto any
 * host that only serves a single page. Online play is not part of this build.
 *
 *   npm run build:single
 *   npm run build:single -- --fragment out.html
 *
 * `--fragment` additionally writes the page without its document shell
 * (title, styles, body content and script only) for hosts that wrap pages in
 * their own `<html>` / `<head>` / `<body>`.
 */
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-single');

// Never bake a match server address into the standalone file.
delete process.env.VITE_SERVER_URL;

await build({
  root,
  configFile: join(root, 'vite.config.ts'),
  logLevel: 'warn',
  publicDir: false,
  envDir: false,
  build: {
    outDir: out,
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
  },
});

let html = readFileSync(join(out, 'index.html'), 'utf8');
const assets = join(out, 'assets');
const files = readdirSync(assets);

const js = files.filter((f) => f.endsWith('.js'));
const css = files.filter((f) => f.endsWith('.css'));
const other = files.filter((f) => !f.endsWith('.js') && !f.endsWith('.css'));
if (js.length !== 1 || css.length !== 1) throw new Error(`expected one script and one stylesheet, found ${js.length} / ${css.length}`);
if (other.length) throw new Error(`assets were not inlined: ${other.join(', ')}`);

const script = readFileSync(join(assets, js[0]), 'utf8').replaceAll('</script', '<\\/script');
const style = readFileSync(join(assets, css[0]), 'utf8').replaceAll('</style', '<\\/style');
const favicon = readFileSync(join(root, 'public', 'favicon.svg'), 'utf8').replace(/\s+/g, ' ').trim();

// Replacement callbacks: the payloads contain `$` sequences that must stay literal.
html = html
  .replace(/<link rel="icon"[^>]*>/, () => `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(favicon)}" />`)
  .replace(/<link rel="stylesheet"[^>]*>/, () => `<style>${style}</style>`)
  .replace(/<script type="module"[^>]*><\/script>/, () => '')
  .replace('</body>', () => `<script type="module">${script}</script>\n  </body>`);

if (/<script[^>]+src=|<link[^>]+rel="stylesheet"/.test(html)) throw new Error('external references remain in the page');

rmSync(assets, { recursive: true, force: true });
rmSync(join(out, 'index.html'), { force: true });
writeFileSync(join(out, 'last-round.html'), html);
console.log(`dist-single/last-round.html  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);

const flag = process.argv.indexOf('--fragment');
if (flag !== -1) {
  const target = process.argv[flag + 1];
  if (!target) throw new Error('--fragment needs an output path');
  const body = /<body>([\s\S]*)<\/body>/.exec(html);
  if (!body) throw new Error('could not find the page body');
  const fragment = [
    '<title>LAST ROUND</title>',
    '<meta name="claude:viewport-fit-sides" content="cover">',
    '<meta name="theme-color" content="#07090f">',
    `<style>${style}</style>`,
    body[1].trim(),
    '',
  ].join('\n');
  writeFileSync(target, fragment);
  console.log(`${target}  ${(Buffer.byteLength(fragment) / 1024).toFixed(0)} KB (fragment)`);
}
