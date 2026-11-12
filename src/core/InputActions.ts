import type GUI from 'lil-gui';
import { DEBUG_ENABLED, debug } from './Debug';

/** Logical actions. Game code asks for actions, never for keys. */
export enum Action {
  Left,
  Right,
  Up, // aim: raise the throw arc
  Down, // ground: crouch / sneak. air: fast fall. aim: lower the arc
  Jump,
  Sprint,
  Throw, // hold to aim, release to throw
  Reset,
  Count, // number of actions, keep last
}

/** Key -> action. Keys are KeyboardEvent.code = PHYSICAL keys, so they still work with an Arabic layout. */
const KEY_BINDINGS = new Map<string, Action>([
  ['ArrowLeft', Action.Left],
  ['KeyA', Action.Left],
  ['ArrowRight', Action.Right],
  ['KeyD', Action.Right],
  ['ArrowUp', Action.Up],
  ['KeyW', Action.Up],
  ['ArrowDown', Action.Down],
  ['KeyS', Action.Down],
  ['KeyC', Action.Down],
  ['Space', Action.Jump],
  ['KeyZ', Action.Jump],
  ['KeyK', Action.Jump],
  ['ShiftLeft', Action.Sprint],
  ['ShiftRight', Action.Sprint],
  ['KeyE', Action.Throw],
  ['KeyF', Action.Throw],
  ['KeyR', Action.Reset],
]);

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
  private readonly states: ActionState[] = []; // indexed by Action
  private readonly pressedSinceUpdate: boolean[] = []; // indexed by Action
  private readonly keysDown = new Set<string>(); // key codes currently down
  private debugFolder: GUI | null = null;

  constructor() {
    for (let a = 0; a < Action.Count; a++) {
      this.states.push(new ActionState());
      this.pressedSinceUpdate.push(false);
    }

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
    const action = KEY_BINDINGS.get(key.code);
    if (action === undefined) return; // not one of our keys

    if (key.type === 'keydown') {
      if (isTypingIntoField(key.target)) return; // typing a number into the debug panel
      key.preventDefault(); // Space / arrows must not scroll the page
      this.onKeyDown(key.code, action, key.timeStamp);
    } else {
      this.onKeyUp(key.code, action);
    }
  }

  private onKeyDown(code: string, action: Action, time: number): void {
    if (this.keysDown.has(code)) return; // OS auto-repeat: the key is already down
    this.keysDown.add(code);

    const s = this.states[action];
    if (s.held) return; // another key of the same action is already down: not a new press
    s.held = true;
    s.pressTime = time; // the real moment of the keypress, not the frame time
    s.consumed = false;
    this.pressedSinceUpdate[action] = true;
  }

  private onKeyUp(code: string, action: Action): void {
    if (!this.keysDown.delete(code)) return; // wasn't down (e.g. pressed before the page had focus)
    this.states[action].held = this.anyKeyDown(action);
  }

  private anyKeyDown(action: Action): boolean {
    for (const [code, boundAction] of KEY_BINDINGS) {
      if (boundAction === action && this.keysDown.has(code)) return true;
    }
    return false;
  }

  private releaseAll(): void {
    this.keysDown.clear();
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

function isTypingIntoField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
