/**
 * Skeleton solve + vector drawing of a fighter.
 *
 * Everything is drawn in "rig space": origin at the feet, +x forward (the way
 * the fighter faces), +y up. The canvas transform takes care of mirroring.
 */
import type { Colourway, Look, Proportions } from './looks';
import { OUTLINE } from './looks';
import { ARM_F, ARM_N, DX, ELB_F, ELB_N, HEAD, KNEE_F, KNEE_N, LEG_F, LEG_N, LIFT, ROT, SPINE } from './pose';
import type { Pose } from './pose';

const D2R = Math.PI / 180;
const HALF_PI = Math.PI / 2;
/** Outline thickness outside each shape. */
const OW = 1.5;

/** Solved joint positions (rig space). Reused between calls. */
const J = {
  hipX: 0, hipY: 0,
  chestX: 0, chestY: 0,
  headX: 0, headY: 0,
  /** Head axis angle, clockwise from vertical (radians). */
  headA: 0,
  /** Spine axis angle after body rotation (radians). */
  spineA: 0,
  shNX: 0, shNY: 0, elNX: 0, elNY: 0, haNX: 0, haNY: 0,
  shFX: 0, shFY: 0, elFX: 0, elFY: 0, haFX: 0, haFY: 0,
  hpNX: 0, hpNY: 0, knNX: 0, knNY: 0, anNX: 0, anNY: 0, toNX: 0, toNY: 0,
  hpFX: 0, hpFY: 0, knFX: 0, knFY: 0, anFX: 0, anFY: 0, toFX: 0, toFY: 0,
};

export type Joints = typeof J;

/** Rotate a point about the origin, counter-clockwise (y up). */
let rc = 1;
let rs = 0;
function rx(x: number, y: number): number {
  return x * rc - y * rs;
}
function ry(x: number, y: number): number {
  return x * rs + y * rc;
}

function footDir(shinA: number, ankleY: number, rot: number, out: { x: number; y: number }): void {
  // Direction the shin points, and the toe direction perpendicular to it.
  const sx = Math.sin(shinA);
  const sy = -Math.cos(shinA);
  let tx = -sy + sx * 0.75;
  let ty = sx + sy * 0.75;
  const len = Math.hypot(tx, ty) || 1;
  tx /= len;
  ty /= len;
  // A planted foot lies flat; a raised one follows the shin.
  const raised = Math.abs(rot) > 0.3 ? 1 : Math.min(1, Math.max(0, ankleY / 16));
  out.x = 1 + (tx - 1) * raised;
  out.y = ty * raised;
}

const toe = { x: 1, y: 0 };

/**
 * Solve joint positions for `pose`. With `ground` true the figure is shifted
 * so its lowest point rests on y = 0.
 */
