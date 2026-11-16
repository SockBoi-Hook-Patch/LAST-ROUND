/**
 * Player input: keyboard and on-screen touch buttons, merged into the same
 * controller mask the simulation and the match server understand.
 */
import { IN } from '../sim/types';
import type { InputMask } from '../sim/types';

export type ActionName = keyof typeof IN;

/** Physical keys (KeyboardEvent.code) per action — layout independent. */
export const KEYMAP: Record<ActionName, readonly string[]> = {
  LEFT: ['KeyA', 'ArrowLeft'],
  RIGHT: ['KeyD', 'ArrowRight'],
  JUMP: ['KeyW', 'ArrowUp', 'Space'],
  BLOCK: ['KeyS', 'ArrowDown'],
  DODGE: ['KeyL', 'KeyC', 'ShiftLeft', 'ShiftRight'],
  LIGHT: ['KeyJ', 'KeyZ'],
  HEAVY: ['KeyK', 'KeyX'],
  SPECIAL: ['KeyI', 'KeyV'],
};

export const PAUSE_KEYS: readonly string[] = ['Escape', 'KeyP'];

/** Short labels for the controls screen. */
export const KEY_LABELS: Record<ActionName, string> = {
  LEFT: 'A / ←',
  RIGHT: 'D / →',
  JUMP: 'W / ↑ / Space',
  BLOCK: 'S / ↓',
  DODGE: 'L / C / Shift',
  LIGHT: 'J / Z',
  HEAVY: 'K / X',
  SPECIAL: 'I / V',
};

const CODE_TO_BIT = new Map<string, number>();
for (const name of Object.keys(KEYMAP) as ActionName[]) {
  for (const code of KEYMAP[name]) CODE_TO_BIT.set(code, IN[name]);
}

export class Input {
  /** When false, game keys are ignored (menus have the keyboard). */
  enabled = false;
  onPause: (() => void) | null = null;
  /** Fired the first time touch input is seen, so the UI can show the pad. */
  onTouchSeen: (() => void) | null = null;
  /** True once the player has touched the screen. */
  touchSeen = false;

  private readonly keys = new Map<string, number>();
  private keyMask = 0;
  private touchMask = 0;
  /**
   * Buttons pressed since the simulation last read the pad. A tap that is
   * pressed and released between two frames would otherwise never be seen.
   */
  private latch = 0;
  /** Pointers currently holding each touch button. */
  private readonly held = new Map<number, { el: HTMLElement; bit: number }>();
  private padPointer = -1;
  private padMask = 0;

  constructor() {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') this.clear();
    });
    window.addEventListener(
      'touchstart',
      () => {
        if (this.touchSeen) return;
        this.touchSeen = true;
        this.onTouchSeen?.();
      },
      { passive: true },
    );
  }

  /** Buttons held right now (does not consume quick taps). */
  mask(): InputMask {
    return this.enabled ? this.keyMask | this.touchMask | this.padMask : 0;
  }

  /**
   * Controller mask for the next simulation tick: everything held, plus any
   * button that was tapped since the previous call.
   */
  consume(): InputMask {
    if (!this.enabled) {
      this.latch = 0;
      return 0;
    }
    const m = this.keyMask | this.touchMask | this.padMask | this.latch;
    this.latch = 0;
    return m;
  }

  /** Drop everything that is held (focus lost, pause, screen change). */
  clear(): void {
    this.keys.clear();
    this.keyMask = 0;
    this.touchMask = 0;
    this.padMask = 0;
    this.latch = 0;
    this.padPointer = -1;
    for (const h of this.held.values()) h.el.classList.remove('is-down');
    this.held.clear();
    document.querySelectorAll('.tpad .is-down').forEach((el) => el.classList.remove('is-down'));
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.enabled || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (PAUSE_KEYS.includes(e.code)) {
      if (!e.repeat) this.onPause?.();
      e.preventDefault();
      return;
    }
    const bit = CODE_TO_BIT.get(e.code);
    if (bit === undefined) return;
    // Keep arrows / space from scrolling the page during a fight.
    e.preventDefault();
    if (e.repeat) return;
    this.keys.set(e.code, bit);
    this.latch |= bit;
    this.recomputeKeys();
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (!this.keys.delete(e.code)) return;
    this.recomputeKeys();
  }

  private recomputeKeys(): void {
    let m = 0;
    for (const bit of this.keys.values()) m |= bit;
    this.keyMask = m;
  }

  /**
   * Wire the on-screen controls. Buttons carry `data-in="LIGHT"` etc.; the
   * movement pad is one element with `data-pad` so a thumb can slide between
   * left and right without lifting.
   */
  bindTouch(root: HTMLElement): void {
    root.addEventListener('contextmenu', (e) => e.preventDefault());

    root.querySelectorAll<HTMLElement>('[data-in]').forEach((el) => {
      const name = el.dataset.in as ActionName;
      const bit = IN[name];
      if (!bit) return;
      const release = (e: PointerEvent): void => {
        if (!this.held.delete(e.pointerId)) return;
        let stillDown = false;
        let m = 0;
        for (const h of this.held.values()) {
          m |= h.bit;
          if (h.el === el) stillDown = true;
        }
        this.touchMask = m;
        if (!stillDown) el.classList.remove('is-down');
      };
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* capture is a nicety */
        }
        this.held.set(e.pointerId, { el, bit });
        this.touchMask |= bit;
        if (this.enabled) this.latch |= bit;
        el.classList.add('is-down');
      });
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('lostpointercapture', release);
    });

    const pad = root.querySelector<HTMLElement>('[data-pad]');
    if (pad) {
      const left = pad.querySelector<HTMLElement>('[data-side="left"]');
      const right = pad.querySelector<HTMLElement>('[data-side="right"]');
      const update = (e: PointerEvent): void => {
        const r = pad.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dead = r.width * 0.06;
        this.padMask = dx < -dead ? IN.LEFT : dx > dead ? IN.RIGHT : 0;
        if (this.enabled) this.latch |= this.padMask;
        left?.classList.toggle('is-down', this.padMask === IN.LEFT);
        right?.classList.toggle('is-down', this.padMask === IN.RIGHT);
      };
      const end = (e: PointerEvent): void => {
        if (e.pointerId !== this.padPointer) return;
        this.padPointer = -1;
        this.padMask = 0;
        left?.classList.remove('is-down');
        right?.classList.remove('is-down');
      };
      pad.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.padPointer = e.pointerId;
        try {
          pad.setPointerCapture(e.pointerId);
        } catch {
          /* capture is a nicety */
        }
        update(e);
      });
      pad.addEventListener('pointermove', (e) => {
        if (e.pointerId === this.padPointer) update(e);
      });
      pad.addEventListener('pointerup', end);
      pad.addEventListener('pointercancel', end);
      pad.addEventListener('lostpointercapture', end);
    }
  }
}
