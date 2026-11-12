import Phaser from 'phaser';
import { DEBUG_ENABLED } from '../debug/Debug';
import { ACTIONS, DEFAULT_BINDINGS, type Action, type Bindings } from './Actions';
import { attachInputDebug } from './InputDebug';

export interface ActionState {
  /** At least one bound key is down right now. */
  held: boolean;
  /** Went down since the previous frame (true even for a tap shorter than one frame). */
  pressed: boolean;
  /** Went up since the previous frame. */
  released: boolean;
  /** performance.now() timestamp of the last press (-Infinity = never). */
  pressTime: number;
  releaseTime: number;
  /** The last press was already used by a buffered query (e.g. it already triggered a jump). */
  consumed: boolean;
  pressCount: number;
  lastSource: string;
}

export interface InputEvent {
  frame: number;
  time: number;
  action: Action;
  kind: 'down' | 'up';
  source: string;
}

const HISTORY_SIZE = 12;

/**
 * Keyboard action input for one scene, updated automatically before the scene's update().
 *
 * Key ideas:
 *  - Several keys can drive one action; it is "held" while any of them is down.
 *  - Presses are timestamped with the real event time, so buffers are accurate even at low FPS
 *    and taps shorter than one frame are never lost.
 *  - `consumeBuffered(action, ms)` = "was it pressed in the last N ms and not used yet?" -> jump buffer.
 *  - Reads DOM keydown/keyup directly, NOT Phaser Key objects: Phaser 3.90 re-processes its whole
 *    per-frame key queue on every DOM event, so a tap + another key in the same frame replays the
 *    tap as a phantom second press (a buffered jump could fire twice).
 */
export class InputActions {
  readonly scene: Phaser.Scene;
  logToConsole = false;

  private readonly states = {} as Record<Action, ActionState>;
  private readonly sources = {} as Record<Action, Set<string>>;
  private readonly pendingPress = new Set<Action>();
  private readonly pendingRelease = new Set<Action>();
  private readonly history: InputEvent[] = [];
  private readonly codeToActions = new Map<string, Action[]>();
  private detachDebug: (() => void) | null = null;

  constructor(scene: Phaser.Scene, bindings: Bindings = DEFAULT_BINDINGS) {
    this.scene = scene;

    for (const action of ACTIONS) {
      this.states[action] = {
        held: false,
        pressed: false,
        released: false,
        pressTime: -Infinity,
        releaseTime: -Infinity,
        consumed: false,
        pressCount: 0,
        lastSource: '-',
      };
      this.sources[action] = new Set();
      for (const code of bindings[action]) {
        const list = this.codeToActions.get(code) ?? [];
        list.push(action);
        this.codeToActions.set(code, list);
      }
    }

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    scene.events.on(Phaser.Scenes.Events.PRE_UPDATE, this.update, this);
    scene.game.events.on(Phaser.Core.Events.BLUR, this.releaseAll, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);

    if (DEBUG_ENABLED) this.detachDebug = attachInputDebug(this);
  }

  // ---------------------------------------------------------------- queries

  held(action: Action): boolean {
    return this.states[action].held;
  }

  pressed(action: Action): boolean {
    return this.states[action].pressed;
  }

  released(action: Action): boolean {
    return this.states[action].released;
  }

  /** How long the action has been held, in ms (0 if not held). */
  heldMs(action: Action): number {
    const s = this.states[action];
    return s.held ? performance.now() - s.pressTime : 0;
  }

  /** Milliseconds since the last press (Infinity if never pressed). */
  pressAgeMs(action: Action): number {
    return performance.now() - this.states[action].pressTime;
  }

  /** Pressed within the last `windowMs` and not consumed yet. Does not consume. */
  buffered(action: Action, windowMs: number): boolean {
    const s = this.states[action];
    return !s.consumed && performance.now() - s.pressTime <= windowMs;
  }

  /** Mark the last press as used so it cannot trigger twice. */
  consume(action: Action): void {
    this.states[action].consumed = true;
  }

  /** The standard buffer check: true once per press if it happened within `windowMs`. */
  consumeBuffered(action: Action, windowMs: number): boolean {
    if (!this.buffered(action, windowMs)) return false;
    this.consume(action);
    return true;
  }

  /** -1, 0 or 1. Both left+right held -> the newest press wins. */
  get moveX(): number {
    return this.axis('left', 'right');
  }

  get moveY(): number {
    return this.axis('up', 'down');
  }

  state(action: Action): Readonly<ActionState> {
    return this.states[action];
  }

  get events(): readonly InputEvent[] {
    return this.history;
  }

  clearHistory(): void {
    this.history.length = 0;
  }

  // ---------------------------------------------------------------- internals

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const actions = this.codeToActions.get(e.code);
    if (!actions || isTypingTarget(e.target)) return;
    e.preventDefault(); // stop Space/arrows from scrolling the page
    if (e.repeat) return; // OS auto-repeat is not a new press
    for (const action of actions) this.sourceDown(action, `key:${e.code}`, e.timeStamp);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const actions = this.codeToActions.get(e.code);
    if (!actions) return;
    for (const action of actions) this.sourceUp(action, `key:${e.code}`, e.timeStamp);
  };

  private axis(negative: Action, positive: Action): number {
    const n = this.states[negative];
    const p = this.states[positive];
    if (n.held && p.held) return n.pressTime > p.pressTime ? -1 : 1;
    if (n.held) return -1;
    if (p.held) return 1;
    return 0;
  }

  private update(): void {
    for (const action of ACTIONS) {
      const s = this.states[action];
      s.pressed = this.pendingPress.has(action);
      s.released = this.pendingRelease.has(action);
      s.held = this.sources[action].size > 0;
    }
    this.pendingPress.clear();
    this.pendingRelease.clear();
  }

  private sourceDown(action: Action, source: string, time: number): void {
    const set = this.sources[action];
    const wasHeld = set.size > 0;
    set.add(source);
    if (wasHeld) return; // another key already holds this action - not a new press

    const s = this.states[action];
    s.pressTime = time;
    s.consumed = false;
    s.pressCount++;
    s.lastSource = source;
    this.pendingPress.add(action);
    this.record(action, 'down', source, time);
  }

  private sourceUp(action: Action, source: string, time: number): void {
    const set = this.sources[action];
    if (!set.delete(source) || set.size > 0) return;

    this.states[action].releaseTime = time;
    this.pendingRelease.add(action);
    this.record(action, 'up', source, time);
  }

  /** Window lost focus: key-up events will never arrive, so release everything. */
  private releaseAll(): void {
    const now = performance.now();
    for (const action of ACTIONS) {
      for (const source of [...this.sources[action]]) this.sourceUp(action, source, now);
    }
  }

  private record(action: Action, kind: 'down' | 'up', source: string, time: number): void {
    const event: InputEvent = { frame: this.scene.game.loop.frame, time, action, kind, source };
    this.history.unshift(event);
    if (this.history.length > HISTORY_SIZE) this.history.pop();
    if (this.logToConsole) console.log(`[input] f${event.frame} ${action} ${kind} (${source})`);
  }

  private destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.scene.events.off(Phaser.Scenes.Events.PRE_UPDATE, this.update, this);
    this.scene.game.events.off(Phaser.Core.Events.BLUR, this.releaseAll, this);
    this.detachDebug?.();
    this.detachDebug = null;
  }
}

/** Don't steal keys while the user types into a lil-gui number field. */
function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