export function solve(pose: Pose, p: Proportions): Joints {
  const s = (pose[SPINE] as number) * D2R;
  const rot = (pose[ROT] as number) * D2R;
  rc = Math.cos(rot);
  rs = Math.sin(rot);

  const ux = Math.sin(s);
  const uy = Math.cos(s);

  // Unrotated, hip at the origin.
  const chx = ux * p.torso;
  const chy = uy * p.torso;
  const shx = ux * (p.torso - 6);
  const shy = uy * (p.torso - 6);
  const ha = s + (pose[HEAD] as number) * D2R;
  const hdx = chx + Math.sin(ha) * (p.neck + p.head * 0.82);
  const hdy = chy + Math.cos(ha) * (p.neck + p.head * 0.82);

  J.hipX = 0;
  J.hipY = 0;
  J.chestX = rx(chx, chy);
  J.chestY = ry(chx, chy);
  J.headX = rx(hdx, hdy);
  J.headY = ry(hdx, hdy);
  J.headA = ha - rot;
  J.spineA = s - rot;

  // Arms (angles are absolute: 0 hangs down, 90 points forward).
  const aN = (pose[ARM_N] as number) * D2R;
  const fN = aN + (pose[ELB_N] as number) * D2R;
  const aF = (pose[ARM_F] as number) * D2R;
  const fF = aF + (pose[ELB_F] as number) * D2R;
  let x = shx - 3;
  let y = shy;
  J.shNX = rx(x, y);
  J.shNY = ry(x, y);
  x += Math.sin(aN) * p.upperArm;
  y -= Math.cos(aN) * p.upperArm;
  J.elNX = rx(x, y);
  J.elNY = ry(x, y);
  x += Math.sin(fN) * p.foreArm;
  y -= Math.cos(fN) * p.foreArm;
  J.haNX = rx(x, y);
  J.haNY = ry(x, y);

  x = shx + 4;
  y = shy;
  J.shFX = rx(x, y);
  J.shFY = ry(x, y);
  x += Math.sin(aF) * p.upperArm;
  y -= Math.cos(aF) * p.upperArm;
  J.elFX = rx(x, y);
  J.elFY = ry(x, y);
  x += Math.sin(fF) * p.foreArm;
  y -= Math.cos(fF) * p.foreArm;
  J.haFX = rx(x, y);
  J.haFY = ry(x, y);

  // Legs.
  const lN = (pose[LEG_N] as number) * D2R;
  const sN = lN + (pose[KNEE_N] as number) * D2R;
  const lF = (pose[LEG_F] as number) * D2R;
  const sF = lF + (pose[KNEE_F] as number) * D2R;
  x = -2;
  y = 0;
  J.hpNX = rx(x, y);
  J.hpNY = ry(x, y);
  x += Math.sin(lN) * p.thigh;
  y -= Math.cos(lN) * p.thigh;
  J.knNX = rx(x, y);
  J.knNY = ry(x, y);
  x += Math.sin(sN) * p.shin;
  y -= Math.cos(sN) * p.shin;
  J.anNX = rx(x, y);
  J.anNY = ry(x, y);

  x = 3;
  y = 0;
  J.hpFX = rx(x, y);
  J.hpFY = ry(x, y);
  x += Math.sin(lF) * p.thigh;
  y -= Math.cos(lF) * p.thigh;
  J.knFX = rx(x, y);
  J.knFY = ry(x, y);
  x += Math.sin(sF) * p.shin;
  y -= Math.cos(sF) * p.shin;
  J.anFX = rx(x, y);
  J.anFY = ry(x, y);

  // Find the floor: the lowest point of the figure.
  const footR = p.foot * 0.36;
  let min = Math.min(J.anNY - footR, J.anFY - footR);
  if (Math.abs(rot) > 0.3) {
    min = Math.min(
      min,
      J.hipY - p.hip,
      J.chestY - p.shoulder,
      J.headY - p.head,
      J.knNY - p.legW * 0.42,
      J.knFY - p.legW * 0.42,
    );
  }
  const dy = -min + (pose[LIFT] as number);
  const dx = pose[DX] as number;

  // Toes (need ankle heights relative to the floor).
  footDir(sN - rot, J.anNY - min - footR, rot, toe);
  J.toNX = J.anNX + toe.x * p.foot;
  J.toNY = J.anNY + toe.y * p.foot;
  footDir(sF - rot, J.anFY - min - footR, rot, toe);
  J.toFX = J.anFX + toe.x * p.foot;
  J.toFY = J.anFY + toe.y * p.foot;

  J.hipX += dx; J.hipY += dy;
  J.chestX += dx; J.chestY += dy;
  J.headX += dx; J.headY += dy;
  J.shNX += dx; J.shNY += dy; J.elNX += dx; J.elNY += dy; J.haNX += dx; J.haNY += dy;
  J.shFX += dx; J.shFY += dy; J.elFX += dx; J.elFY += dy; J.haFX += dx; J.haFY += dy;
  J.hpNX += dx; J.hpNY += dy; J.knNX += dx; J.knNY += dy; J.anNX += dx; J.anNY += dy; J.toNX += dx; J.toNY += dy;
  J.hpFX += dx; J.hpFY += dy; J.knFX += dx; J.knFY += dy; J.anFX += dx; J.anFY += dy; J.toFX += dx; J.toFY += dy;
  return J;
}

