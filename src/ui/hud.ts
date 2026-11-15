/**
 * In-fight heads-up display: health, guard and overdrive gauges, the clock,
 * score, combo counters and the announcer. Plain DOM so text stays crisp and
 * readable by assistive technology; values only touch the DOM when they change.
 */
import { icon } from '../assets/icons';
import { CHARS, METER_MAX, TICK_RATE } from '../sim/data';
import type { Fighter, MatchState } from '../sim/types';
import { charLook, drawPortrait } from '../render/rig';
import { esc, t } from './i18n';

interface PlateEls {
  root: HTMLElement;
  face: HTMLCanvasElement;
  name: HTMLElement;
  hp: HTMLElement;
  guard: HTMLElement;
  meter: HTMLElement;
  /** Last written values, to skip redundant DOM writes. */
  vHp: number;
  vGuard: number;
  vMeter: number;
  key: string;
}

export interface HudLabels {
  /** Text above the clock, e.g. "ROUND 3/8". */
  round: string;
  /** Display names of fighter 0 and 1. */
  names: [string, string];
  /** Small text after each name (e.g. "YOU"). */
  tags?: [string, string];
  /** Show the score line. */
  score: boolean;
  /** Small note at the bottom of the playfield. */
  note?: string;
}

function q<T extends HTMLElement>(root: HTMLElement, sel: string): T {
  return root.querySelector(sel) as T;
}

function plateHtml(side: 'p1' | 'p2'): string {
  return `<div class="plate plate--${side}" data-plate="${side}">
  <canvas class="plate__face" width="96" height="96" aria-hidden="true"></canvas>
  <div class="plate__body">
    <div class="plate__name"></div>
    <div class="bar bar--hp" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i class="bar__ghost"></i><i class="bar__fill"></i></div>
    <div class="bar bar--guard" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i class="bar__fill"></i></div>
    <div class="bar bar--meter" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i class="bar__fill"></i></div>
  </div>
</div>`;
}

export class Hud {
  onPause: (() => void) | null = null;

  private readonly root: HTMLElement;
  private plates!: [PlateEls, PlateEls];
  private elRound!: HTMLElement;
  private elTime!: HTMLElement;
  private elScore!: HTMLElement;
  private elCombo!: [HTMLElement, HTMLElement];
  private elCallout!: HTMLElement;
  private elAnnounce!: HTMLElement;
  private elAnnMain!: HTMLElement;
  private elAnnSub!: HTMLElement;
  private elNote!: HTMLElement;
  private vTime = '';
  private vScore = -1;
  private vCombo: [number, number] = [0, 0];
  private vComboDmg: [number, number] = [0, 0];
  private announceTimer = 0;
  private showScore = true;

  constructor(root: HTMLElement) {
    this.root = root;
    this.build();
  }

  /** (Re)build the markup — also used after a language change. */
  build(): void {
    this.root.innerHTML = `<div class="hud__top">
  ${plateHtml('p1')}
  <div class="clock">
    <div class="clock__round"></div>
    <div class="clock__time" aria-hidden="true"></div>
    <div class="clock__score"></div>
  </div>
  ${plateHtml('p2')}
</div>
<button type="button" class="hud__pause" aria-label="${esc(t('act.pause'))}">${icon('pause')}</button>
<div class="combo" hidden><b>0</b><span>${esc(t('hud.hits'))}</span><small></small></div>
<div class="combo combo--p2" hidden><b>0</b><span>${esc(t('hud.hits'))}</span><small></small></div>
<div class="callout" aria-hidden="true"></div>
<div class="announce" aria-hidden="true"><div class="announce__main"></div><div class="announce__sub"></div></div>
<div class="hud__note" hidden></div>`;
    const plate = (side: string): PlateEls => {
      const el = q<HTMLElement>(this.root, `[data-plate="${side}"]`);
      return {
        root: el,
        face: q<HTMLCanvasElement>(el, '.plate__face'),
        name: q(el, '.plate__name'),
        hp: q(el, '.bar--hp'),
        guard: q(el, '.bar--guard'),
        meter: q(el, '.bar--meter'),
        vHp: -1,
        vGuard: -1,
        vMeter: -1,
        key: '',
      };
    };
    this.plates = [plate('p1'), plate('p2')];
    this.elRound = q(this.root, '.clock__round');
    this.elTime = q(this.root, '.clock__time');
    this.elScore = q(this.root, '.clock__score');
    const combos = this.root.querySelectorAll<HTMLElement>('.combo');
    this.elCombo = [combos[0] as HTMLElement, combos[1] as HTMLElement];
    this.elCallout = q(this.root, '.callout');
    this.elAnnounce = q(this.root, '.announce');
    this.elAnnMain = q(this.root, '.announce__main');
    this.elAnnSub = q(this.root, '.announce__sub');
    this.elNote = q(this.root, '.hud__note');
    q<HTMLButtonElement>(this.root, '.hud__pause').addEventListener('click', () => this.onPause?.());
    this.vTime = '';
    this.vScore = -1;
    this.vCombo = [0, 0];
    this.vComboDmg = [0, 0];
  }

  show(on: boolean): void {
    this.root.hidden = !on;
  }

