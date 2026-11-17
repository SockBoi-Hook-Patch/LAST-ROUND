/**
 * Application controller: owns the frame loop and moves the game between
 * the title, fighter select, fights, upgrades and results.
 */
import { audio } from '../audio';
import type { SfxId } from '../audio';
import { Renderer } from '../render/renderer';
import { aiInput, aiParamsForLevel, createAi } from '../sim/ai';
import type { AiState } from '../sim/ai';
import { CHARS, METER_MAX, PLAYABLE, STAGE_W, TICK_RATE } from '../sim/data';
import { createMatch, stepMatch } from '../sim/match';
import { IN } from '../sim/types';
import type { CharId, InputMask, MatchState, SimEvent } from '../sim/types';
import { Hud } from '../ui/hud';
import { setLang, t } from '../ui/i18n';
import type { Lang } from '../ui/i18n';
import { Screens, touchMarkup } from '../ui/screens';
import type { DummyMode } from '../ui/screens';
import { loadSettings, reducedMotion, saveSettings } from '../ui/settings';
import type { MotionPref, Settings } from '../ui/settings';
import { Input } from './input';
import {
  PARRY_SCORE,
  TOTAL_ROUNDS,
  applyUpgrade,
  createRun,
  currentOpponent,
  finishRound,
  hitScore,
  opponentAi,
  opponentInit,
  playerInit,
  rollUpgrades,
} from './survival';
import type { RunState } from './survival';

export type FightKind = 'attract' | 'survival' | 'training' | 'online';

const TICK_MS = 1000 / TICK_RATE;
/** Slow-motion factor and length after a knockout. */
const KO_SLOW = 0.32;
const KO_SLOW_TICKS = 38;

export interface Fight {
  kind: FightKind;
  m: MatchState;
  /** CPU driving fighter 0 (attract mode only). */
  aiP: AiState | null;
  /** CPU driving fighter 1. */
  ai: AiState | null;
  /** Fighter positions on the previous tick, for interpolation. */
  prev: Float64Array;
  flash: Float32Array;
  acc: number;
  slow: number;
  ended: boolean;
  /** Player's health when the round began. */
  hpStart: number;
  dummy: DummyMode;
  /** Which fighter the local player controls. */
  me: 0 | 1;
}

function randomSeed(): number {
  return ((Math.random() * 0x7fffffff) ^ Date.now()) >>> 0;
}

export class App {
  readonly settings: Settings;
  readonly input = new Input();
  readonly renderer: Renderer;
  readonly hud: Hud;
  readonly screens: Screens;

  fight: Fight | null = null;
  run: RunState | null = null;
  paused = false;
  /** Stage clock in seconds; stops while paused. */
  time = 0;
  reduced = false;

  private readonly elApp: HTMLElement;
  private readonly elTouch: HTMLElement;
  private readonly elLive: HTMLElement;
  private lastMs = 0;
  private frames = 0;
  private trainingChar: CharId = 'switch';
  private readyShown = false;
  /** Feature hook: adds the online entry when a match server is configured. */
  online: { available: boolean; open: () => void } | null = null;