/* ------------------------------------------------------------------ */
/* Drawing primitives                                                  */
/* ------------------------------------------------------------------ */

type Ctx = CanvasRenderingContext2D;

/** Shadow-side offset in rig space (light comes from the upper left of the screen). */
let shadeX = 0.45;
const shadeY = -0.62;
/** 0..1 blend of every fill towards white. */
let flashK = 0;
/** When set, everything is filled with this flat colour and no outline. */
let flat: string | null = null;

const tintCache = new Map<string, string>();

function col(c: string): string {
  if (flat) return flat;
  if (flashK <= 0.03) return c;
  const q = Math.min(4, Math.max(1, Math.round(flashK * 4)));
  const key = c + q;
  let out = tintCache.get(key);
  if (!out) {
    const n = parseInt(c.slice(1), 16);
    const k = q / 4;
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    out = `rgb(${Math.round(r + (255 - r) * k)},${Math.round(g + (255 - g) * k)},${Math.round(b + (255 - b) * k)})`;
    tintCache.set(key, out);
  }
  return out;
}

function capsule(ctx: Ctx, x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): void {
  const a = Math.atan2(y1 - y0, x1 - x0);
  ctx.beginPath();
  ctx.arc(x0, y0, r0, a + HALF_PI, a - HALF_PI + Math.PI * 2);
  ctx.arc(x1, y1, r1, a - HALF_PI, a + HALF_PI);
  ctx.closePath();
}

function outline(ctx: Ctx): void {
  if (flat) return;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OW * 2;
  ctx.stroke();
}

/** A tapered limb segment with outline, base colour and a shade pass. */
function part(ctx: Ctx, x0: number, y0: number, r0: number, x1: number, y1: number, r1: number, fill: string, shade: string | null): void {
  capsule(ctx, x0, y0, r0, x1, y1, r1);
  outline(ctx);
  ctx.fillStyle = col(fill);
  ctx.fill();
  if (shade && !flat) {
    const k = 0.4;
    capsule(ctx, x0 + shadeX * r0 * k, y0 + shadeY * r0 * k, r0 * 0.56, x1 + shadeX * r1 * k, y1 + shadeY * r1 * k, r1 * 0.56);
    ctx.fillStyle = col(shade);
    ctx.fill();
  }
}

/** A band covering part of a segment (tape, cuffs, boots, shin guards). */
function band(ctx: Ctx, x0: number, y0: number, r0: number, x1: number, y1: number, r1: number, from: number, to: number, fill: string, grow = 1.08): void {
  const ax = x0 + (x1 - x0) * from;
  const ay = y0 + (y1 - y0) * from;
  const bx = x0 + (x1 - x0) * to;
  const by = y0 + (y1 - y0) * to;
  const ra = (r0 + (r1 - r0) * from) * grow;
  const rb = (r0 + (r1 - r0) * to) * grow;
  capsule(ctx, ax, ay, ra, bx, by, rb);
  outline(ctx);
  ctx.fillStyle = col(fill);
  ctx.fill();
}

function disc(ctx: Ctx, x: number, y: number, r: number, fill: string, stroke = true): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (stroke) outline(ctx);
  ctx.fillStyle = col(fill);
  ctx.fill();
}

function line(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, w: number, stroke: string): void {
  if (flat) return;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = col(stroke);
  ctx.lineWidth = w;
  ctx.stroke();
}

/* Local frames: a point given along `f` (forward) and `u` (up the axis). */
let fx = 1;
let fy = 0;
let ux = 0;
let uy = 1;
let ox = 0;
let oy = 0;
function frame(x: number, y: number, axis: number): void {
  ox = x;
  oy = y;
  ux = Math.sin(axis);
  uy = Math.cos(axis);
  fx = uy;
  fy = -ux;
}
function lx(a: number, b: number): number {
  return ox + fx * a + ux * b;
}
function ly(a: number, b: number): number {
  return oy + fy * a + uy * b;
}

