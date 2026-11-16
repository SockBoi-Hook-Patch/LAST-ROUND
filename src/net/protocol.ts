/**
 * Wire protocol of the online 1-v-1 mode, shared by the browser client and
 * the match server.
 *
 * The server is authoritative: clients only ever send their controller mask.
 * Health, positions, hits, round results and the match winner all come from
 * the simulation running on the server.
 */
import { CHARS, PLAYABLE } from '../sim/data';
import type { CharId, Fighter, FighterStateId, MatchPhase, MatchState, MoveId, SimEvent } from '../sim/types';

export const PROTOCOL_VERSION = 1;
/** Rounds needed to win a match (best of three). */
export const ROUNDS_TO_WIN = 2;
/** Largest message a client may send, in bytes. */
export const MAX_CLIENT_MESSAGE = 256;
export const ROOM_CODE_LENGTH = 4;
/** Unambiguous characters for room codes (no 0/O, 1/I). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type ErrorCode = 'bad' | 'notfound' | 'full' | 'busy' | 'version';

export type ClientMsg =
  | { t: 'quick'; char: CharId }
  | { t: 'create'; char: CharId }
  | { t: 'join'; code: string; char: CharId }
  | { t: 'cancel' }
  | { t: 'leave' }
  | { t: 'input'; mask: number }
  | { t: 'ping'; ts: number };

export type OverReason = 'score' | 'forfeit';

export type ServerMsg =
  | { t: 'welcome'; v: number }
  | { t: 'queued' }
  | { t: 'room'; code: string }
  | { t: 'idle' }
  | { t: 'error'; code: ErrorCode }
  | { t: 'start'; you: 0 | 1; round: number; wins: [number, number]; state: MatchState }
  | { t: 's'; s: Snap }
  | { t: 'round'; winner: 0 | 1 | 2; wins: [number, number] }
  | { t: 'over'; winner: 0 | 1 | 2; reason: OverReason; wins: [number, number] }
  | { t: 'pong'; ts: number };

/* ------------------------------------------------------------------ */
/* Compact per-tick snapshots                                          */
/* ------------------------------------------------------------------ */

const STATES: FighterStateId[] = [
  'intro', 'idle', 'walkF', 'walkB', 'prejump', 'jump', 'land', 'block', 'blockstun', 'parry', 'dodgeF', 'dodgeB',
  'attack', 'hit', 'hitHeavy', 'launch', 'down', 'getup', 'guardbreak', 'win', 'lose',
];
const MOVES: (MoveId | null)[] = [null, 'L1', 'L2', 'L3', 'H', 'FIN', 'AIR', 'SP'];
const PHASES: MatchPhase[] = ['intro', 'fight', 'ko', 'timeup', 'over'];

/** One fighter as a flat number array (see `packFighter` for the order). */
export type FighterSnap = number[];

export interface Snap {
  /** tick, phase, phaseT, timer, hitstop, winner */
  h: [number, number, number, number, number, number];
  f: [FighterSnap, FighterSnap];
  /** Simulation events of this tick. */
  e?: SimEvent[];
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function packFighter(f: Readonly<Fighter>): FighterSnap {
  return [
    r2(f.x), r2(f.y), r2(f.vx), r2(f.vy), f.facing,
    STATES.indexOf(f.state), f.t, MOVES.indexOf(f.move), f.moveHit ? 1 : 0, f.moveExtra,
    r2(f.hp), r2(f.guard), r2(f.meter),
    f.stun, f.stunTotal, f.invuln, f.combo, f.comboDmg,
  ];
}

function unpackFighter(f: Fighter, s: FighterSnap): void {
  f.x = s[0] as number;
  f.y = s[1] as number;
  f.vx = s[2] as number;
  f.vy = s[3] as number;
  f.facing = (s[4] as number) < 0 ? -1 : 1;
  f.state = STATES[s[5] as number] ?? 'idle';
  f.t = s[6] as number;
  f.move = MOVES[s[7] as number] ?? null;
  f.moveHit = s[8] === 1;
  f.moveExtra = s[9] as number;
  f.hp = s[10] as number;
  f.guard = s[11] as number;
  f.meter = s[12] as number;
  f.stun = s[13] as number;
  f.stunTotal = s[14] as number;
  f.invuln = s[15] as number;
  f.combo = s[16] as number;
  f.comboDmg = s[17] as number;
}

export function packState(m: Readonly<MatchState>): Snap {
  const snap: Snap = {
    h: [m.tick, PHASES.indexOf(m.phase), m.phaseT, m.timer, m.hitstop, m.winner],
    f: [packFighter(m.fighters[0]), packFighter(m.fighters[1])],
  };
  if (m.events.length) snap.e = m.events.slice();
  return snap;
}

/** Overwrite the dynamic parts of `m` with a snapshot from the server. */
export function applySnap(m: MatchState, snap: Snap): void {
  m.tick = snap.h[0];
  m.phase = PHASES[snap.h[1]] ?? 'fight';
  m.phaseT = snap.h[2];
  m.timer = snap.h[3];
  m.hitstop = snap.h[4];
  m.winner = snap.h[5] as MatchState['winner'];
  unpackFighter(m.fighters[0], snap.f[0]);
  unpackFighter(m.fighters[1], snap.f[1]);
  m.events = snap.e ?? [];
}

/* ------------------------------------------------------------------ */
/* Validation of untrusted client input                                */
/* ------------------------------------------------------------------ */

export function isPlayableChar(v: unknown): v is CharId {
  return typeof v === 'string' && (PLAYABLE as string[]).includes(v) && CHARS[v as CharId].playable;
}

export function normaliseCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const code = v.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** Parse and validate a client message. Returns null for anything malformed. */
export function parseClientMsg(raw: string): ClientMsg | null {
  if (raw.length > MAX_CLIENT_MESSAGE) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  switch (o.t) {
    case 'quick':
    case 'create':
      return isPlayableChar(o.char) ? { t: o.t, char: o.char } : null;
    case 'join': {
      const code = normaliseCode(o.code);
      return code && isPlayableChar(o.char) ? { t: 'join', code, char: o.char } : null;
    }
    case 'cancel':
      return { t: 'cancel' };
    case 'leave':
      return { t: 'leave' };
    case 'input':
      return typeof o.mask === 'number' && Number.isInteger(o.mask) && o.mask >= 0 && o.mask <= 255 ? { t: 'input', mask: o.mask } : null;
    case 'ping':
      return typeof o.ts === 'number' && Number.isFinite(o.ts) ? { t: 'ping', ts: o.ts } : null;
    default:
      return null;
  }
}

/** Accept only ws:// and wss:// endpoints. */
export function validServerUrl(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'ws:' || u.protocol === 'wss:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Minimal sanity check of the match state a server sends at round start. */
export function validStartState(v: unknown): v is MatchState {
  if (!v || typeof v !== 'object') return false;
  const m = v as { fighters?: unknown; timer?: unknown; phase?: unknown };
  if (!Array.isArray(m.fighters) || m.fighters.length !== 2) return false;
  if (typeof m.timer !== 'number' || typeof m.phase !== 'string') return false;
  return m.fighters.every((f) => {
    const x = f as Partial<Fighter> | null;
    return (
      !!x &&
      isPlayableChar(x.char) &&
      typeof x.x === 'number' &&
      typeof x.hp === 'number' &&
      typeof x.maxHp === 'number' &&
      x.maxHp > 0 &&
      typeof x.maxGuard === 'number' &&
      x.maxGuard > 0 &&
      typeof x.mods === 'object' &&
      x.mods !== null
    );
  });
}
