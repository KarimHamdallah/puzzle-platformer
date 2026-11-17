import type { Engine } from './Engine';

/**
 * One screen of the game: the menu, a level. The engine runs exactly one state at a time.
 *  - OnStart(data): build everything. `data` is what ChangeState / Restart passed (or undefined).
 *  - OnFixedUpdate(dt): gameplay, at a fixed 60 Hz (0, 1 or several times per frame).
 *  - OnUpdate(dt): once per rendered frame: visuals, HUD, menus. dt in seconds.
 *  - OnDestroy(): free what only you know about (debug folders). The engine then destroys every
 *    visual, body, tween, animator and timer made during the state, so nothing leaks into the next one.
 */
export abstract class GameState {
  protected readonly engine: Engine;

  constructor(engine: Engine) {
    this.engine = engine;
  }

  abstract OnStart(data: unknown): void;

  OnFixedUpdate(_dt: number): void {}

  abstract OnUpdate(dt: number): void;

  OnDestroy(): void {}
}

/** Makes a fresh state object: every start of a state is a NEW object (no stale fields from last time). */
export type StateFactory = (engine: Engine) => GameState;

/**
 * The states by id, the current one, and the switch between them. A ChangeState() asked for in the
 * middle of a frame waits until the end of that frame (ApplyPendingChange), so a state is never
 * destroyed while its own code is still running.
 */
export class StateMachine {
  private readonly engine: Engine;
  private readonly onScopeEnd: () => void;
  private readonly factories = new Map<number, StateFactory>();
  private state: GameState | null = null;
  private stateId = -1;
  private pendingId = -1;
  private pendingData: unknown = undefined;

  /** onScopeEnd: the engine's cleanup between two states. */
  constructor(engine: Engine, onScopeEnd: () => void) {
    this.engine = engine;
    this.onScopeEnd = onScopeEnd;
  }

  Register(id: number, factory: StateFactory): void {
    this.factories.set(id, factory);
  }

  /** Switch to state `id` at the end of this frame. */
  ChangeState(id: number, data?: unknown): void {
    this.pendingId = id;
    this.pendingData = data;
  }

  /** Start the current state again (a death, a checkpoint), with new data. */
  Restart(data?: unknown): void {
    this.ChangeState(this.stateId, data);
  }

  get currentId(): number {
    return this.stateId;
  }

  /** The running state (tests and the debug console read it). */
  get current(): GameState | null {
    return this.state;
  }

  /** Engine only. */
  FixedUpdate(dt: number): void {
    if (this.state) this.state.OnFixedUpdate(dt);
  }

  /** Engine only. */
  Update(dt: number): void {
    if (this.state) this.state.OnUpdate(dt);
  }

  /** Engine only: at the end of the frame, do the switch that was asked for. */
  ApplyPendingChange(): void {
    if (this.pendingId < 0) return;
    const id = this.pendingId;
    const data = this.pendingData;
    this.pendingId = -1;
    this.pendingData = undefined;
    const factory = this.factories.get(id);
    if (!factory) throw new Error('no state registered with id ' + id);
    if (this.state) {
      this.state.OnDestroy();
      this.onScopeEnd();
    }
    this.stateId = id;
    this.state = factory(this.engine);
    this.state.OnStart(data);
  }
}
