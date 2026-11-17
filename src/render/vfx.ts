/**
 * Impact effects: bursts of light, dust and shock rings. Everything here is
 * cosmetic and deliberately non-graphic — hits are shown as light and force,
 * never as injury.
 */
import { CHARS, moveFrames } from '../sim/data';
import type { Fighter, MatchState, MoveId, SimEvent, Strength } from '../sim/types';
import { GROUND_Y, PAL } from './palette';
import { charLook, drawFighter } from './rig';

type Kind = 'ray' | 'core' | 'ring' | 'dust' | 'shard' | 'arc';

interface Fx {
  kind: Kind;
  /** World position (x along the floor, y above it). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  rot: number;
  spin: number;
  color: string;
  /** Arc sweep (radians, y-up) and mirror. */
  a0: number;
  a1: number;
  dir: number;
}

interface Ghost {
  f: Fighter;
  life: number;
  max: number;
  color: string;
}

interface PendingArc {
  who: 0 | 1;
  move: MoveId;
  delay: number;
}

const MAX_FX = 180;

const BURST: Record<Strength, { rays: number; size: number; ring: boolean; color: string; hot: string }> = {
  light: { rays: 6, size: 26, ring: false, color: PAL.amber, hot: '#fff3d6' },
  heavy: { rays: 9, size: 40, ring: true, color: PAL.amber, hot: '#fff3d6' },
  finisher: { rays: 12, size: 54, ring: true, color: PAL.red, hot: '#ffe1e5' },
  special: { rays: 16, size: 70, ring: true, color: PAL.cyan, hot: '#ffffff' },
};

/** Swing trails: centre offset, radius and sweep for the arcing moves. */
const ARCS: Partial<Record<MoveId, { cx: number; cy: number; r: number; a0: number; a1: number }>> = {
  L3: { cx: 8, cy: 86, r: 98, a0: -62, a1: 8 },
  H: { cx: 26, cy: 128, r: 88, a0: 96, a1: -6 },
  FIN: { cx: 34, cy: 110, r: 80, a0: -78, a1: 78 },
  AIR: { cx: 0, cy: 62, r: 92, a0: 6, a1: -68 },
};

export class Vfx {
  /** 0..1 full-screen flash and its colour. */
  flash = 0;
  flashColor = '#ffffff';
  /** 0..1 darkening of the scene behind the fighters (overdrive start). */
  dim = 0;
  /** Camera shake amplitude in logical px. */
  shake = 0;
  /** Ticks of horizontal speed lines left. */
  rush = 0;
  rushDir = 1;

  private readonly items: Fx[] = [];
  private readonly ghosts: Ghost[] = [];
  private readonly pending: PendingArc[] = [];
  private n = 0;

  reset(): void {
    this.items.length = 0;
    this.ghosts.length = 0;
    this.pending.length = 0;
    this.flash = 0;
    this.dim = 0;
    this.shake = 0;
    this.rush = 0;
  }

  /** Cheap repeatable pseudo-random so effects need no global RNG. */
  private rnd(): number {
    this.n = (this.n * 1664525 + 1013904223) >>> 0;
    return this.n / 4294967296;
  }

  private add(kind: Kind, x: number, y: number, life: number, size: number, color: string): Fx | null {
    if (this.items.length >= MAX_FX) return null;
    const fx: Fx = { kind, x, y, vx: 0, vy: 0, life, max: life, size, rot: 0, spin: 0, color, a0: 0, a1: 0, dir: 1 };
    this.items.push(fx);
    return fx;
  }

  private burst(x: number, y: number, s: Strength, color?: string): void {
    const b = BURST[s];
    const c = color ?? b.color;
    this.add('core', x, y, 7, b.size * 0.55, b.hot);
    for (let i = 0; i < b.rays; i++) {
      const fx = this.add('ray', x, y, 9 + Math.floor(this.rnd() * 5), b.size * (0.6 + this.rnd() * 0.6), i % 3 === 0 ? b.hot : c);
      if (!fx) break;
      fx.rot = (i / b.rays) * Math.PI * 2 + this.rnd() * 0.5;
    }
    if (b.ring) this.add('ring', x, y, 14, b.size * 1.5, c);
  }

