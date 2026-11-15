/**
 * THE UNDERCROFT — the arena under the elevated line.
 *
 * The art lives in hand-authored SVG layers (`src/assets/stage`). Each layer
 * is rasterised once into an offscreen canvas; per frame we only blit those
 * bitmaps with parallax and add a few cheap animated touches (lamp flicker,
 * a buzzing neon sign, the crowd, a passing train, drizzle).
 */
import cityUrl from '../assets/stage/city.svg?url';
import crowdAUrl from '../assets/stage/crowd-a.svg?url';
import crowdBUrl from '../assets/stage/crowd-b.svg?url';
import floorUrl from '../assets/stage/floor.svg?url';
import frontUrl from '../assets/stage/front.svg?url';
import skyUrl from '../assets/stage/sky.svg?url';
import yardUrl from '../assets/stage/yard.svg?url';
import { CAM_MAX, CAM_MIN, GROUND_Y, PAL, VIEW_H } from './palette';

export interface StageDrawOpts {
  /** World x of the left edge of the viewport (CAM_MIN .. CAM_MAX - viewW). */
  camX: number;
  /** Logical viewport width (720..1280); height is always 540. */
  viewW: number;
  /** Seconds, monotonically increasing (frozen while the game is paused). */
  time: number;
  reducedMotion: boolean;
}

export interface Stage {
  /** Resolves when all layers are loaded and rasterised (never rejects). */
  readonly ready: Promise<void>;
  /** Device pixels per logical unit; layers are re-rasterised when it changes a lot. */
  setPixelScale(scale: number): void;
  /** Everything behind the fighters: sky, skyline, structure, crowd, floor. */
  drawBack(ctx: CanvasRenderingContext2D, o: StageDrawOpts): void;
  /** Overlays in front of the fighters: light cones, drizzle, vignette. */
  drawFront(ctx: CanvasRenderingContext2D, o: StageDrawOpts): void;
}

export interface StageOptions {
  /** Called when a train starts crossing the far viaduct (sound / shake). */
  onTrain?: () => void;
}

interface Layer {
  url: string;
  /** Width of the artwork in logical units. */
  w: number;
  parallax: number;
  /** Vertical band of the artwork that is actually used. */
  y0: number;
  y1: number;
  /** Upper limit for this layer's raster scale (soft layers need less). */
  maxScale: number;
  img: HTMLImageElement | null;
  bmp: HTMLCanvasElement | null;
}

function layer(url: string, w: number, parallax: number, y0: number, y1: number, maxScale: number): Layer {
  return { url, w, parallax, y0, y1, maxScale, img: null, bmp: null };
}

