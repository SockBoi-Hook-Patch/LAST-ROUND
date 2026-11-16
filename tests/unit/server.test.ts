import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { startServer } from '../../server/index';
import type { RunningServer } from '../../server/index';
import { Lobby } from '../../server/lobby';
import type { Conn } from '../../server/lobby';
import { CHARS, STAGE_W } from '../../src/sim/data';
import { IN } from '../../src/sim/types';
import type { MatchState } from '../../src/sim/types';
import { applySnap, normaliseCode, packState, parseClientMsg, validServerUrl } from '../../src/net/protocol';
import type { ServerMsg } from '../../src/net/protocol';
import { createMatch, stepMatch } from '../../src/sim/match';

/* ------------------------------------------------------------------ */
/* In-memory connections                                               */
/* ------------------------------------------------------------------ */

class Fake implements Conn {
  inbox: ServerMsg[] = [];
  closed = false;
  send(msg: ServerMsg): void {
    this.inbox.push(msg);
  }
  close(): void {
    this.closed = true;
  }
  last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> | undefined {
    for (let i = this.inbox.length - 1; i >= 0; i--) if (this.inbox[i]!.t === t) return this.inbox[i] as Extract<ServerMsg, { t: T }>;
    return undefined;
  }
  count(t: ServerMsg['t']): number {
    return this.inbox.filter((m) => m.t === t).length;
  }
}

function pair(lobby = new Lobby()): { lobby: Lobby; a: Fake; b: Fake } {
  const a = new Fake();
  const b = new Fake();
  lobby.connect(a);
  lobby.connect(b);
  lobby.message(a, JSON.stringify({ t: 'quick', char: 'switch' }));
  lobby.message(b, JSON.stringify({ t: 'quick', char: 'anvil' }));
  return { lobby, a, b };
}

/** Rebuild the match state a client would hold from what it was sent. */
function clientView(c: Fake): MatchState {
  const start = c.last('start')!;
  const m = JSON.parse(JSON.stringify(start.state)) as MatchState;
  const from = c.inbox.lastIndexOf(start);
  for (const msg of c.inbox.slice(from)) if (msg.t === 's') applySnap(m, msg.s);
  return m;
}

describe('protocol', () => {
  it('accepts well-formed messages and rejects everything else', () => {
    expect(parseClientMsg('{"t":"quick","char":"kestrel"}')).toEqual({ t: 'quick', char: 'kestrel' });
    expect(parseClientMsg('{"t":"join","code":" ab2c ","char":"pylon"}')).toEqual({ t: 'join', code: 'AB2C', char: 'pylon' });
    expect(parseClientMsg('{"t":"input","mask":37}')).toEqual({ t: 'input', mask: 37 });
    for (const bad of [
      '',
      'not json',
      'null',
      '[]',
      '{"t":"quick"}',
      '{"t":"quick","char":"conductor"}',
      '{"t":"quick","char":"godmode"}',
      '{"t":"input","mask":-1}',
      '{"t":"input","mask":256}',
      '{"t":"input","mask":1.5}',
      '{"t":"input","mask":"32"}',
      '{"t":"join","code":"TOOLONG","char":"switch"}',
      '{"t":"join","code":"AB0O","char":"switch"}',
      '{"t":"state","hp":9999}',
      '{"t":"over","winner":0}',
      `{"t":"input","mask":1,"pad":"${'x'.repeat(400)}"}`,
    ]) {
      expect(parseClientMsg(bad), bad.slice(0, 40)).toBeNull();
    }
    expect(normaliseCode('abcd')).toBe('ABCD');
    expect(normaliseCode('ab')).toBeNull();
    expect(validServerUrl('wss://example.com/ws')).toBe('wss://example.com/ws');
    expect(validServerUrl('https://example.com')).toBeNull();
    expect(validServerUrl('javascript:alert(1)')).toBeNull();
  });

  it('snapshots reproduce the server state on the client', () => {
    const server = createMatch({ char: 'kestrel' }, { char: 'pylon' });
    const client = JSON.parse(JSON.stringify(server)) as MatchState;
    for (let n = 0; n < 500; n++) {
      stepMatch(server, (n * 37) & 0xff, (n * 91 + 5) & 0xff);
      applySnap(client, JSON.parse(JSON.stringify(packState(server))));
      expect(client.tick).toBe(server.tick);
      expect(client.phase).toBe(server.phase);
      for (const i of [0, 1] as const) {
        const s = server.fighters[i];
        const c = client.fighters[i];
        expect(c.state).toBe(s.state);
        expect(c.move).toBe(s.move);
        expect(c.t).toBe(s.t);
        expect(c.facing).toBe(s.facing);
        expect(c.x).toBeCloseTo(s.x, 1);
        expect(c.y).toBeCloseTo(s.y, 1);
        expect(c.hp).toBeCloseTo(s.hp, 1);
      }
      expect(client.events).toEqual(server.events);
    }
  });
});

