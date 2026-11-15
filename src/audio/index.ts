/**
 * LAST ROUND audio: fully synthesised music and sound effects.
 *
 * Usage:
 *   import { audio } from './audio';
 *   window.addEventListener('pointerdown', () => void audio.unlock());
 *   audio.setMusic('menu');
 *   audio.play('hitHeavy', { pan: 0.3 });
 */
import { createAudioEngine } from './engine';
import type { AudioEngine } from './types';

export * from './types';
export { createAudioEngine };

/** Shared engine instance used by the game. */
export const audio: AudioEngine = createAudioEngine();
