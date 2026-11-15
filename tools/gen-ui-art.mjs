/**
 * Authoring script for the logo, the app mark and the icon set.
 *
 * Like the stage layers, these are original shapes described as code so the
 * whole family shares one grid and one stroke weight. Run
 * `node tools/gen-ui-art.mjs` to regenerate; the output is committed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'src', 'assets');
const ICONS = join(ASSETS, 'icons');
mkdirSync(ICONS, { recursive: true });
mkdirSync(join(ROOT, 'public'), { recursive: true });

const BONE = '#ece6d6';
const RED = '#f2475f';
const RED_DIM = '#8c2338';
const CYAN = '#3cd8c8';
const AMBER = '#f4a63a';
const INK = '#07090f';

/* ------------------------------------------------------------------ */
/* Lettering: angular stencil capitals on a 100 x 140 grid             */
/* ------------------------------------------------------------------ */
const GLYPH = {
  L: 'M0 0H28V112H100V140H0Z',
  A: 'M0 140V24L24 0H76L100 24V140H72V96H28V140ZM28 28V68H72V28Z',
  S: 'M100 0H24L0 24V84H72V112H0V140H76L100 116V56H28V28H100Z',
  T: 'M0 0H100V28H64V140H36V28H0Z',
  R: 'M0 0H76L100 24V62L84 80L100 140H70L56 88H28V140H0ZM28 28V60H72V28Z',
  U: 'M0 0H28V112H72V0H100V116L76 140H24L0 116Z',
  N: 'M0 140V0H30L72 84V0H100V140H70L28 56V140Z',
  D: 'M0 0H72L100 28V112L72 140H0ZM28 28V112H62L72 102V38L62 28Z',
};

function word(text, x, y, scale, gap) {
  let out = '';
  let cx = x;
  for (const ch of text) {
    out += `<path transform="translate(${cx} ${y}) scale(${scale})" d="${GLYPH[ch]}" fill-rule="evenodd"/>`;
    cx += 100 * scale + gap;
  }
  return { markup: out, end: cx - gap };
}

/** The round clock: twelve ticks, the last segment lit. */
function ring(cx, cy, r, opts = {}) {
  const w = opts.width ?? r * 0.2;
  let ticks = '';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const r0 = r * 0.6;
    const r1 = r * 0.78;
    ticks += `M${(cx + Math.cos(a) * r0).toFixed(1)} ${(cy + Math.sin(a) * r0).toFixed(1)}L${(cx + Math.cos(a) * r1).toFixed(1)} ${(cy + Math.sin(a) * r1).toFixed(1)}`;
  }
  // Final segment: from ten o'clock to twelve.
  const a0 = (-150 * Math.PI) / 180;
  const a1 = (-90 * Math.PI) / 180;
  const arc = `M${(cx + Math.cos(a0) * r).toFixed(1)} ${(cy + Math.sin(a0) * r).toFixed(1)}A${r} ${r} 0 0 1 ${(cx + Math.cos(a1) * r).toFixed(1)} ${(cy + Math.sin(a1) * r).toFixed(1)}`;
  const hand = `M${cx} ${cy}L${(cx + Math.cos(a0 + 0.26) * r * 0.5).toFixed(1)} ${(cy + Math.sin(a0 + 0.26) * r * 0.5).toFixed(1)}`;
  return { ticks, arc, hand, w };
}