/** Positions shared with the artwork (svg x = world x + 100). */
const LAMPS = [290, 700, 1110];
const TRAIN_Y = 226;
const TRAIN_CARS = 7;
const TRAIN_CAR_W = 78;
const TRAIN_SPEED = 250;

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    } catch {
      resolve(null);
    }
  });
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Cheap repeatable noise in 0..1 for flicker. */
function hash(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

export function createStage(opts: StageOptions = {}): Stage {
  const sky = layer(skyUrl, 1400, 0.15, 0, 420, 1);
  const city = layer(cityUrl, 1600, 0.4, 100, 440, 1.25);
  const crowdA = layer(crowdAUrl, 1400, 1, 290, 402, 2);
  const crowdB = layer(crowdBUrl, 1400, 1, 290, 402, 2);
  const yard = layer(yardUrl, 1400, 1, 0, 416, 2);
  const floor = layer(floorUrl, 1400, 1, 400, 540, 2);
  const front = layer(frontUrl, 1400, 1, 0, 540, 0.5);
  const layers = [sky, city, crowdA, crowdB, yard, floor, front];

  let pixelScale = 1;
  let rasterScale = 0;
  let loaded = false;
  let cone: HTMLCanvasElement | null = null;
  let glow: HTMLCanvasElement | null = null;

  /* Train schedule (seconds on the stage clock). */
  let trainStart = -1;
  let nextTrain = 7;
  let trainCount = 0;

  function rasterise(): void {
    const target = Math.min(2, Math.max(1, Math.round(pixelScale * 4) / 4));
    if (!loaded || target === rasterScale) return;
    rasterScale = target;
    for (const l of layers) {
      if (!l.img) continue;
      const s = Math.min(target, l.maxScale);
      try {
        const c = makeCanvas(l.w * s, (l.y1 - l.y0) * s);
        const g = c.getContext('2d');
        if (!g) continue;
        g.drawImage(l.img, 0, -l.y0 * s, l.w * s, VIEW_H * s);
        l.bmp = c;
      } catch {
        l.bmp = null;
      }
    }
  }

  function buildSprites(): void {
    try {
      // Sodium light cone: narrow at the lamp, wide and faint at the floor.
      const c = makeCanvas(260, 190);
      const g = c.getContext('2d');
      if (g) {
        const grad = g.createLinearGradient(0, 0, 0, 190);
        grad.addColorStop(0, 'rgba(244,166,58,0.34)');
        grad.addColorStop(0.5, 'rgba(244,166,58,0.12)');
        grad.addColorStop(1, 'rgba(244,166,58,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(118, 0);
        g.lineTo(142, 0);
        g.lineTo(260, 190);
        g.lineTo(0, 190);
        g.closePath();
        g.fill();
        cone = c;
      }
      const c2 = makeCanvas(96, 96);
      const g2 = c2.getContext('2d');
      if (g2) {
        const rg = g2.createRadialGradient(48, 48, 2, 48, 48, 48);
        rg.addColorStop(0, 'rgba(255,255,255,0.5)');
        rg.addColorStop(0.4, 'rgba(255,255,255,0.14)');
        rg.addColorStop(1, 'rgba(255,255,255,0)');
        g2.fillStyle = rg;
        g2.fillRect(0, 0, 96, 96);
        glow = c2;
      }
    } catch {
      cone = null;
      glow = null;
    }
  }

  const ready: Promise<void> = (async () => {
    if (typeof document === 'undefined') return;
    try {
      const imgs = await Promise.all(layers.map((l) => loadImage(l.url)));
      imgs.forEach((img, i) => {
        (layers[i] as Layer).img = img;
      });
      loaded = true;
      buildSprites();
      rasterise();
    } catch {
      loaded = false;
    }
  })();

  /** Screen x of a layer's left edge, centred so narrow views see its middle. */
  function layerX(l: Layer, o: StageDrawOpts): number {
    const travel = (CAM_MAX - CAM_MIN - o.viewW) * l.parallax;
    const slack = Math.max(0, l.w - (o.viewW + travel)) / 2;
    return -(o.camX - CAM_MIN) * l.parallax - slack;
  }

  function blit(ctx: CanvasRenderingContext2D, l: Layer, o: StageDrawOpts, dy = 0): void {
    if (!l.bmp) return;
    ctx.drawImage(l.bmp, layerX(l, o), l.y0 + dy, l.w, l.y1 - l.y0);
  }

  function drawFallback(ctx: CanvasRenderingContext2D, o: StageDrawOpts): void {
    ctx.fillStyle = PAL.ink800;
    ctx.fillRect(0, 0, o.viewW, VIEW_H);
    ctx.fillStyle = PAL.ink700;
    ctx.fillRect(0, 402, o.viewW, VIEW_H - 402);
    ctx.fillStyle = PAL.steel500;
    ctx.fillRect(0, 402, o.viewW, 2);
  }

  function updateTrain(o: StageDrawOpts): void {
    if (o.reducedMotion) return;
    // The stage clock restarted (new match): start the schedule over.
    if (o.time < trainStart - 0.5 || o.time < nextTrain - 60) {
      trainStart = -1;
      nextTrain = o.time + 6;
    }
    if (trainStart < 0 && o.time >= nextTrain) {
      trainStart = o.time;
      trainCount++;
      try {
        opts.onTrain?.();
      } catch {
        /* a listener must never break rendering */
      }
    }
  }

  function drawTrain(ctx: CanvasRenderingContext2D, o: StageDrawOpts): void {
    if (trainStart < 0 || o.reducedMotion) return;
    const len = TRAIN_CARS * TRAIN_CAR_W;
    const dir = trainCount % 2 === 0 ? 1 : -1;
    const travelled = (o.time - trainStart) * TRAIN_SPEED;
    if (travelled > city.w + len + 40) {
      trainStart = -1;
      nextTrain = o.time + 24 + hash(trainCount * 3.7) * 14;
      return;
    }
    const head = dir === 1 ? -len + travelled : city.w - travelled;
    const base = layerX(city, o);
    for (let i = 0; i < TRAIN_CARS; i++) {
      const x = base + head + i * TRAIN_CAR_W;
      if (x > o.viewW || x + TRAIN_CAR_W < 0) continue;
      ctx.fillStyle = '#0b0e1c';
      ctx.fillRect(x + 1, TRAIN_Y - 20, TRAIN_CAR_W - 3, 20);
      ctx.fillStyle = 'rgba(240,196,128,0.8)';
      for (let w = 0; w < 5; w++) ctx.fillRect(x + 7 + w * 14, TRAIN_Y - 15, 9, 7);
      ctx.fillStyle = 'rgba(60,216,200,0.55)';
      ctx.fillRect(x + 1, TRAIN_Y - 5, TRAIN_CAR_W - 3, 1.5);
    }
  }

  function lampLevel(i: number, o: StageDrawOpts): number {
    if (o.reducedMotion) return 1;
    // A slow breathing shimmer; the last lamp has a failing ballast.
    let k = 0.94 + 0.06 * Math.sin(o.time * 7.3 + i * 2.1);
    if (i === 2) {
      const beat = Math.floor(o.time * 11);
      if (hash(beat * 0.37) > 0.9) k *= 0.45 + hash(beat) * 0.3;
    }
    return k;
  }

  function drawBack(ctx: CanvasRenderingContext2D, o: StageDrawOpts): void {
    try {
      if (!loaded || !yard.bmp) {
        drawFallback(ctx, o);
        return;
      }
      ctx.fillStyle = PAL.ink900;
      ctx.fillRect(0, 0, o.viewW, VIEW_H);
      blit(ctx, sky, o);
      blit(ctx, city, o);
      updateTrain(o);
      drawTrain(ctx, o);
      const bob = o.reducedMotion ? 0 : 1.7;
      blit(ctx, crowdA, o, Math.sin(o.time * 2.3) * bob);
      blit(ctx, crowdB, o, Math.sin(o.time * 2.3 + 2.2) * bob);
      blit(ctx, yard, o);
      blit(ctx, floor, o);

      // The cyan sign buzzes; the reflection on the floor follows it.
      if (glow && !o.reducedMotion) {
        const beat = Math.floor(o.time * 14);
        const dip = hash(beat * 0.61) > 0.86 ? 0.35 : 1;
        const x = layerX(yard, o) + 290;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.16 * dip;
        ctx.drawImage(glow, x - 110, 60, 220, 140);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    } catch {
      /* drawing must never take the game down */
    }
  }

  function drawFront(ctx: CanvasRenderingContext2D, o: StageDrawOpts): void {
    try {
      if (!loaded) return;
      const yx = layerX(yard, o);
      if (cone) {
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < LAMPS.length; i++) {
          const x = yx + (LAMPS[i] as number);
          if (x < -260 || x > o.viewW + 260) continue;
          ctx.globalAlpha = 0.5 * lampLevel(i, o);
          ctx.drawImage(cone, x - 230, 113, 460, GROUND_Y + 34 - 113);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      if (!o.reducedMotion) {
        // Drizzle caught in the lamp light.
        ctx.strokeStyle = 'rgba(167,175,198,0.16)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const span = o.viewW + 80;
        for (let i = 0; i < 34; i++) {
          const x = ((i * 97.3 + o.time * 90) % span) - 40;
          const y = ((i * 57.7 + o.time * (520 + (i % 5) * 46)) % 580) - 20;
          ctx.moveTo(x, y);
          ctx.lineTo(x - 3, y + 12);
        }
        ctx.stroke();
      }
      blit(ctx, front, o);
    } catch {
      /* drawing must never take the game down */
    }
  }

  return {
    ready,
    setPixelScale(scale: number): void {
      if (!Number.isFinite(scale) || scale <= 0) return;
      pixelScale = scale;
      rasterise();
    },
    drawBack,
    drawFront,
  };
}