  dust(x: number, dir: number, amount = 4): void {
    for (let i = 0; i < amount; i++) {
      const fx = this.add('dust', x + (this.rnd() - 0.5) * 22, 2 + this.rnd() * 6, 18 + Math.floor(this.rnd() * 10), 6 + this.rnd() * 7, PAL.fog200);
      if (!fx) break;
      fx.vx = dir * (0.6 + this.rnd() * 1.6) + (this.rnd() - 0.5) * 1.2;
      fx.vy = 0.25 + this.rnd() * 0.5;
    }
  }

  /** React to the simulation events of one tick. */
  onEvent(e: SimEvent, m: Readonly<MatchState>, reduced: boolean): void {
    switch (e.type) {
      case 'hit': {
        const att = m.fighters[e.attacker];
        const color = e.strength === 'special' ? charLook(att.char, att.skin).accent : undefined;
        this.burst(e.x, e.y, e.strength, color);
        if (e.counter) this.add('ring', e.x, e.y, 12, 46, PAL.bone100);
        if (e.launch) this.dust(m.fighters[e.attacker === 0 ? 1 : 0].x, att.facing, 3);
        const k = e.strength === 'light' ? 2.5 : e.strength === 'heavy' ? 6 : e.strength === 'finisher' ? 9 : 13;
        if (!reduced) this.shake = Math.max(this.shake, k);
        if (e.strength === 'special') this.flashOut(0.5, '#ffffff', reduced);
        else if (e.strength === 'finisher') this.flashOut(0.22, '#ffe1e5', reduced);
        break;
      }
      case 'block':
        if (e.parry) {
          this.add('ring', e.x, e.y, 16, 74, '#ffffff');
          this.add('ring', e.x, e.y, 11, 44, PAL.cyan);
          this.add('core', e.x, e.y, 8, 26, '#ffffff');
          for (let i = 0; i < 8; i++) {
            const fx = this.add('ray', e.x, e.y, 11, 44, i % 2 ? PAL.cyan : '#ffffff');
            if (fx) fx.rot = (i / 8) * Math.PI * 2;
          }
          this.flashOut(0.18, '#dffcf8', reduced);
        } else {
          this.add('core', e.x, e.y, 5, 13, '#dffcf8');
          for (let i = 0; i < 4; i++) {
            const fx = this.add('ray', e.x, e.y, 7, 18 + this.rnd() * 10, PAL.cyan);
            if (fx) fx.rot = this.rnd() * Math.PI * 2;
          }
          if (!reduced) this.shake = Math.max(this.shake, e.strength === 'light' ? 1 : 2.5);
        }
        break;
      case 'guardbreak':
        this.add('ring', e.x, e.y, 18, 84, PAL.cyan);
        for (let i = 0; i < 12; i++) {
          const fx = this.add('shard', e.x, e.y, 26 + Math.floor(this.rnd() * 10), 6 + this.rnd() * 6, i % 3 === 0 ? PAL.bone100 : PAL.cyan);
          if (!fx) break;
          const a = this.rnd() * Math.PI * 2;
          const sp = 3 + this.rnd() * 5;
          fx.vx = Math.cos(a) * sp;
          fx.vy = Math.sin(a) * sp + 3;
          fx.rot = this.rnd() * 6;
          fx.spin = (this.rnd() - 0.5) * 0.6;
        }
        if (!reduced) this.shake = Math.max(this.shake, 7);
        break;
      case 'jump':
        this.dust(e.x, 0, 3);
        break;
      case 'land':
        this.dust(e.x, 0, e.hard ? 8 : 3);
        if (e.hard && !reduced) this.shake = Math.max(this.shake, 4);
        break;
      case 'dodge':
        this.dust(e.x, -e.dir, 4);
        break;
      case 'special': {
        this.dim = 1;
        this.rush = 26;
        this.rushDir = m.fighters[e.who].facing;
        const c = charLook(m.fighters[e.who].char, m.fighters[e.who].skin).accent;
        this.add('ring', e.x, e.y, 20, 120, c);
        this.add('ring', e.x, e.y, 14, 70, '#ffffff');
        break;
      }
      case 'ko':
        this.add('ring', e.x, e.y, 26, 190, '#ffffff');
        this.add('ring', e.x, e.y, 20, 120, PAL.amber);
        this.flashOut(0.7, '#ffffff', reduced);
        if (!reduced) this.shake = Math.max(this.shake, 14);
        break;
      case 'swing':
        if (ARCS[e.move]) this.pending.push({ who: e.who, move: e.move, delay: moveFrames(m.fighters[e.who].char, e.move).startup });
        break;
      default:
        break;
    }
  }

