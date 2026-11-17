/**
 * "Sodium & Neon" — the single palette shared by canvas art, SVG assets and
 * the DOM interface. Night under an elevated rail line: cold blue-black
 * concrete, warm sodium lamps, and a few tired neon tubes.
 *
 * Keep this file and the custom properties in `src/ui/styles.css` in sync.
 */
export const PAL = {
  ink900: '#07090f',
  ink800: '#0d1019',
  ink700: '#141826',
  ink600: '#1c2235',
  steel500: '#2a324b',
  steel400: '#424c6b',
  steel300: '#69738f',
  fog200: '#a7afc6',
  bone100: '#ece6d6',

  /** Player-one accent / cool neon. */
  cyan: '#3cd8c8',
  cyanDim: '#1d7f7b',
  /** Opponent accent / hot neon. */
  red: '#f2475f',
  redDim: '#8c2338',
  /** Sodium lamps, health, highlights. */
  amber: '#f4a63a',
  amberDim: '#9a5f1c',
  violet: '#8f6cf0',
  violetDim: '#4a3691',
  /** Painted hazard markings. */
  hazard: '#e6c13c',
} as const;

/** Logical view height; width varies with the display aspect ratio. */
export const VIEW_H = 540;
export const VIEW_W_MIN = 720;
export const VIEW_W_MAX = 1280;
/** Screen-space y of the arena floor line fighters stand on. */
export const GROUND_Y = 452;
/** Camera limits in world units (art must cover this horizontal range). */
export const CAM_MIN = -100;
export const CAM_MAX = 1300;
