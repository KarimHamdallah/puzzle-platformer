import Phaser from 'phaser';
import { DEBUG_ENABLED, TuningFolder } from '../core/Debug';
import { Action, InputActions } from '../core/InputActions';
import { TILE } from './constants';

// ---------------------------------------------------------------- Day 1, as it was
// The very first movement test (commit aa7980a): the greybox room and the white cube with eyes, with
// its own controller, tuning and camera follow, ported unchanged in behaviour. The survivor's
// controller grew out of this one later; this level keeps the original to compare against.

interface Solid {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const ROOM_W = 60;
export const ROOM_H = 24;
const SPAWN_X = 3.5; // feet position, tiles
const SPAWN_Y = 21;
export const BACKGROUND = 0x4f9d6f; // greybox palette: green room, red solids, white cube
export const SOLID = 0xff4646;
const CUBE_COLOR = 0xffffff;
const EYES_COLOR = 0x9e9e9e;
const GHOST_COLOR = 0x000000;
const CUBE_W = Math.round(TILE * 0.75);
const CUBE_H = Math.round(TILE * 0.875);

export const SOLIDS: Solid[] = [
  // frame
  { x: 0, y: 0, w: 60, h: 1 }, // ceiling
  { x: 0, y: 0, w: 1, h: 24 }, // left wall
  { x: 59, y: 0, w: 1, h: 24 }, // right wall
  // ground
  { x: 1, y: 21, w: 20, h: 3 }, // floor A
  { x: 21, y: 23, w: 6, h: 1 }, // pit bottom (2 deep): tests coyote time at the pit edge
  { x: 27, y: 21, w: 14, h: 3 }, // floor B
  { x: 41, y: 19, w: 18, h: 5 }, // floor C: 2-tile step up
  // left staircase: short hops; the first one is low enough to bonk your head on
  { x: 5, y: 18, w: 4, h: 1 },
  { x: 10, y: 15, w: 4, h: 1 },
  { x: 15, y: 12, w: 4, h: 1 },
  // long platform over the pit: tests run-jump distance from the staircase
  { x: 21, y: 10, w: 8, h: 1 },
  // pillar on floor B: exactly 3 tiles tall -> needs a full (held) jump, a tapped jump fails
  { x: 33, y: 18, w: 2, h: 3 },
  // low tunnel on floor C: 1-tile gap, run under it without jumping
  { x: 47, y: 17, w: 3, h: 1 },
  // right climb: ledges with growing gaps
  { x: 43, y: 15, w: 3, h: 1 },
  { x: 51, y: 13, w: 3, h: 1 },
  { x: 55, y: 9, w: 3, h: 1 },
];

/**
 * Every movement number, in TILES and SECONDS (never pixels).
 * Gravity and jump speed are derived from jumpHeight + timeToApex, so designers tune what they feel.
 */
class CubeTuning {
  // horizontal
  runSpeed = 8.5; // tiles/s
  accelTime = 0.08; // s from 0 to full speed (ground)
  decelTime = 0.06; // s from full speed to 0 (ground, no input)
  turnTime = 0.05; // s to brake when pressing the opposite direction (ground)
  airAccelTime = 0.12;
  airDecelTime = 0.25;
  // jump
  jumpHeight = 3.2; // tiles, full held jump
  timeToApex = 0.36; // s
  fallGravityMult = 1.7; // falling is faster than rising = snappy, not floaty
  jumpCutGravityMult = 2.6; // release jump early while rising -> short hop (variable height)
  apexThreshold = 1.5; // tiles/s: near the top of the arc...
  apexGravityMult = 0.5; // ...gravity is reduced while jump is held = a little hang time
  maxFallSpeed = 15; // tiles/s
  fastFallSpeed = 22; // tiles/s while holding down
  fastFallGravityMult = 1.6;
  // forgiveness
  coyoteMs = 100; // can still jump this long after walking off a ledge
  jumpBufferMs = 120; // a jump pressed this long before landing still happens
  // presentation
  squash = 0.22; // squash & stretch strength (0 = off)
  ghostAlpha = 0.22; // takeoff shadow opacity (0 = off)
}

const T = new CubeTuning();

/** Gravity (px/s²) and jump launch speed (px/s) derived from the tuning. */
function cubeGravity(): number {
  const h = T.jumpHeight * TILE;
  return (2 * h) / (T.timeToApex * T.timeToApex);
}

function cubeJumpSpeed(): number {
  return (2 * T.jumpHeight * TILE) / T.timeToApex;
}

function moveTowards(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

/** The Day 1 cube: white block + two grey eyes that look where you move. */
class Cube {
  readonly body: Phaser.Physics.Arcade.Body;
  /** Visual root, positioned at the FEET centre so squash & stretch pivots on the ground. */
  readonly view: Phaser.GameObjects.Container;
  grounded = false;
  jumping = false; // rising/falling after a jump (not after walking off a ledge): enables jump cut + apex hang
  facing = 1;

  private readonly scene: Phaser.Scene;
  private readonly input: InputActions;
  private readonly ghost: Phaser.GameObjects.Graphics;
  private readonly eyes: Phaser.GameObjects.Graphics;
  private simTime = 0; // physics time, s
  private lastGroundedAt = -Infinity;
  private airborneVy = 0;

  constructor(scene: Phaser.Scene, input: InputActions, feetX: number, feetY: number) {
    this.scene = scene;
    this.input = input;
    // Physics: a bare Arcade body (no sprite). We integrate gravity ourselves.
    this.body = scene.physics.add.body(feetX - CUBE_W / 2, feetY - CUBE_H, CUBE_W, CUBE_H);
    this.body.setAllowGravity(false);

    // Takeoff ghost: same silhouette, dark and translucent, left where the last jump started.
    this.ghost = scene.add.graphics().setVisible(false).setDepth(5);
    this.ghost.fillStyle(GHOST_COLOR, 1).fillRect(-CUBE_W / 2, -CUBE_H, CUBE_W, CUBE_H);

    const shape = scene.add.graphics();
    shape.fillStyle(CUBE_COLOR, 1).fillRect(-CUBE_W / 2, -CUBE_H, CUBE_W, CUBE_H);
    this.eyes = scene.add.graphics();
    this.eyes.fillStyle(EYES_COLOR, 1);
    this.eyes.fillRect(-9, -CUBE_H * 0.78, 6, 14);
    this.eyes.fillRect(3, -CUBE_H * 0.78, 6, 14);
    this.view = scene.add.container(feetX, feetY, [shape, this.eyes]).setDepth(10);
  }

  get feetX(): number {
    return this.body.center.x;
  }

  get feetY(): number {
    return this.body.bottom;
  }

  respawn(): void {
    this.body.reset(SPAWN_X * TILE - CUBE_W / 2, SPAWN_Y * TILE - CUBE_H);
    this.jumping = false;
    this.grounded = false;
    this.lastGroundedAt = -Infinity;
    this.ghost.setVisible(false);
  }

  /** Visuals, once per rendered frame. */
  update(deltaMs: number): void {
    this.view.setPosition(this.feetX, this.feetY);
    // Eyes drift toward the facing side and look up/down with vertical speed.
    const targetX = this.facing * CUBE_W * 0.16;
    const targetY = Phaser.Math.Clamp(this.body.velocity.y / cubeJumpSpeed(), -1, 1) * 5;
    const k = 1 - Math.exp(-deltaMs / 50); // frame-rate independent smoothing
    this.eyes.x += (targetX - this.eyes.x) * k;
    this.eyes.y += (targetY - this.eyes.y) * k;
  }

  /** Gameplay, at the physics rate. */
  fixedUpdate(dt: number): void {
    const b = this.body;
    const input = this.input;
    this.simTime += dt;

    // Ground check. Ignore it while moving up (we just jumped; contact flags can be stale for a step).
    const onGround = (b.blocked.down || b.touching.down) && b.velocity.y >= 0;
    if (onGround) {
      if (!this.grounded) this.land();
      this.lastGroundedAt = this.simTime;
      this.jumping = false;
    } else {
      this.airborneVy = b.velocity.y;
    }
    this.grounded = onGround;

    // horizontal: move toward target speed with separate accel / decel / turn times
    const runSpeed = T.runSpeed * TILE;
    const target = input.moveX * runSpeed;
    let vx = b.velocity.x;
    let time: number;
    if (target !== 0) {
      const turning = vx !== 0 && Math.sign(target) !== Math.sign(vx);
      time = onGround ? (turning ? T.turnTime : T.accelTime) : T.airAccelTime;
      this.facing = Math.sign(target);
    } else {
      time = onGround ? T.decelTime : T.airDecelTime;
    }
    vx = time <= 0 ? target : moveTowards(vx, target, (runSpeed / time) * dt);

    // jump: buffered press + coyote time
    const gravity = cubeGravity();
    let vy = b.velocity.y;
    const canJump = !this.jumping && this.simTime - this.lastGroundedAt <= T.coyoteMs / 1000;
    if (canJump && input.buffered(Action.Jump, T.jumpBufferMs)) {
      input.consume(Action.Jump);
      // +half a gravity step: gravity is applied below in this same step, and the fixed-step
      // integrator would otherwise lose ~0.15 tiles on every jump.
      vy = -(cubeJumpSpeed() + 0.5 * gravity * dt);
      this.jump();
    }

    // gravity with modifiers
    let g = gravity;
    if (vy > 0) g *= T.fallGravityMult;
    else if (vy < 0 && this.jumping && !input.held(Action.Jump)) g *= T.jumpCutGravityMult;
    if (this.jumping && input.held(Action.Jump) && Math.abs(vy) < T.apexThreshold * TILE) g *= T.apexGravityMult;
    const fastFalling = input.held(Action.Down) && vy > 0;
    if (fastFalling) g *= T.fastFallGravityMult;

    vy += g * dt;
    vy = Math.min(vy, (fastFalling ? T.fastFallSpeed : T.maxFallSpeed) * TILE);
    b.setVelocity(vx, vy);
  }

  private jump(): void {
    this.jumping = true;
    this.grounded = false;
    this.lastGroundedAt = -Infinity; // no second coyote jump

    // Ghost marks the takeoff frame; it moves on every new jump.
    this.ghost.setPosition(this.feetX, this.feetY).setVisible(T.ghostAlpha > 0);
    this.scene.tweens.killTweensOf(this.ghost);
    this.ghost.setAlpha(0);
    this.scene.tweens.add({ targets: this.ghost, alpha: T.ghostAlpha, duration: 90 });
    this.pulseScale(1 - T.squash * 0.6, 1 + T.squash * 0.6, 160);
  }

  private land(): void {
    const impact = Phaser.Math.Clamp(this.airborneVy / (T.maxFallSpeed * TILE), 0, 1);
    this.pulseScale(1 + T.squash * impact, 1 - T.squash * impact, 130);
  }

  /** Squash & stretch: snap to (sx, sy) then spring back to 1. Visual only, the hitbox never changes. */
  private pulseScale(sx: number, sy: number, duration: number): void {
    if (T.squash <= 0) return;
    this.scene.tweens.killTweensOf(this.view);
    this.view.setScale(sx, sy);
    this.scene.tweens.add({ targets: this.view, scaleX: 1, scaleY: 1, duration: duration, ease: 'Back.easeOut' });
  }
}

// ---------------------------------------------------------------- scene

/**
 * Movement test room. Frame order (like a C++ main loop):
 *   1. physics steps at 60 Hz -> fixedUpdate(dt) -> cube.fixedUpdate(dt)   (gameplay)
 *   2. update()               -> controls, cube visuals                    (once per rendered frame)
 *   3. render
 */
export class PlaygroundScene extends Phaser.Scene {
  private controls!: InputActions;
  private cube!: Cube;
  private tuning: TuningFolder<CubeTuning> | null = null;
  private world!: Phaser.Physics.Arcade.World;

  constructor() {
    super('Playground');
  }

  create(): void {
    const worldW = ROOM_W * TILE;
    const worldH = ROOM_H * TILE;
    this.world = this.physics.world;
    this.world.setBounds(0, 0, worldW, worldH);
    const cam = this.cameras.main;
    cam.setBackgroundColor(BACKGROUND);
    cam.fadeIn(200);

    const solids = this.physics.add.staticGroup();
    for (let i = 0; i < SOLIDS.length; i++) {
      const s = SOLIDS[i];
      solids.add(this.add.rectangle((s.x + s.w / 2) * TILE, (s.y + s.h / 2) * TILE, s.w * TILE, s.h * TILE, SOLID));
    }

    this.controls = new InputActions();
    this.cube = new Cube(this, this.controls, SPAWN_X * TILE, SPAWN_Y * TILE);
    this.physics.add.collider(this.cube.body, solids);

    // Day 1 camera: plain smoothed follow, before the dead-zone rig existed.
    cam.setBounds(0, 0, worldW, worldH);
    cam.startFollow(this.cube.view, false, 0.12, 0.12, 0, TILE);

    if (DEBUG_ENABLED) {
      const t = new TuningFolder('cube tuning', T);
      t.add('runSpeed', 1, 20, 0.1);
      t.add('accelTime', 0, 0.6, 0.01);
      t.add('decelTime', 0, 0.6, 0.01);
      t.add('turnTime', 0, 0.6, 0.01);
      t.add('airAccelTime', 0, 1, 0.01);
      t.add('airDecelTime', 0, 1, 0.01);
      t.add('jumpHeight', 0.5, 8, 0.1);
      t.add('timeToApex', 0.1, 1, 0.01);
      t.add('fallGravityMult', 0.5, 4, 0.05);
      t.add('jumpCutGravityMult', 1, 6, 0.1);
      t.add('apexThreshold', 0, 6, 0.1);
      t.add('apexGravityMult', 0.1, 1, 0.05);
      t.add('maxFallSpeed', 2, 40, 0.5);
      t.add('fastFallSpeed', 2, 50, 0.5);
      t.add('fastFallGravityMult', 1, 4, 0.1);
      t.add('coyoteMs', 0, 300, 5);
      t.add('jumpBufferMs', 0, 300, 5);
      t.add('squash', 0, 0.6, 0.01);
      t.add('ghostAlpha', 0, 1, 0.01);
      this.tuning = t;
    }

    this.add.text(24, 20, 'DAY 1  -  MOVEMENT TEST ROOM', {
      fontFamily: 'Georgia, serif', fontSize: '34px', fontStyle: 'bold', color: '#ffffff', stroke: '#1d3a2a', strokeThickness: 6,
    }).setScrollFactor(0).setDepth(50);
    this.add.text(24, this.scale.height - 20, 'Move ←→   Jump Space (hold = higher)   Fast fall ↓   Respawn R   Level select Esc', {
      fontFamily: 'Georgia, serif', fontSize: '22px', color: '#ffffff', stroke: '#1d3a2a', strokeThickness: 4,
    }).setOrigin(0, 1).setScrollFactor(0).setDepth(50);

    // Arcade fires WORLD_STEP after each physics step's collisions are resolved.
    this.world.on(Phaser.Physics.Arcade.Events.WORLD_STEP, this.fixedUpdate, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
  }

  update(_time: number, deltaMs: number): void {
    this.controls.update();
    if (this.controls.pressed(Action.Back)) {
      this.scene.start('Menu');
      return;
    }
    if (this.controls.pressed(Action.Reset)) this.cube.respawn();
    this.cube.update(deltaMs);
  }

  private fixedUpdate(dt: number): void {
    this.cube.fixedUpdate(dt);
  }

  /** Our "destructor". Uses this.world: scene.physics.world is already null when SHUTDOWN fires. */
  private shutdown(): void {
    this.world.off(Phaser.Physics.Arcade.Events.WORLD_STEP, this.fixedUpdate, this);
    if (this.tuning) this.tuning.destroy();
    this.controls.destroy();
  }
}
