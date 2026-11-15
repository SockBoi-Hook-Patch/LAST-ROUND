/**
 * Player settings and records, persisted in localStorage. Storage can be
 * unavailable (private mode, blocked cookies): every access is guarded and
 * the game simply runs with defaults.
 */
import { detectLang } from './i18n';
import type { Lang } from './i18n';

export type MotionPref = 'auto' | 'on' | 'off';

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
  lang: Lang;
  /** 'auto' follows the system's prefers-reduced-motion. */
  motion: MotionPref;
  bestScore: number;
  bestRound: number;
  /** Fighter picked last time. */
  lastChar: string;
}

const KEY = 'last-round:v1';

export function defaultSettings(): Settings {
  return {
    master: 0.8,
    music: 0.55,
    sfx: 0.9,
    muted: false,
    lang: detectLang(),
    motion: 'auto',
    bestScore: 0,
    bestRound: 0,
    lastChar: 'switch',
  };
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/** Merge untrusted stored data over the defaults, field by field. */
export function sanitize(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  return {
    master: num(r.master, d.master, 0, 1),
    music: num(r.music, d.music, 0, 1),
    sfx: num(r.sfx, d.sfx, 0, 1),
    muted: typeof r.muted === 'boolean' ? r.muted : d.muted,
    lang: r.lang === 'en' || r.lang === 'th' ? r.lang : d.lang,
    motion: r.motion === 'on' || r.motion === 'off' || r.motion === 'auto' ? r.motion : d.motion,
    bestScore: Math.floor(num(r.bestScore, 0, 0, 1e9)),
    bestRound: Math.floor(num(r.bestRound, 0, 0, 99)),
    lastChar: typeof r.lastChar === 'string' ? r.lastChar : d.lastChar,
  };
}

export function loadSettings(): Settings {
  try {
    const text = localStorage.getItem(KEY);
    return sanitize(text ? JSON.parse(text) : null);
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}

/** Whether animation should be toned down right now. */
export function reducedMotion(s: Readonly<Settings>): boolean {
  if (s.motion === 'on') return true;
  if (s.motion === 'off') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