function logo() {
  const top = word('LAST', 62, 22, 0.56, 12);
  const y2 = 126;
  const r = word('R', 40, y2, 1, 0);
  const cx = 40 + 100 + 18 + 70;
  const cy = y2 + 70;
  const rest = word('UND', cx + 70 + 18, y2, 1, 16);
  const k = ring(cx, cy, 61);
  const W = Math.round(rest.end + 40);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 300" role="img" aria-label="LAST ROUND">
<defs>
<filter id="lr-glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="9"/></filter>
<mask id="lr-cut"><rect width="${W}" height="300" fill="#fff"/><rect x="0" y="${y2 + 84}" width="${W}" height="5" fill="#000"/><rect x="0" y="70" width="${W}" height="3" fill="#000"/></mask>
</defs>
<g transform="skewX(-9) translate(34 0)">
<g mask="url(#lr-cut)">
<g fill="${BONE}">${top.markup}</g>
<g fill="${BONE}">${r.markup}${rest.markup}</g>
</g>
<path d="M${top.end + 22} 34H${W - 96}V48H${top.end + 22}Z" fill="${AMBER}"/>
<path d="M${top.end + 22} 62H${W - 150}V68H${top.end + 22}Z" fill="${CYAN}"/>
<path d="M${top.end + 22} 82h20l-12 14h-20zM${top.end + 54} 82h20l-12 14h-20zM${top.end + 86} 82h20l-12 14h-20z" fill="${BONE}" opacity="0.55"/>
<g fill="none" stroke-linecap="butt">
<circle cx="${cx}" cy="${cy}" r="61" stroke="${RED}" stroke-width="16" opacity="0.5" filter="url(#lr-glow)"/>
<circle cx="${cx}" cy="${cy}" r="61" stroke="${RED_DIM}" stroke-width="${k.w.toFixed(1)}"/>
<path d="${k.arc}" stroke="${RED}" stroke-width="${k.w.toFixed(1)}"/>
<path d="${k.arc}" stroke="#ffd7dc" stroke-width="3"/>
<path d="${k.ticks}" stroke="${BONE}" stroke-width="5" opacity="0.85"/>
<path d="${k.hand}" stroke="${BONE}" stroke-width="7"/>
</g>
<circle cx="${cx}" cy="${cy}" r="6" fill="${BONE}"/>
</g>
</svg>
`;
}

function mark(bg) {
  const k = ring(32, 32, 21);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="LAST ROUND">
${bg ? `<path d="M10 0H54L64 10V54L54 64H10L0 54V10Z" fill="${INK}"/>` : ''}
<g fill="none">
<circle cx="32" cy="32" r="21" stroke="${RED_DIM}" stroke-width="5.5"/>
<path d="${k.arc}" stroke="${RED}" stroke-width="5.5"/>
<path d="${k.ticks}" stroke="${BONE}" stroke-width="2.4"/>
<path d="${k.hand}" stroke="${BONE}" stroke-width="3.4"/>
</g>
<circle cx="32" cy="32" r="2.8" fill="${BONE}"/>
</svg>
`;
}

writeFileSync(join(ASSETS, 'logo.svg'), logo());
writeFileSync(join(ASSETS, 'logo-mark.svg'), mark(false));
writeFileSync(join(ROOT, 'public', 'favicon.svg'), mark(true));