  /** Set everything that only changes between rounds. */
  setup(m: Readonly<MatchState>, labels: HudLabels): void {
    this.elRound.textContent = labels.round;
    this.showScore = labels.score;
    this.elScore.hidden = !labels.score;
    this.elNote.hidden = !labels.note;
    this.elNote.textContent = labels.note ?? '';
    m.fighters.forEach((f, i) => {
      const p = this.plates[i] as PlateEls;
      const look = charLook(f.char, f.skin);
      const name = labels.names[i] as string;
      const tag = labels.tags?.[i];
      p.name.innerHTML = esc(name) + (tag ? `<small>${esc(tag)}</small>` : '');
      p.root.style.setProperty('--accent', look.accent);
      p.hp.setAttribute('aria-label', t('hud.hp', { name }));
      p.guard.setAttribute('aria-label', t('hud.guard', { name }));
      p.meter.setAttribute('aria-label', t('hud.meter', { name }));
      const key = `${f.char}:${f.skin}`;
      if (p.key !== key) {
        p.key = key;
        const ctx = p.face.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, 96, 96);
          drawPortrait(ctx, f.char, f.skin, { x: 0, y: 0, w: 96, h: 96 }, { flip: i === 1 });
        }
      }
      p.vHp = p.vGuard = p.vMeter = -1;
    });
    this.clearAnnounce();
    this.update(m, 0);
  }

  private gauge(p: PlateEls, f: Readonly<Fighter>): void {
    const hp = Math.max(0, Math.round((f.hp / f.maxHp) * 1000) / 1000);
    if (hp !== p.vHp) {
      p.vHp = hp;
      p.hp.style.setProperty('--v', String(hp));
      p.hp.setAttribute('aria-valuenow', String(Math.round(hp * 100)));
      p.hp.classList.toggle('is-low', hp <= 0.28);
    }
    const guard = Math.round((f.guard / f.maxGuard) * 100) / 100;
    if (guard !== p.vGuard) {
      p.vGuard = guard;
      p.guard.style.setProperty('--v', String(guard));
      p.guard.setAttribute('aria-valuenow', String(Math.round(guard * 100)));
      p.guard.classList.toggle('is-broken', f.state === 'guardbreak' || guard < 0.25);
    }
    const meter = Math.round((f.meter / METER_MAX) * 100) / 100;
    if (meter !== p.vMeter) {
      p.vMeter = meter;
      p.meter.style.setProperty('--v', String(meter));
      p.meter.setAttribute('aria-valuenow', String(Math.round(meter * 100)));
      p.meter.classList.toggle('is-full', meter >= 1);
    }
  }

  /** Per-frame refresh. */
  update(m: Readonly<MatchState>, score: number): void {
    this.gauge(this.plates[0], m.fighters[0]);
    this.gauge(this.plates[1], m.fighters[1]);

    const time = m.training ? '∞' : String(Math.ceil(m.timer / TICK_RATE));
    if (time !== this.vTime) {
      this.vTime = time;
      this.elTime.textContent = time;
      this.elTime.classList.toggle('is-low', !m.training && m.timer <= 10 * TICK_RATE);
    }
    if (this.showScore && score !== this.vScore) {
      this.vScore = score;
      this.elScore.textContent = String(score).padStart(6, '0');
    }

    for (let i = 0; i < 2; i++) {
      const f = m.fighters[i] as Fighter;
      const el = this.elCombo[i] as HTMLElement;
      const n = f.combo >= 2 ? f.combo : 0;
      if (n !== this.vCombo[i]) {
        const grew = n > (this.vCombo[i] as number);
        this.vCombo[i] = n;
        el.hidden = n === 0;
        if (n > 0) {
          (el.firstElementChild as HTMLElement).textContent = String(n);
          if (grew) {
            el.classList.remove('is-pop');
            void el.offsetWidth;
            el.classList.add('is-pop');
          }
        }
      }
      if (n > 0 && f.comboDmg !== this.vComboDmg[i]) {
        this.vComboDmg[i] = f.comboDmg;
        (el.lastElementChild as HTMLElement).textContent = String(Math.round(f.comboDmg));
      }
    }
  }

  /** Brief word near the top: JUST GUARD, COUNTER, GUARD BREAK… */
  callout(text: string, tone: 'cool' | 'warn' | 'gold' = 'cool'): void {
    const el = this.elCallout;
    el.textContent = text;
    el.dataset.tone = tone;
    el.classList.remove('is-on');
    void el.offsetWidth;
    el.classList.add('is-on');
  }

  /** Big centre-screen call: ROUND 1, FIGHT!, K.O. */
  announce(main: string, sub = '', ms = 1300, tone: 'normal' | 'ko' = 'normal'): void {
    window.clearTimeout(this.announceTimer);
    this.elAnnMain.textContent = main;
    this.elAnnSub.textContent = sub;
    this.elAnnounce.dataset.tone = tone;
    this.elAnnounce.classList.remove('is-on');
    void this.elAnnounce.offsetWidth;
    this.elAnnounce.classList.add('is-on');
    if (ms > 0) this.announceTimer = window.setTimeout(() => this.clearAnnounce(), ms);
  }

  clearAnnounce(): void {
    window.clearTimeout(this.announceTimer);
    this.elAnnMain.textContent = '';
    this.elAnnSub.textContent = '';
    this.elAnnounce.classList.remove('is-on');
  }

  setNote(text: string): void {
    this.elNote.hidden = !text;
    this.elNote.textContent = text;
  }
}

/** Display name of a fighter's character. */
export function ringName(f: Readonly<Fighter>): string {
  return CHARS[f.char].ringName;
}