describe('lobby', () => {
  it('pairs two quick-match players and starts an authoritative match', () => {
    const lobby = new Lobby();
    const a = new Fake();
    const b = new Fake();
    lobby.connect(a);
    expect(a.last('welcome')).toBeDefined();
    lobby.message(a, JSON.stringify({ t: 'quick', char: 'switch' }));
    expect(a.last('queued')).toBeDefined();
    expect(lobby.stats().queued).toBe(1);
    lobby.connect(b);
    lobby.message(b, JSON.stringify({ t: 'quick', char: 'anvil' }));
    const sa = a.last('start')!;
    const sb = b.last('start')!;
    expect(sa.you).toBe(0);
    expect(sb.you).toBe(1);
    expect(sa.round).toBe(1);
    expect(sa.state.fighters[0].char).toBe('switch');
    expect(sa.state.fighters[1].char).toBe('anvil');
    expect(sa.state.fighters[1].maxHp).toBe(CHARS.anvil.maxHp);
    expect(lobby.stats()).toMatchObject({ players: 2, rooms: 1, playing: 1, queued: 0 });
  });

  it('broadcasts one snapshot per tick to both players', () => {
    const { lobby, a, b } = pair();
    for (let n = 0; n < 30; n++) lobby.tick();
    expect(a.count('s')).toBe(30);
    expect(b.count('s')).toBe(30);
    expect(a.last('s')!.s.h[0]).toBe(30);
  });

  it('each player only controls their own fighter', () => {
    const { lobby, a, b } = pair();
    for (let n = 0; n < 130; n++) lobby.tick(); // intro
    const before = clientView(a);
    lobby.message(a, JSON.stringify({ t: 'input', mask: IN.RIGHT }));
    for (let n = 0; n < 30; n++) lobby.tick();
    const after = clientView(a);
    expect(after.fighters[0].x).toBeGreaterThan(before.fighters[0].x + 50);
    expect(after.fighters[1].x).toBe(before.fighters[1].x);
    // Player two walks left; player one stops when the key is released.
    lobby.message(a, JSON.stringify({ t: 'input', mask: 0 }));
    lobby.message(b, JSON.stringify({ t: 'input', mask: IN.LEFT }));
    for (let n = 0; n < 30; n++) lobby.tick();
    const later = clientView(b);
    expect(later.fighters[0].x).toBeCloseTo(after.fighters[0].x, 5);
    expect(later.fighters[1].x).toBeLessThan(after.fighters[1].x - 50);
  });

  it('ignores attempts to cheat: clients cannot set health, score or results', () => {
    const { lobby, a, b } = pair();
    for (let n = 0; n < 130; n++) lobby.tick();
    const errorsBefore = a.count('error');
    for (const raw of [
      '{"t":"state","fighters":[{"hp":99999},{"hp":0}]}',
      '{"t":"over","winner":0}',
      '{"t":"round","winner":0,"wins":[2,0]}',
      '{"t":"hit","damage":5000}',
      '{"t":"input","mask":4096}',
    ]) {
      lobby.message(a, raw);
    }
    expect(a.count('error')).toBe(errorsBefore + 5);
    // Extra fields on a valid message are simply dropped.
    lobby.message(a, '{"t":"input","mask":0,"hp":99999,"winner":0}');
    for (let n = 0; n < 60; n++) lobby.tick();
    const m = clientView(b);
    expect(m.fighters[0].hp).toBe(CHARS.switch.maxHp);
    expect(m.fighters[1].hp).toBe(CHARS.anvil.maxHp);
    expect(a.last('over')).toBeUndefined();
    expect(b.last('over')).toBeUndefined();
  });

  it('plays a whole match: the server decides rounds and the winner', () => {
    const { lobby, a, b } = pair();
    let guard = 0;
    // Player one walks in and keeps jabbing; player two never touches the pad.
    while (!a.last('over') && guard++ < 40000) {
      const view = clientView(a);
      const dist = Math.abs(view.fighters[0].x - view.fighters[1].x);
      let mask = dist > 110 ? IN.RIGHT : 0;
      if (dist <= 110 && guard % 12 < 2) mask |= IN.LIGHT;
      lobby.message(a, JSON.stringify({ t: 'input', mask }));
      lobby.tick();
    }
    const over = a.last('over')!;
    expect(over).toBeDefined();
    expect(over.winner).toBe(0);
    expect(over.reason).toBe('score');
    expect(over.wins).toEqual([2, 0]);
    expect(b.last('over')).toEqual(over);
    expect(a.count('round')).toBe(2);
    expect(a.count('start')).toBe(2);
    expect(a.inbox.filter((m) => m.t === 'start').map((m) => (m as Extract<ServerMsg, { t: 'start' }>).round)).toEqual([1, 2]);
    // The room is gone and both players are free to queue again.
    expect(lobby.stats()).toMatchObject({ rooms: 0, playing: 0 });
    lobby.message(a, JSON.stringify({ t: 'quick', char: 'pylon' }));
    expect(a.last('queued')).toBeDefined();
  });

  it('a player who disconnects mid-match forfeits to the other', () => {
    const { lobby, a, b } = pair();
    for (let n = 0; n < 200; n++) lobby.tick();
    lobby.disconnect(a);
    const over = b.last('over')!;
    expect(over.winner).toBe(1);
    expect(over.reason).toBe('forfeit');
    expect(lobby.stats()).toMatchObject({ players: 1, rooms: 0 });
    const snaps = b.count('s');
    for (let n = 0; n < 30; n++) lobby.tick();
    expect(b.count('s')).toBe(snaps);
  });

  it('leaving on purpose also forfeits and frees the leaver', () => {
    const { lobby, a, b } = pair();
    for (let n = 0; n < 50; n++) lobby.tick();
    lobby.message(b, JSON.stringify({ t: 'leave' }));
    expect(a.last('over')).toMatchObject({ winner: 0, reason: 'forfeit' });
    expect(b.last('idle')).toBeDefined();
    lobby.message(b, JSON.stringify({ t: 'quick', char: 'switch' }));
    expect(b.last('queued')).toBeDefined();
  });

  it('private rooms: create, join by code, wrong code, full room', () => {
    const lobby = new Lobby({ randomInt: () => 3 });
    const host = new Fake();
    const guest = new Fake();
    const late = new Fake();
    for (const c of [host, guest, late]) lobby.connect(c);
    lobby.message(host, JSON.stringify({ t: 'create', char: 'kestrel' }));
    const code = host.last('room')!.code;
    expect(code).toBe('DDDD');
    lobby.message(guest, JSON.stringify({ t: 'join', code: 'ZZZZ', char: 'pylon' }));
    expect(guest.last('error')).toEqual({ t: 'error', code: 'notfound' });
    lobby.message(guest, JSON.stringify({ t: 'join', code: code.toLowerCase(), char: 'kestrel' }));
    expect(host.last('start')!.you).toBe(0);
    expect(guest.last('start')!.you).toBe(1);
    // Mirror match: the guest wears the alternate colours.
    expect(guest.last('start')!.state.fighters[1].skin).toBe(1);
    lobby.message(late, JSON.stringify({ t: 'join', code, char: 'anvil' }));
    expect(late.last('error')).toEqual({ t: 'error', code: 'full' });
  });

  it('cancelling leaves the queue or closes the waiting room', () => {
    const lobby = new Lobby();
    const a = new Fake();
    const b = new Fake();
    lobby.connect(a);
    lobby.connect(b);
    lobby.message(a, JSON.stringify({ t: 'quick', char: 'switch' }));
    lobby.message(a, JSON.stringify({ t: 'cancel' }));
    expect(a.last('idle')).toBeDefined();
    lobby.message(b, JSON.stringify({ t: 'quick', char: 'switch' }));
    expect(b.last('start')).toBeUndefined();
    expect(b.last('queued')).toBeDefined();
    lobby.message(b, JSON.stringify({ t: 'cancel' }));
    lobby.message(a, JSON.stringify({ t: 'create', char: 'switch' }));
    const code = a.last('room')!.code;
    lobby.message(a, JSON.stringify({ t: 'cancel' }));
    lobby.message(b, JSON.stringify({ t: 'join', code, char: 'switch' }));
    expect(b.last('error')).toEqual({ t: 'error', code: 'notfound' });
  });

  it('refuses a second queue or room for a player who is already busy', () => {
    const { lobby, a } = pair();
    lobby.message(a, JSON.stringify({ t: 'quick', char: 'switch' }));
    expect(a.last('error')).toEqual({ t: 'error', code: 'busy' });
    lobby.message(a, JSON.stringify({ t: 'create', char: 'switch' }));
    expect(a.count('room')).toBe(0);
  });

  it('closes abandoned waiting rooms', () => {
    const lobby = new Lobby();
    const a = new Fake();
    lobby.connect(a);
    lobby.message(a, JSON.stringify({ t: 'create', char: 'switch' }));
    expect(lobby.stats().rooms).toBe(1);
    for (let n = 0; n < 5 * 60 * 60 + 2; n++) lobby.tick();
    expect(lobby.stats().rooms).toBe(0);
    expect(a.last('idle')).toBeDefined();
  });

  it('drops a connection that floods the server', () => {
    const { lobby, a } = pair();
    for (let n = 0; n < 400; n++) lobby.message(a, '{"t":"input","mask":0}');
    expect(a.closed).toBe(true);
  });

  it('keeps fighters inside the arena whatever the inputs', () => {
    const { lobby, a, b } = pair();
    for (let n = 0; n < 900; n++) {
      lobby.message(a, JSON.stringify({ t: 'input', mask: (n * 73) & 0xff }));
      lobby.message(b, JSON.stringify({ t: 'input', mask: (n * 151 + 9) & 0xff }));
      lobby.tick();
      if (a.last('over')) break;
    }
    const m = clientView(a);
    for (const f of m.fighters) {
      expect(f.x).toBeGreaterThan(0);
      expect(f.x).toBeLessThan(STAGE_W);
      expect(f.hp).toBeGreaterThanOrEqual(0);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Real sockets                                                        */
/* ------------------------------------------------------------------ */

interface Client {
  ws: WebSocket;
  inbox: ServerMsg[];
  wait<T extends ServerMsg['t']>(t: T, ms?: number): Promise<Extract<ServerMsg, { t: T }>>;
  send(msg: unknown): void;
  closed: Promise<number>;
}

function connect(port: number, headers: Record<string, string> = {}): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, { headers });
    const inbox: ServerMsg[] = [];
    const waiters: { t: string; done: (m: ServerMsg) => void }[] = [];
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMsg;
      inbox.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i]!.t === msg.t) waiters.splice(i, 1)[0]!.done(msg);
      }
    });
    const closed = new Promise<number>((res) => ws.on('close', (code) => res(code)));
    ws.on('error', reject);
    ws.on('open', () =>
      resolve({
        ws,
        inbox,
        closed,
        send: (msg) => ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)),
        wait: (t, ms = 5000) =>
          new Promise((res, rej) => {
            const found = inbox.find((m) => m.t === t);
            if (found) return res(found as never);
            const timer = setTimeout(() => rej(new Error(`timed out waiting for "${t}"`)), ms);
            waiters.push({
              t,
              done: (m) => {
                clearTimeout(timer);
                res(m as never);
              },
            });
          }),
      }),
    );
  });
}

