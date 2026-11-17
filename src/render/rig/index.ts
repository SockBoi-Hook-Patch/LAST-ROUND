/**
 * Procedural fighter renderer: a jointed vector puppet posed straight from
 * the simulation state. No sprite sheets — every frame is drawn from joints.
 */
import { CHARS } from '../../sim/data';
import type { CharId, Fighter } from '../../sim/types';
import { drawFigure, solve } from './draw';
import { LOOKS, SKIN_COUNT, colourway } from './looks';
import { POSE_LEN, PORTRAIT_POSES, SPINE, HEAD, poseFor } from './pose';
import type { Pose } from './pose';

export { SKIN_COUNT };
export { attackPhase } from './pose';

export interface DrawFighterOpts {
  /** Screen-space x of the feet centre (already camera-adjusted and interpolated). */
  x: number;
  /** Screen-space y of the floor line; feet are drawn at groundY - (o.y ?? f.y). */
  groundY: number;
  /** Optional interpolated height override. */
  y?: number;
  /** Seconds, monotonically increasing — drives idle breathing etc. */
  time: number;
  /** 0..1 white impact flash blended over the body. */
  flash?: number;
  /** Draw the soft floor shadow (default true). */
  shadow?: boolean;
  /** Overall opacity (after-images). */
  alpha?: number;
  /** Draw a flat single-colour silhouette instead of the full figure. */
  silhouette?: string;
  reducedMotion?: boolean;
}

const pose: Pose = new Array<number>(POSE_LEN).fill(0);
const style = { facing: 1, flash: 0, silhouette: null as string | null, tailSwing: 0, eyesShut: false };

export function drawFighter(ctx: CanvasRenderingContext2D, f: Readonly<Fighter>, o: DrawFighterOpts): void {
  const look = LOOKS[f.char] ?? LOOKS.switch;
  const def = CHARS[f.char] ?? CHARS.switch;
  const c = colourway(f.char, f.skin);
  const sc = def.scale;
  const y = o.y ?? f.y;

  if (o.shadow !== false && !o.silhouette) {
    // Soft contact shadow: shrinks and fades with height.
    const k = Math.max(0.35, 1 - y / 220);
    ctx.fillStyle = `rgba(2,3,8,${(0.42 * k).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(o.x, o.groundY + 3, 44 * sc * k, 7 * k, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  poseFor(pose, f, o.time, o.reducedMotion === true);
  solve(pose, look.prop);

  style.facing = f.facing;
  style.flash = o.flash ?? 0;
  style.silhouette = o.silhouette ?? null;
  // The pony tail trails behind movement.
  style.tailSwing = Math.max(-45, Math.min(55, -f.vx * f.facing * 7 + f.vy * 2.5));
  style.eyesShut = f.state === 'down' || f.state === 'launch' || f.state === 'hitHeavy';

  ctx.save();
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  ctx.translate(o.x, o.groundY - y);
  ctx.scale(f.facing * sc, -sc);
  drawFigure(ctx, look, c, style);
  ctx.restore();
}

export interface PortraitOpts {
  mood?: 'neutral' | 'win' | 'lose';
  flip?: boolean;
}

const bust: Pose = new Array<number>(POSE_LEN).fill(0);

/** Bust portrait (head + shoulders) fitted into the box. */
export function drawPortrait(
  ctx: CanvasRenderingContext2D,
  char: CharId,
  skin: number,
  box: { x: number; y: number; w: number; h: number },
  opts: PortraitOpts = {},
): void {
  const look = LOOKS[char] ?? LOOKS.switch;
  const c = colourway(char, skin);
  const mood = opts.mood ?? 'neutral';
  const src = PORTRAIT_POSES[mood];
  for (let i = 0; i < POSE_LEN; i++) bust[i] = src[i] as number;
  if (mood === 'neutral') {
    // Hands down so nothing hides the face.
    bust[2] = 8;
    bust[3] = 18;
    bust[4] = 14;
    bust[5] = 24;
    bust[SPINE] = 6;
    bust[HEAD] = -2;
  }
  const j = solve(bust, look.prop);
  const flip = opts.flip ? -1 : 1;
  const s = box.h / (look.prop.head * 2 + 44);

  style.facing = flip;
  style.flash = 0;
  style.silhouette = null;
  style.tailSwing = 0;
  style.eyesShut = false;

  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.translate(box.x + box.w * 0.5 - flip * (j.headX + 3) * s, box.y + box.h * 0.4 + j.headY * s);
  ctx.scale(flip * s, -s);
  drawFigure(ctx, look, c, style);
  ctx.restore();
}

/** UI accent colours of a character colourway. */
export function charLook(char: CharId, skin: number): { accent: string; accentDim: string; ink: string } {
  const c = colourway(char, skin);
  return { accent: c.accent, accentDim: c.accentDim, ink: '#07090f' };
}
