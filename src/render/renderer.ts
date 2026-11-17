/**
 * Canvas renderer: sizes the playfield, follows the fighters with a camera
 * and composes stage, fighters and effects each frame.
 */
import type { MatchState } from '../sim/types';
import { CAM_MAX, CAM_MIN, GROUND_Y, PAL, VIEW_H, VIEW_W_MAX, VIEW_W_MIN } from './palette';
import { drawFighter } from './rig';
import { createStage } from './stage';
import type { Stage } from './stage';
import { Vfx } from './vfx';

export interface FrameOpts {
  /** Stage clock in seconds (frozen while paused). */
  time: number;
  /** 0..1 position between the previous and the current simulation tick. */
  alpha: number;
  /** Fighter positions on the previous tick: x0, y0, x1, y1. */
  prev: ArrayLike<number>;
  /** Impact flash per fighter, 0..1. */
  flash: ArrayLike<number>;
  reducedMotion: boolean;
  /** 0..1 extra darkening of the whole scene (menus over the stage). */
  veil: number;
}

/** Hard cap on backing-store height: plenty sharp, kind to phone GPUs. */
const MAX_PIXEL_H = 1080;

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly vfx = new Vfx();
  readonly stage: Stage;
  /** Logical width of the view; the height is always 540. */
  viewW = 960;
  /** World x of the left edge of the view. */
  camX = 120;

  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly wrap: HTMLElement;
  private scale = 1;
  private frameNo = 0;

  constructor(canvas: HTMLCanvasElement, wrap: HTMLElement, onTrain?: () => void) {
    this.canvas = canvas;
    this.wrap = wrap;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.stage = createStage({ onTrain });
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.resize()).observe(wrap);
    }
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => this.resize());
  }

  /** Match the backing store to the playfield box. */
  resize(): void {
    const cssW = Math.max(1, this.wrap.clientWidth);
    const cssH = Math.max(1, this.wrap.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5, MAX_PIXEL_H / cssH);
    const pxH = Math.max(1, Math.round(cssH * Math.max(dpr, 0.5)));
    const pxW = Math.max(1, Math.round((cssW / cssH) * pxH));
    if (this.canvas.width !== pxW || this.canvas.height !== pxH) {
      this.canvas.width = pxW;
      this.canvas.height = pxH;
    }
    this.scale = pxH / VIEW_H;
    this.viewW = Math.min(VIEW_W_MAX, Math.max(VIEW_W_MIN, pxW / this.scale));
    this.stage.setPixelScale(this.scale);
  }

  private camTarget(m: Readonly<MatchState>): number {
    const mid = (m.fighters[0].x + m.fighters[1].x) / 2;
    return Math.min(CAM_MAX - this.viewW, Math.max(CAM_MIN, mid - this.viewW / 2));
  }

  /** Jump the camera straight to the fighters (start of a round). */
  snapCamera(m: Readonly<MatchState>): void {
    this.camX = this.camTarget(m);
  }

  /** Ease the camera towards the fighters; call once per simulation tick. */
  followCamera(m: Readonly<MatchState>): void {
    this.camX += (this.camTarget(m) - this.camX) * 0.14;
  }

  draw(m: Readonly<MatchState>, o: FrameOpts): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.frameNo++;
    const s = this.scale;
    // Letterbox horizontally if the box is wider than the widest view.
    const offX = Math.max(0, (this.canvas.width / s - this.viewW) / 2);
    ctx.setTransform(s, 0, 0, s, offX * s, 0);
    if (offX > 0) {
      ctx.fillStyle = PAL.ink900;
      ctx.fillRect(-offX, 0, this.viewW + offX * 2, VIEW_H);
    }

    const vfx = this.vfx;
    let shakeX = 0;
    let shakeY = 0;
    if (vfx.shake > 0 && !o.reducedMotion) {
      shakeX = Math.sin(this.frameNo * 12.9898) * vfx.shake;
      shakeY = Math.cos(this.frameNo * 78.233) * vfx.shake * 0.6;
    }
    const cam = Math.min(CAM_MAX - this.viewW, Math.max(CAM_MIN, this.camX));
    const stageOpts = { camX: cam, viewW: this.viewW, time: o.time, reducedMotion: o.reducedMotion };

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.viewW, VIEW_H);
    ctx.clip();
    ctx.translate(shakeX, shakeY);

    this.stage.drawBack(ctx, stageOpts);

    if (vfx.dim > 0) {
      ctx.fillStyle = `rgba(4,5,10,${(vfx.dim * 0.55).toFixed(3)})`;
      ctx.fillRect(-20, -20, this.viewW + 40, VIEW_H + 40);
    }
    vfx.drawRush(ctx, this.viewW, o.time);
    vfx.drawBehind(ctx, cam, o.time);

    // Whoever is striking is drawn on top so the blow reads clearly.
    const [f0, f1] = m.fighters;
    const a = o.alpha;
    const first = f0.state === 'attack' && f1.state !== 'attack' ? 1 : 0;
    for (let n = 0; n < 2; n++) {
      const i = n === 0 ? first : 1 - first;
      const f = i === 0 ? f0 : f1;
      const px = o.prev[i * 2] as number;
      const py = o.prev[i * 2 + 1] as number;
      // Interpolate between ticks; snap on big jumps.
      const jump = Math.abs(f.x - px) > 60;
      const x = jump ? f.x : px + (f.x - px) * a;
      const y = jump ? f.y : py + (f.y - py) * a;
      drawFighter(ctx, f, {
        x: x - cam,
        y,
        groundY: GROUND_Y,
        time: o.time,
        flash: o.flash[i] as number,
        reducedMotion: o.reducedMotion,
      });
    }

    vfx.drawFront(ctx, cam);
    this.stage.drawFront(ctx, stageOpts);
    ctx.restore();

    if (vfx.flash > 0) {
      ctx.globalAlpha = Math.min(1, vfx.flash);
      ctx.fillStyle = vfx.flashColor;
      ctx.fillRect(0, 0, this.viewW, VIEW_H);
      ctx.globalAlpha = 1;
    }
    if (o.veil > 0) {
      ctx.fillStyle = `rgba(7,9,15,${Math.min(1, o.veil).toFixed(3)})`;
      ctx.fillRect(0, 0, this.viewW, VIEW_H);
    }
  }
}
