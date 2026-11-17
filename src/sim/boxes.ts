import { CHARS, MOVES, moveFrames } from './data';
import type { Box, Fighter } from './types';

/** Body box used for both taking hits and pushing the opponent. */
export function hurtbox(f: Readonly<Fighter>): Box {
  const c = CHARS[f.char];
  const half = (c.bodyW * c.scale) / 2;
  let h = c.bodyH * c.scale;
  if (f.state === 'down' || f.state === 'getup') h *= 0.3;
  else if (f.state === 'launch') h *= 0.6;
  else if (f.state === 'dodgeF') h *= 0.7;
  return { x0: f.x - half, x1: f.x + half, y0: f.y, y1: f.y + h };
}

/** True while the fighter's current move has a live hitbox. */
export function isAttackActive(f: Readonly<Fighter>): boolean {
  if (f.state !== 'attack' || !f.move) return false;
  const fr = moveFrames(f.char, f.move);
  return f.t >= fr.startup && f.t < fr.startup + fr.active;
}

/** World-space hitbox of the fighter's current move, or null when inactive. */
export function hitbox(f: Readonly<Fighter>): Box | null {
  if (!isAttackActive(f) || !f.move) return null;
  return moveBox(f);
}

/** World-space box of the current move regardless of timing (debug / AI). */
export function moveBox(f: Readonly<Fighter>): Box | null {
  if (!f.move) return null;
  const c = CHARS[f.char];
  const b = MOVES[f.move].box;
  const xa = f.x + f.facing * b.x0 * c.reach;
  const xb = f.x + f.facing * b.x1 * c.reach;
  return {
    x0: Math.min(xa, xb),
    x1: Math.max(xa, xb),
    y0: f.y + b.y0 * c.scale,
    y1: f.y + b.y1 * c.scale,
  };
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}
