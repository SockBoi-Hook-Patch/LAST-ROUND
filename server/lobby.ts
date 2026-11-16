/**
 * Matchmaking and authoritative match rooms.
 *
 * Transport-agnostic: connections are anything that can `send` a message and
 * be `close`d, so the same code is driven by real WebSockets in production
 * and by plain objects in unit tests.
 *
 * Clients send only a controller mask. The server runs the very same
 * simulation as the single-player game and is the sole source of truth for
 * positions, damage, round results and the winner.
 */
import { MAX_SEP } from '../src/sim/data';
import { createMatch, stepMatch } from '../src/sim/match';
import type { CharId, MatchState } from '../src/sim/types';
import {
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROUNDS_TO_WIN,
  packState,
  parseClientMsg,
} from '../src/net/protocol';
import type { ErrorCode, ServerMsg } from '../src/net/protocol';

export interface Conn {
  send(msg: ServerMsg): void;
  close(): void;
}

interface Player {
  conn: Conn;
  char: CharId;
  room: Room | null;
  /** Latest controller mask received (already validated). */
  input: number;
  /** Rate limiting: messages seen in the current window. */
  msgs: number;
  windowTick: number;
}

type RoomState = 'waiting' | 'playing' | 'between' | 'closed';

interface Room {
  code: string | null;
  players: [Player, Player | null];
  state: RoomState;
  m: MatchState | null;
  round: number;
  wins: [number, number];
  /** Ticks left in the current wait (between rounds / waiting for a guest). */
  wait: number;
}

export interface LobbyOptions {
  /** Random integer in [0, n). Injectable for tests. */
  randomInt?: (n: number) => number;
  maxRooms?: number;
}

const TICKS_PER_SECOND = 60;
/** Pause between rounds so players can read the result. */
const BETWEEN_ROUNDS_TICKS = 2 * TICKS_PER_SECOND;
/** A private room nobody joins is closed after this long. */
const WAITING_ROOM_TICKS = 5 * 60 * TICKS_PER_SECOND;
/** A match never runs longer than this many rounds (draws included). */
const MAX_ROUNDS = 5;
/** Messages allowed per second before a connection is dropped. */
const MAX_MESSAGES_PER_SECOND = 240;

export class Lobby {
  private readonly players = new Map<Conn, Player>();
  private readonly rooms = new Set<Room>();
  private readonly byCode = new Map<string, Room>();
  private queue: Player | null = null;
  private readonly randomInt: (n: number) => number;
  private readonly maxRooms: number;
  private tickNo = 0;

  constructor(opts: LobbyOptions = {}) {
    this.randomInt = opts.randomInt ?? ((n) => Math.floor(Math.random() * n));
    this.maxRooms = opts.maxRooms ?? 500;
  }

  stats(): { players: number; rooms: number; playing: number; queued: number } {
    let playing = 0;
    for (const r of this.rooms) if (r.state === 'playing' || r.state === 'between') playing++;
    return { players: this.players.size, rooms: this.rooms.size, playing, queued: this.queue ? 1 : 0 };
  }

  connect(conn: Conn): void {
    this.players.set(conn, { conn, char: 'switch', room: null, input: 0, msgs: 0, windowTick: this.tickNo });
    conn.send({ t: 'welcome', v: PROTOCOL_VERSION });
  }

  disconnect(conn: Conn): void {
    const p = this.players.get(conn);
    if (!p) return;
    this.players.delete(conn);
    this.detach(p, false);
  }

  /** Handle one raw text message from a client. */
  message(conn: Conn, raw: string): void {
    const p = this.players.get(conn);
    if (!p) return;

    if (this.tickNo - p.windowTick >= TICKS_PER_SECOND) {
      p.windowTick = this.tickNo;
      p.msgs = 0;
    }
    if (++p.msgs > MAX_MESSAGES_PER_SECOND) {
      conn.close();
      return;
    }

    const msg = parseClientMsg(raw);
    if (!msg) {
      this.error(p, 'bad');
      return;
    }
    switch (msg.t) {
      case 'input':
        // Only meaningful inside a running match; otherwise ignored.
        if (p.room && p.room.state === 'playing') p.input = msg.mask;
        return;
      case 'ping':
        conn.send({ t: 'pong', ts: msg.ts });
        return;
      case 'quick':
        if (this.busy(p)) return this.error(p, 'busy');
        p.char = msg.char;
        if (this.queue && this.queue !== p) {
          const other = this.queue;
          this.queue = null;
          if (this.rooms.size >= this.maxRooms) {
            this.error(other, 'busy');
            return this.error(p, 'busy');
          }
          this.startMatch(this.makeRoom(other, p, null));
        } else {
          this.queue = p;
          conn.send({ t: 'queued' });
        }
        return;
      case 'create': {
        if (this.busy(p)) return this.error(p, 'busy');
        if (this.rooms.size >= this.maxRooms) return this.error(p, 'busy');
        p.char = msg.char;
        const code = this.newCode();
        if (!code) return this.error(p, 'busy');
        const room = this.makeRoom(p, null, code);
        room.wait = WAITING_ROOM_TICKS;
        conn.send({ t: 'room', code });
        return;
      }
      case 'join': {
        if (this.busy(p)) return this.error(p, 'busy');
        const room = this.byCode.get(msg.code);
        if (!room || room.state === 'closed') return this.error(p, 'notfound');
        if (room.state !== 'waiting' || room.players[1]) return this.error(p, 'full');
        p.char = msg.char;
        p.room = room;
        room.players[1] = p;
        this.startMatch(room);
        return;
      }
      case 'cancel':
      case 'leave':
        this.detach(p, true);
        return;
    }
  }

