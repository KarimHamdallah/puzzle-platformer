/** Every logical action the game understands. Game code never asks for raw keys. */
export const ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'attack', 'interact', 'reset'] as const;
export type Action = (typeof ACTIONS)[number];

export interface Bindings {
  /**
   * KeyboardEvent.code values = PHYSICAL keys ('KeyZ', 'Space', 'ArrowLeft').
   * Physical codes keep working when the OS layout is Arabic/AZERTY/etc.
   */
  keys: Record<Action, readonly string[]>;
  /** Standard-mapping gamepad button indices (0 = A / Cross, 2 = X / Square, 12-15 = d-pad). */
  pad: Record<Action, readonly number[]>;
}

export const DEFAULT_BINDINGS: Bindings = {
  keys: {
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    up: ['ArrowUp', 'KeyW'],
    down: ['ArrowDown', 'KeyS'],
    jump: ['Space', 'KeyZ', 'KeyK'],
    attack: ['KeyX', 'KeyJ'],
    interact: ['KeyE', 'KeyC'],
    reset: ['KeyR'],
  },
  pad: {
    left: [14],
    right: [15],
    up: [12],
    down: [13],
    jump: [0],
    attack: [2],
    interact: [3],
    reset: [8],
  },
};
