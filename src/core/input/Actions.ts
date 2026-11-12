/** Every logical action the game understands. Game code never asks for raw keys. */
export const ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'attack', 'interact', 'reset'] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * Keyboard bindings as KeyboardEvent.code values = PHYSICAL keys ('KeyZ', 'Space', 'ArrowLeft').
 * Physical codes keep working when the OS layout is Arabic/AZERTY/etc.
 */
export type Bindings = Record<Action, readonly string[]>;

export const DEFAULT_BINDINGS: Bindings = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  jump: ['Space', 'KeyZ', 'KeyK'],
  attack: ['KeyX', 'KeyJ'],
  interact: ['KeyE', 'KeyC'],
  reset: ['KeyR'],
};
