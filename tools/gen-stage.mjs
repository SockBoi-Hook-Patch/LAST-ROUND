/**
 * Authoring script for the stage art of THE UNDERCROFT.
 *
 * The SVG layers in `src/assets/stage/` are original artwork described here as
 * code (so repeated detail such as windows, fence posts and the crowd stays
 * consistent). Run `node tools/gen-stage.mjs` to regenerate them; the output
 * is committed, the game never runs this script.
 *
 * Every layer is 540 units high. `yard`, `crowd-*`, `floor` and `front` are
 * 1400 wide and cover world x -100..1300 (svg x = world x + 100).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'stage');
mkdirSync(OUT, { recursive: true });

/* Palette — keep in sync with src/render/palette.ts */
const P = {
  ink900: '#07090f', ink800: '#0d1019', ink700: '#141826', ink600: '#1c2235',
  steel500: '#2a324b', steel400: '#424c6b', steel300: '#69738f', fog200: '#a7afc6', bone100: '#ece6d6',
  cyan: '#3cd8c8', cyanDim: '#1d7f7b', red: '#f2475f', redDim: '#8c2338',
  amber: '#f4a63a', amberDim: '#9a5f1c', violet: '#8f6cf0', violetDim: '#4a3691', hazard: '#e6c13c',
};

