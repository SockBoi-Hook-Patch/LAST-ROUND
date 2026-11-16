/**
 * Online 1-v-1. The browser only sends its controller mask; everything it
 * draws comes from snapshots of the simulation running on the match server.
 *
 * This mode exists only when a match server is configured at build time
 * (`VITE_SERVER_URL`). Without one, the game never shows an online entry.
 */
import { audio } from '../audio';
import { icon } from '../assets/icons';
import { NetClient } from '../net/client';
import { ROOM_CODE_LENGTH, applySnap, normaliseCode, validServerUrl, validStartState } from '../net/protocol';
import type { ErrorCode, ServerMsg, Snap } from '../net/protocol';
import { charLook } from '../render/rig';
import { CHARS, PLAYABLE } from '../sim/data';
import type { CharId } from '../sim/types';
import { esc, t } from '../ui/i18n';
import type { TextKey } from '../ui/i18n';
import { saveSettings } from '../ui/settings';
import type { App, Fight } from './app';

/** Match server endpoint, or null when online play is not configured. */
export function serverUrl(): string | null {
  // A local page may point at a local server (development and tests only).
  try {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      const override = validServerUrl(new URLSearchParams(window.location.search).get('server'));
      if (override) return override;
    }
  } catch {
    /* fall through to the build-time setting */
  }
  return validServerUrl(import.meta.env.VITE_SERVER_URL);
}

const ERRORS: Record<ErrorCode, TextKey> = {
  bad: 'online.error.generic',
  busy: 'online.error.generic',
  version: 'online.error.generic',
  notfound: 'online.error.notfound',
  full: 'online.error.full',
};

/** Snapshots older than this many are applied without effects (tab was asleep). */
const MAX_FX_BACKLOG = 12;

export class OnlineMode {
  private readonly app: App;
  private readonly url: string;
  private readonly net = new NetClient();
  private char: CharId = 'switch';
  private fight: Fight | null = null;
  private you: 0 | 1 = 0;
  private wins: [number, number] = [0, 0];
  private round = 1;
  private snaps: Snap[] = [];
  private lastMask = -1;
  private sinceSend = 0;
  private pingTimer = 0;
  private pending = false;
  private active = false;

  constructor(app: App, url: string) {
    this.app = app;
    this.url = url;
    this.net.onStatus = () => this.onStatus();
    this.net.onMessage = (m) => this.onMessage(m);
  }

  /** Enter the online lobby from the title screen. */
  open(): void {
    const last = this.app.settings.lastChar as CharId;
    this.char = PLAYABLE.includes(last) ? last : 'switch';
    this.active = true;
    this.showLobby();
    if (this.net.status !== 'open' && this.net.status !== 'connecting') this.net.connect(this.url);
  }

  private leave(): void {
    this.active = false;
    window.clearInterval(this.pingTimer);
    this.net.close();
    this.fight = null;
    this.snaps.length = 0;
    this.app.onFrame = null;
    this.app.onQuitFight = null;
  }

  private home(): void {
    this.leave();
    this.app.fight = null;
    this.app.goTitle();
  }

  /* ---------------------------------------------------------------- */
  /* Lobby                                                             */
  /* ---------------------------------------------------------------- */

  private statusLine(): { text: string; state: string } {
    switch (this.net.status) {
      case 'open':
        return { text: this.net.ping >= 0 ? `${t('online.connected')} · ${t('online.ping', { n: this.net.ping })}` : t('online.connected'), state: 'ok' };
      case 'connecting':
        return { text: t('online.connecting'), state: 'wait' };
      default:
        return { text: t('online.offline'), state: 'bad' };
    }
  }

