/**
 * Menu screens. Each screen is rendered from a template into one container;
 * buttons declare what they do with `data-act` (leaves the screen — locked
 * against double activation) or `data-set` (adjusts something in place).
 */
import { icon } from '../assets/icons';
import type { IconName } from '../assets/icons';
import logoUrl from '../assets/logo.svg?url';
import { KEY_LABELS } from '../game/input';
import { TOTAL_ROUNDS, UPGRADES } from '../game/survival';
import type { Opponent, RoundBreakdown, RunState, UpgradeId } from '../game/survival';
import { CHARS, PLAYABLE } from '../sim/data';
import { createFighter } from '../sim/match';
import type { CharId } from '../sim/types';
import { charLook, drawFighter, drawPortrait } from '../render/rig';
import { esc, getLang, t } from './i18n';
import type { Lang, TextKey } from './i18n';
import type { MotionPref, Settings } from './settings';

type Handlers = Record<string, (el: HTMLElement) => void>;

export type DummyMode = 'stand' | 'guard' | 'jump' | 'cpu';

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function fmtTime(ticks: number): string {
  const s = Math.round(ticks / 60);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function paintPortrait(canvas: HTMLCanvasElement | null, char: CharId, skin: number, flip = false): void {
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawPortrait(ctx, char, skin, { x: 0, y: 0, w: canvas.width, h: canvas.height }, { flip });
}

export class Screens {
  /** Name of the open screen, or null. */
  current: string | null = null;
  /** UI sound hook. */
  onSound: ((kind: 'move' | 'select' | 'back') => void) | null = null;

  private readonly root: HTMLElement;
  private handlers: Handlers = {};
  private back: (() => void) | null = null;
  private locked = false;
  private unlockTimer = 0;
  private raf = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    root.addEventListener('click', (e) => this.onClick(e));
    // Listen on the document so menu keys work even when focus has left the
    // screen (e.g. Tab moved it to <body>).
    document.addEventListener('keydown', (e) => {
      if (this.current) this.onKey(e);
    });
    root.addEventListener('focusin', (e) => {
      if ((e.target as HTMLElement).matches?.('button')) this.onSound?.('move');
    });
  }

  get isOpen(): boolean {
    return this.current !== null;
  }

  /** Ignore activations for `ms` (stray double clicks, keys held across screens). */
  private lock(ms: number): void {
    this.locked = true;
    this.root.dataset.locked = '1';
    window.clearTimeout(this.unlockTimer);
    this.unlockTimer = window.setTimeout(() => {
      this.locked = false;
      delete this.root.dataset.locked;
    }, ms);
  }

  private open(name: string, html: string, handlers: Handlers, back: (() => void) | null): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.current = name;
    this.handlers = handlers;
    this.back = back;
    this.root.dataset.screen = name;
    this.root.innerHTML = html;
    this.root.hidden = false;
    this.root.scrollTop = 0;
    // Ignore clicks and key presses that were aimed at the previous screen.
    this.lock(240);
    const target = this.root.querySelector<HTMLElement>('[data-autofocus]') ?? this.root.querySelector<HTMLElement>('button');
    // Focusing without scrolling keeps the layout still on mobile.
    (target ?? this.root).focus({ preventScroll: true });
  }

  close(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.clearTimeout(this.unlockTimer);
    this.locked = false;
    delete this.root.dataset.locked;
    this.current = null;
    this.handlers = {};
    this.back = null;
    this.root.hidden = true;
    this.root.innerHTML = '';
  }

  private onClick(e: Event): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act],[data-set]');
    if (!el || !this.root.contains(el) || (el as HTMLButtonElement).disabled) return;
    const set = el.dataset.set;
    if (set) {
      this.handlers[set]?.(el);
      return;
    }
    if (this.locked) return;
    const act = el.dataset.act as string;
    const fn = this.handlers[act];
    if (!fn) return;
    // One activation per screen: the handler is expected to navigate away.
    this.lock(600);
    this.onSound?.(act === 'back' ? 'back' : 'select');
    fn(el);
  }

  private focusables(): HTMLElement[] {
    return Array.from(this.root.querySelectorAll<HTMLElement>('button:not([disabled]):not([hidden]), input:not([disabled])')).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Tab') {
      // Keep keyboard focus inside the open screen.
      const items = this.focusables();
      if (!items.length) return;
      const active = document.activeElement as HTMLElement | null;
      const i = active ? items.indexOf(active) : -1;
      let next: HTMLElement | null = null;
      if (i < 0) next = items[e.shiftKey ? items.length - 1 : 0] as HTMLElement;
      else if (!e.shiftKey && i === items.length - 1) next = items[0] as HTMLElement;
      else if (e.shiftKey && i === 0) next = items[items.length - 1] as HTMLElement;
      if (next) {
        e.preventDefault();
        next.focus();
      }
      return;
    }
    if (e.key === 'Escape') {
      // The menu owns this key press: it must not also reach the game (where
      // Escape would immediately pause the fight that was just resumed).
      e.preventDefault();
      e.stopPropagation();
      if (this.back && !this.locked) {
        const back = this.back;
        this.lock(600);
        this.onSound?.('back');
        back();
      }
      return;
    }
    const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) return;
    const items = this.focusables();
    if (!items.length) return;
    const i = active ? items.indexOf(active) : -1;
    const next = items[(i + dir + items.length) % items.length] as HTMLElement;
    e.preventDefault();
    next.focus();
    // Radio-style cards select on arrow keys.
    if (next.getAttribute('role') === 'radio') next.click();
  }

  /* ---------------------------------------------------------------- */
  /* Title                                                             */
  /* ---------------------------------------------------------------- */

  title(o: {
    bestScore: number;
    bestRound: number;
    online: boolean;
    onSurvival: () => void;
    onTraining: () => void;
    onOnline: () => void;
    onHowto: () => void;
    onSettings: () => void;
  }): void {
    let n = 0;
    const item = (act: string, ic: IconName, label: TextKey, sub: TextKey | null, primary = false): string =>
      `<li><button type="button" class="btn${primary ? ' btn--primary' : ''}" data-act="${act}"${primary ? ' data-autofocus' : ''}>
        <span class="menu__n" aria-hidden="true">${String(++n).padStart(2, '0')}</span>${icon(ic)}
        <span>${esc(t(label))}${sub ? `<small>${esc(t(sub))}</small>` : ''}</span></button></li>`;
    const best =
      o.bestScore > 0
        ? `<span>${esc(t('best.score'))}</span><b>${fmt(o.bestScore)}</b><span>${esc(t('best.round', { n: o.bestRound }))}</span>`
        : `<span>${esc(t('best.score'))}</span><span>${esc(t('best.none'))}</span>`;
    this.open(
      'title',
      `<div class="title">
        <img class="title__logo" src="${logoUrl}" alt="LAST ROUND" width="696" height="300" />
        <p class="title__tag">${esc(t('title.tagline'))}<small>${esc(t('title.sub'))}</small></p>
        <ul class="menu">
          ${item('survival', 'survival', 'menu.survival', 'menu.survival.sub', true)}
          ${item('training', 'training', 'menu.training', 'menu.training.sub')}
          ${o.online ? item('online', 'online', 'menu.online', 'menu.online.sub') : ''}
          ${item('howto', 'keyboard', 'menu.howto', null)}
          ${item('settings', 'sound-on', 'menu.settings', null)}
        </ul>
        <div class="title__best">${best}</div>
      </div>`,
      { survival: o.onSurvival, training: o.onTraining, online: o.onOnline, howto: o.onHowto, settings: o.onSettings },
      null,
    );
  }

  /* ---------------------------------------------------------------- */
  /* Fighter select                                                    */
  /* ---------------------------------------------------------------- */

  select(o: { initial: CharId; heading?: string; reducedMotion: boolean; onPick: (c: CharId) => void; onBack: () => void }): void {
    let picked: CharId = PLAYABLE.includes(o.initial) ? o.initial : 'switch';
    const cards = PLAYABLE.map((id) => {
      const c = CHARS[id];
      return `<button type="button" class="card" role="radio" aria-checked="false" data-set="pick" data-char="${id}" style="--accent:${charLook(id, 0).accent}">
        <canvas width="116" height="116" aria-hidden="true"></canvas>
        <span><span class="card__name">${esc(c.ringName)}</span><br /><span class="card__real">${esc(c.realName)}</span></span>
      </button>`;
    }).join('');
    const stat = (key: TextKey, id: string): string =>
      `<div><dt>${esc(t(key))}</dt><dd data-stat="${id}" role="img">${'<i></i>'.repeat(5)}</dd></div>`;
    this.open(
      'select',
      `<div class="screen__inner">
        <h1 class="h1">${esc(o.heading ?? t('select.title'))}</h1>
        <p class="lede">${esc(t('select.hint'))}</p>
        <div class="rule"></div>
        <div class="select">
          <div class="roster" role="radiogroup" aria-label="${esc(t('select.title'))}">${cards}</div>
          <div class="sheet profile" aria-live="polite">
            <div class="profile__stage"><canvas aria-hidden="true"></canvas></div>
            <div>
              <h2 class="profile__name"></h2>
              <div class="profile__real"></div>
              <p class="profile__blurb"></p>
              <dl class="stats">
                ${stat('stat.vitality', 'vitality')}${stat('stat.power', 'power')}${stat('stat.speed', 'speed')}${stat('stat.reach', 'reach')}
              </dl>
            </div>
          </div>
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn--ghost" data-act="back">${icon('back')}<span>${esc(t('common.back'))}</span></button>
          <button type="button" class="btn btn--primary" data-act="go">${icon('check')}<span>${esc(t('select.start'))}</span></button>
        </div>
      </div>`,
      {
        pick: (el) => {
          picked = el.dataset.char as CharId;
          apply();
          this.onSound?.('move');
        },
        go: () => o.onPick(picked),
        back: o.onBack,
      },
      o.onBack,
    );

    const root = this.root;
    root.querySelectorAll<HTMLElement>('.card').forEach((el) => {
      paintPortrait(el.querySelector('canvas'), el.dataset.char as CharId, 0);
    });
    const profile = root.querySelector<HTMLElement>('.profile') as HTMLElement;
    const stage = root.querySelector<HTMLCanvasElement>('.profile__stage canvas') as HTMLCanvasElement;

    const apply = (): void => {
      const c = CHARS[picked];
      const look = charLook(picked, 0);
      profile.style.setProperty('--accent', look.accent);
      (profile.querySelector('.profile__name') as HTMLElement).textContent = c.ringName;
      (profile.querySelector('.profile__real') as HTMLElement).textContent = c.realName;
      (profile.querySelector('.profile__blurb') as HTMLElement).textContent = t(`char.${picked}` as TextKey);
      (['vitality', 'power', 'speed', 'reach'] as const).forEach((k) => {
        const dd = profile.querySelector(`[data-stat="${k}"]`) as HTMLElement;
        dd.setAttribute('aria-label', `${c.pips[k]} / 5`);
        dd.querySelectorAll('i').forEach((pip, i) => pip.classList.toggle('on', i < c.pips[k]));
      });
      root.querySelectorAll<HTMLElement>('.card').forEach((el) => {
        const on = el.dataset.char === picked;
        el.setAttribute('aria-checked', String(on));
        el.tabIndex = on ? 0 : -1;
      });
    };
    apply();
    root.querySelector<HTMLElement>(`.card[data-char="${picked}"]`)?.focus({ preventScroll: true });

    // Live preview: the chosen fighter in their stance.
    const dummy = createFighter({ char: picked }, 0, 1);
    dummy.state = 'idle';
    const ctx = stage.getContext('2d');
    const paint = (ms: number): void => {
      if (this.current !== 'select' || !ctx) return;
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (stage.width !== Math.round(w * dpr) || stage.height !== Math.round(h * dpr)) {
        stage.width = Math.max(1, Math.round(w * dpr));
        stage.height = Math.max(1, Math.round(h * dpr));
      }
      dummy.char = picked;
      const k = (h / 250) * dpr;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.clearRect(0, 0, w * 2, 400);
      drawFighter(ctx, dummy, { x: (w * dpr) / k / 2 - 12, groundY: 226, time: ms / 1000, reducedMotion: o.reducedMotion });
      if (!o.reducedMotion) this.raf = requestAnimationFrame(paint);
    };
    this.raf = requestAnimationFrame(paint);
    if (o.reducedMotion) {
      // No animation loop: repaint when the selection changes instead.
      root.addEventListener('click', () => requestAnimationFrame(paint));
    }
  }

  /* ---------------------------------------------------------------- */
  /* Controls                                                          */
  /* ---------------------------------------------------------------- */

  howto(o: { onBack: () => void }): void {
    const row = (label: TextKey, keys: string): string => `<div><dt>${esc(t(label))}</dt><dd>${esc(keys)}</dd></div>`;
    const L = `<kbd>${esc(t('word.light'))}</kbd>`;
    const H = `<kbd class="h">${esc(t('word.heavy'))}</kbd>`;
    const J = `<kbd>${esc(t('word.jump'))}</kbd>`;
    const combo = (seq: string, label: TextKey): string => `<div><dt><span class="seq">${seq}</span></dt><dd>${esc(t(label))}</dd></div>`;
    this.open(
      'howto',
      `<div class="screen__inner">
        <h1 class="h1">${esc(t('howto.title'))}</h1>
        <div class="rule"></div>
        <div class="sheet">
          <div class="cols">
            <section>
              <h2 class="h2">${icon('keyboard')} ${esc(t('howto.keyboard'))}</h2>
              <dl class="keys">
                ${row('act.move', `${KEY_LABELS.LEFT}  ·  ${KEY_LABELS.RIGHT}`)}
                ${row('act.jump', KEY_LABELS.JUMP)}
                ${row('act.block', KEY_LABELS.BLOCK)}
                ${row('act.dodge', KEY_LABELS.DODGE)}
                ${row('act.light', KEY_LABELS.LIGHT)}
                ${row('act.heavy', KEY_LABELS.HEAVY)}
                ${row('act.special', KEY_LABELS.SPECIAL)}
                ${row('act.pause', 'Esc / P')}
              </dl>
              <h2 class="h2" style="margin-top:16px">${icon('touch')} ${esc(t('howto.touch'))}</h2>
              <p class="note">${esc(t('howto.touch.note'))}</p>
            </section>
            <section>
              <h2 class="h2">${esc(t('howto.combos'))}</h2>
              <dl class="keys">
                ${combo(`${L}›${L}›${L}`, 'combo.lll')}
                ${combo(`${L}›${L}›${H}`, 'combo.llh')}
                ${combo(`${L}›${H}`, 'combo.lh')}
                ${combo(`${J}+${H}`, 'combo.air')}
                ${combo(`${L}+${H}`, 'combo.sp')}
              </dl>
              <h2 class="h2" style="margin-top:16px">${esc(t('howto.tips'))}</h2>
              <ul class="tips">
                <li>${esc(t('tip.parry'))}</li>
                <li>${esc(t('tip.guard'))}</li>
                <li>${esc(t('tip.dodge'))}</li>
                <li>${esc(t('tip.carry'))}</li>
              </ul>
            </section>
          </div>
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn--primary btn--inline" data-act="back" data-autofocus>${icon('back')}<span>${esc(t('common.back'))}</span></button>
        </div>
      </div>`,
      { back: o.onBack },
      o.onBack,
    );
  }

  /* ---------------------------------------------------------------- */
  /* Settings                                                          */
  /* ---------------------------------------------------------------- */

  settings(o: {
    settings: Settings;
    audioSupported: boolean;
    onVolume: (kind: 'master' | 'music' | 'sfx', v: number) => void;
    onMute: (muted: boolean) => void;
    onLang: (lang: Lang) => void;
    onMotion: (m: MotionPref) => void;
    onTest: () => void;
    onBack: () => void;
    /** Selector of the control to focus after opening (re-render after a change). */
    focus?: string;
  }): void {
    const s = o.settings;
    const slider = (kind: 'master' | 'music' | 'sfx', label: TextKey): string => {
      const v = Math.round(s[kind] * 100);
      return `<div class="field"><label for="vol-${kind}">${esc(t(label))}</label>
        <input id="vol-${kind}" type="range" min="0" max="100" step="5" value="${v}" data-vol="${kind}" style="--p:${v}%" />
        <output for="vol-${kind}">${v}</output></div>`;
    };
    const seg = (set: string, value: string, label: string, on: boolean): string =>
      `<button type="button" data-set="${set}" data-value="${value}" aria-pressed="${on}">${esc(label)}</button>`;
    this.open(
      'settings',
      `<div class="screen__inner screen__inner--narrow">
        <h1 class="h1">${esc(t('settings.title'))}</h1>
        <div class="rule"></div>
        <div class="sheet">
          ${slider('master', 'settings.master')}
          ${slider('music', 'settings.music')}
          ${slider('sfx', 'settings.sfx')}
          <div class="field field--wide"><span class="field__label">${esc(t('settings.mute'))}</span>
            <div class="seg">
              <button type="button" data-set="mute" aria-pressed="${s.muted}">${icon(s.muted ? 'sound-off' : 'sound-on')}</button>
              <button type="button" data-set="test">${esc(t('settings.audio.test'))}</button>
            </div></div>
          <div class="field field--wide"><span class="field__label">${esc(t('settings.language'))}</span>
            <div class="seg">${seg('lang', 'th', 'ไทย', s.lang === 'th')}${seg('lang', 'en', 'English', s.lang === 'en')}</div></div>
          <div class="field field--wide"><span class="field__label">${esc(t('settings.motion'))}</span>
            <div class="seg">
              ${seg('motion', 'auto', t('settings.motion.auto'), s.motion === 'auto')}
              ${seg('motion', 'on', t('settings.motion.on'), s.motion === 'on')}
              ${seg('motion', 'off', t('settings.motion.off'), s.motion === 'off')}
            </div></div>
          ${o.audioSupported ? '' : `<p class="note" role="status">${esc(t('settings.audio.unsupported'))}</p>`}
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn--primary btn--inline" data-act="back" data-autofocus>${icon('back')}<span>${esc(t('common.back'))}</span></button>
        </div>
      </div>`,
      {
        mute: (el) => {
          const muted = el.getAttribute('aria-pressed') !== 'true';
          el.setAttribute('aria-pressed', String(muted));
          el.innerHTML = icon(muted ? 'sound-off' : 'sound-on');
          o.onMute(muted);
        },
        test: () => o.onTest(),
        lang: (el) => o.onLang(el.dataset.value as Lang),
        motion: (el) => {
          el.parentElement?.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
          o.onMotion(el.dataset.value as MotionPref);
        },
        back: o.onBack,
      },
      o.onBack,
    );
    this.root.querySelectorAll<HTMLInputElement>('input[data-vol]').forEach((input) => {
      input.addEventListener('input', () => {
        const v = Number(input.value);
        input.style.setProperty('--p', `${v}%`);
        (input.nextElementSibling as HTMLElement).textContent = String(v);
        o.onVolume(input.dataset.vol as 'master' | 'music' | 'sfx', v / 100);
      });
    });
    const muteBtn = this.root.querySelector<HTMLElement>('[data-set="mute"]');
    muteBtn?.setAttribute('aria-label', t('settings.mute'));
    if (o.focus) this.root.querySelector<HTMLElement>(o.focus)?.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------------- */
  /* Pause                                                             */
  /* ---------------------------------------------------------------- */

  pause(o: {
    training: boolean;
    online?: boolean;
    dummy?: DummyMode;
    onResume: () => void;
    onRestart: () => void;
    onDummy?: (d: DummyMode) => void;
    onHowto: () => void;
    onSettings: () => void;
    onQuit: () => void;
  }): void {
    const modes: DummyMode[] = ['stand', 'guard', 'jump', 'cpu'];
    const dummy = o.training
      ? `<div class="field field--wide" style="margin-bottom:12px"><span class="field__label">${esc(t('train.dummy'))}</span><div class="seg">${modes
          .map((d) => `<button type="button" data-set="dummy" data-value="${d}" aria-pressed="${d === o.dummy}">${esc(t(`train.${d}` as TextKey))}</button>`)
          .join('')}</div></div>`
      : '';
    this.open(
      'pause',
      `<div class="screen__inner screen__inner--narrow">
        <h1 class="h1">${esc(t('pause.title'))}</h1>
        <div class="rule"></div>
        ${dummy}
        <ul class="menu">
          <li><button type="button" class="btn btn--primary" data-act="resume" data-autofocus>${icon('right')}<span>${esc(t('pause.resume'))}</span></button></li>
          ${o.online ? '' : `<li><button type="button" class="btn" data-act="restart">${icon('replay')}<span>${esc(t(o.training ? 'pause.reset' : 'pause.restart'))}</span></button></li>`}
          <li><button type="button" class="btn" data-act="howto">${icon('keyboard')}<span>${esc(t('menu.howto'))}</span></button></li>
          <li><button type="button" class="btn" data-act="settings">${icon('sound-on')}<span>${esc(t('menu.settings'))}</span></button></li>
          <li><button type="button" class="btn" data-act="quit">${icon('home')}<span>${esc(t('pause.quit'))}</span></button></li>
        </ul>
      </div>`,
      {
        resume: o.onResume,
        restart: o.onRestart,
        howto: o.onHowto,
        settings: o.onSettings,
        quit: o.onQuit,
        dummy: (el) => {
          el.parentElement?.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
          o.onDummy?.(el.dataset.value as DummyMode);
        },
      },
      o.onResume,
    );
  }

  /* ---------------------------------------------------------------- */
  /* Round clear + upgrade choice                                      */
  /* ---------------------------------------------------------------- */

  clear(o: { run: Readonly<RunState>; cleared: number; breakdown: RoundBreakdown; choices: UpgradeId[]; next: Opponent; onPick: (id: UpgradeId) => void }): void {
    const b = o.breakdown;
    const line = (label: TextKey, v: number, cls = ''): string => (v > 0 ? `<div class="${cls}"><dt>${esc(t(label))}</dt><dd>+${fmt(v)}</dd></div>` : '');
    const ups = o.choices
      .map((id, i) => {
        const def = UPGRADES[id];
        const lvl = o.run.upgrades[id];
        const level = def.max < 50 ? `<em>${esc(t('clear.level', { n: lvl + 1, max: def.max }))}</em>` : '<em>&nbsp;</em>';
        return `<button type="button" class="up" data-act="pick" data-up="${id}"${i === 0 ? ' data-autofocus' : ''}>
          ${icon(def.icon as IconName)}<b>${esc(t(`up.${id}` as TextKey))}</b><span>${esc(t(`up.${id}.d` as TextKey))}</span>${level}</button>`;
      })
      .join('');
    const hp = Math.max(0, Math.min(1, o.run.hp / o.run.maxHp));
    this.open(
      'clear',
      `<div class="screen__inner">
        <h1 class="h1">${esc(t('clear.title', { n: o.cleared }))}</h1>
        <p class="lede">${esc(t('clear.choose'))}</p>
        <div class="rule"></div>
        <div class="clear">
          <div class="sheet">
            <dl class="tally">
              ${line('clear.clear', b.clear)}${line('clear.time', b.time)}${line('clear.health', b.health)}${line('clear.perfect', b.perfect, 'is-gold')}
              <div class="tally__total"><dt>${esc(t('clear.total'))}</dt><dd>+${fmt(b.total)}</dd></div>
            </dl>
            <div class="hpline">${esc(t('clear.hp'))} — ${Math.round(o.run.hp)} / ${o.run.maxHp}
              <div class="bar bar--hp${hp <= 0.28 ? ' is-low' : ''}" style="--v:${hp.toFixed(3)}"><i class="bar__fill"></i></div></div>
            <div class="next">
              <canvas width="104" height="104" aria-hidden="true"></canvas>
              <div><small>${esc(o.next.boss ? t('clear.final') : t('clear.next'))} · ${esc(t('hud.round', { n: o.next.round, total: TOTAL_ROUNDS }))}</small><b>${esc(o.next.name)}</b></div>
            </div>
          </div>
          <div class="upgrades">${ups}</div>
        </div>
      </div>`,
      { pick: (el) => o.onPick(el.dataset.up as UpgradeId) },
      null,
    );
    paintPortrait(this.root.querySelector('.next canvas'), o.next.char, o.next.skin, true);
  }

  /* ---------------------------------------------------------------- */
  /* Results                                                           */
  /* ---------------------------------------------------------------- */

  result(o: {
    won: boolean;
    run: Readonly<RunState>;
    opponent: Opponent;
    bestScore: number;
    newBest: boolean;
    onRetry: () => void;
    onChange: () => void;
    onHome: () => void;
  }): void {
    const r = o.run;
    const cleared = o.won ? TOTAL_ROUNDS : r.round - 1;
    const fig = (label: TextKey, value: string, key = false, extra = ''): string =>
      `<div class="${key ? 'is-key' : ''}"><dt>${esc(t(label))}</dt><dd>${esc(value)}${extra}</dd></div>`;
    this.open(
      'result',
      `<div class="screen__inner">
        <h1 class="h1 result__title${o.won ? '' : ' result__title--lose'}">${esc(t(o.won ? 'result.win' : 'result.lose'))}</h1>
        <p class="lede">${esc(o.won ? t('result.win.sub') : t('result.lose.sub', { n: r.round, name: o.opponent.name }))}</p>
        <div class="rule"></div>
        <dl class="figures">
          ${fig('result.score', fmt(r.score), true, o.newBest ? `<span class="badge">${esc(t('result.newBest'))}</span>` : '')}
          ${fig('result.best', fmt(o.bestScore))}
          ${fig('result.rounds', t(cleared === 1 ? 'result.rounds.one' : 'result.rounds.v', { n: cleared }))}
          ${fig('result.combo', String(r.stats.maxCombo))}
          ${fig('result.damage', fmt(r.stats.damageDealt))}
          ${fig('result.perfects', String(r.stats.perfects))}
          ${fig('result.time', fmtTime(r.stats.ticks))}
        </dl>
        <div class="btn-row">
          <button type="button" class="btn btn--primary" data-act="retry" data-autofocus>${icon('replay')}<span>${esc(t('result.retry'))}</span></button>
          <button type="button" class="btn" data-act="change">${icon('survival')}<span>${esc(t('result.change'))}</span></button>
          <button type="button" class="btn btn--ghost" data-act="home">${icon('home')}<span>${esc(t('result.home'))}</span></button>
        </div>
      </div>`,
      { retry: o.onRetry, change: o.onChange, home: o.onHome },
      null,
    );
  }

  /** Generic screen for features that build their own markup (online lobby). */
  custom(name: string, html: string, handlers: Handlers, back: (() => void) | null): HTMLElement {
    this.open(name, html, handlers, back);
    return this.root;
  }
}

