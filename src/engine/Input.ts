import type Phaser from 'phaser';
import type GUI from 'lil-gui';
import { debugPanel } from './debug/DebugPanel';

class ActionState {
  held = false; // at least one bound key is down
  pressed = false; // went down since the previous Poll() (latched once per frame)
  pressTime = -Infinity; // timestamp of the last press, ms (same clock as performance.now())
  consumed = false; // the last press was already used (e.g. it already made the player jump)
}

/**
 * Keyboard and mouse -> actions. Like an SDL event loop:
 *   - The browser calls handleEvent() for every keydown / keyup / window blur, at any time.
 *   - The engine calls Poll() once at the start of each frame to latch `pressed`.
 *   - Actions are plain numbers: the game defines its own enum and binds keys to it (Bind).
 * Keys are KeyboardEvent.code = PHYSICAL keys, so they still work with an Arabic layout.
 *
 * Why not Phaser's keyboard: Phaser 3.90 re-processes its whole per-frame key queue on every DOM
 * event, so a quick tap + another key inside one frame replays the tap as a second press.
 */
export class Input {
  /** Mouse, in screen pixels of the game (1920x1080 whatever the window size). */
  pointerX = 0;
  pointerY = 0;
  pointerPressed = false; // the button went down this frame
  wheelY = 0; // wheel movement this frame (+ = down)

  private readonly states: ActionState[] = []; // indexed by action
  private readonly pressedSinceUpdate: boolean[] = [];
  private readonly keysDown = new Set<string>(); // key codes currently down
  private readonly bindings = new Map<string, number>(); // key code -> action
  private scene: Phaser.Scene | null = null;
  private pointerSinceUpdate = false;
  private wheelSinceUpdate = 0;
  private debugFolder: GUI | null = null;

  /** How many actions the game has (its enum's Count). */
  Init(actionCount: number): void {
    for (let a = 0; a < actionCount; a++) {
      this.states.push(new ActionState());
      this.pressedSinceUpdate.push(false);
    }
    // Passing `this` as the listener: the browser calls this.handleEvent(event).
    window.addEventListener('keydown', this);
    window.addEventListener('keyup', this);
    window.addEventListener('blur', this);
  }

  Bind(code: string, action: number): void {
    this.bindings.set(code, action);
  }

  /** Engine only: mouse events come from the host scene. */
  Attach(scene: Phaser.Scene): void {
    this.scene = scene;
    scene.input.on('pointerdown', () => { this.pointerSinceUpdate = true; });
    scene.input.on('wheel', (_p: unknown, _over: unknown, _dx: number, dy: number) => { this.wheelSinceUpdate += dy; });
  }

  /** Engine only: once at the start of every frame, before anything reads pressed(). */
  Poll(): void {
    for (let a = 0; a < this.states.length; a++) {
      this.states[a].pressed = this.pressedSinceUpdate[a];
      this.pressedSinceUpdate[a] = false;
    }
    this.pointerPressed = this.pointerSinceUpdate;
    this.pointerSinceUpdate = false;
    this.wheelY = this.wheelSinceUpdate;
    this.wheelSinceUpdate = 0;
    if (this.scene) {
      const p = this.scene.input.activePointer;
      this.pointerX = p.x;
      this.pointerY = p.y;
    }
  }

  // ---------------------------------------------------------------- queries

  Held(action: number): boolean {
    return this.states[action].held;
  }

  /** True for exactly one frame per press. */
  Pressed(action: number): boolean {
    return this.states[action].pressed;
  }

  /** Pressed within the last `windowMs` and not consumed yet. This is the jump buffer. */
  Buffered(action: number, windowMs: number): boolean {
    const s = this.states[action];
    return !s.consumed && performance.now() - s.pressTime <= windowMs;
  }

  /** Mark the last press as used, so one press can never trigger twice. */
  Consume(action: number): void {
    this.states[action].consumed = true;
  }

  /** Engine: a new state starts, presses from the previous one must not leak into it. */
  ConsumeAll(): void {
    for (let a = 0; a < this.states.length; a++) {
      this.states[a].consumed = true;
      this.states[a].pressed = false;
    }
  }

  /** -1, 0 or +1 from two opposite actions. Both held: the most recent press wins. */
  Axis(negative: number, positive: number): number {
    const n = this.states[negative];
    const p = this.states[positive];
    if (n.held && p.held) return n.pressTime > p.pressTime ? -1 : 1;
    if (n.held) return -1;
    if (p.held) return 1;
    return 0;
  }

  /** CSS cursor over the game: 'pointer' over something clickable, 'default' otherwise. */
  SetCursor(cursor: string): void {
    if (this.scene) this.scene.input.setDefaultCursor(cursor);
  }

  /** A debug folder with every action's held state. */
  CreateDebugFolder(names: string[]): void {
    if (this.debugFolder) return;
    const folder = debugPanel.gui.addFolder('input').close();
    for (let a = 0; a < this.states.length; a++) {
      folder.add(this.states[a], 'held').name(names[a] ?? String(a)).listen().disable();
    }
    this.debugFolder = folder;
  }

  // ---------------------------------------------------------------- events

  handleEvent(e: Event): void {
    if (e.type === 'blur') {
      this.ReleaseAll(); // focus lost: the keyup events will never arrive
      return;
    }
    const key = e as KeyboardEvent;
    const action = this.bindings.get(key.code);
    if (action === undefined) return; // not one of our keys

    if (key.type === 'keydown') {
      if (IsTypingIntoField(key.target)) return; // typing a number into the debug panel
      key.preventDefault(); // Space / arrows must not scroll the page
      this.OnKeyDown(key.code, action, key.timeStamp);
    } else {
      this.OnKeyUp(key.code, action);
    }
  }

  private OnKeyDown(code: string, action: number, time: number): void {
    if (this.keysDown.has(code)) return; // OS auto-repeat: the key is already down
    this.keysDown.add(code);

    const s = this.states[action];
    if (s.held) return; // another key of the same action is already down: not a new press
    s.held = true;
    s.pressTime = time; // the real moment of the keypress, not the frame time
    s.consumed = false;
    this.pressedSinceUpdate[action] = true;
  }

  private OnKeyUp(code: string, action: number): void {
    if (!this.keysDown.delete(code)) return; // wasn't down (e.g. pressed before the page had focus)
    this.states[action].held = this.AnyKeyDown(action);
  }

  private AnyKeyDown(action: number): boolean {
    for (const [code, bound] of this.bindings) {
      if (bound === action && this.keysDown.has(code)) return true;
    }
    return false;
  }

  private ReleaseAll(): void {
    this.keysDown.clear();
    for (let a = 0; a < this.states.length; a++) this.states[a].held = false;
  }
}

function IsTypingIntoField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