  constructor() {
    this.settings = loadSettings();
    setLang(this.settings.lang);
    this.elApp = document.getElementById('app') as HTMLElement;
    this.elTouch = document.getElementById('touch') as HTMLElement;
    this.elLive = document.getElementById('live') as HTMLElement;
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    const playfield = document.getElementById('playfield') as HTMLElement;

    this.renderer = new Renderer(canvas, playfield, () => {
      if (this.fight && this.fight.kind !== 'attract' && !this.paused) audio.play('train', { gain: 0.5 });
    });
    this.hud = new Hud(document.getElementById('hud') as HTMLElement);
    this.screens = new Screens(document.getElementById('screen') as HTMLElement);
    this.hud.onPause = () => this.pause();
    this.input.onPause = () => this.pause();
    this.input.onTouchSeen = () => this.syncTouch();
    this.screens.onSound = (kind) => audio.play(kind === 'move' ? 'uiMove' : kind === 'back' ? 'uiBack' : 'uiSelect');

    this.applyAudioSettings();
    this.applyMotion();
    this.buildTouch();

    // Browsers only allow sound after a gesture: try on every early gesture.
    const unlock = (): void => {
      if (!audio.unlocked) void audio.unlock();
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchend', unlock, { passive: true });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') this.pause();
    });
    try {
      window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => this.applyMotion());
    } catch {
      /* older browsers: the setting is read once at start */
    }
  }

  start(): void {
    this.goTitle();
    requestAnimationFrame((ms) => {
      this.lastMs = ms;
      this.frame(ms);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Settings                                                          */
  /* ---------------------------------------------------------------- */

  private applyAudioSettings(): void {
    const s = this.settings;
    audio.setVolume('master', s.master);
    audio.setVolume('music', s.music);
    audio.setVolume('sfx', s.sfx);
    audio.setMuted(s.muted);
  }

  private applyMotion(): void {
    this.reduced = reducedMotion(this.settings);
    document.documentElement.classList.toggle('reduce-motion', this.reduced);
  }

  private buildTouch(): void {
    this.elTouch.innerHTML = touchMarkup();
    this.input.bindTouch(this.elTouch);
  }

  /** Touch controls are shown during fights on touch devices. */
  private syncTouch(): void {
    let coarse = false;
    try {
      coarse = window.matchMedia('(pointer: coarse)').matches;
    } catch {
      coarse = false;
    }
    const playing = !!this.fight && this.fight.kind !== 'attract' && !this.fight.ended && !this.screens.isOpen;
    this.elTouch.hidden = !(playing && (coarse || this.input.touchSeen));
  }

  private setMode(mode: 'menu' | 'fight'): void {
    this.elApp.dataset.mode = mode;
    this.input.enabled = mode === 'fight';
    if (mode !== 'fight') this.input.clear();
    this.syncTouch();
  }

  private say(text: string): void {
    this.elLive.textContent = text;
  }

  /* ---------------------------------------------------------------- */
  /* Navigation                                                        */
  /* ---------------------------------------------------------------- */

  goTitle(): void {
    this.run = null;
    this.paused = false;
    if (!this.fight || this.fight.kind !== 'attract') this.startAttract();
    this.hud.show(false);
    audio.setMusic('menu');
    audio.setIntensity(0);
    this.screens.title({
      bestScore: this.settings.bestScore,
      bestRound: this.settings.bestRound,
      online: !!this.online?.available,
      onSurvival: () => this.goSelect('survival'),
      onTraining: () => this.goSelect('training'),
      onOnline: () => this.online?.open(),
      onHowto: () => this.goHowto(() => this.goTitle()),
      onSettings: () => this.goSettings(() => this.goTitle()),
    });
    this.setMode('menu');
  }

  goSelect(mode: 'survival' | 'training'): void {
    const initial = (PLAYABLE.includes(this.settings.lastChar as CharId) ? this.settings.lastChar : 'switch') as CharId;
    this.screens.select({
      initial,
      reducedMotion: this.reduced,
      heading: mode === 'training' ? `${t('menu.training')} — ${t('select.title')}` : undefined,
      onPick: (c) => {
        this.settings.lastChar = c;
        saveSettings(this.settings);
        if (mode === 'survival') this.startRun(c);
        else this.startTraining(c);
      },
      onBack: () => this.goTitle(),
    });
    this.setMode('menu');
  }

  goHowto(back: () => void): void {
    this.screens.howto({ onBack: back });
    this.setMode('menu');
  }

  goSettings(back: () => void): void {
    this.screens.settings({
      settings: this.settings,
      audioSupported: audio.supported,
      onVolume: (kind, v) => {
        this.settings[kind] = v;
        audio.setVolume(kind, v);
        saveSettings(this.settings);
      },
      onMute: (muted) => {
        this.settings.muted = muted;
        audio.setMuted(muted);
        saveSettings(this.settings);
      },
      onTest: () => audio.play('hitHeavy'),
      onLang: (lang: Lang) => {
        if (lang === this.settings.lang) return;
        this.settings.lang = lang;
        saveSettings(this.settings);
        setLang(lang);
        // Rebuild everything that carries text.
        this.hud.build();
        this.buildTouch();
        if (this.fight?.kind === 'online') this.onHudRebuild?.();
        else if (this.fight && this.fight.kind !== 'attract') this.setupHud();
        this.goSettings(back);
      },
      onMotion: (m: MotionPref) => {
        this.settings.motion = m;
        saveSettings(this.settings);
        this.applyMotion();
      },
      onBack: back,
    });
    this.setMode('menu');
  }

  /* ---------------------------------------------------------------- */
  /* Fights                                                            */
  /* ---------------------------------------------------------------- */

  private newFight(kind: FightKind, m: MatchState): Fight {
    const f: Fight = {
      kind,
      m,
      aiP: null,
      ai: null,
      prev: new Float64Array([m.fighters[0].x, m.fighters[0].y, m.fighters[1].x, m.fighters[1].y]),
      flash: new Float32Array(2),
      acc: 0,
      slow: 0,
      ended: false,
      hpStart: m.fighters[0].hp,
      dummy: 'stand',
      me: 0,
    };
    this.fight = f;
    this.paused = false;
    this.renderer.vfx.reset();
    this.renderer.snapCamera(m);
    return f;
  }

  /** CPU sparring behind the menus. */
  private startAttract(): void {
    const a = PLAYABLE[Math.floor(Math.random() * PLAYABLE.length)] as CharId;
    let b = PLAYABLE[Math.floor(Math.random() * PLAYABLE.length)] as CharId;
    if (b === a) b = PLAYABLE[(PLAYABLE.indexOf(a) + 1) % PLAYABLE.length] as CharId;
    const m = createMatch({ char: a }, { char: b, skin: 1 + Math.floor(Math.random() * 2) }, { skipIntro: true });
    const f = this.newFight('attract', m);
    f.aiP = createAi(aiParamsForLevel(6), randomSeed());
    f.ai = createAi(aiParamsForLevel(6), randomSeed());
  }

  startRun(char: CharId): void {
    this.run = createRun(char, randomSeed());
    this.startRound();
  }

  /** Begin the fight for `run.round`. */
  startRound(): void {
    const run = this.run;
    if (!run) return;
    const opp = currentOpponent(run);
    const m = createMatch(playerInit(run), opponentInit(opp));
    const f = this.newFight('survival', m);
    f.ai = createAi(opponentAi(opp), (run.seed ^ Math.imul(run.round, 0x85ebca6b)) >>> 0);
    this.screens.close();
    this.setupHud();
    this.hud.show(true);
    this.setMode('fight');
    const call = opp.boss ? 'FINAL ROUND' : `ROUND ${run.round}`;
    this.hud.announce(call, `VS ${opp.name}`, 1500);
    this.say(`${call} — ${opp.name}`);
    audio.play('roundStart');
    audio.setMusic(opp.boss ? 'boss' : 'fight');
    audio.setIntensity(0);
  }

  startTraining(char: CharId): void {
    this.run = null;
    this.trainingChar = char;
    const partner = PLAYABLE[(PLAYABLE.indexOf(char) + 1) % PLAYABLE.length] as CharId;
    const keep = this.fight?.kind === 'training' ? this.fight.dummy : 'stand';
    const m = createMatch({ char }, { char: partner, skin: 1 }, { training: true, skipIntro: true });
    const f = this.newFight('training', m);
    f.dummy = keep;
    f.ai = createAi(aiParamsForLevel(4), randomSeed());
    this.screens.close();
    this.setupHud();
    this.hud.show(true);
    this.setMode('fight');
    audio.setMusic('interlude');
    audio.setIntensity(0);
    this.say(t('hud.training'));
  }

  private setupHud(): void {
    const f = this.fight;
    if (!f) return;
    const [a, b] = f.m.fighters;
    if (f.kind === 'survival' && this.run) {
      const opp = currentOpponent(this.run);
      this.hud.setup(f.m, {
        round: t('hud.round', { n: this.run.round, total: TOTAL_ROUNDS }),
        names: [CHARS[a.char].ringName, opp.name],
        score: true,
      });
    } else if (f.kind === 'training') {
      this.hud.setup(f.m, {
        round: t('hud.training'),
        names: [CHARS[a.char].ringName, CHARS[b.char].ringName],
        score: false,
        note: `${t('train.dummy')}: ${t(`train.${f.dummy}`)} · Esc`,
      });
    }
  }

  /** Called by features that run their own fights (online). */
  beginExternalFight(kind: FightKind, m: MatchState, me: 0 | 1): Fight {
    const f = this.newFight(kind, m);
    f.me = me;
    this.screens.close();
    this.hud.show(true);
    this.setMode('fight');
    return f;
  }

  /** The external fight has finished and a result screen is showing. */
  endExternalFight(): void {
    this.setMode('menu');
  }

  pause(): void {
    const f = this.fight;
    if (!f || f.kind === 'attract' || f.ended || this.paused || this.screens.isOpen) return;
    if (f.kind === 'online') {
      // An online match cannot be frozen: the menu opens over the live fight.
      this.openPauseMenu();
      return;
    }
    this.paused = true;
    this.openPauseMenu();
  }

  private openPauseMenu(): void {
    const f = this.fight;
    if (!f) return;
    const reopen = (): void => this.openPauseMenu();
    this.screens.pause({
      training: f.kind === 'training',
      online: f.kind === 'online',
      dummy: f.dummy,
      onResume: () => this.resume(),
      onRestart: () => {
        if (f.kind === 'training') this.startTraining(this.trainingChar);
        else if (this.run) this.startRun(this.run.char);
      },
      onDummy: (d) => {
        f.dummy = d;
        this.setupHud();
      },
      onHowto: () => this.goHowto(reopen),
      onSettings: () => this.goSettings(reopen),
      onQuit: () => this.quitFight(),
    });
    this.setMode('menu');
  }

  /** Overridable by the online feature to leave the room first. */
  onQuitFight: (() => void) | null = null;

  private quitFight(): void {
    const hook = this.onQuitFight;
    this.onQuitFight = null;
    hook?.();
    this.fight = null;
    this.goTitle();
  }

  resume(): void {
    this.screens.close();
    this.paused = false;
    this.lastMs = performance.now();
    this.setMode('fight');
  }

  /* ---------------------------------------------------------------- */
  /* Simulation                                                        */
  /* ---------------------------------------------------------------- */

  private dummyInput(f: Fight): InputMask {
    switch (f.dummy) {
      case 'guard':
        return IN.BLOCK;
      case 'jump':
        return f.m.tick % 80 < 3 ? IN.JUMP : 0;
      case 'cpu':
        return f.ai ? aiInput(f.ai, f.m, 1) : 0;
      default:
        return 0;
    }
  }

  private stepFight(f: Fight): void {
    const m = f.m;
    f.prev[0] = m.fighters[0].x;
    f.prev[1] = m.fighters[0].y;
    f.prev[2] = m.fighters[1].x;
    f.prev[3] = m.fighters[1].y;

    let in0: InputMask = 0;
    let in1: InputMask = 0;
    if (f.kind === 'attract') {
      in0 = f.aiP ? aiInput(f.aiP, m, 0) : 0;
      in1 = f.ai ? aiInput(f.ai, m, 1) : 0;
    } else if (f.kind === 'survival') {
      in0 = this.input.consume();
      in1 = f.ai ? aiInput(f.ai, m, 1) : 0;
    } else if (f.kind === 'training') {
      in0 = this.input.consume();
      in1 = this.dummyInput(f);
    }
    stepMatch(m, in0, in1);
    this.afterTick(f);
  }

  /** Effects, sound and scoring for the tick that was just simulated. */
  afterTick(f: Fight): void {
    const m = f.m;
    const vfx = this.renderer.vfx;
    const quiet = f.kind === 'attract';
    for (const e of m.events) {
      vfx.onEvent(e, m, this.reduced);
      if (!quiet) this.onEvent(f, e);
    }
    vfx.update(m);
    this.renderer.followCamera(m);
    f.flash[0] = (f.flash[0] as number) * 0.72;
    f.flash[1] = (f.flash[1] as number) * 0.72;
    if (f.slow > 0) f.slow--;

    if (f.kind === 'training') this.trainingUpkeep(f);

    if (!quiet && m.phase === 'fight' && !m.training && m.timer <= 10 * TICK_RATE && m.timer > 0 && m.timer % TICK_RATE === 0) {
      audio.play('timerTick');
    }

    if (m.phase === 'over' && !f.ended) {
      f.ended = true;
      if (f.kind === 'attract') this.startAttract();
      else if (f.kind === 'survival') this.finishSurvivalRound(f);
    }
  }

  private trainingUpkeep(f: Fight): void {
    const [p, d] = f.m.fighters;
    // Gauges drift back up so everything can be practised without waiting.
    if (p.combo === 0 && d.state !== 'hit' && d.state !== 'hitHeavy' && d.state !== 'launch' && d.hp < d.maxHp) d.hp = Math.min(d.maxHp, d.hp + 6);
    if (d.combo === 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 6);
    if (p.meter < METER_MAX && !(p.state === 'attack' && p.move === 'SP')) p.meter = Math.min(METER_MAX, p.meter + 0.35);
    // Keep the pair from getting stuck in a corner forever.
    if (f.dummy === 'stand' && d.state === 'idle' && (d.x < 140 || d.x > STAGE_W - 140) && p.combo === 0) {
      d.x += d.x < STAGE_W / 2 ? 1.2 : -1.2;
    }
  }

  private pan(x: number): number {
    const k = ((x - this.renderer.camX) / this.renderer.viewW) * 2 - 1;
    return Math.max(-0.8, Math.min(0.8, k));
  }

  private onEvent(f: Fight, e: SimEvent): void {
    const run = f.kind === 'survival' ? this.run : null;
    const me = f.me;
    switch (e.type) {
      case 'hit': {
        const victim = e.attacker === 0 ? 1 : 0;
        f.flash[victim] = e.strength === 'light' ? 0.6 : 1;
        const id: SfxId = e.strength === 'light' ? 'hitLight' : e.strength === 'heavy' ? 'hitHeavy' : e.strength === 'finisher' ? 'hitFinisher' : 'hitSpecial';
        audio.play(id, { pan: this.pan(e.x) });
        if (e.launch) audio.play('knockdown', { pan: this.pan(e.x), gain: 0.5 });
        if (e.counter) this.hud.callout('COUNTER', 'gold');
        if (run) {
          if (e.attacker === 0) {
            run.score += hitScore(e.damage, e.combo);
            run.stats.damageDealt += e.damage;
            if (e.combo > run.stats.maxCombo) run.stats.maxCombo = e.combo;
          } else {
            run.stats.damageTaken += e.damage;
          }
        }
        break;
      }
      case 'block':
        audio.play(e.parry ? 'parry' : 'block', { pan: this.pan(e.x) });
        if (e.parry) {
          this.hud.callout('JUST GUARD', 'cool');
          if (run && e.defender === 0) {
            run.score += PARRY_SCORE;
            run.stats.parries++;
          }
        }
        break;
      case 'guardbreak':
        audio.play('guardBreak', { pan: this.pan(e.x) });
        this.hud.callout('GUARD BREAK', 'warn');
        break;
      case 'swing':
        audio.play(e.strength === 'light' ? 'swingLight' : 'swingHeavy', { pan: this.pan(e.x), gain: 0.7 });
        break;
      case 'jump':
        audio.play('jump', { pan: this.pan(e.x), gain: 0.6 });
        break;
      case 'land':
        audio.play(e.hard ? 'knockdown' : 'land', { pan: this.pan(e.x), gain: e.hard ? 1 : 0.6 });
        break;
      case 'dodge':
        audio.play('dodge', { pan: this.pan(e.x) });
        break;
      case 'special':
        audio.play('specialStart', { pan: this.pan(e.x) });
        this.hud.callout('OVERDRIVE', 'gold');
        break;
      case 'meterFull':
        if (e.who === me) audio.play('meterFull');
        break;
      case 'ko':
        audio.play('ko');
        f.slow = KO_SLOW_TICKS;
        break;
      case 'phase':
        if (e.phase === 'fight') {
          this.hud.announce('FIGHT!', '', 800);
          audio.play('fight');
        } else if (e.phase === 'ko') {
          const text = f.m.winner === 2 ? 'DOUBLE K.O.' : 'K.O.';
          this.hud.announce(text, '', 2300, 'ko');
          this.say(text);
        } else if (e.phase === 'timeup') {
          this.hud.announce('TIME UP', '', 2000);
          this.say('TIME UP');
        }
        break;
    }
  }

  private finishSurvivalRound(f: Fight): void {
    const run = this.run;
    if (!run) return;
    const opponent = currentOpponent(run);
    const cleared = run.round;
    const taken = Math.max(0, f.hpStart - f.m.fighters[0].hp);
    const breakdown = finishRound(run, f.m, taken);
    this.hud.show(false);
    this.hud.clearAnnounce();
    audio.setIntensity(0);

    if (run.outcome === 'active') {
      audio.play('roundClear');
      audio.setMusic('interlude');
      this.screens.clear({
        run,
        cleared,
        breakdown,
        choices: rollUpgrades(run),
        next: currentOpponent(run),
        onPick: (id) => {
          applyUpgrade(run, id);
          audio.play('upgrade');
          this.startRound();
        },
      });
      this.setMode('menu');
      return;
    }

    const won = run.outcome === 'won';
    const reached = won ? TOTAL_ROUNDS : cleared;
    const newBest = run.score > this.settings.bestScore;
    if (newBest) this.settings.bestScore = run.score;
    if (reached > this.settings.bestRound) this.settings.bestRound = reached;
    saveSettings(this.settings);
    audio.play(won ? 'victory' : 'defeat');
    audio.setMusic(won ? 'menu' : 'interlude');
    this.screens.result({
      won,
      run,
      opponent,
      bestScore: this.settings.bestScore,
      newBest,
      onRetry: () => this.startRun(run.char),
      onChange: () => this.goSelect('survival'),
      onHome: () => this.goTitle(),
    });
    this.setMode('menu');
  }

  /* ---------------------------------------------------------------- */
  /* Frame loop                                                        */
  /* ---------------------------------------------------------------- */

  /** Optional per-frame hook for features that drive their own fight. */
  onFrame: ((dtMs: number) => void) | null = null;
  /** Re-applies HUD labels of an external fight after the HUD is rebuilt. */
  onHudRebuild: (() => void) | null = null;

  private frame(ms: number): void {
    // Whatever happens while drawing this frame, the loop must keep running.
    requestAnimationFrame((t2) => this.frame(t2));
    try {
      this.frameBody(ms);
    } catch (err) {
      console.error(err);
    }
  }

  private frameBody(ms: number): void {
    const dt = Math.min(100, Math.max(0, ms - this.lastMs));
    this.lastMs = ms;
    this.frames++;
    const f = this.fight;

    if (f && !this.paused) {
      if (f.kind === 'online') {
        this.onFrame?.(dt);
        this.time += dt / 1000;
      } else {
        const rate = f.slow > 0 && !this.reduced ? KO_SLOW : 1;
        f.acc += dt * rate;
        let steps = 0;
        while (f.acc >= TICK_MS && steps < 6) {
          f.acc -= TICK_MS;
          steps++;
          this.stepFight(f);
          if (this.fight !== f) break;
        }
        if (steps === 6) f.acc = 0;
        this.time += (dt / 1000) * rate;
      }
    }

    const cur = this.fight;
    // While paused nothing moves: redraw only now and then (resizes).
    if (cur && (!this.paused || this.frames % 12 === 0)) {
      this.renderer.draw(cur.m, {
        time: this.time,
        alpha: cur.kind === 'online' ? 1 : Math.min(1, cur.acc / TICK_MS),
        prev: cur.prev,
        flash: cur.flash,
        reducedMotion: this.reduced,
        veil: 0,
      });
      if (cur.kind !== 'attract') {
        this.hud.update(cur.m, this.run?.score ?? 0);
        const meFighter = cur.m.fighters[cur.me];
        const ready = meFighter.meter >= METER_MAX;
        const sp = this.elTouch.querySelector('.tbtn--special');
        if (sp && sp.classList.contains('is-ready') !== ready) sp.classList.toggle('is-ready', ready);
        if (cur.kind === 'survival' && cur.m.phase === 'fight') {
          const low = meFighter.hp / meFighter.maxHp;
          audio.setIntensity(low < 0.35 ? 1 : low < 0.6 ? 0.5 : 0.15);
        }
      }
    }

    if (!this.readyShown) {
      this.readyShown = true;
      this.elApp.dataset.ready = '1';
    }
  }
}
