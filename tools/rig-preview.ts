/**
 * Dev-only contact sheet of the fighter rig: every state of every fighter,
 * optionally with the simulation's hurt / hit boxes drawn on top.
 */
import { hurtbox, moveBox } from '../src/sim/boxes';
import { CHARS, DODGE_TICKS, GETUP_TICKS, INTRO_TICKS, moveFrames } from '../src/sim/data';
import { createFighter } from '../src/sim/match';
import type { CharId, Fighter, FighterStateId, MoveId } from '../src/sim/types';
import { drawFighter, drawPortrait } from '../src/render/rig';

const params = new URLSearchParams(location.search);
const showBoxes = params.get('boxes') === '1';
const only = params.get('char') as CharId | null;
const skin = Number(params.get('skin') ?? 0);
const chars: CharId[] = only ? [only] : ['kestrel', 'anvil', 'switch', 'pylon', 'conductor'];

interface Cell {
  label: string;
  set: (f: Fighter) => void;
}

function st(state: FighterStateId, t: number, extra?: (f: Fighter) => void): (f: Fighter) => void {
  return (f) => {
    f.state = state;
    f.t = t;
    extra?.(f);
  };
}

function atk(move: MoveId, phase: 'wind' | 'hit' | 'rec'): (f: Fighter) => void {
  return (f) => {
    const fr = moveFrames(f.char, move);
    f.state = 'attack';
    f.move = move;
    f.t = phase === 'wind' ? Math.round(fr.startup * 0.55) : phase === 'hit' ? fr.startup + 1 : fr.startup + fr.active + Math.round(fr.recovery * 0.4);
    if (move === 'AIR') {
      f.y = 70;
      f.vy = -3;
    }
  };
}

const CELLS: Cell[] = [
  { label: 'intro', set: st('intro', 20) },
  { label: 'idle', set: st('idle', 0) },
  { label: 'walkF', set: st('walkF', 5) },
  { label: 'walkF 2', set: st('walkF', 16) },
  { label: 'prejump', set: st('prejump', 3) },
  { label: 'jump rise', set: st('jump', 8, (f) => ((f.y = 80), (f.vy = 8))) },
  { label: 'jump apex', set: st('jump', 18, (f) => ((f.y = 125), (f.vy = 0))) },
  { label: 'jump fall', set: st('jump', 30, (f) => ((f.y = 60), (f.vy = -9))) },
  { label: 'land', set: st('land', 1) },
  { label: 'block', set: st('block', 10) },
  { label: 'blockstun', set: st('blockstun', 1, (f) => ((f.stun = 12), (f.stunTotal = 13))) },
  { label: 'parry', set: st('parry', 3) },
  { label: 'dodgeB', set: st('dodgeB', Math.round(DODGE_TICKS * 0.45)) },
  { label: 'dodgeF', set: st('dodgeF', Math.round(DODGE_TICKS * 0.45)) },
  { label: 'L1 wind', set: atk('L1', 'wind') },
  { label: 'L1 JAB', set: atk('L1', 'hit') },
  { label: 'L2 CROSS', set: atk('L2', 'hit') },
  { label: 'L3 wind', set: atk('L3', 'wind') },
  { label: 'L3 KICK', set: atk('L3', 'hit') },
  { label: 'H wind', set: atk('H', 'wind') },
  { label: 'H HEAVY', set: atk('H', 'hit') },
  { label: 'H rec', set: atk('H', 'rec') },
  { label: 'FIN wind', set: atk('FIN', 'wind') },
  { label: 'FIN', set: atk('FIN', 'hit') },
  { label: 'AIR', set: atk('AIR', 'hit') },
  { label: 'SP wind', set: atk('SP', 'wind') },
  { label: 'SP DASH', set: atk('SP', 'hit') },
  { label: 'hit', set: st('hit', 3, (f) => ((f.stun = 13), (f.stunTotal = 17))) },
  { label: 'hitHeavy', set: st('hitHeavy', 4, (f) => ((f.stun = 20), (f.stunTotal = 25))) },
  { label: 'stagger', set: st('hitHeavy', 14, (f) => ((f.stun = 10), (f.stunTotal = 25))) },
  { label: 'launch', set: st('launch', 9, (f) => ((f.y = 70), (f.vy = 2))) },
  { label: 'launch late', set: st('launch', 22, (f) => ((f.y = 25), (f.vy = -8))) },
  { label: 'down', set: st('down', 30) },
  { label: 'down KO', set: st('down', 60, (f) => (f.hp = 0)) },
  { label: 'getup', set: st('getup', Math.round(GETUP_TICKS * 0.45)) },
  { label: 'getup 2', set: st('getup', Math.round(GETUP_TICKS * 0.75)) },
  { label: 'guardbreak', set: st('guardbreak', 14) },
  { label: 'win', set: st('win', 40) },
  { label: 'lose', set: st('lose', 40) },
  { label: 'intro end', set: st('intro', INTRO_TICKS - 12) },
];