/* ------------------------------------------------------------------ */
/* Icons: 24 x 24, 2px square-cut strokes, currentColor                */
/* ------------------------------------------------------------------ */
// `s` = stroked paths, `f` = filled paths.
const ICON = {
  // controls
  left: { f: 'M16 4L6 12L16 20Z' },
  right: { f: 'M8 4L18 12L8 20Z' },
  jump: { f: 'M12 3L5 11H9V16H15V11H19Z', s: 'M7 20H17' },
  light: { s: 'M7 9H16L18 11V16L16 18H9L7 16ZM10 9V12M13 9V12M2 11H4.5M2 15H4.5' },
  heavy: { s: 'M9 7H18L21 10V17L18 20H11L9 18ZM12.5 7V11M16 7V11M3 5L6 8M2 12.5H5.5M3 20L6 17' },
  block: { s: 'M12 3L19 6V13L12 21L5 13V6ZM9 10.5L12 13.5L15 10.5' },
  dodge: { s: 'M6 6L12 12L6 18M13 6L19 12L13 18M2 9H3.5M2 15H3.5' },
  special: { f: 'M12 2L14.2 9.2L21 7L16.2 12L21 17L14.2 14.8L12 22L9.8 14.8L3 17L7.8 12L3 7L9.8 9.2Z' },
  pause: { f: 'M6.5 5H10V19H6.5ZM14 5H17.5V19H14Z' },
  // ui
  'sound-on': { s: 'M4 9.5H8L13 5.5V18.5L8 14.5H4ZM16 9L17.6 12L16 15M19 6.5L21.4 12L19 17.5' },
  'sound-off': { s: 'M4 9.5H8L13 5.5V18.5L8 14.5H4ZM16.5 9.5L21.5 14.5M21.5 9.5L16.5 14.5' },
  music: { s: 'M9 17V6L19 4V15', f: 'M5 15H9V19H5ZM15 13H19V17H15Z' },
  keyboard: { s: 'M3 6H21V18H3ZM6.5 10H7.5M10 10H11M13.5 10H14.5M17 10H18M7 14H17' },
  touch: { s: 'M12 12V21M8.5 17.5L12 21L15.5 17.5M7.8 11.2A5 5 0 1 1 16.2 11.2' },
  back: { s: 'M10 5L3 12L10 19M3.5 12H21' },
  check: { s: 'M4 12.5L9.5 18L20 6.5' },
  replay: { s: 'M19 12A7 7 0 1 1 15.5 5.94M15.5 2V6.5H11' },
  home: { s: 'M3 11.5L12 3.5L21 11.5M6 9.5V20H18V9.5' },
  trophy: { s: 'M7.5 4H16.5V10L14.5 14H9.5L7.5 10ZM7.5 6H4V9L7.5 11M16.5 6H20V9L16.5 11M12 14V18M8 20.5H16' },
  clock: { s: 'M12 3L18.4 5.6L21 12L18.4 18.4L12 21L5.6 18.4L3 12L5.6 5.6ZM12 7.5V12L15.5 14' },
  online: { s: 'M4 19H6.5V15H4ZM9.5 19H12V11H9.5ZM15 19H17.5V6H15ZM20.5 19V3' },
  training: { s: 'M12 2V5M8 5H16L17 8V18L15 21H9L7 18V8ZM7.2 11H16.8M7.2 15H16.8' },
  survival: { s: 'M5 19L12 13L19 19M5 13L12 7L19 13M9 5.5L12 3L15 5.5' },
  settings: { s: 'M4 7H20M4 17H20', f: 'M7 4H10V10H7ZM14 14H17V20H14Z' },
  close: { s: 'M5 5L19 19M19 5L5 19' },
  // upgrades
  'up-second-wind': { s: 'M9.5 3.5H14.5V9.5H20.5V14.5H14.5V20.5H9.5V14.5H3.5V9.5H9.5Z' },
  'up-iron-core': { s: 'M12 2.5L20.5 7.2V16.8L12 21.5L3.5 16.8V7.2ZM12 8L15.8 10.2V13.8L12 16L8.2 13.8V10.2Z' },
  'up-heavy-hands': { s: 'M3 9.5V14.5M6 7V17M6 12H18M18 7V17M21 9.5V14.5' },
  'up-quick-feet': { s: 'M4 17H21L20 13.5L14 12.5L11 8.5H7V13.5H4ZM1.5 8H4M1.5 11H3' },
  'up-tight-guard': { s: 'M12 3L19 6V13L12 21L5 13V6ZM12 7.5V16M9 11.5H15' },
  'up-battery': { s: 'M3.5 7.5H18V16.5H3.5ZM18 10H20.5V14H18', f: 'M11.5 8.5L8 12.6H11L10 15.5L13.6 11.4H10.6Z' },
  'up-deep-breath': { s: 'M3 8H13.5A2.75 2.75 0 1 0 10.75 5.25M3 12H19M3 16H15A2.75 2.75 0 1 1 12.25 18.75' },
  'up-closer': { s: 'M12 3L14.6 9L21 9.6L16.2 13.8L17.6 20L12 16.8L6.4 20L7.8 13.8L3 9.6L9.4 9Z' },
};

for (const [name, def] of Object.entries(ICON)) {
  let body = '';
  if (def.f) body += `<path d="${def.f}" fill="currentColor"/>`;
  if (def.s) body += `<path d="${def.s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"/>`;
  writeFileSync(join(ICONS, `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">${body}</svg>\n`);
}

const names = Object.keys(ICON);
const index = `/**
 * Icon set — generated by \`tools/gen-ui-art.mjs\`. Do not edit by hand.
 * Icons inherit \`currentColor\`; size them with CSS.
 */
const raw = import.meta.glob<string>('./*.svg', { query: '?raw', import: 'default', eager: true });

export type IconName =
${names.map((n) => `  | '${n}'`).join('\n')};

export const ICON_NAMES: readonly IconName[] = [
${names.map((n) => `  '${n}',`).join('\n')}
];

export const ICONS = {} as Record<IconName, string>;
for (const name of ICON_NAMES) ICONS[name] = raw[\`./\${name}.svg\`] ?? '';

/** Inline SVG markup for \`name\`, hidden from assistive technology. */
export function icon(name: IconName, className = 'icon'): string {
  const svg = ICONS[name] ?? '';
  return svg.replace('<svg ', \`<svg class="\${className}" aria-hidden="true" focusable="false" \`);
}
`;
writeFileSync(join(ICONS, 'index.ts'), index);
console.log(`logo.svg, logo-mark.svg, favicon.svg and ${names.length} icons written`);