function poly(ctx: Ctx, pts: readonly number[], k: number, fill: string, stroke = true): void {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    const a = (pts[i] as number) * k;
    const b = (pts[i + 1] as number) * k;
    if (i === 0) ctx.moveTo(lx(a, b), ly(a, b));
    else ctx.lineTo(lx(a, b), ly(a, b));
  }
  ctx.closePath();
  if (stroke) outline(ctx);
  ctx.fillStyle = col(fill);
  ctx.fill();
}

/* ------------------------------------------------------------------ */
/* Body parts                                                          */
/* ------------------------------------------------------------------ */

function drawArm(ctx: Ctx, look: Look, c: Colourway, near: boolean): void {
  const p = look.prop;
  const sx = near ? J.shNX : J.shFX;
  const sy = near ? J.shNY : J.shFY;
  const ex = near ? J.elNX : J.elFX;
  const ey = near ? J.elNY : J.elFY;
  const hx = near ? J.haNX : J.haFX;
  const hy = near ? J.haNY : J.haFY;
  const r0 = p.armW * 0.54;
  const r1 = p.armW * 0.44;
  const r2 = p.armW * 0.37;
  const dim = near ? 0 : 1;

  let upper = c.skin;
  let upperSh = c.skinShade;
  let fore = c.skin;
  let foreSh = c.skinShade;
  if (look.top === 'windbreaker' || look.top === 'track') {
    upper = fore = c.top;
    upperSh = foreSh = c.topShade;
  } else if (look.top === 'waistcoat') {
    upper = c.legs;
    upperSh = c.legsShade;
  }
  // The far arm sits in the body's shadow.
  if (dim) {
    upper = upperSh;
    fore = foreSh;
  }

  part(ctx, ex, ey, r1, hx, hy, r2, fore, dim ? null : foreSh);
  part(ctx, sx, sy, r0, ex, ey, r1, upper, dim ? null : upperSh);

  if (look.top === 'vest') band(ctx, ex, ey, r1, hx, hy, r2, 0.4, 1, c.hands);
  else if (look.top === 'tank') band(ctx, ex, ey, r1, hx, hy, r2, 0.72, 1, c.hands);
  else if (look.top === 'waistcoat') band(ctx, sx, sy, r0, ex, ey, r1, 0.8, 1, c.top, 1.12);
  else if (look.top === 'track') band(ctx, ex, ey, r1, hx, hy, r2, 0.82, 1, c.trim, 1.06);
  else if (look.top === 'windbreaker') band(ctx, ex, ey, r1, hx, hy, r2, 0.8, 1, c.topShade, 1.1);

  const fr = p.fist * 0.68;
  disc(ctx, hx, hy, fr, dim && c.hands !== c.skin ? c.hands : c.hands);
  if (look.top === 'waistcoat') line(ctx, hx - fr * 0.7, hy, hx + fr * 0.7, hy, 1.6, c.trim);
}