  /** Advance every room by one simulation tick. */
  tick(): void {
    this.tickNo++;
    for (const room of this.rooms) {
      switch (room.state) {
        case 'waiting':
          if (--room.wait <= 0) {
            const host = room.players[0];
            this.closeRoom(room);
            host.conn.send({ t: 'idle' });
          }
          break;
        case 'between':
          if (--room.wait <= 0) {
            room.round++;
            this.startRound(room);
          }
          break;
        case 'playing':
          this.stepRoom(room);
          break;
        case 'closed':
          break;
      }
    }
  }

  /* ---------------------------------------------------------------- */

  private busy(p: Player): boolean {
    return p.room !== null || this.queue === p;
  }

  private error(p: Player, code: ErrorCode): void {
    p.conn.send({ t: 'error', code });
  }

  private newCode(): string | null {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[this.randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.byCode.has(code)) return code;
    }
    return null;
  }

  private makeRoom(a: Player, b: Player | null, code: string | null): Room {
    const room: Room = { code, players: [a, b], state: 'waiting', m: null, round: 1, wins: [0, 0], wait: 0 };
    a.room = room;
    if (b) b.room = room;
    this.rooms.add(room);
    if (code) this.byCode.set(code, room);
    return room;
  }

  private closeRoom(room: Room): void {
    room.state = 'closed';
    room.m = null;
    this.rooms.delete(room);
    if (room.code) this.byCode.delete(room.code);
    for (const p of room.players) {
      if (p && p.room === room) {
        p.room = null;
        p.input = 0;
      }
    }
  }

  private startMatch(room: Room): void {
    room.round = 1;
    room.wins = [0, 0];
    this.startRound(room);
  }

  private startRound(room: Room): void {
    const [a, b] = room.players;
    if (!b) return;
    a.input = 0;
    b.input = 0;
    // A mirror match puts the second player in the alternate colours.
    room.m = createMatch({ char: a.char }, { char: b.char, skin: a.char === b.char ? 1 : 0 });
    room.state = 'playing';
    a.conn.send({ t: 'start', you: 0, round: room.round, wins: [room.wins[0], room.wins[1]], state: room.m });
    b.conn.send({ t: 'start', you: 1, round: room.round, wins: [room.wins[0], room.wins[1]], state: room.m });
  }

  private stepRoom(room: Room): void {
    const m = room.m;
    const [a, b] = room.players;
    if (!m || !b) return;
    stepMatch(m, a.input, b.input);

    // Belt and braces: the simulation keeps fighters in bounds, but a state
    // that is somehow corrupt must never be broadcast or kept alive.
    const f0 = m.fighters[0];
    const f1 = m.fighters[1];
    if (!Number.isFinite(f0.x) || !Number.isFinite(f1.x) || Math.abs(f0.x - f1.x) > MAX_SEP + 1) {
      this.finish(room, 2, 'score');
      return;
    }

    const snap: ServerMsg = { t: 's', s: packState(m) };
    a.conn.send(snap);
    b.conn.send(snap);

    if (m.phase !== 'over') return;
    const winner = (m.winner === 0 || m.winner === 1 ? m.winner : 2) as 0 | 1 | 2;
    if (winner !== 2) room.wins[winner]++;
    const wins: [number, number] = [room.wins[0], room.wins[1]];
    a.conn.send({ t: 'round', winner, wins });
    b.conn.send({ t: 'round', winner, wins });

    const decided = wins[0] >= ROUNDS_TO_WIN || wins[1] >= ROUNDS_TO_WIN;
    if (decided || room.round >= MAX_ROUNDS) {
      this.finish(room, wins[0] === wins[1] ? 2 : wins[0] > wins[1] ? 0 : 1, 'score');
    } else {
      room.state = 'between';
      room.wait = BETWEEN_ROUNDS_TICKS;
    }
  }

  private finish(room: Room, winner: 0 | 1 | 2, reason: 'score' | 'forfeit'): void {
    const wins: [number, number] = [room.wins[0], room.wins[1]];
    const players = room.players;
    this.closeRoom(room);
    for (const p of players) {
      if (p && this.players.has(p.conn)) p.conn.send({ t: 'over', winner, reason, wins });
    }
  }

  /** Remove a player from the queue or their room. */
  private detach(p: Player, notifySelf: boolean): void {
    if (this.queue === p) this.queue = null;
    const room = p.room;
    if (room) {
      const idx = room.players[0] === p ? 0 : 1;
      const other = room.players[idx === 0 ? 1 : 0];
      const inMatch = room.state === 'playing' || room.state === 'between';
      this.closeRoom(room);
      if (other && this.players.has(other.conn)) {
        if (inMatch) {
          // Leaving a match in progress forfeits it.
          other.conn.send({ t: 'over', winner: (idx === 0 ? 1 : 0) as 0 | 1, reason: 'forfeit', wins: [room.wins[0], room.wins[1]] });
        } else {
          other.conn.send({ t: 'idle' });
        }
      }
    }
    if (notifySelf && this.players.has(p.conn)) p.conn.send({ t: 'idle' });
  }
}
