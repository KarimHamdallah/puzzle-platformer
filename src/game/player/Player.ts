import Phaser from 'phaser';
import type { InputActions } from '../../core/input/InputActions';
import { COLORS, TILE } from '../constants';
import { PLAYER_TUNING as T, jumpPhysics } from './PlayerTuning';

export const PLAYER_W = Math.round(TILE * 0.75);
export const PLAYER_H = Math.round(TILE * 0.875);

export type PlayerState = 'idle' | 'run' | 'jump' | 'fall';

/** Events: 'jump' (x, y feet), 'land' (impactSpeed px/s), 'step' (dt) - used by debug views and later by VFX/SFX. */
export class Player extends Phaser.Events.EventEmitter {
  readonly scene: Phaser.Scene;
  readonly body: Phaser.Physics.Arcade.Body;
  /** Visual root, positioned at the FEET centre so squash & stretch pivots on the ground. */
  readonly view: Phaser.GameObjects.Container;

  state: PlayerState = 'idle';
  grounded = false;
  /** Rising/falling after a jump (not after walking off a ledge). Enables jump cut + apex hang. */
  jumping = false;
  facing = 1;
  /** Physics time in seconds (advances only on physics steps, so slow-motion stays consistent). */
  simTime = 0;
  lastGroundedAt = -Infinity;

  private readonly input: InputActions;
  private readonly spawn: Phaser.Math.Vector2;
  private readonly ghost: Phaser.GameObjects.Graphics;
  private readonly eyes: Phaser.GameObjects.Graphics;
  private airborneVy = 0;

  constructor(scene: Phaser.Scene, input: InputActions, spawnFeetX: number, spawnFeetY: number) {
    super();
    this.scene = scene;
    this.input = input;
    this.spawn = new Phaser.Math.Vector2(spawnFeetX, spawnFeetY);

    // Physics: a bare Arcade body (no sprite). We integrate gravity ourselves.
    this.body = scene.physics.add.body(spawnFeetX - PLAYER_W / 2, spawnFeetY - PLAYER_H, PLAYER_W, PLAYER_H);
    this.body.setAllowGravity(false);

    // Takeoff ghost: same silhouette, dark and translucent, left where the last jump started.
    this.ghost = scene.add.graphics().setVisible(false).setDepth(5);
    this.ghost.fillStyle(COLORS.ghost, 1).fillRect(-PLAYER_W / 2, -PLAYER_H, PLAYER_W, PLAYER_H);

    // Primitive character: white block + two grey eyes that look where you move.
    const shape = scene.add.graphics();
    shape.fillStyle(COLORS.player, 1).fillRect(-PLAYER_W / 2, -PLAYER_H, PLAYER_W, PLAYER_H);
    this.eyes = scene.add.graphics();
    this.eyes.fillStyle(COLORS.playerEyes, 1);
    this.eyes.fillRect(-9, -PLAYER_H * 0.78, 6, 14);
    this.eyes.fillRect(3, -PLAYER_H * 0.78, 6, 14);
    this.view = scene.add.container(spawnFeetX, spawnFeetY, [shape, this.eyes]).setDepth(10);

    // Keep our own reference: on SHUTDOWN the physics plugin has already set scene.physics.world = null.
    const world = scene.physics.world;
    world.on(Phaser.Physics.Arcade.Events.WORLD_STEP, this.step, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      world.off(Phaser.Physics.Arcade.Events.WORLD_STEP, this.step, this);
      this.removeAllListeners();
    });
  }

  /** Feet position in px. */
  get feetX(): number {
    return this.body.center.x;
  }

  get feetY(): number {
    return this.body.bottom;
  }

  respawn(): void {
    this.body.reset(this.spawn.x - PLAYER_W / 2, this.spawn.y - PLAYER_H);
    this.jumping = false;
    this.grounded = false;
    this.lastGroundedAt = -Infinity;
    this.ghost.setVisible(false);
  }

  /** Called from the scene's update(): visuals only. Gameplay runs in step() at the physics rate. */
  update(deltaMs: number): void {
    this.view.setPosition(this.feetX, this.feetY);

    // Eyes drift toward the facing side and look up/down with vertical speed.
    const { jumpSpeed } = jumpPhysics(TILE);
    const targetX = this.facing * PLAYER_W * 0.16;
    const targetY = Phaser.Math.Clamp(this.body.velocity.y / jumpSpeed, -1, 1) * 5;
    const k = 1 - Math.exp(-deltaMs / 50); // frame-rate independent smoothing
    this.eyes.x += (targetX - this.eyes.x) * k;
    this.eyes.y += (targetY - this.eyes.y) * k;
  }

  // ------------------------------------------------------------- gameplay (fixed step)

  private step(dt: number): void {
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

    // --- horizontal: move toward target speed with separate accel / decel / turn times
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

    // --- jump: buffered press + coyote time
    const { gravity, jumpSpeed } = jumpPhysics(TILE);
    let vy = b.velocity.y;
    const canJump = !this.jumping && this.simTime - this.lastGroundedAt <= T.coyoteMs / 1000;
    if (canJump && input.buffered('jump', T.jumpBufferMs)) {
      input.consume('jump');
      // +half a gravity step: gravity is applied below in this same step, and the fixed-step
      // integrator would otherwise lose ~jumpHeight*dt/timeToApex (≈0.15 tiles) on every jump.
      vy = -(jumpSpeed + 0.5 * gravity * dt);
      this.jump();
    }

    // --- gravity with modifiers
    let g = gravity;
    if (vy > 0) g *= T.fallGravityMult;
    else if (vy < 0 && this.jumping && !input.held('jump')) g *= T.jumpCutGravityMult;
    if (this.jumping && input.held('jump') && Math.abs(vy) < T.apexThreshold * TILE) g *= T.apexGravityMult;
    const fastFalling = input.held('down') && vy > 0;
    if (fastFalling) g *= T.fastFallGravityMult;

    vy += g * dt;
    vy = Math.min(vy, (fastFalling ? T.fastFallSpeed : T.maxFallSpeed) * TILE);

    b.setVelocity(vx, vy);
    this.state = this.grounded ? (Math.abs(vx) > 1 ? 'run' : 'idle') : vy < 0 ? 'jump' : 'fall';
    this.emit('step', dt);
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
    this.emit('jump', this.feetX, this.feetY);
  }

  private land(): void {
    const impact = Phaser.Math.Clamp(this.airborneVy / (T.maxFallSpeed * TILE), 0, 1);
    this.pulseScale(1 + T.squash * impact, 1 - T.squash * impact, 130);
    this.emit('land', this.airborneVy);
  }

  /** Squash & stretch: snap to (sx, sy) then spring back to 1. Visual only, the hitbox never changes. */
  private pulseScale(sx: number, sy: number, duration: number): void {
    if (T.squash <= 0) return;
    this.scene.tweens.killTweensOf(this.view);
    this.view.setScale(sx, sy);
    this.scene.tweens.add({ targets: this.view, scaleX: 1, scaleY: 1, duration, ease: 'Back.easeOut' });
  }
}

function moveTowards(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}