/** Markup of the on-screen touch controls. */
export function touchMarkup(): string {
  const b = (cls: string, input: string, ic: IconName, label: TextKey, short: string): string =>
    `<button type="button" class="tbtn tbtn--${cls}" data-in="${input}" aria-label="${esc(t(label))}">${icon(ic)}<span aria-hidden="true">${esc(short)}</span></button>`;
  const th = getLang() === 'th';
  return `<div class="touch__pad tpad" data-pad>
    <div class="tbtn tbtn--move" data-side="left" role="button" aria-label="${esc(t('act.left'))}">${icon('left')}</div>
    <div class="tbtn tbtn--move" data-side="right" role="button" aria-label="${esc(t('act.right'))}">${icon('right')}</div>
  </div>
  <div class="touch__acts">
    ${b('dodge', 'DODGE', 'dodge', 'act.dodge', th ? 'หลบ' : 'DODGE')}
    ${b('jump', 'JUMP', 'jump', 'act.jump', th ? 'โดด' : 'JUMP')}
    ${b('special', 'SPECIAL', 'special', 'act.special', 'OD')}
    ${b('block', 'BLOCK', 'block', 'act.block', th ? 'การ์ด' : 'GUARD')}
    ${b('light', 'LIGHT', 'light', 'act.light', th ? 'เบา' : 'LIGHT')}
    ${b('heavy', 'HEAVY', 'heavy', 'act.heavy', th ? 'หนัก' : 'HEAVY')}
  </div>`;
}