function drawLeg(ctx: Ctx, look: Look, c: Colourway, near: boolean): void {
  const p = look.prop;
  const hx = near ? J.hpNX : J.hpFX;
  const hy = near ? J.hpNY : J.hpFY;
  const kx = near ? J.knNX : J.knFX;
  const ky = near ? J.knNY : J.knFY;
  const ax = near ? J.anNX : J.anFX;
  const ay = near ? J.anNY : J.anFY;
  const tx = near ? J.toNX : J.toFX;
  const ty = near ? J.toNY : J.toFY;
  const loose = look.legs === 'sweats' ? 1.2 : look.legs === 'shorts' ? 1.1 : 1;
  const r0 = p.legW * 0.52 * loose;
  const r1 = p.legW * 0.43 * (look.legs === 'shorts' ? 1 : loose);
  const r2 = p.legW * (look.legs === 'trousers' || look.legs === 'sweats' ? 0.37 : 0.31);
  const dim = !near;

  const cloth = dim ? c.legsShade : c.legs;
  const clothSh = dim ? null : c.legsShade;
  const bare = look.legs === 'shorts';
  const shinFill = bare ? (dim ? c.skinShade : c.skin) : cloth;
  const shinSh = bare ? (dim ? null : c.skinShade) : clothSh;

  // Foot first so the shin overlaps the ankle.
  const footR = p.foot * 0.36;
  const bx = ax - (tx - ax) * 0.32;
  const by = ay - (ty - ay) * 0.32;
  part(ctx, bx, by, footR, tx, ty, footR * 0.78, c.shoes, null);

  part(ctx, kx, ky, r1, ax, ay, r2, shinFill, shinSh);
  if (look.legs === 'shorts') band(ctx, kx, ky, r1, ax, ay, r2, 0.55, 1, c.shoes, 1.14);
  if (look.shinGuards) band(ctx, kx, ky, r1, ax, ay, r2, 0.22, 0.86, dim ? c.topShade : c.top, 1.1);
  if (look.legs === 'joggers') band(ctx, kx, ky, r1, ax, ay, r2, 0.84, 1, c.topShade, 1.12);

  part(ctx, hx, hy, r0, kx, ky, r1, cloth, clothSh);
  if (look.legs === 'track' && near) {
    line(ctx, hx, hy + 1, kx, ky, 2.2, c.trim);
    line(ctx, kx, ky, ax, ay, 2, c.trim);
  }
}

function drawTorso(ctx: Ctx, look: Look, c: Colourway): void {
  const p = look.prop;
  frame(J.hipX, J.hipY, J.spineA);
  const T = p.torso;
  const sh = p.shoulder;

  // Neck.
  part(ctx, lx(0, T - 3), ly(0, T - 3), p.head * 0.4, J.headX, J.headY, p.head * 0.38, c.skin, c.skinShade);

  // Hood resting behind the neck.
  if (look.top === 'vest') disc(ctx, lx(-sh * 0.72, T - 1), ly(-sh * 0.72, T - 1), sh * 0.5, c.topShade);

  // Pelvis in the leg colour, then the torso over it.
  disc(ctx, J.hipX, J.hipY, p.hip * 1.04, c.legs);
  const topY = T - sh * 0.72;
  part(ctx, lx(0, 7), ly(0, 7), p.hip * 0.98, lx(0, topY), ly(0, topY), sh, c.top, c.topShade);

  if (flat) return;
  switch (look.top) {
    case 'track':
      // One diagonal stripe, shoulder to hip.
      line(ctx, lx(-sh * 0.5, T * 0.93), ly(-sh * 0.5, T * 0.93), lx(sh * 0.62, T * 0.3), ly(sh * 0.62, T * 0.3), 5, c.trim);
      line(ctx, lx(-p.hip * 0.8, 6), ly(-p.hip * 0.8, 6), lx(p.hip * 0.85, 6), ly(p.hip * 0.85, 6), 2.4, c.topShade);
      break;
    case 'windbreaker':
      // Raised collar and a zip.
      poly(ctx, [-0.5, 0.93, 0.62, 0.9, 0.86, 1.13, -0.28, 1.17], 1, c.topShade, false);
      line(ctx, lx(sh * 0.78, T * 0.84), ly(sh * 0.78, T * 0.84), lx(p.hip * 0.78, 12), ly(p.hip * 0.78, 12), 1.6, c.trim);
      line(ctx, lx(-p.hip * 0.86, 9), ly(-p.hip * 0.86, 9), lx(p.hip * 0.9, 9), ly(p.hip * 0.9, 9), 3, c.topShade);
      break;
    case 'vest':
      line(ctx, lx(sh * 0.74, T * 0.8), ly(sh * 0.74, T * 0.8), lx(p.hip * 0.8, 10), ly(p.hip * 0.8, 10), 2, c.trim);
      line(ctx, lx(-p.hip * 0.9, 8), ly(-p.hip * 0.9, 8), lx(p.hip * 0.92, 8), ly(p.hip * 0.92, 8), 3, c.topShade);
      break;
    case 'tank':
      line(ctx, lx(sh * 0.3, T * 0.98), ly(sh * 0.3, T * 0.98), lx(sh * 0.84, T * 0.62), ly(sh * 0.84, T * 0.62), 2, c.trim);
      line(ctx, lx(-p.hip * 0.9, 8), ly(-p.hip * 0.9, 8), lx(p.hip * 0.92, 8), ly(p.hip * 0.92, 8), 2.4, c.trim);
      break;
    case 'waistcoat': {
      // Dark shirt at the collar, a trimmed front edge and three buttons.
      line(ctx, lx(sh * 0.2, T * 1.0), ly(sh * 0.2, T * 1.0), lx(sh * 0.86, T * 0.7), ly(sh * 0.86, T * 0.7), 4.5, c.legs);
      line(ctx, lx(sh * 0.88, T * 0.66), ly(sh * 0.88, T * 0.66), lx(p.hip * 0.86, 10), ly(p.hip * 0.86, 10), 1.8, c.trim);
      for (let i = 0; i < 3; i++) {
        const b = T * (0.24 + i * 0.16);
        const a = sh * 0.56 - i * 0.6;
        ctx.beginPath();
        ctx.arc(lx(a, b), ly(a, b), 1.5, 0, Math.PI * 2);
        ctx.fillStyle = col(c.trim);
        ctx.fill();
      }
      break;
    }
  }
}

