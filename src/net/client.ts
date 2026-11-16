/**
 * Thin WebSocket client for the match server: connection state, a latency
 * estimate, and typed messages. All failure modes end in `status === 'closed'`
 * so the UI can always tell the player what happened.
 */
import { PROTOCOL_VERSION } from './protocol';
import type { ClientMsg, ServerMsg } from './protocol';

export type NetStatus = 'idle' | 'connecting' | 'open' | 'closed';

const CONNECT_TIMEOUT_MS = 7000;
const PING_EVERY_MS = 2000;

export class NetClient {
  status: NetStatus = 'idle';
  /** Round-trip time in ms, or -1 before the first measurement. */
  ping = -1;
  onStatus: ((s: NetStatus) => void) | null = null;
  onMessage: ((m: ServerMsg) => void) | null = null;

  private ws: WebSocket | null = null;
  private timer = 0;
  private pinger = 0;

  connect(url: string): void {
    this.close();
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.setStatus('closed');
      return;
    }
    this.ws = ws;
    this.timer = window.setTimeout(() => {
      if (this.ws === ws && this.status === 'connecting') this.drop(ws);
    }, CONNECT_TIMEOUT_MS);

    ws.onmessage = (ev) => {
      if (this.ws !== ws || typeof ev.data !== 'string') return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data) as ServerMsg;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'welcome') {
        if (msg.v !== PROTOCOL_VERSION) {
          this.drop(ws);
          return;
        }
        window.clearTimeout(this.timer);
        this.setStatus('open');
        this.pinger = window.setInterval(() => this.send({ t: 'ping', ts: performance.now() }), PING_EVERY_MS);
        this.send({ t: 'ping', ts: performance.now() });
        return;
      }
      if (msg.t === 'pong') {
        if (typeof msg.ts === 'number') this.ping = Math.max(0, Math.round(performance.now() - msg.ts));
        return;
      }
      if (this.status === 'open') this.onMessage?.(msg);
    };
    ws.onclose = () => {
      if (this.ws === ws) this.drop(ws);
    };
    ws.onerror = () => {
      if (this.ws === ws) this.drop(ws);
    };
  }

  send(msg: ClientMsg): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* the close handler reports the failure */
    }
  }

  private drop(ws: WebSocket): void {
    window.clearTimeout(this.timer);
    window.clearInterval(this.pinger);
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    try {
      ws.close();
    } catch {
      /* already closed */
    }
    if (this.ws === ws) this.ws = null;
    this.ping = -1;
    this.setStatus('closed');
  }

  /** Close quietly (no status callback): the caller is leaving on purpose. */
  close(): void {
    window.clearTimeout(this.timer);
    window.clearInterval(this.pinger);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
    this.ping = -1;
    this.status = 'idle';
  }

  private setStatus(s: NetStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.onStatus?.(s);
  }
}
