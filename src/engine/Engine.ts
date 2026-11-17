import Phaser from 'phaser';
import { AnimationSystem } from './Animation';
import { Assets } from './Assets';
import { Audio } from './Audio';
import { Camera } from './Camera';
import { DebugDraw } from './debug/DebugDraw';
import { debugPanel } from './debug/DebugPanel';
import { Input } from './Input';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { Renderer } from './Renderer';
import { StateMachine } from './StateMachine';
import { TweenSystem } from './Tween';

export interface EngineConfig {
  width: number; // render resolution: scaled to fit the window
  height: number;
  fixedDt: number; // s per gameplay / physics step (1 / 60)
  background: number; // colour behind everything
  parent: string; // id of the HTML element that holds the canvas
}

/** A frame longer than this (tab in the background, a breakpoint) is cut short: no physics explosion. */
const MAX_FRAME_DT = 0.25;

interface Timer {
  left: number; // s
  fn: () => void;
}

/** Game time and delayed calls ("do this in 0.7 s"). Timers are cleared when the state ends. */
export class Clock {
  /** ms of game time since the engine started (stops with timeScale 0). */
  nowMs = 0;
  private timers: Timer[] = [];

  /** Call fn after `seconds` of game time. */
  After(seconds: number, fn: () => void): void {
    this.timers.push({ left: seconds, fn: fn });
  }

  /** Engine only: once per frame. */
  Update(dt: number): void {
    this.nowMs += dt * 1000;
    const due: Timer[] = [];
    for (let i = this.timers.length - 1; i >= 0; i--) {
      this.timers[i].left -= dt;
      if (this.timers[i].left <= 0) due.push(this.timers.splice(i, 1)[0]);
    }
    for (let i = due.length - 1; i >= 0; i--) due[i].fn(); // in the order they were made
  }

  /** Engine only: a state ended. */
  Clear(): void {
    this.timers = [];
  }
}

/**
 * The engine: owns every system and runs the game loop. The game never sees Phaser: Phaser only
 * provides the browser frame callback (requestAnimationFrame), the WebGL drawing, the asset loader
 * and audio playback, all behind the engine's classes.
 *
 *   const engine = new Engine({ ... });
 *   engine.states.Register(StateId.Menu, (e) => new MenuState(e));
 *   engine.Run(StateId.Menu);
 */
export class Engine {
  readonly config: EngineConfig;
  readonly input = new Input();
  readonly assets = new Assets();
  readonly audio = new Audio();
  readonly renderer = new Renderer();
  readonly camera = new Camera();
  readonly physics = new PhysicsWorld();
  readonly tweens = new TweenSystem();
  readonly animations: AnimationSystem;
  readonly clock = new Clock();
  readonly debug = new DebugDraw();
  readonly states: StateMachine;
  /** Debug slow motion: 0.5 = everything runs at half speed. */
  timeScale = 1;

  private accumulator = 0; // s of game time not simulated yet
  private game: Phaser.Game | null = null;
  private firstState = 0;

  constructor(config: EngineConfig) {
    this.config = config;
    this.animations = new AnimationSystem(this.assets);
    this.states = new StateMachine(this, () => this.ClearScope());
    debugPanel.SetFpsSource(() => (this.game ? this.game.loop.actualFps : 0));
  }

  get width(): number { return this.config.width; }
  get height(): number { return this.config.height; }

  /** Create the window and start the loop with state `first` (after the assets are loaded). */
  Run(first: number): void {
    this.firstState = first;
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: this.config.parent,
      dom: { createContainer: true }, // HTML over the canvas, scaled with it
      width: this.config.width,
      height: this.config.height,
      backgroundColor: this.config.background,
      pixelArt: false,
      antialias: true,
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [new HostScene(this)],
    });
  }

  /** The Phaser game, for the debug console and tests only. */
  get native(): Phaser.Game | null {
    return this.game;
  }

  /** Host only: assets are loaded, systems can attach. */
  Start(scene: Phaser.Scene): void {
    this.assets.AfterLoad();
    this.renderer.Attach(scene);
    this.camera.Attach(scene);
    this.camera.SetBackground(this.config.background);
    this.input.Attach(scene);
    this.audio.Attach(scene);
    this.debug.Attach(scene);
    this.states.ChangeState(this.firstState);
    this.states.ApplyPendingChange();
  }

  /**
   * THE GAME LOOP: one rendered frame. The host calls it every requestAnimationFrame with the
   * elapsed ms; Phaser draws the result right after it returns.
   */
  Frame(dtMs: number): void {
    const dt = Math.min(dtMs / 1000, MAX_FRAME_DT) * this.timeScale;
    this.debug.BeginFrame(); // immediate-mode debug drawing starts empty every frame
    this.input.Poll(); // latch this frame's key presses

    // Fixed-step gameplay + physics: the same 60 steps per second whatever the screen's refresh rate.
    if (this.physics.paused) {
      this.accumulator = 0; // a dialogue is open: the world stands still
    } else {
      this.accumulator += dt;
      const fixedDt = this.config.fixedDt;
      while (this.accumulator >= fixedDt) {
        this.states.FixedUpdate(fixedDt); // AI, player control: read contacts, set velocities
        this.physics.Step(fixedDt); // move bodies, collide, write contacts
        this.accumulator -= fixedDt;
      }
    }

    this.tweens.Update(dt);
    this.animations.Update(dt);
    this.clock.Update(dt);
    this.states.Update(dt); // visuals, HUD, menus, the camera follow
    this.camera.Update(dt); // shake, fade, flash
    if (this.physics.drawBodies) this.physics.DebugDraw(this.debug);
    this.states.ApplyPendingChange(); // state switches happen between frames, never mid-frame
  }

  /** Between two states: everything the old one made goes. */
  private ClearScope(): void {
    this.renderer.DestroyAll();
    this.physics.Clear();
    this.tweens.Clear();
    this.animations.Clear();
    this.clock.Clear();
    this.camera.Reset();
    this.camera.SetBackground(this.config.background);
    this.input.ConsumeAll();
    this.accumulator = 0;
    this.timeScale = 1;
  }
}

/** The one Phaser scene: it loads the assets and forwards every frame to Engine.Frame. */
class HostScene extends Phaser.Scene {
  private readonly engine: Engine;

  constructor(engine: Engine) {
    super('Host');
    this.engine = engine;
  }

  preload(): void {
    this.engine.assets.Load(this);
  }

  create(): void {
    this.engine.Start(this);
  }

  update(_time: number, deltaMs: number): void {
    this.engine.Frame(deltaMs);
  }
}