const FRINGE = [-0.95, 0.12, -1.04, 0.6, -0.62, 1.08, 0.1, 1.24, 0.78, 1.08, 1.3, 0.66, 1.1, 0.26, 0.74, 0.64, 0.2, 0.74, -0.42, 0.56];
const UNDERCUT = [-0.96, 0.14, -0.42, 0.56, -0.3, 0.06, -0.78, -0.24];
const PONY_CAP = [0.86, 0.66, 0.5, 1.02, -0.1, 1.14, -0.7, 0.92, -1.08, 0.36, -1.0, -0.2, -0.55, -0.12, -0.2, 0.42, 0.4, 0.6];
const BEANIE = [1.04, 0.36, 0.96, 0.78, 0.5, 1.14, -0.1, 1.24, -0.74, 1.04, -1.12, 0.5, -1.1, 0.08];
const CAP_HAIR = [-0.98, 0.3, -1.03, -0.24, -0.62, -0.46, -0.44, 0.22];
const CAP_BAND = [-1.12, 0.22, 1.06, 0.36, 1.06, 0.68, -1.12, 0.56];
const CAP_CROWN = [-1.12, 0.56, 1.06, 0.68, 1.22, 1.26, -0.2, 1.42, -1.28, 1.18];
const CAP_VISOR = [0.96, 0.36, 1.88, 0.18, 1.84, 0.34, 1.06, 0.58];
const BEARD = [-0.02, -0.34, 0.36, -0.52, 0.78, -0.44, 1.0, -0.64, 0.84, -1.08, 0.3, -1.2, -0.12, -0.96];
const SHAVED = [0.9, 0.5, 0.56, 0.86, 0, 1.02, -0.56, 0.86, -0.94, 0.4, -0.6, 0.5, 0, 0.66, 0.6, 0.52];
const NOSE = [0.9, 0.06, 1.24, -0.14, 0.94, -0.32];