  private flashOut(k: number, color: string, reduced: boolean): void {
    // Full-screen flashes are kept very mild when motion is reduced.
    const v = reduced ? k * 0.25 : k;
    if (v > this.flash) {
      this.flash = v;
      this.flashColor = color;
    }
  }

  /** Advance one simulation tick. */
  update(m: Readonly<MatchState>): void {
    // Swing trails appear the moment a strike becomes active.
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i] as PendingArc;
      const f = m.fighters[p.who];
      if (f.state !== 'attack' || f.move !== p.move) {
        this.pending.splice(i, 1);
        continue;
      }
      if (m.hitstop > 0) continue;
      if (--p.delay > 0) continue;
      this.pending.splice(i, 1);
      const def = ARCS[p.move];
      if (!def) continue;
      const c = CHARS[f.char];
      const fx = this.add('arc', f.x + f.facing * def.cx * c.reach, f.y + def.cy * c.scale, 8, def.r * c.reach, PAL.bone100);
      if (fx) {
        fx.a0 = (def.a0 * Math.PI) / 180;
        fx.a1 = (def.a1 * Math.PI) / 180;
        fx.dir = f.facing;
      }
    }

    // After-images trail dodges and the overdrive dash.
    if (m.hitstop === 0 && m.tick % 2 === 0) {
      for (const f of m.fighters) {
        const dashing = f.state === 'dodgeF' || f.state === 'dodgeB' || (f.state === 'attack' && f.move === 'SP' && Math.abs(f.vx) > 4);
        if (dashing && this.ghosts.length < 14) {
          this.ghosts.push({ f: { ...f }, life: 9, max: 9, color: charLook(f.char, f.skin).accent });
        }
      }
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i] as Ghost;
      if (--g.life <= 0) this.ghosts.splice(i, 1);
    }

    for (let i = this.items.length - 1; i >= 0; i--) {
      const fx = this.items[i] as Fx;
      fx.life--;
      if (fx.life <= 0) {
        this.items.splice(i, 1);
        continue;
      }
      fx.x += fx.vx;
      fx.y += fx.vy;
      fx.rot += fx.spin;
      if (fx.kind === 'shard') {
        fx.vy -= 0.45;
        if (fx.y < 2) {
          fx.y = 2;
          fx.vy *= -0.3;
          fx.vx *= 0.7;
        }
      } else if (fx.kind === 'dust') {
        fx.vx *= 0.9;
      }
    }

    this.flash *= 0.78;
    if (this.flash < 0.01) this.flash = 0;
    this.dim *= 0.93;
    if (this.dim < 0.02) this.dim = 0;
    this.shake *= 0.84;
    if (this.shake < 0.2) this.shake = 0;
    if (this.rush > 0) this.rush--;
  }

  /** After-images, drawn behind the fighters. */
  drawBehind(ctx: CanvasRenderingContext2D, camX: number, time: number): void {
    for (const g of this.ghosts) {
      drawFighter(ctx, g.f, {
        x: g.f.x - camX,
        groundY: GROUND_Y,
        time,
        shadow: false,
        silhouette: g.color,
        alpha: 0.34 * (g.life / g.max),
      });
    }
  }

  /** Sparks, rings and dust, drawn over the fighters. */
  drawFront(ctx: CanvasRenderingContext2D, camX: number): void {
    ctx.save();
    ctx.lineCap = 'round';
    for (const fx of this.items) {
      const k = fx.life / fx.max;
      const p = 1 - k;
      const x = fx.x - camX;
      const y = GROUND_Y - fx.y;
      switch (fx.kind) {
        case 'core':
          ctx.globalAlpha = k;
          ctx.fillStyle = fx.color;
          ctx.beginPath();
          ctx.arc(x, y, fx.size * (0.5 + p * 0.7), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'ray': {
          const r0 = fx.size * (0.2 + p * 0.9);
          const r1 = fx.size * (0.5 + p * 1.5);
          ctx.globalAlpha = k;
          ctx.strokeStyle = fx.color;
          ctx.lineWidth = 1 + 4 * k;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(fx.rot) * r0, y + Math.sin(fx.rot) * r0);
          ctx.lineTo(x + Math.cos(fx.rot) * r1, y + Math.sin(fx.rot) * r1);
          ctx.stroke();
          break;
        }
        case 'ring':
          ctx.globalAlpha = k * 0.9;
          ctx.strokeStyle = fx.color;
          ctx.lineWidth = 1 + 5 * k;
          ctx.beginPath();
          ctx.ellipse(x, y, fx.size * (0.2 + p * 0.8), fx.size * (0.2 + p * 0.8), 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'dust':
          ctx.globalAlpha = k * 0.34;
          ctx.fillStyle = fx.color;
          ctx.beginPath();
          ctx.arc(x, y, fx.size * (0.6 + p * 1.3), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'shard':
          ctx.globalAlpha = Math.min(1, k * 2);
          ctx.fillStyle = fx.color;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(fx.rot) * fx.size, y + Math.sin(fx.rot) * fx.size);
          ctx.lineTo(x + Math.cos(fx.rot + 2.3) * fx.size * 0.7, y + Math.sin(fx.rot + 2.3) * fx.size * 0.7);
          ctx.lineTo(x + Math.cos(fx.rot + 4) * fx.size * 0.5, y + Math.sin(fx.rot + 4) * fx.size * 0.5);
          ctx.closePath();
          ctx.fill();
          break;
        case 'arc': {
          // A crescent of light following the limb; the tail fades first.
          const steps = 4;
          ctx.strokeStyle = fx.color;
          for (let s = 0; s < steps; s++) {
            const t0 = s / steps;
            const t1 = (s + 1) / steps;
            let b0 = -(fx.a0 + (fx.a1 - fx.a0) * t0);
            let b1 = -(fx.a0 + (fx.a1 - fx.a0) * t1);
            if (fx.dir < 0) {
              b0 = Math.PI - b0;
              b1 = Math.PI - b1;
            }
            ctx.globalAlpha = k * 0.5 * t1;
            ctx.lineWidth = 3 + 9 * t1 * k;
            ctx.beginPath();
            // Canvas angles grow clockwise; sweep the short way round.
            const ccw = fx.dir > 0 ? b1 < b0 : b1 > b0;
            ctx.arc(x, y, fx.size, b0, b1, ccw);
            ctx.stroke();
          }
          break;
        }
      }
    }
    ctx.restore();
  }

  /** Speed lines of the overdrive dash (screen space). */
  drawRush(ctx: CanvasRenderingContext2D, viewW: number, time: number): void {
    if (this.rush <= 0) return;
    const k = Math.min(1, this.rush / 10);
    ctx.save();
    ctx.globalAlpha = 0.3 * k;
    ctx.strokeStyle = PAL.bone100;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const y = 70 + ((i * 53.3) % 400);
      const len = 90 + ((i * 37) % 170);
      const x = ((i * 191 - this.rushDir * time * 2600) % (viewW + 400) + viewW + 400) % (viewW + 400) - 200;
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y);
    }
    ctx.stroke();
    ctx.restore();
  }
}
