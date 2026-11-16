/**
 * LAST ROUND match server: HTTP health endpoint + WebSocket transport around
 * the lobby. Configuration comes from environment variables only — there are
 * no secrets in this service.
 *
 *   PORT             port to listen on (default 8787)
 *   HOST             interface to bind (default 0.0.0.0)
 *   ALLOWED_ORIGINS  comma-separated list of web origins allowed to connect,
 *                    e.g. "https://example.github.io". Empty = any origin.
 *   MAX_CONNECTIONS  connection cap (default 400)
 */
import { randomInt } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { MAX_CLIENT_MESSAGE } from '../src/net/protocol';
import type { ServerMsg } from '../src/net/protocol';
import { Lobby } from './lobby';
import type { Conn } from './lobby';

export interface ServerOptions {
  port?: number;
  host?: string;
  allowedOrigins?: string[];
  maxConnections?: number;
  /** Simulation ticks per second (tests run the clock faster). */
  tickRate?: number;
}

export interface RunningServer {
  port: number;
  lobby: Lobby;
  close(): Promise<void>;
}

const HEARTBEAT_MS = 10_000;

function originAllowed(req: IncomingMessage, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  const origin = req.headers.origin;
  return typeof origin === 'string' && allowed.includes(origin);
}

export function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const allowed = (opts.allowedOrigins ?? []).map((o) => o.trim()).filter(Boolean);
  const maxConnections = opts.maxConnections ?? 400;
  const tickRate = opts.tickRate ?? 60;
  const lobby = new Lobby({ randomInt: (n) => randomInt(n) });
  const alive = new WeakMap<WebSocket, boolean>();

  const http: Server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (req.method === 'GET' && url === '/health') {
      const body = JSON.stringify({ ok: true, ...lobby.stats() });
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
      res.end(body);
      return;
    }
    if (req.method === 'GET' && url === '/') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('LAST ROUND match server. Connect with a WebSocket.\n');
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found\n');
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MESSAGE * 2, perMessageDeflate: false });

  http.on('upgrade', (req, socket, head) => {
    if (!originAllowed(req, allowed)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    if (wss.clients.size >= maxConnections) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    alive.set(ws, true);
    const conn: Conn = {
      send(msg: ServerMsg): void {
        if (ws.readyState !== ws.OPEN) return;
        // A client that cannot keep up is dropped rather than buffered forever.
        if (ws.bufferedAmount > 1_000_000) {
          ws.terminate();
          return;
        }
        ws.send(JSON.stringify(msg));
      },
      close(): void {
        ws.close(1008, 'policy');
      },
    };
    lobby.connect(conn);
    ws.on('pong', () => alive.set(ws, true));
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        ws.close(1003, 'text only');
        return;
      }
      lobby.message(conn, data.toString());
    });
    ws.on('close', () => lobby.disconnect(conn));
    ws.on('error', () => ws.terminate());
  });

  // Fixed-rate simulation clock with catch-up, shared by every room.
  const stepMs = 1000 / tickRate;
  let last = performance.now();
  let acc = 0;
  const clock = setInterval(() => {
    const now = performance.now();
    acc += Math.min(250, now - last);
    last = now;
    let steps = 0;
    while (acc >= stepMs && steps < 8) {
      acc -= stepMs;
      steps++;
      lobby.tick();
    }
    if (steps === 8) acc = 0;
  }, Math.max(1, Math.floor(stepMs / 2)));

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_MS);

  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(opts.port ?? 8787, opts.host ?? '0.0.0.0', () => {
      const addr = http.address();
      const port = typeof addr === 'object' && addr ? addr.port : (opts.port ?? 8787);
      resolve({
        port,
        lobby,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(clock);
            clearInterval(heartbeat);
            for (const ws of wss.clients) ws.terminate();
            wss.close(() => http.close(() => done()));
          }),
      });
    });
  });
}

/* Run when started directly (node dist-server/index.js / tsx server/index.ts). */
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entry) {
  const port = Number(process.env.PORT) || 8787;
  const origins = (process.env.ALLOWED_ORIGINS ?? '').split(',');
  startServer({
    port,
    host: process.env.HOST || '0.0.0.0',
    allowedOrigins: origins,
    maxConnections: Number(process.env.MAX_CONNECTIONS) || undefined,
  })
    .then((srv) => {
      console.log(`LAST ROUND match server listening on :${srv.port}`);
      const stop = (): void => {
        void srv.close().then(() => process.exit(0));
      };
      process.on('SIGTERM', stop);
      process.on('SIGINT', stop);
    })
    .catch((err) => {
      console.error('Failed to start the match server:', err);
      process.exit(1);
    });
}
