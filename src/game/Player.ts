import Phaser from 'phaser';
import type GUI from 'lil-gui';
import { DEBUG_ENABLED, TuningFolder, debug } from '../core/Debug';
import { Action, type InputActions } from '../core/InputActions';
import { COLORS, TILE } from './constants';

/**
 * Every movement number, in TILES and SECONDS (never pixels).
 * Gravity and jump speed are derived from jumpHeight + timeToApex.
 */
class PlayerTuning {
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
  jumpCutGravityMult = 2.6; // jump released while rising -> short hop
  apexThreshold = 1.5; // tiles/s: near the top of the arc...
  apexGravityMult = 0.5; // ...gravity is reduced while jump is held = small hang time
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

const T = new PlayerTuning();

const PLAYER_W = Math.round(TILE * 0.75);
const PLAYER_H = Math.round(TILE * 0.875);

enum PlayerState {
  Idle,
  Run,
  Jump,
  Fall,
}

function gravity(): number {
  return (2 * T.jumpHeight * TILE) / (T.timeToApex * T.timeToApex); // px/s²
}

function jumpSpeed(): number {
  return (2 * T.jumpHeight * TILE) / T.timeToApex; // px/s
}

function moveTowards(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

export class Player {
  readonly body: Phaser.Physics.Arcade.Body;
  /** Visual root, placed at the FEET so squash & stretch pivots on the ground. */
  readonly view: Phaser.GameObjects.Container;

  state = PlayerState.Idle;
  grounded = false;
  jumping = false; // in the air because of a jump (not a walk-off): enables jump cut + apex hang
  facing = 1;

  private readonly scene: Phaser.Scene;
  private readonly input: InputActions;
  private readonly spawnX: number;
  private readonly spawnY: number;
  private readonly ghost: Phaser.GameObjects.Rectangle;
  private readonly eyes: Phaser.GameObjects.Container;
  private simTime = 0; // seconds of physics time (stops in slow motion, unlike real time)
  private lastGroundedAt = -Infinity;
  private airborneVy = 0; // last vertical speed in the air = landing impact
  private debugView: PlayerDebug | null = null;

  constructor(scene: Phaser.Scene, input: InputActions, spawnFeetX: number, spawnFeetY: number) {
    this.scene = scene;
    this.input = input;
    this.spawnX = spawnFeetX;
    this.spawnY = spawnFeetY;

    // Physics: a bare Arcade body (no sprite). Gravity is ours, not Arcade's.
    this.body = scene.physics.add.body(spawnFeetX - PLAYER_W / 2, spawnFeetY - PLAYER_H, PLAYER_W, PLAYER_H);
    this.body.setAllowGravity(false);

    // Takeoff ghost: same size, dark and translucent, left where the last jump started.
    this.ghost = scene.add.rectangle(0, 0, PLAYER_W, PLAYER_H, COLORS.ghost).setOrigin(0.5, 1).setVisible(false);

    // Primitive character: white block + two grey eyes.
    const block = scene.add.rectangle(0, 0, PLAYER_W, PLAYER_H, COLORS.player).setOrigin(0.5, 1);
    this.eyes = scene.add.container(0, 0, [
      scene.add.rectangle(-6, -PLAYER_H * 0.78, 6, 14, COLORS.playerEyes).setOrigin(0.5, 0),
      scene.add.rectangle(6, -PLAYER_H * 0.78, 6, 14, COLORS.playerEyes).setOrigin(0.5, 0),
    ]);
    this.view = scene.add.container(spawnFeetX, spawnFeetY, [block, this.eyes]);

    if (DEBUG_ENABLED) this.debugView = new PlayerDebug(scene, this);
  }

  destroy(): void {
    if (this.debugView) this.debugView.destroy();
  }

  get feetX(): number {
    return this.body.center.x;
  }

  get feetY(): number {
    return this.body.bottom;
  }

  respawn(): void {
    this.body.reset(this.spawnX - PLAYER_W / 2, this.spawnY - PLAYER_H);
    this.grounded = false;
    this.jumping = false;
    this.lastGroundedAt = -Infinity;
    this.ghost.setVisible(false);
  }

  /** Gameplay. Called by the scene on every physics step (60 Hz), after collisions are resolved. */
  fixedUpdate(dt: number): void {
    const b = this.body;
    this.simTime += dt;

    // Ground check. Ignored while moving up: right after a jump the contact flag can be one step stale.
    const onGround = (b.blocked.down || b.touching.down) && b.velocity.y >= 0;
    if (onGround) {
      if (!this.grounded) this.land();
      this.lastGroundedAt = this.simTime;
      this.jumping = false;
    } else {
      this.airborneVy = b.velocity.y;
    }
    this.grounded = onGround;

    // Horizontal: move toward the target speed, with different times for accel / decel / turning.
    const runSpeed = T.runSpeed * TILE;
    const target = this.input.moveX * runSpeed;
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

    // Jump: buffered press + coyote time.
    const g = gravity();
    let vy = b.velocity.y;
    const canJump = !this.jumping && this.simTime - this.lastGroundedAt <= T.coyoteMs / 1000;
    if (canJump && this.input.buffered(Action.Jump, T.jumpBufferMs)) {
      this.input.consume(Action.Jump);
      // +half a gravity step: gravity is applied below in this same step, and the fixed-step
      // integrator would otherwise lose ~jumpHeight*dt/timeToApex (≈0.15 tiles) on every jump.
      vy = -(jumpSpeed() + 0.5 * g * dt);
      this.jump();
    }

    // Gravity with modifiers.
    const jumpHeld = this.input.held(Action.Jump);
    let mult = 1;
    if (vy > 0) mult = T.fallGravityMult;
    else if (vy < 0 && this.jumping && !jumpHeld) mult = T.jumpCutGravityMult;
    if (this.jumping && jumpHeld && Math.abs(vy) < T.apexThreshold * TILE) mult *= T.apexGravityMult;
    const fastFalling = vy > 0 && this.input.held(Action.Down);
    if (fastFalling) mult *= T.fastFallGravityMult;

    vy += g * mult * dt;
    vy = Math.min(vy, (fastFalling ? T.fastFallSpeed : T.maxFallSpeed) * TILE);
    b.setVelocity(vx, vy);

    if (this.grounded) this.state = Math.abs(vx) > 1 ? PlayerState.Run : PlayerState.Idle;
    else this.state = vy < 0 ? PlayerState.Jump : PlayerState.Fall;

    if (this.debugView) this.debugView.onStep();
  }

  /** Visuals. Called by the scene once per rendered frame. */
  update(deltaMs: number): void {
    this.view.setPosition(this.feetX, this.feetY);

    // Eyes drift toward the facing side and look up / down with vertical speed.
    const targetX = this.facing * PLAYER_W * 0.16;
    const targetY = Phaser.Math.Clamp(this.body.velocity.y / jumpSpeed(), -1, 1) * 5;
    const k = 1 - Math.exp(-deltaMs / 50); // frame-rate independent smoothing
    this.eyes.x += (targetX - this.eyes.x) * k;
    this.eyes.y += (targetY - this.eyes.y) * k;
  }

  private jump(): void {
    this.jumping = true;
    this.grounded = false;
    this.lastGroundedAt = -Infinity; // no second coyote jump

    // The ghost marks the takeoff frame and moves on every new jump.
    this.ghost.setPosition(this.feetX, this.feetY).setVisible(T.ghostAlpha > 0).setAlpha(0);
    this.scene.tweens.killTweensOf(this.ghost);
    this.scene.tweens.add({ targets: this.ghost, alpha: T.ghostAlpha, duration: 90 });

    this.pulseScale(1 - T.squash * 0.6, 1 + T.squash * 0.6, 160);
    if (this.debugView) this.debugView.onJump();
  }

  private land(): void {
    const impact = Phaser.Math.Clamp(this.airborneVy / (T.maxFallSpeed * TILE), 0, 1);
    this.pulseScale(1 + T.squash * impact, 1 - T.squash * impact, 130);
    if (this.debugView) this.debugView.onLand();
  }

  /** Squash & stretch: snap to (sx, sy), spring back to 1. Visual only, the hitbox never changes. */
  private pulseScale(sx: number, sy: number, duration: number): void {
    if (T.squash <= 0) return;
    this.scene.tweens.killTweensOf(this.view);
    this.view.setScale(sx, sy);
    this.scene.tweens.add({ targets: this.view, scaleX: 1, scaleY: 1, duration: duration, ease: 'Back.easeOut' });
  }
}

/**
 * Debug view for the player (debug builds only):
 *  - "player tuning" folder: a slider for every PlayerTuning value
 *  - "player" folder: live state, hitboxes, jump trail, time scale, respawn
 *  - jump trail: the real path of the last jump + its measured height / distance in tiles,
 *    which is what level design needs ("can the player make this gap?")
 */
class PlayerDebug {
  // shown in the panel
  state = '';
  grounded = false;
  vx = 0;
  vy = 0;
  showHitboxes = false;
  showTrail = true;
  timeScale = 1;

  private readonly scene: Phaser.Scene;
  private readonly player: Player;
  private readonly world: Phaser.Physics.Arcade.World;
  private readonly tuning: TuningFolder<PlayerTuning>;
  private readonly folder: GUI;
  private readonly trail: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private points: Phaser.Types.Math.Vector2Like[] = [];
  private startX = 0;
  private startY = 0;
  private apexX = 0;
  private apexY = 0;
  private tracking = false;

  constructor(scene: Phaser.Scene, player: Player) {
    this.scene = scene;
    this.player = player;
    this.world = scene.physics.world;

    const t = new TuningFolder('player tuning', T);
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

    const f = debug.gui.addFolder('player');
    f.add(this, 'state').listen().disable();
    f.add(this, 'grounded').listen().disable();
    f.add(this, 'vx').name('vx (tiles/s)').listen().disable();
    f.add(this, 'vy').name('vy (tiles/s)').listen().disable();
    f.add(this, 'showHitboxes').name('show hitboxes').onChange(() => this.applyHitboxes());
    f.add(this, 'showTrail').name('show jump trail').onChange(() => this.applyTrailVisibility());
    f.add(this, 'timeScale', 0.1, 1, 0.05).name('time scale').onChange(() => this.applyTimeScale());
    f.add(player, 'respawn').name('respawn (R)');
    this.folder = f;

    this.trail = scene.add.graphics();
    this.label = scene.add.text(0, 0, '', {
      fontFamily: 'Consolas, monospace',
      fontSize: '22px',
      color: '#ffffff',
      backgroundColor: '#00000088',
      padding: { x: 6, y: 3 },
    });
    this.label.setOrigin(0.5, 1).setVisible(false); // an empty label would still draw its background
  }

  destroy(): void {
    this.tuning.destroy();
    this.folder.destroy();
    this.world.timeScale = 1;
  }

  onStep(): void {
    const p = this.player;
    this.state = PlayerState[p.state];
    this.grounded = p.grounded;
    this.vx = Math.round((p.body.velocity.x / TILE) * 100) / 100;
    this.vy = p.grounded ? 0 : Math.round((p.body.velocity.y / TILE) * 100) / 100;

    if (!this.tracking) return;
    this.points.push({ x: p.feetX, y: p.feetY });
    if (p.feetY < this.apexY) {
      this.apexX = p.feetX;
      this.apexY = p.feetY;
    }
    this.drawTrail();
  }

  onJump(): void {
    this.startX = this.player.feetX;
    this.startY = this.player.feetY;
    this.apexX = this.startX;
    this.apexY = this.startY;
    this.points = [{ x: this.startX, y: this.startY }];
    this.tracking = true;
    this.label.setVisible(false);
  }

  onLand(): void {
    if (!this.tracking) return;
    this.tracking = false;
    const height = (this.startY - this.apexY) / TILE;
    const distance = Math.abs(this.player.feetX - this.startX) / TILE;
    const rise = (this.startY - this.player.feetY) / TILE;
    const riseText = (rise >= 0 ? 'up ' : 'down ') + Math.abs(rise).toFixed(2);
    this.label.setText('height ' + height.toFixed(2) + 't   distance ' + distance.toFixed(2) + 't   ' + riseText + 't');
    this.label.setPosition(this.apexX, this.apexY - 44).setVisible(this.showTrail);
    this.drawTrail();
  }

  private drawTrail(): void {
    const g = this.trail;
    g.clear();
    if (this.points.length < 2) return;
    g.lineStyle(3, 0xffffff, 0.8);
    g.strokePoints(this.points, false);
    g.lineStyle(1, 0xffffff, 0.35);
    g.lineBetween(this.startX - 60, this.startY, this.startX + 60, this.startY); // takeoff height
    g.lineStyle(2, 0xffff66, 0.9);
    g.lineBetween(this.apexX - 40, this.apexY, this.apexX + 40, this.apexY); // apex
    g.fillStyle(0xffff66, 1);
    g.fillCircle(this.apexX, this.apexY, 5);
  }

  private applyHitboxes(): void {
    if (this.showHitboxes && !this.world.debugGraphic) this.world.createDebugGraphic();
    this.world.drawDebug = this.showHitboxes;
    if (this.world.debugGraphic) this.world.debugGraphic.clear().setVisible(this.showHitboxes);
  }

  private applyTrailVisibility(): void {
    this.trail.setVisible(this.showTrail);
    this.label.setVisible(this.showTrail && this.label.text !== '');
  }

  private applyTimeScale(): void {
    this.world.timeScale = 1 / this.timeScale; // Arcade: bigger timeScale = slower
    this.scene.tweens.timeScale = this.timeScale;
  }
}