/* Deterministic PRNG so regenerating gives the same art. */
let seed = 20261115;
function rnd() {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rr = (a, b) => a + rnd() * (b - a);
const ri = (a, b) => Math.floor(rr(a, b + 1));
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const f = (n) => Number(n.toFixed(1));

function svg(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n${body}\n</svg>\n`;
}
function save(name, text) {
  writeFileSync(join(OUT, name), text);
  console.log(name.padEnd(14), (text.length / 1024).toFixed(1) + ' KB');
}

/* ------------------------------------------------------------------ */
/* sky.svg — night sky, haze and the far skyline (parallax 0.15)       */
/* ------------------------------------------------------------------ */
function sky() {
  const W = 1400;
  let s = `<defs>
<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${P.ink900}"/><stop offset="0.45" stop-color="#0e1222"/>
<stop offset="0.72" stop-color="#1b1a33"/><stop offset="0.86" stop-color="#2c2238"/><stop offset="1" stop-color="#1a1626"/>
</linearGradient>
<radialGradient id="m" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#f1dcc0" stop-opacity="0.55"/><stop offset="0.3" stop-color="#d9a777" stop-opacity="0.2"/><stop offset="1" stop-color="#d9a777" stop-opacity="0"/></radialGradient>
<filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>
</defs>
<rect width="${W}" height="540" fill="url(#g)"/>
<ellipse cx="1010" cy="170" rx="210" ry="150" fill="url(#m)"/>
<circle cx="1010" cy="170" r="34" fill="#e9d5b8" opacity="0.5"/>
<circle cx="1022" cy="162" r="34" fill="#141829" opacity="0.5"/>
<g filter="url(#b)" opacity="0.55">
<ellipse cx="260" cy="330" rx="330" ry="46" fill="${P.violetDim}"/>
<ellipse cx="900" cy="350" rx="420" ry="40" fill="${P.amberDim}"/>
<ellipse cx="1250" cy="320" rx="200" ry="40" fill="${P.redDim}"/>
</g>`;
  // Stars: a sparse dusting, mostly hidden by the city glow.
  for (let i = 0; i < 70; i++) {
    s += `<rect x="${f(rr(0, W))}" y="${f(rr(60, 250))}" width="1.4" height="1.4" fill="${P.fog200}" opacity="${f(rr(0.15, 0.55))}"/>`;
  }
  // Far skyline: flat, hazy slabs.
  let x = -20;
  let d = `M-20 540`;
  while (x < W + 40) {
    const w = ri(34, 92);
    const top = ri(232, 318);
    d += ` L${x} ${top} L${x + w} ${top}`;
    if (rnd() < 0.3) d += ` L${x + w} ${top + ri(8, 30)}`;
    x += w;
  }
  d += ` L${W + 40} 540 Z`;
  s += `<path d="${d}" fill="#161a2e"/>`;
  // Tiny warm windows.
  for (let i = 0; i < 150; i++) {
    const c = pick(['#b98a52', '#b98a52', '#8f7ea8', '#5f9c9a']);
    s += `<rect x="${f(rr(0, W))}" y="${f(rr(300, 392))}" width="2" height="2.6" fill="${c}" opacity="${f(rr(0.25, 0.7))}"/>`;
  }
  return svg(W, 540, s);
}

/* ------------------------------------------------------------------ */
/* city.svg — nearer buildings with lit windows and signs (parallax .4)*/
/* ------------------------------------------------------------------ */
function city() {
  const W = 1600;
  let s = `<defs>
<filter id="gl" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="7"/></filter>
<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#11152a" stop-opacity="0"/><stop offset="1" stop-color="#11152a" stop-opacity="0.9"/></linearGradient>
</defs>`;
  let x = -30;
  const signs = [];
  while (x < W + 30) {
    const w = ri(96, 190);
    const top = ri(150, 268);
    const body = pick(['#10142a', '#121730', '#0e1226', '#14182e']);
    s += `<rect x="${x}" y="${top}" width="${w}" height="${540 - top}" fill="${body}"/>`;
    // Lit edge facing the moon.
    s += `<rect x="${x + w - 3}" y="${top}" width="3" height="${540 - top}" fill="#232a4a" opacity="0.8"/>`;
    // Roof furniture.
    const roof = rnd();
    if (roof < 0.3) {
      // Water tank on legs.
      const tx = x + ri(14, w - 46);
      s += `<path d="M${tx} ${top} v-10 M${tx + 26} ${top} v-10" stroke="${body}" stroke-width="3"/><rect x="${tx - 3}" y="${top - 34}" width="32" height="24" fill="${body}"/><path d="M${tx - 5} ${top - 34} l18 -9 l18 9 z" fill="${body}"/>`;
    } else if (roof < 0.55) {
      const tx = x + ri(10, w - 20);
      s += `<path d="M${tx} ${top} v-${ri(26, 56)}" stroke="${body}" stroke-width="2"/><rect x="${tx - 1.5}" y="${top - 60}" width="3" height="3" fill="${P.red}" opacity="0.8"/>`;
    } else if (roof < 0.75) {
      s += `<rect x="${x + ri(8, 30)}" y="${top - 12}" width="${ri(24, 50)}" height="12" fill="${body}"/>`;
    }
    // Windows in a grid, mostly dark.
    const cols = Math.floor((w - 16) / 13);
    const rows = Math.floor((400 - top) / 17);
    const lit = pick(['#d9a055', '#d9a055', '#c7b98a', '#6fb7b0', '#9c86d6']);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const roll = rnd();
        if (roll > 0.26) continue;
        const col = roll < 0.03 ? pick(['#6fb7b0', '#9c86d6', '#d67a86']) : lit;
        s += `<rect x="${x + 9 + c * 13}" y="${top + 12 + r * 17}" width="6.5" height="9" fill="${col}" opacity="${f(rr(0.28, 0.8))}"/>`;
      }
    }
    if (w > 130 && rnd() < 0.6) signs.push({ x: x + w / 2, y: top + ri(34, 70) });
    x += w + ri(0, 10);
  }
  // Neon signs on buildings: simple shapes only, soft glow underneath.
  const cols = [P.red, P.cyan, P.violet, P.amber];
  signs.forEach((sg, i) => {
    const c = cols[i % cols.length];
    const kind = i % 4;
    let shape = '';
    if (kind === 0) shape = `<rect x="${sg.x - 26}" y="${sg.y - 9}" width="52" height="18" fill="none" stroke="${c}" stroke-width="2.4"/><path d="M${sg.x - 16} ${sg.y} h32" stroke="${c}" stroke-width="2.4"/>`;
    else if (kind === 1) shape = `<circle cx="${sg.x}" cy="${sg.y}" r="13" fill="none" stroke="${c}" stroke-width="2.6"/><path d="M${sg.x} ${sg.y - 7} v7 l5 4" fill="none" stroke="${c}" stroke-width="2"/>`;
    else if (kind === 2) shape = `<path d="M${sg.x - 5} ${sg.y - 26} v52 M${sg.x + 5} ${sg.y - 26} v52" stroke="${c}" stroke-width="2.6"/>`;
    else shape = `<path d="M${sg.x - 22} ${sg.y + 8} l11 -16 l11 16 l11 -16 l11 16" fill="none" stroke="${c}" stroke-width="2.6"/>`;
    s += `<g opacity="0.55" filter="url(#gl)">${shape.replaceAll('stroke-width="2', 'stroke-width="9')}</g><g opacity="0.85">${shape}</g>`;
  });
  // Ground haze so the city sinks behind the yard.
  s += `<rect y="300" width="${W}" height="240" fill="url(#fade)"/>`;
  // Distant elevated line the train runs on (the train itself is animated in code).
  s += `<rect y="226" width="${W}" height="5" fill="#0b0e1c"/><rect y="231" width="${W}" height="2" fill="#1d2440"/>`;
  for (let px = 30; px < W; px += 118) s += `<rect x="${px}" y="231" width="7" height="200" fill="#0b0e1c"/>`;
  return svg(W, 540, s);
}

/* ------------------------------------------------------------------ */
/* Shared pieces for the yard                                          */
/* ------------------------------------------------------------------ */
const PILLARS = [112, 468, 932, 1288];
const LAMPS = [290, 700, 1110];
const FLOOR_Y = 402;

/** Seven-segment style digit drawn as stencil bars. */
function digit(n, x, y, h, col, op) {
  const w = h * 0.56;
  const t = h * 0.15;
  const segs = {
    a: [x + t, y, w - 2 * t, t], g: [x + t, y + h / 2 - t / 2, w - 2 * t, t], d: [x + t, y + h - t, w - 2 * t, t],
    f: [x, y + t * 0.6, t, h / 2 - t], b: [x + w - t, y + t * 0.6, t, h / 2 - t],
    e: [x, y + h / 2 + t * 0.4, t, h / 2 - t], c: [x + w - t, y + h / 2 + t * 0.4, t, h / 2 - t],
  };
  const on = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abfgcd' }[n];
  let s = '';
  for (const k of on) {
    const [sx, sy, sw, sh] = segs[k];
    s += `<rect x="${f(sx)}" y="${f(sy)}" width="${f(sw)}" height="${f(sh)}" fill="${col}" opacity="${op}"/>`;
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* yard.svg — rail deck, pillars, fence, signs, props (parallax 1)     */
/* ------------------------------------------------------------------ */
function yard() {
  const W = 1400;
  let s = `<defs>
<linearGradient id="pil" x1="0" y1="0" x2="1" y2="0">
<stop offset="0" stop-color="#3a4564"/><stop offset="0.12" stop-color="${P.steel500}"/><stop offset="0.7" stop-color="${P.ink600}"/><stop offset="1" stop-color="${P.ink700}"/>
</linearGradient>
<linearGradient id="pilv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.ink900}" stop-opacity="0.75"/><stop offset="0.3" stop-color="${P.ink900}" stop-opacity="0"/><stop offset="0.8" stop-color="${P.ink900}" stop-opacity="0"/><stop offset="1" stop-color="${P.ink900}" stop-opacity="0.5"/></linearGradient>
<linearGradient id="deck" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#04050a"/><stop offset="1" stop-color="${P.ink800}"/></linearGradient>
<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a2034"/><stop offset="1" stop-color="#10131f"/></linearGradient>
<pattern id="link" width="11" height="11" patternUnits="userSpaceOnUse"><path d="M0 0 L11 11 M11 0 L0 11" stroke="${P.steel300}" stroke-width="0.8" opacity="0.5"/></pattern>
<pattern id="haz" width="20" height="20" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="20" height="20" fill="#16171c"/><rect width="10" height="20" fill="${P.hazard}"/></pattern>
<filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="6"/></filter>
<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2"/></filter>
</defs>`;

  // Low retaining wall behind the fence, with poster rectangles and stains.
  s += `<rect y="340" width="${W}" height="${FLOOR_Y - 340}" fill="url(#wall)"/><rect y="340" width="${W}" height="2.5" fill="${P.steel400}" opacity="0.7"/>`;
  for (let x = 20; x < W; x += ri(60, 150)) {
    const w = ri(18, 34);
    s += `<rect x="${x}" y="${ri(350, 364)}" width="${w}" height="${ri(22, 30)}" fill="${pick(['#252b41', '#2b2538', '#1f2a36', '#33291f'])}" opacity="0.8"/>`;
  }

  // Chain-link fence: mesh, top rail, posts.
  s += `<rect y="258" width="${W}" height="84" fill="url(#link)"/>`;
  s += `<rect y="255" width="${W}" height="4" fill="${P.steel400}"/><rect y="259" width="${W}" height="1.5" fill="${P.ink900}" opacity="0.6"/>`;
  for (let x = 34; x < W; x += 116) {
    s += `<rect x="${x}" y="250" width="5" height="${FLOOR_Y - 250}" fill="${P.steel500}"/><rect x="${x}" y="250" width="1.5" height="${FLOOR_Y - 250}" fill="${P.steel300}" opacity="0.6"/>`;
  }
  // Warning plates wired to the fence (shapes only).
  for (const [x, c] of [[236, P.hazard], [604, P.bone100], [820, P.hazard], [1168, P.bone100]]) {
    s += `<rect x="${x}" y="282" width="34" height="24" fill="#191c26"/><rect x="${x + 2}" y="284" width="30" height="20" fill="none" stroke="${c}" stroke-width="1.6" opacity="0.75"/><path d="M${x + 17} 288 l7 12 h-14 z" fill="${c}" opacity="0.7"/>`;
  }

  // Rail deck overhead: slab, flange, cross girders, conduit.
  s += `<rect width="${W}" height="66" fill="url(#deck)"/>`;
  s += `<rect y="62" width="${W}" height="6" fill="${P.ink600}"/><rect y="68" width="${W}" height="2" fill="${P.steel400}" opacity="0.55"/>`;
  for (let x = 14; x < W; x += 88) {
    s += `<rect x="${x}" y="66" width="20" height="16" fill="${P.ink700}"/><rect x="${x}" y="80" width="20" height="3" fill="${P.steel500}"/>`;
    s += `<circle cx="${x + 5}" cy="72" r="1.3" fill="${P.steel300}" opacity="0.6"/><circle cx="${x + 15}" cy="72" r="1.3" fill="${P.steel300}" opacity="0.6"/>`;
  }
  s += `<path d="M0 44 H${W}" stroke="${P.steel500}" stroke-width="3"/><path d="M0 50 H${W}" stroke="#05060b" stroke-width="2"/>`;
  // Sagging cables.
  for (let x = 0; x < W; x += 233) s += `<path d="M${x} 84 q116 ${ri(22, 40)} 233 0" fill="none" stroke="#05060b" stroke-width="1.8"/>`;

  // Hanging signs between the pillars: dim neon on dark boards.
  const board = (cx, w, h) => `<path d="M${cx - w / 2 + 14} 68 V96 M${cx + w / 2 - 14} 68 V96" stroke="#05060b" stroke-width="3"/><rect x="${cx - w / 2}" y="96" width="${w}" height="${h}" fill="#0a0c14"/><rect x="${cx - w / 2}" y="96" width="${w}" height="${h}" fill="none" stroke="${P.steel500}" stroke-width="2"/>`;
  // Left bay: cyan chevrons pointing to the ring.
  {
    const cx = 290;
    const sh = `<path d="M${cx - 44} 112 l18 18 l-18 18 M${cx - 16} 112 l18 18 l-18 18 M${cx + 12} 112 l18 18 l-18 18" fill="none" stroke="${P.cyan}" stroke-width="5" stroke-linecap="square"/>`;
    s += board(cx, 124, 68) + `<g filter="url(#glow)" opacity="0.55">${sh}</g><g opacity="0.9">${sh}</g>`;
  }
  // Right bay: the circuit's round-clock emblem in red.
  {
    const cx = 1110;
    const cy = 136;
    let ticks = '';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      ticks += `M${f(cx + Math.cos(a) * 20)} ${f(cy + Math.sin(a) * 20)} L${f(cx + Math.cos(a) * 25)} ${f(cy + Math.sin(a) * 25)} `;
    }
    const sh = `<circle cx="${cx}" cy="${cy}" r="30" fill="none" stroke="${P.red}" stroke-width="4.5"/><path d="${ticks}" stroke="${P.red}" stroke-width="2.4"/><path d="M${cx} ${cy} V${cy - 15} M${cx} ${cy} l-9 6" stroke="${P.bone100}" stroke-width="3" stroke-linecap="square"/>`;
    s += board(cx, 96, 80) + `<g filter="url(#glow)" opacity="0.6">${sh}</g><g opacity="0.92">${sh}</g>`;
  }

  // Lamps: cable, shade, hot underside (the light cones are drawn in code).
  for (const x of LAMPS) {
    s += `<path d="M${x} 66 V98" stroke="#05060b" stroke-width="2.5"/><path d="M${x - 24} 112 L${x - 11} 97 H${x + 11} L${x + 24} 112 Z" fill="#0a0c14"/><path d="M${x - 24} 112 L${x - 11} 97 H${x + 11}" fill="none" stroke="${P.steel400}" stroke-width="1.4"/>`;
    s += `<ellipse cx="${x}" cy="113" rx="22" ry="4.5" fill="${P.amber}"/><ellipse cx="${x}" cy="113" rx="12" ry="2.6" fill="#fff0cf"/>`;
    s += `<ellipse cx="${x}" cy="116" rx="46" ry="16" fill="${P.amber}" opacity="0.4" filter="url(#glow)"/>`;
  }

  // Pillars.
  PILLARS.forEach((x, i) => {
    const w = 86;
    const l = x - w / 2;
    // Flared capital meeting the deck.
    s += `<path d="M${l - 22} 66 H${l + w + 22} L${l + w} 112 H${l} Z" fill="${P.ink600}"/><path d="M${l - 22} 66 L${l} 112" stroke="#3a4564" stroke-width="2"/>`;
    s += `<rect x="${l}" y="108" width="${w}" height="${FLOOR_Y - 108 + 12}" fill="url(#pil)"/>`;
    s += `<rect x="${l}" y="108" width="${w}" height="${FLOOR_Y - 108 + 12}" fill="url(#pilv)"/>`;
    // Form-work seams and tie holes.
    for (let y = 150; y < 330; y += 58) {
      s += `<path d="M${l} ${y} H${l + w}" stroke="#0a0c14" stroke-width="1.4" opacity="0.6"/>`;
      s += `<circle cx="${l + 18}" cy="${y + 26}" r="2" fill="#0a0c14" opacity="0.7"/><circle cx="${l + w - 18}" cy="${y + 26}" r="2" fill="#0a0c14" opacity="0.7"/>`;
    }
    // Grime streaks.
    for (let k = 0; k < 4; k++) {
      const gx = l + ri(8, w - 10);
      s += `<rect x="${gx}" y="112" width="${ri(3, 7)}" height="${ri(40, 150)}" fill="#05060b" opacity="${f(rr(0.12, 0.3))}" filter="url(#soft)"/>`;
    }
    // Stencilled bay number.
    const n = 6 + i;
    s += digit(0, l + 21, 176, 44, P.bone100, 0.34) + digit(n % 10, l + 49, 176, 44, P.bone100, 0.34);
    // Hazard-striped plinth.
    s += `<rect x="${l - 5}" y="342" width="${w + 10}" height="${FLOOR_Y - 342 + 12}" fill="url(#haz)"/><rect x="${l - 5}" y="342" width="${w + 10}" height="${FLOOR_Y - 342 + 12}" fill="#05060b" opacity="0.42"/><rect x="${l - 5}" y="342" width="${w + 10}" height="3" fill="${P.hazard}" opacity="0.7"/>`;
    // Cool rim light on the left edge.
    s += `<rect x="${l}" y="112" width="2.5" height="${FLOOR_Y - 112}" fill="${P.cyan}" opacity="0.22"/>`;
  });

  // The ring bell on a bracket (pillar two) — a nod to the title.
  {
    const x = PILLARS[1] + 43;
    s += `<path d="M${x} 250 h26 v10" fill="none" stroke="${P.steel400}" stroke-width="3"/><path d="M${x + 14} 262 q12 -4 24 0 q2 14 6 20 h-36 q4 -6 6 -20z" fill="#8a6a2c"/><path d="M${x + 16} 263 q4 -2 8 -1 q0 12 -3 19 h-9 q3 -6 4 -18z" fill="#c9a04a" opacity="0.8"/><circle cx="${x + 26}" cy="285" r="3" fill="#3b2d12"/>`;
  }

  // Props at the foot of the pillars: drums, crates, tyres.
  const drum = (x, c) => `<rect x="${x}" y="356" width="30" height="48" fill="${c}"/><rect x="${x}" y="356" width="30" height="48" fill="url(#pilv)"/><rect x="${x - 1}" y="368" width="32" height="3" fill="#05060b" opacity="0.5"/><rect x="${x - 1}" y="388" width="32" height="3" fill="#05060b" opacity="0.5"/><rect x="${x}" y="356" width="3" height="48" fill="#fff" opacity="0.08"/>`;
  s += drum(182, '#2f4b55') + drum(216, '#5a2f3a');
  s += drum(1200, '#4b4420');
  s += `<rect x="980" y="368" width="46" height="36" fill="#2a2520"/><path d="M980 368 l46 36 M1026 368 l-46 36" stroke="#15120f" stroke-width="3"/><rect x="980" y="368" width="46" height="36" fill="none" stroke="#3d362e" stroke-width="2.5"/>`;
  s += `<rect x="996" y="340" width="34" height="28" fill="#25211c"/><rect x="996" y="340" width="34" height="28" fill="none" stroke="#3d362e" stroke-width="2.5"/>`;
  for (const [x, y] of [[392, 392], [400, 380], [408, 392]]) s += `<ellipse cx="${x + 14}" cy="${y + 6}" rx="19" ry="7" fill="#0a0b10"/><ellipse cx="${x + 14}" cy="${y + 5}" rx="19" ry="7" fill="none" stroke="#1d2030" stroke-width="2"/>`;

  return svg(W, 540, s);
}

/* ------------------------------------------------------------------ */
/* crowd-a / crowd-b — spectators behind the fence                     */
/* ------------------------------------------------------------------ */
function crowd(which) {
  const W = 1400;
  let s = '';
  let x = which === 0 ? 8 : 26;
  while (x < W) {
    const h = rr(46, 66);
    const w = rr(24, 32);
    const base = FLOOR_Y - 2;
    const top = base - h - rr(8, 26);
    const tone = pick(['#0a0c15', '#0c0f1a', '#0e1220', '#090b13']);
    const rim = pick([P.cyanDim, P.redDim, P.amberDim, P.violetDim]);
    // Shoulders and head; some raise an arm.
    s += `<path d="M${f(x - w / 2)} ${base} v-${f(h * 0.7)} q0 -${f(h * 0.22)} ${f(w / 2)} -${f(h * 0.24)} q${f(w / 2)} ${f(h * 0.02)} ${f(w / 2)} ${f(h * 0.24)} v${f(h * 0.7)}z" fill="${tone}"/>`;
    s += `<circle cx="${f(x)}" cy="${f(top + 6)}" r="${f(rr(8, 10.5))}" fill="${tone}"/>`;
    s += `<path d="M${f(x - 6)} ${f(top + 1)} a9 9 0 0 1 9 -4" fill="none" stroke="${rim}" stroke-width="1.5" opacity="0.7"/>`;
    if (rnd() < 0.22) s += `<path d="M${f(x + w / 2 - 3)} ${f(base - h * 0.8)} l${f(rr(6, 12))} -${f(rr(26, 38))}" stroke="${tone}" stroke-width="6" stroke-linecap="round"/>`;
    x += rr(34, 62);
  }
  return svg(W, 540, s);
}

/* ------------------------------------------------------------------ */
/* floor.svg — wet asphalt, painted ring, reflections                  */
/* ------------------------------------------------------------------ */
function floor() {
  const W = 1400;
  let s = `<defs>
<linearGradient id="fl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2032"/><stop offset="0.35" stop-color="#141827"/><stop offset="1" stop-color="#090b12"/></linearGradient>
<filter id="bl" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9"/></filter>
<filter id="bs" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3"/></filter>
<pattern id="hz" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="skewX(-35)"><rect width="24" height="24" fill="#15161b"/><rect width="12" height="24" fill="${P.hazard}"/></pattern>
</defs>
<rect y="${FLOOR_Y}" width="${W}" height="${540 - FLOOR_Y}" fill="url(#fl)"/>`;
  // Kerb with a worn hazard strip at the back edge.
  s += `<rect y="${FLOOR_Y}" width="${W}" height="7" fill="url(#hz)" opacity="0.55"/><rect y="${FLOOR_Y}" width="${W}" height="1.5" fill="${P.steel300}" opacity="0.5"/><rect y="${FLOOR_Y + 7}" width="${W}" height="2" fill="#05060b" opacity="0.6"/>`;

  // Reflections of the lamps and signs on the wet ground.
  s += `<g filter="url(#bl)">`;
  for (const x of LAMPS) s += `<ellipse cx="${x}" cy="456" rx="170" ry="24" fill="${P.amber}" opacity="0.2"/><rect x="${x - 16}" y="${FLOOR_Y + 8}" width="32" height="70" fill="${P.amber}" opacity="0.14"/>`;
  s += `<rect x="252" y="${FLOOR_Y + 6}" width="76" height="60" fill="${P.cyan}" opacity="0.14"/><rect x="1078" y="${FLOOR_Y + 6}" width="64" height="64" fill="${P.red}" opacity="0.16"/>`;
  s += `</g>`;

  // Seams between concrete slabs, in perspective.
  for (let i = -6; i <= 20; i++) {
    const xt = 700 + (i - 7) * 118;
    const xb = 700 + (i - 7) * 196;
    s += `<path d="M${xt} ${FLOOR_Y + 9} L${xb} 540" stroke="#05060b" stroke-width="1.6" opacity="0.5"/>`;
  }
  for (const y of [430, 476, 524]) s += `<path d="M0 ${y} H${W}" stroke="#05060b" stroke-width="${f(1 + (y - 400) / 90)}" opacity="0.4"/>`;

  // The painted ring: worn, broken paint.
  s += `<ellipse cx="700" cy="462" rx="560" ry="50" fill="none" stroke="${P.bone100}" stroke-width="5" opacity="0.2" stroke-dasharray="150 14 60 9 210 22 40 12"/>`;
  s += `<ellipse cx="700" cy="462" rx="546" ry="47" fill="none" stroke="${P.red}" stroke-width="1.6" opacity="0.28" stroke-dasharray="90 20 230 16"/>`;
  s += `<path d="M700 446 V478 M662 462 H738" stroke="${P.bone100}" stroke-width="3" opacity="0.16"/>`;
  s += `<ellipse cx="700" cy="462" rx="120" ry="11" fill="none" stroke="${P.bone100}" stroke-width="2.5" opacity="0.13" stroke-dasharray="40 10"/>`;

  // Puddles: darker, glossier patches with a bright lip.
  for (const [x, y, rx, ry] of [[410, 498, 120, 12], [930, 512, 150, 13], [1220, 470, 90, 8], [150, 468, 80, 7], [690, 526, 110, 9]]) {
    s += `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#06080e" opacity="0.6"/><ellipse cx="${x}" cy="${y - 1}" rx="${rx - 8}" ry="${ry - 3}" fill="#1f2740" opacity="0.4" filter="url(#bs)"/><path d="M${x - rx + 16} ${y - 2} q${rx - 16} -${ry} ${rx * 1.5} 0" fill="none" stroke="${P.fog200}" stroke-width="1" opacity="0.2"/>`;
  }
  // Grit and cracks.
  for (let i = 0; i < 260; i++) {
    const y = rr(FLOOR_Y + 10, 540);
    s += `<rect x="${f(rr(0, W))}" y="${f(y)}" width="${f(rr(1, 2.6))}" height="1.2" fill="${rnd() < 0.5 ? '#05060b' : P.steel400}" opacity="${f(rr(0.2, 0.55))}"/>`;
  }
  for (let i = 0; i < 7; i++) {
    let x = rr(40, W - 80);
    let y = rr(FLOOR_Y + 20, 530);
    let d = `M${f(x)} ${f(y)}`;
    for (let k = 0; k < 5; k++) {
      x += rr(10, 34);
      y += rr(-5, 5);
      d += ` L${f(x)} ${f(y)}`;
    }
    s += `<path d="${d}" fill="none" stroke="#05060b" stroke-width="1.3" opacity="0.6"/>`;
  }
  // Pillar contact shadows.
  for (const x of PILLARS) s += `<ellipse cx="${x}" cy="${FLOOR_Y + 13}" rx="72" ry="9" fill="#05060b" opacity="0.55" filter="url(#bs)"/>`;
  return svg(W, 540, s);
}

/* ------------------------------------------------------------------ */
/* front.svg — vignette and dark foreground framing                    */
/* ------------------------------------------------------------------ */
function front() {
  const W = 1400;
  const s = `<defs>
<linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#03040a" stop-opacity="0.85"/><stop offset="0.16" stop-color="#03040a" stop-opacity="0"/><stop offset="0.86" stop-color="#03040a" stop-opacity="0"/><stop offset="1" stop-color="#03040a" stop-opacity="0.7"/></linearGradient>
</defs>
<rect width="${W}" height="540" fill="url(#t)"/>
<path d="M0 0 H${W} V14 Q700 30 0 14 Z" fill="#03040a"/>
<path d="M-10 26 q240 58 480 6" fill="none" stroke="#03040a" stroke-width="4"/>
<path d="M880 22 q260 64 540 2" fill="none" stroke="#03040a" stroke-width="5"/>
<path d="M430 18 q230 40 480 4" fill="none" stroke="#03040a" stroke-width="2.5"/>`;
  return svg(W, 540, s);
}

save('sky.svg', sky());
save('city.svg', city());
save('yard.svg', yard());
save('crowd-a.svg', crowd(0));
save('crowd-b.svg', crowd(1));
save('floor.svg', floor());
save('front.svg', front());