const COLS = 10;
const CW = 150;
const CH = 240;
const GROUND = 205;
const rows = Math.ceil(CELLS.length / COLS);
const blockH = rows * CH + 110;

const canvas = document.getElementById('c') as HTMLCanvasElement;
canvas.width = COLS * CW;
canvas.height = chars.length * blockH;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

function draw(time: number): void {
  ctx.fillStyle = '#1c2235';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  chars.forEach((char, ci) => {
    const top = ci * blockH;
    // Portrait strip.
    ctx.fillStyle = '#0d1019';
    ctx.fillRect(0, top, canvas.width, 100);
    (['neutral', 'win', 'lose'] as const).forEach((mood, mi) => {
      for (let s = 0; s < 3; s++) {
        const box = { x: 10 + (mi * 3 + s) * 100, y: top + 6, w: 88, h: 88 };
        ctx.fillStyle = '#20263a';
        ctx.fillRect(box.x, box.y, box.w, box.h);
        drawPortrait(ctx, char, s, box, { mood, flip: s === 2 });
      }
    });
    ctx.fillStyle = '#ece6d6';
    ctx.font = 'bold 18px monospace';
    ctx.fillText(`${CHARS[char].ringName}  (skin ${skin})`, 930, top + 54);

    CELLS.forEach((cell, i) => {
      const cx = (i % COLS) * CW + CW / 2 - 16;
      const gy = top + 100 + Math.floor(i / COLS) * CH + GROUND;
      ctx.strokeStyle = '#424c6b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo((i % COLS) * CW + 6, gy + 0.5);
      ctx.lineTo((i % COLS) * CW + CW - 6, gy + 0.5);
      ctx.stroke();
      const f = createFighter({ char, skin }, 0, 1);
      f.state = 'idle';
      cell.set(f);
      drawFighter(ctx, f, { x: cx, groundY: gy, time });
      if (showBoxes) {
        const hb = hurtbox(f);
        ctx.strokeStyle = 'rgba(60,216,200,0.9)';
        ctx.strokeRect(cx + hb.x0, gy - hb.y1, hb.x1 - hb.x0, hb.y1 - hb.y0);
        const mb = (f.state as string) === 'attack' ? moveBox(f) : null;
        if (mb) {
          ctx.strokeStyle = 'rgba(242,71,95,0.95)';
          ctx.strokeRect(cx + mb.x0, gy - mb.y1, mb.x1 - mb.x0, mb.y1 - mb.y0);
        }
      }
      ctx.fillStyle = '#a7afc6';
      ctx.font = '11px monospace';
      ctx.fillText(cell.label, (i % COLS) * CW + 8, gy + 22);
    });
  });
}

if (params.get('animate') === '1') {
  const loop = (ms: number): void => {
    draw(ms / 1000);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
} else {
  draw(0);
}
(window as unknown as { __ready: boolean }).__ready = true;
