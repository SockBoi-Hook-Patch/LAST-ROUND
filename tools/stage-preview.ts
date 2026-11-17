/** Dev-only page: renders the stage with two fighters standing in it. */
import { CAM_MAX, CAM_MIN, GROUND_Y, VIEW_H } from '../src/render/palette';
import { drawFighter } from '../src/render/rig';
import { createStage } from '../src/render/stage';
import { createFighter } from '../src/sim/match';

const q = new URLSearchParams(location.search);
const viewW = Number(q.get('w') ?? 960);
const cam = Number(q.get('cam') ?? 0.5);
const fixedT = q.get('t');
const still = q.get('still') === '1';
const scale = Number(q.get('s') ?? 1);

const canvas = document.getElementById('c') as HTMLCanvasElement;
canvas.width = viewW * scale;
canvas.height = VIEW_H * scale;
canvas.style.width = `${viewW}px`;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
const stage = createStage();
stage.setPixelScale(scale);

const a = createFighter({ char: 'switch' }, 0, 1);
const b = createFighter({ char: 'anvil', skin: 1 }, 0, -1);
a.state = 'idle';
b.state = 'block';
b.t = 10;

function frame(ms: number): void {
  const time = fixedT !== null ? Number(fixedT) : ms / 1000;
  const camX = CAM_MIN + (CAM_MAX - CAM_MIN - viewW) * cam;
  const o = { camX, viewW, time, reducedMotion: still };
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  stage.drawBack(ctx, o);
  const mid = camX + viewW / 2;
  drawFighter(ctx, a, { x: mid - 90 - camX, groundY: GROUND_Y, time });
  drawFighter(ctx, b, { x: mid + 90 - camX, groundY: GROUND_Y, time });
  stage.drawFront(ctx, o);
  if (fixedT === null) requestAnimationFrame(frame);
}

void stage.ready.then(() => {
  frame(0);
  (window as unknown as { __ready: boolean }).__ready = true;
});