function drawHead(ctx: Ctx, look: Look, c: Colourway, tailSwing: number, eyesShut: boolean): void {
  const r = look.prop.head;
  frame(J.headX, J.headY, J.headA);

  // Pony tail hangs behind the skull.
  if (look.hair === 'ponytail') {
    const bx = lx(-0.92 * r, 0.52 * r);
    const by = ly(-0.92 * r, 0.52 * r);
    const a = (-150 + tailSwing) * D2R;
    const ex = bx + Math.cos(a) * r * 2.1;
    const ey = by + Math.sin(a) * r * 2.1;
    part(ctx, bx, by, r * 0.36, ex, ey, r * 0.14, c.hair, null);
    disc(ctx, bx, by, r * 0.24, c.trim);
  }
  if (look.hair === 'cap') poly(ctx, CAP_HAIR, r, c.hair);

  // Skull, jaw and nose share one outline.
  const jx = lx(0.22 * r, -0.42 * r);
  const jy = ly(0.22 * r, -0.42 * r);
  if (!flat) {
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = OW * 2;
    ctx.beginPath();
    ctx.arc(J.headX, J.headY, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(jx, jy, r * 0.74, 0, Math.PI * 2);
    ctx.stroke();
  }
  poly(ctx, NOSE, r, c.skin);
  disc(ctx, J.headX, J.headY, r, c.skin, false);
  disc(ctx, jx, jy, r * 0.74, c.skin, false);
  if (!flat) {
    // Ear.
    disc(ctx, lx(-0.3 * r, -0.04 * r), ly(-0.3 * r, -0.04 * r), r * 0.14, c.skinShade, false);
  }

  if (look.beard) {
    poly(ctx, BEARD, r, c.hair, false);
    if (look.hair === 'cap') line(ctx, lx(0.62 * r, -0.36 * r), ly(0.62 * r, -0.36 * r), lx(1.08 * r, -0.5 * r), ly(1.08 * r, -0.5 * r), r * 0.2, c.hair);
  }

  if (!flat) {
    // Eye, brow and mouth: small, but they give the head a direction.
    const ey = eyesShut ? 0.12 : 0.16;
    line(ctx, lx(0.44 * r, ey * r), ly(0.44 * r, ey * r), lx(0.78 * r, 0.12 * r), ly(0.78 * r, 0.12 * r), r * (eyesShut ? 0.1 : 0.17), OUTLINE);
    line(ctx, lx(0.36 * r, 0.38 * r), ly(0.36 * r, 0.38 * r), lx(0.84 * r, 0.27 * r), ly(0.84 * r, 0.27 * r), r * 0.11, OUTLINE);
    if (!look.beard) line(ctx, lx(0.6 * r, -0.52 * r), ly(0.6 * r, -0.52 * r), lx(0.86 * r, -0.5 * r), ly(0.86 * r, -0.5 * r), r * 0.08, OUTLINE);
  }

  switch (look.hair) {
    case 'fringe':
      poly(ctx, UNDERCUT, r, c.skinShade, false);
      poly(ctx, FRINGE, r, c.hair);
      break;
    case 'shaved':
      poly(ctx, SHAVED, r, c.skinShade, false);
      break;
    case 'ponytail':
      poly(ctx, PONY_CAP, r, c.hair);
      break;
    case 'beanie':
      poly(ctx, BEANIE, r, c.hair);
      line(ctx, lx(-1.12 * r, 0.2 * r), ly(-1.12 * r, 0.2 * r), lx(1.06 * r, 0.44 * r), ly(1.06 * r, 0.44 * r), r * 0.3, c.topShade);
      break;
    case 'cap':
      poly(ctx, CAP_CROWN, r, c.legs);
      poly(ctx, CAP_BAND, r, c.trim);
      poly(ctx, CAP_VISOR, r, c.legs);
      disc(ctx, lx(0.82 * r, 0.98 * r), ly(0.82 * r, 0.98 * r), r * 0.15, c.trim, false);
      break;
  }
}

export interface FigureStyle {
  /** 1 or -1: which way the figure faces on screen (for shading). */
  facing: number;
  flash: number;
  /** Flat silhouette colour (after-images), or null for the full drawing. */
  silhouette: string | null;
  tailSwing: number;
  eyesShut: boolean;
}

/**
 * Draw the solved figure. The context must already be transformed into rig
 * space (origin at the feet, y up, x mirrored for left-facing fighters).
 */
export function drawFigure(ctx: Ctx, look: Look, c: Colourway, style: FigureStyle): void {
  shadeX = 0.45 * style.facing;
  flashK = style.flash;
  flat = style.silhouette;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  drawArm(ctx, look, c, false);
  drawLeg(ctx, look, c, false);
  drawTorso(ctx, look, c);
  drawHead(ctx, look, c, style.tailSwing, style.eyesShut);
  drawLeg(ctx, look, c, true);
  drawArm(ctx, look, c, true);

  flashK = 0;
  flat = null;
}
