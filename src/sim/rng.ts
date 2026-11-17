/** Small deterministic PRNG (mulberry32). State is a single 32-bit integer. */
export interface Rng {
  seed: number;
}

export function makeRng(seed: number): Rng {
  return { seed: seed >>> 0 || 0x9e3779b9 };
}

/** Next float in [0, 1). */
export function rnd(r: Rng): number {
  r.seed = (r.seed + 0x6d2b79f5) >>> 0;
  let t = r.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [min, max] inclusive. */
export function rndInt(r: Rng, min: number, max: number): number {
  return min + Math.floor(rnd(r) * (max - min + 1));
}

export function pick<T>(r: Rng, items: readonly T[]): T {
  return items[Math.floor(rnd(r) * items.length)] as T;
}

/** In-place Fisher–Yates shuffle. */
export function shuffle<T>(r: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rnd(r) * (i + 1));
    const tmp = items[i] as T;
    items[i] = items[j] as T;
    items[j] = tmp;
  }
  return items;
}