describe('match server over WebSocket', () => {
  let srv: RunningServer | null = null;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    await srv?.close();
    srv = null;
  });

  async function open(headers?: Record<string, string>): Promise<Client> {
    const c = await connect(srv!.port, headers);
    sockets.push(c.ws);
    return c;
  }

  it('serves a health endpoint', async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1' });
    const res = await fetch(`http://127.0.0.1:${srv.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, players: 0, rooms: 0 });
    expect((await fetch(`http://127.0.0.1:${srv.port}/nope`)).status).toBe(404);
  });

  it('two real clients are matched, receive snapshots and move their fighters', async () => {
    // Run the simulation clock fast so the intro passes quickly.
    srv = await startServer({ port: 0, host: '127.0.0.1', tickRate: 600 });
    const a = await open();
    const b = await open();
    await a.wait('welcome');
    await b.wait('welcome');
    a.send({ t: 'quick', char: 'switch' });
    await a.wait('queued');
    b.send({ t: 'quick', char: 'pylon' });
    const sa = await a.wait('start');
    const sb = await b.wait('start');
    expect([sa.you, sb.you]).toEqual([0, 1]);
    const x0 = sa.state.fighters[0].x;

    a.send({ t: 'input', mask: IN.RIGHT });
    // Wait until the server reports the fighter has walked.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('fighter never moved')), 8000);
      const poll = setInterval(() => {
        const last = [...b.inbox].reverse().find((m) => m.t === 's') as Extract<ServerMsg, { t: 's' }> | undefined;
        if (last && (last.s.f[0][0] as number) > x0 + 60) {
          clearInterval(poll);
          clearTimeout(timer);
          resolve();
        }
      }, 20);
    });

    a.send({ t: 'ping', ts: 1234 });
    expect((await a.wait('pong')).ts).toBe(1234);

    // Dropping the socket forfeits the match to the remaining player.
    a.ws.terminate();
    const over = await b.wait('over');
    expect(over).toMatchObject({ winner: 1, reason: 'forfeit' });
    const health = (await (await fetch(`http://127.0.0.1:${srv.port}/health`)).json()) as { rooms: number };
    expect(health.rooms).toBe(0);
  });

  it('rejects malformed, binary and oversized messages without crashing', async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1' });
    const a = await open();
    await a.wait('welcome');
    a.send('this is not json');
    expect((await a.wait('error')).code).toBe('bad');
    // Binary frames are refused.
    const b = await open();
    await b.wait('welcome');
    b.ws.send(Buffer.from([1, 2, 3]));
    expect(await b.closed).toBe(1003);
    // Oversized frames close the socket (ws enforces maxPayload).
    const c = await open();
    await c.wait('welcome');
    c.send('x'.repeat(5000));
    expect(await c.closed).toBe(1009);
    // The server is still healthy for everyone else.
    a.send({ t: 'quick', char: 'anvil' });
    await a.wait('queued');
  });

  it('enforces the allowed origin list', async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', allowedOrigins: ['https://play.example'] });
    await expect(connect(srv.port, { Origin: 'https://evil.example' })).rejects.toThrow(/403/);
    const ok = await open({ Origin: 'https://play.example' });
    await ok.wait('welcome');
  });
});