  private showLobby(error = ''): void {
    this.pending = false;
    const st = this.statusLine();
    const chars = PLAYABLE.map(
      (id) =>
        `<button type="button" data-set="char" data-value="${id}" aria-pressed="${id === this.char}" style="--accent:${charLook(id, 0).accent}">${esc(CHARS[id].ringName)}</button>`,
    ).join('');
    const root = this.app.screens.custom(
      'online',
      `<div class="screen__inner screen__inner--narrow">
        <h1 class="h1">${esc(t('online.title'))}</h1>
        <p class="status" data-state="${st.state}" role="status">${esc(st.text)}</p>
        <div class="rule"></div>
        <div class="sheet">
          <div class="field field--wide"><span class="field__label">${esc(t('select.title'))}</span><div class="seg">${chars}</div></div>
          <p class="note">${esc(t('online.bestof'))}</p>
          <ul class="menu" style="margin-top:12px">
            <li><button type="button" class="btn btn--primary" data-set="quick" data-needs-net>${icon('online')}<span>${esc(t('online.quick'))}</span></button></li>
            <li><button type="button" class="btn" data-set="create" data-needs-net>${icon('survival')}<span>${esc(t('online.create'))}</span></button></li>
            <li><label class="sr-only" for="room-code">${esc(t('online.code'))}</label>
              <input id="room-code" class="code-input" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false"
                maxlength="${ROOM_CODE_LENGTH}" placeholder="${esc(t('online.code.hint'))}" /></li>
            <li><button type="button" class="btn" data-set="join" data-needs-net>${icon('right')}<span>${esc(t('online.join'))}</span></button></li>
          </ul>
          <p class="note" data-error role="alert">${esc(error)}</p>
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn--ghost btn--inline" data-act="back">${icon('back')}<span>${esc(t('common.back'))}</span></button>
          <button type="button" class="btn btn--inline" data-set="retry" ${this.net.status === 'closed' ? '' : 'hidden'}>${icon('replay')}<span>${esc(t('online.retry'))}</span></button>
        </div>
      </div>`,
      {
        char: (el) => {
          this.char = el.dataset.value as CharId;
          el.parentElement?.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
          this.app.settings.lastChar = this.char;
          saveSettings(this.app.settings);
        },
        quick: () => this.request({ t: 'quick', char: this.char }),
        create: () => this.request({ t: 'create', char: this.char }),
        join: () => {
          const input = root.querySelector<HTMLInputElement>('#room-code');
          const code = normaliseCode(input?.value ?? '');
          if (!code) {
            this.setError(t('online.error.notfound'));
            input?.focus();
            return;
          }
          this.request({ t: 'join', code, char: this.char });
        },
        retry: () => {
          this.net.connect(this.url);
        },
        back: () => this.home(),
      },
      () => this.home(),
    );
    root.querySelector<HTMLInputElement>('#room-code')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') root.querySelector<HTMLElement>('[data-set="join"]')?.click();
      // Typing a code must not trigger menu navigation.
      if (e.key.startsWith('Arrow')) e.stopPropagation();
    });
    this.refreshLobby();
  }

  private request(msg: Parameters<NetClient['send']>[0]): void {
    if (this.pending || this.net.status !== 'open') return;
    this.pending = true;
    this.setError('');
    this.refreshLobby();
    this.net.send(msg);
  }

  private setError(text: string): void {
    const el = document.querySelector('#screen [data-error]');
    if (el) el.textContent = text;
  }

  /** Reflect connection state in whichever online screen is showing. */
  private refreshLobby(): void {
    const root = document.getElementById('screen');
    if (!root || root.hidden) return;
    const st = this.statusLine();
    const line = root.querySelector<HTMLElement>('.status');
    if (line) {
      line.textContent = st.text;
      line.dataset.state = st.state;
    }
    const ready = this.net.status === 'open' && !this.pending;
    root.querySelectorAll<HTMLButtonElement>('[data-needs-net]').forEach((b) => (b.disabled = !ready));
    const retry = root.querySelector<HTMLElement>('[data-set="retry"]');
    if (retry) retry.hidden = this.net.status !== 'closed';
  }

  private showWaiting(code: string | null): void {
    this.app.screens.custom(
      'online-wait',
      `<div class="screen__inner screen__inner--narrow">
        <h1 class="h1">${esc(t('online.title'))}</h1>
        <p class="status" data-state="wait" role="status">${esc(code ? t('online.waiting') : t('online.searching'))}</p>
        <div class="rule"></div>
        <div class="sheet">
          ${code ? `<p class="note">${esc(t('online.room', { code }))}</p><p class="roomcode" data-code>${esc(code)}</p>` : `<p class="note">${esc(t('online.bestof'))}</p>`}
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn--inline" data-act="cancel" data-autofocus>${icon('close')}<span>${esc(t('online.cancel'))}</span></button>
        </div>
      </div>`,
      { cancel: () => this.net.send({ t: 'cancel' }) },
      () => this.net.send({ t: 'cancel' }),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Connection + messages                                             */
  /* ---------------------------------------------------------------- */

  private onStatus(): void {
    if (!this.active) return;
    if (this.net.status === 'closed') {
      if (this.fight && !this.fight.ended) {
        // Lost the server mid-match.
        this.endMatch();
        this.showDone(t('online.lost'), '', false);
        return;
      }
      const screen = this.app.screens.current;
      if (screen === 'online-wait') this.showLobby(t('online.lost'));
      else if (screen === 'online') {
        this.pending = false;
        this.refreshLobby();
      }
      return;
    }
    this.refreshLobby();
  }

  private onMessage(msg: ServerMsg): void {
    if (!this.active) return;
    switch (msg.t) {
      case 'queued':
        this.showWaiting(null);
        break;
      case 'room':
        this.showWaiting(typeof msg.code === 'string' ? msg.code : '');
        break;
      case 'idle':
        if (!this.fight) this.showLobby();
        break;
      case 'error':
        if (!this.fight) this.showLobby(t(ERRORS[msg.code] ?? 'online.error.generic'));
        break;
      case 'start':
        if ((msg.you === 0 || msg.you === 1) && validStartState(msg.state)) this.startRound(msg);
        break;
      case 's':
        if (this.fight && msg.s && Array.isArray(msg.s.h) && Array.isArray(msg.s.f)) this.snaps.push(msg.s);
        break;
      case 'round':
        if (this.fight && Array.isArray(msg.wins)) {
          this.wins = [Number(msg.wins[0]) || 0, Number(msg.wins[1]) || 0];
          const mine = this.wins[this.you];
          const theirs = this.wins[this.you === 0 ? 1 : 0];
          this.app.hud.announce(`${mine} – ${theirs}`, msg.winner === 2 ? t('online.draw') : msg.winner === this.you ? t('online.win') : t('online.lose'), 1900);
        }
        break;
      case 'over': {
        if (Array.isArray(msg.wins)) this.wins = [Number(msg.wins[0]) || 0, Number(msg.wins[1]) || 0];
        const won = msg.winner === this.you;
        const title = msg.winner === 2 ? t('online.draw') : won ? t('online.win') : t('online.lose');
        this.endMatch();
        this.showDone(title, msg.reason === 'forfeit' ? (won ? t('online.forfeit') : t('online.left')) : '', won);
        break;
      }
      default:
        break;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Match                                                             */
  /* ---------------------------------------------------------------- */

  private startRound(msg: Extract<ServerMsg, { t: 'start' }>): void {
    const app = this.app;
    this.you = msg.you;
    this.round = msg.round;
    this.wins = [Number(msg.wins[0]) || 0, Number(msg.wins[1]) || 0];
    this.snaps.length = 0;
    this.lastMask = -1;
    const f = app.beginExternalFight('online', msg.state, this.you);
    this.fight = f;
    const [a, b] = msg.state.fighters;
    const youTag = t('online.you');
    const rivalTag = t('online.rival');
    app.hud.setup(msg.state, {
      round: `ROUND ${this.round} · ${this.wins[0]}–${this.wins[1]}`,
      names: [CHARS[a.char].ringName, CHARS[b.char].ringName],
      tags: this.you === 0 ? [youTag, rivalTag] : [rivalTag, youTag],
      score: false,
      note: this.net.ping >= 0 ? t('online.ping', { n: this.net.ping }) : t('online.connected'),
    });
    app.hud.announce(`ROUND ${this.round}`, t('online.bestof'), 1500);
    audio.play('roundStart');
    audio.setMusic('fight');
    app.onFrame = () => this.frame();
    app.onQuitFight = () => {
      this.net.send({ t: 'leave' });
      this.leave();
    };
    window.clearInterval(this.pingTimer);
    this.pingTimer = window.setInterval(() => {
      if (this.fight && this.net.ping >= 0) app.hud.setNote(t('online.ping', { n: this.net.ping }));
    }, 2000);
  }

  /** Once per rendered frame: send our input, apply what the server sent. */
  private frame(): void {
    const f = this.fight;
    if (!f) return;
    const mask = this.app.input.consume();
    this.sinceSend++;
    // Send on change, plus a slow repeat in case a packet went missing.
    if (mask !== this.lastMask || this.sinceSend >= 10) {
      this.lastMask = mask;
      this.sinceSend = 0;
      this.net.send({ t: 'input', mask });
    }
    const q = this.snaps;
    for (let i = 0; i < q.length; i++) {
      const m = f.m;
      f.prev[0] = m.fighters[0].x;
      f.prev[1] = m.fighters[0].y;
      f.prev[2] = m.fighters[1].x;
      f.prev[3] = m.fighters[1].y;
      applySnap(m, q[i] as Snap);
      // A long backlog (tab was in the background) is fast-forwarded silently.
      if (q.length - i <= MAX_FX_BACKLOG) this.app.afterTick(f);
    }
    q.length = 0;
  }

  private endMatch(): void {
    window.clearInterval(this.pingTimer);
    if (this.fight) this.fight.ended = true;
    this.fight = null;
    this.snaps.length = 0;
    this.app.onFrame = null;
    this.app.onQuitFight = null;
    this.app.hud.show(false);
    audio.setMusic('interlude');
  }

  private showDone(title: string, sub: string, won: boolean): void {
    audio.play(won ? 'victory' : 'defeat');
    const mine = this.wins[this.you];
    const theirs = this.wins[this.you === 0 ? 1 : 0];
    const connected = this.net.status === 'open';
    this.app.screens.custom(
      'online-done',
      `<div class="screen__inner screen__inner--narrow">
        <h1 class="h1 result__title${won ? '' : ' result__title--lose'}">${esc(title)}</h1>
        <p class="lede" role="status">${esc(sub || t('online.wins', { a: mine, b: theirs }))}</p>
        <div class="rule"></div>
        <dl class="figures"><div class="is-key"><dt>${esc(t('online.you'))} — ${esc(t('online.rival'))}</dt><dd data-score>${mine} – ${theirs}</dd></div></dl>
        <div class="btn-row">
          <button type="button" class="btn btn--primary" data-act="again" data-autofocus>${icon('replay')}<span>${esc(t(connected ? 'online.rematch' : 'online.retry'))}</span></button>
          <button type="button" class="btn btn--ghost" data-act="home">${icon('home')}<span>${esc(t('result.home'))}</span></button>
        </div>
      </div>`,
      {
        again: () => {
          this.showLobby();
          if (this.net.status !== 'open' && this.net.status !== 'connecting') this.net.connect(this.url);
        },
        home: () => this.home(),
      },
      null,
    );
    // The fight is over: menus own the keyboard again.
    this.app.endExternalFight();
  }
}
