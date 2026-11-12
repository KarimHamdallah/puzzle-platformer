import type GUI from 'lil-gui';
import { DEBUG_ENABLED, debug } from './Debug';

/** Logical actions. Game code asks for actions, never for keys. */
export enum Action {
  Left,
  Right,
  Down,
  Jump,
  Reset,
  Count, // number of actions, keep last
}

interface Binding {
  code: string; // KeyboardEvent.code = PHYSICAL key, so it still works with an Arabic layout
  action: Action;
}

const BINDINGS: Binding[] = [
  { code: 'ArrowLeft', action: Action.Left },
  { code: 'KeyA', action: Action.Left },
  { code: 'ArrowRight', action: Action.Right },
  { code: 'KeyD', action: Action.Right },
  { code: 'ArrowDown', action: Action.Down },
  { code: 'KeyS', action: Action.Down },
  { code: 'Space', action: Action.Jump },
  { code: 'KeyZ', action: Action.Jump },
  { code: 'KeyK', action: Action.Jump },
  { code: 'KeyR', action: Action.Reset },
];

class ActionState {
  held = false; // at least one bound key is down
  pressed = false; // went down since the previous update() (latched once per frame)
  pressTime = -Infinity; // timestamp of the last press, ms (same clock as performance.now())
  consumed = false; // the last press was already used (e.g. it already made the player jump)
}

/**
 * Keyboard -> actions. Like an SDL event loop:
 *   - The browser calls handleEvent() for every keydown / keyup / window blur, at any time.
 *   - The scene calls update() once at the start of each frame to latch `pressed`.
 *
 * Why not Phaser's keyboard: Phaser 3.90 re-processes its whole per-frame key queue on every DOM
 * event, so a quick tap + another key inside one frame replays the tap as a second press.
 */
export class InputActions {
  private readonly states: ActionState[] = [];
  private readonly keyDown: boolean[] = []; // one entry per BINDINGS row
  private readonly pressedSinceUpdate: boolean[] = []; // one entry per Action
  private debugFolder: GUI | null = null;

  constructor() {
    for (let a = 0; a < Action.Count; a++) {
      this.states.push(new ActionState());
      this.pressedSinceUpdate.push(false);
    }
    for (let i = 0; i < BINDINGS.length; i++) this.keyDown.push(false);

    // Passing `this` as the listener: the browser calls this.handleEvent(event).
    window.addEventListener('keydown', this);
    window.addEventListener('keyup', this);
    window.addEventListener('blur', this);

    if (DEBUG_ENABLED) this.createDebugFolder();
  }

  destroy(): void {
    window.removeEventListener('keydown', this);
    window.removeEventListener('keyup', this);
    window.removeEventListener('blur', this);
    if (this.debugFolder) this.debugFolder.destroy();
  }

  /** Call once at the start of every frame, before reading pressed(). */
  update(): void {
    for (let a = 0; a < Action.Count; a++) {
      this.states[a].pressed = this.pressedSinceUpdate[a];
      this.pressedSinceUpdate[a] = false;
    }
  }

  // ---------------------------------------------------------------- queries

  held(action: Action): boolean {
    return this.states[action].held;
  }

  /** True for exactly one frame per press. */
  pressed(action: Action): boolean {
    return this.states[action].pressed;
  }

  /** Pressed within the last `windowMs` and not consumed yet. This is the jump buffer. */
  buffered(action: Action, windowMs: number): boolean {
    const s = this.states[action];
    return !s.consumed && performance.now() - s.pressTime <= windowMs;
  }

  /** Mark the last press as used, so one press can never trigger twice. */
  consume(action: Action): void {
    this.states[action].consumed = true;
  }

  /** -1, 0 or +1. Left and right both held: the most recent press wins. */
  get moveX(): number {
    const left = this.states[Action.Left];
    const right = this.states[Action.Right];
    if (left.held && right.held) return left.pressTime > right.pressTime ? -1 : 1;
    if (left.held) return -1;
    if (right.held) return 1;
    return 0;
  }

  // ---------------------------------------------------------------- events

  handleEvent(e: Event): void {
    if (e.type === 'blur') {
      this.releaseAll(); // focus lost: the keyup events will never arrive
      return;
    }
    const key = e as KeyboardEvent;
    const i = findBinding(key.code);
    if (i < 0) return;

    if (key.type === 'keydown') {
      if (isTypingIntoField(key.target)) return; // typing a number into the debug panel
      key.preventDefault(); // Space / arrows must not scroll the page
      this.onKeyDown(i, key.timeStamp);
    } else {
      this.onKeyUp(i);
    }
  }

  private onKeyDown(binding: number, time: number): void {
    if (this.keyDown[binding]) return; // OS auto-repeat: the key is already down
    this.keyDown[binding] = true;

    const s = this.states[BINDINGS[binding].action];
    if (s.held) return; // another key of the same action is already down: not a new press
    s.held = true;
    s.pressTime = time; // the real moment of the keypress, not the frame time
    s.consumed = false;
    this.pressedSinceUpdate[BINDINGS[binding].action] = true;
  }

  private onKeyUp(binding: number): void {
    if (!this.keyDown[binding]) return;
    this.keyDown[binding] = false;

    const action = BINDINGS[binding].action;
    this.states[action].held = this.anyKeyDown(action);
  }

  private anyKeyDown(action: Action): boolean {
    for (let i = 0; i < BINDINGS.length; i++) {
      if (BINDINGS[i].action === action && this.keyDown[i]) return true;
    }
    return false;
  }

  private releaseAll(): void {
    for (let i = 0; i < BINDINGS.length; i++) this.keyDown[i] = false;
    for (let a = 0; a < Action.Count; a++) this.states[a].held = false;
  }

  private createDebugFolder(): void {
    const folder = debug.gui.addFolder('input').close();
    for (let a = 0; a < Action.Count; a++) {
      folder.add(this.states[a], 'held').name(Action[a]).listen().disable();
    }
    folder.add(this, 'moveX').listen().disable();
    this.debugFolder = folder;
  }
}

function findBinding(code: string): number {
  for (let i = 0; i < BINDINGS.length; i++) {
    if (BINDINGS[i].code === code) return i;
  }
  return -1;
}

function isTypingIntoField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
