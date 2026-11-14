import Phaser from 'phaser';
import type GUI from 'lil-gui';
import { DEBUG_ENABLED, TuningFolder, debug } from '../core/Debug';
import { Action, type InputActions } from '../core/InputActions';
import { ART_SCALE, TILE } from './constants';
import { NoiseKind, type NoiseSystem } from './Noise';
import { THROW, launchVelocity, type Throwables } from './Throwing';
import type { Zombie } from './Zombie';

/**
 * Every movement number, in TILES and SECONDS (never pixels).
 * Gravity and jump speed are derived from jumpHeight + timeToApex.
 */
class PlayerTuning {
  // gaits
  walkSpeed = 4.5; // tiles/s, default movement: quiet
  sprintSpeed = 8.5; // tiles/s while holding Sprint: loud
  sneakSpeed = 2.2; // tiles/s while crouched: silent
  accelTime = 0.08; // s from 0 to sprint speed (ground)
  decelTime = 0.06; // s from sprint speed to 0 (ground, no input)
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
  cornerCorrection = 0.3; // tiles: head would clip a ceiling corner by up to this -> slide past it
  ledgeCorrection = 0.2; // tiles: feet miss a ledge top by up to this while moving into it -> pop up
  // noise (tiles a sound carries). Hearing is the Clicker's strength: walking carries far, sprinting
  // further; only sneaking is silent (a Clicker still senses you within 2 tiles).
  walkNoise = 8;
  sprintNoise = 14;
  landNoise = 8; // hard landings only
  combatNoise = 7; // punches that land
  strideLength = 1.1; // tiles between footsteps
  // melee
  attackReach = 0.9; // tiles in front of the body
  stompBounce = 2.2; // tiles: bounce height after jumping on a Runner's head
  // presentation
  squash = 0.22; // squash & stretch strength (0 = off)
  ghostAlpha = 0.22; // takeoff shadow opacity (0 = off)
}

const T = new PlayerTuning();

// Hitbox: the survivor art is 64 px tall at 2x = 128 px (2 tiles); the hitbox is a bit smaller than
// the drawing (hair and backpack stick out), so contacts feel fair. Crouching lowers it.
const PLAYER_W = Math.round(TILE * 0.55);
const PLAYER_H = Math.round(TILE * 1.8);
const CROUCH_H = Math.round(TILE * 1.15);
const LAND_ANIM_TIME = 0.12; // s the landing pose is held
const THROW_TIME = 0.3; // s the throw animation locks movement
const THROW_RELEASE = 0.08; // s into the throw when the bottle leaves the hand (release frame)
const ATTACK_TIME = 0.2; // s a punch locks movement (short: several fit in a Runner's dizzy window)
const ATTACK_HIT = 0.06; // s into the punch when the fist lands
const HIDDEN_TINT = 0x6a6a6a;
const OVERLAP_INSET = 0.5; // px: the static tree counts touching edges as overlap, so test a slightly smaller box

enum PlayerState {
  Idle,
  Walk,
  Sprint,
  Crouch,
  Sneak,
  Jump,
  Fall,
  Aim,
  Throw,
  Attack,
  Dead,
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
  readonly throwables: Throwables;

  state = PlayerState.Idle;
  grounded = false;
  jumping = false; // in the air because of a jump (not a walk-off): enables jump cut + apex hang
  crouched = false;
  crouchWanted = false; // crouch is a TOGGLE: one press of Down / S / C
  hidden = false; // crouched behind cover: sighted enemies cannot see him
  canListen = false; // Listen Mode unlocked (Hard level, then every level once Hard is finished)
  listening = false; // holding Listen: frozen, crouched, silent (the scene draws what he hears)
  stepCount = 0; // audible footsteps so far (the HUD noise meter pulses on each one)
  landCount = 0; // loud landings so far
  dead = false;
  facing = 1;
  /** Cover areas (crates) and the infected, for hiding and melee; the scene fills these. */
  covers: Phaser.Geom.Rectangle[] = [];
  zombies: Zombie[] = [];

  private readonly scene: Phaser.Scene;
  private readonly physics: Phaser.Physics.Arcade.ArcadePhysics;
  private readonly input: InputActions;
  private readonly noise: NoiseSystem;
  private readonly spawnX: number;
  private readonly spawnY: number;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly ghost: Phaser.GameObjects.Image;
  private aiming = false;
  private aimDistance = 0; // tiles, signed: where the bottle will land
  private aimArc = 0; // tiles above the hand
  private throwTimer = 0;
  private throwPending = false; // bottle not released yet in the current throw
  private restartThrowAnim = false;
  private attackTimer = 0;
  private attackPending = false; // strike not resolved yet in the current swing
  private restartAttackAnim = false;
  private landTimer = 0;
  private stepDistance = 0; // px walked since the last footstep
  private simTime = 0; // seconds of physics time (stops in slow motion, unlike real time)
  private lastGroundedAt = -Infinity;
  private airborneVy = 0; // last vertical speed in the air = landing impact
  private debugView: PlayerDebug | null = null;

  constructor(scene: Phaser.Scene, input: InputActions, noise: NoiseSystem, throwables: Throwables,
    spawnFeetX: number, spawnFeetY: number) {
    this.scene = scene;
    this.physics = scene.physics;
    this.input = input;
    this.noise = noise;
    this.throwables = throwables;
    this.spawnX = spawnFeetX;
    this.spawnY = spawnFeetY;

    // Physics: a bare Arcade body (no sprite). Gravity is ours, not Arcade's.
    this.body = scene.physics.add.body(spawnFeetX - PLAYER_W / 2, spawnFeetY - PLAYER_H, PLAYER_W, PLAYER_H);
    this.body.setAllowGravity(false);

    // Takeoff ghost: a black silhouette of the exact takeoff frame, left where the last jump started.
    this.ghost = scene.add.image(0, 0, 'player_idle', 0).setOrigin(0.5, 1).setScale(ART_SCALE);
    this.ghost.setTintFill(0x000000).setVisible(false).setDepth(9);

    // The survivor sprite sits inside a container at the feet (squash & stretch pivots there).
    this.sprite = scene.add.sprite(0, 0, 'player_idle', 0).setOrigin(0.5, 1).setScale(ART_SCALE);
    this.sprite.play('player_idle');
    this.view = scene.add.container(spawnFeetX, spawnFeetY, [this.sprite]).setDepth(10);

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
    this.setCrouched(false);
    this.body.reset(this.spawnX - PLAYER_W / 2, this.spawnY - PLAYER_H);
    this.grounded = false;
    this.jumping = false;
    this.aiming = false;
    this.dead = false;
    this.lastGroundedAt = -Infinity;
    this.ghost.setVisible(false);
  }

  /** Caught by an infected. The scene restarts the level shortly after. */
  kill(): void {
    if (this.dead) return;
    this.dead = true;
    this.aiming = false;
    this.throwables.clearAim();
    this.body.setVelocity(0, 0);
  }

  /** Gameplay. Called by the scene on every physics step (60 Hz), after collisions are resolved. */
  fixedUpdate(dt: number): void {
    const b = this.body;
    this.simTime += dt;
    if (this.dead) {
      b.setVelocity(0, 0);
      this.state = PlayerState.Dead;
      return;
    }

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

    // Crouch toggle: a Down press on the ground flips it (presses in the air / while aiming are eaten,
    // so a fast-fall or an arc adjustment never toggles crouch on landing). Sprinting, jumping,
    // falling and aiming stand you up; standing needs head room.
    if (this.input.buffered(Action.Down, 150)) {
      this.input.consume(Action.Down);
      if (onGround && !this.aiming) this.crouchWanted = !this.crouchWanted;
    }
    if (!onGround || this.input.held(Action.Sprint) || this.input.held(Action.Throw)) this.crouchWanted = false;
    // Listen Mode: hold on the ground to freeze in a crouch (still hidden behind cover, silent).
    this.listening = this.canListen && onGround && this.input.held(Action.Listen) && !this.aiming
      && this.throwTimer <= 0 && this.attackTimer <= 0;
    const crouchNow = this.crouchWanted || this.listening;
    if (crouchNow && !this.crouched) this.setCrouched(true);
    else if (!crouchNow && this.crouched && this.canStand()) this.setCrouched(false);

    this.updateThrow(dt, onGround);
    this.updateAttack(dt, onGround);

    // Horizontal: gait speed, then accel / decel / turn toward it.
    let gaitSpeed = T.walkSpeed;
    if (this.crouched) gaitSpeed = T.sneakSpeed;
    else if (this.input.held(Action.Sprint)) gaitSpeed = T.sprintSpeed;
    const locked = this.aiming || this.throwTimer > 0 || this.attackTimer > 0 || this.listening;
    const target = locked ? 0 : this.input.moveX * gaitSpeed * TILE;
    let vx = b.velocity.x;
    let time: number;
    if (target !== 0) {
      const turning = vx !== 0 && Math.sign(target) !== Math.sign(vx);
      time = onGround ? (turning ? T.turnTime : T.accelTime) : T.airAccelTime;
      this.facing = Math.sign(target);
    } else {
      time = onGround ? T.decelTime : T.airDecelTime;
    }
    const rate = (T.sprintSpeed * TILE) / Math.max(time, 0.0001); // same responsiveness in every gait
    vx = time <= 0 ? target : moveTowards(vx, target, rate * dt);

    // Jump: buffered press + coyote time. Jumping from a crouch stands up first (if there is room).
    const g = gravity();
    let vy = b.velocity.y;
    const canJump = !locked && !this.jumping && this.simTime - this.lastGroundedAt <= T.coyoteMs / 1000;
    if (canJump && this.input.buffered(Action.Jump, T.jumpBufferMs) && (!this.crouched || this.canStand())) {
      this.input.consume(Action.Jump);
      this.setCrouched(false);
      this.crouchWanted = false;
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

    // Forgiveness: look one step ahead and fix "missed by a few pixels" before Arcade collides.
    if (vy < 0) this.correctCorner(vy * dt);
    else if (!onGround && vx !== 0) this.correctLedge(vx * dt);

    b.setVelocity(vx, vy);

    this.footsteps(dt, onGround, Math.abs(vx));
    this.hidden = this.crouched && this.behindCover();
    this.state = this.computeState(Math.abs(vx));

    if (this.debugView) this.debugView.onStep();
  }

  /** Visuals. Called by the scene once per rendered frame. */
  update(deltaMs: number): void {
    this.view.setPosition(this.feetX, this.feetY);
    this.sprite.setFlipX(this.facing < 0);
    this.landTimer = Math.max(0, this.landTimer - deltaMs / 1000);

    const speed = Math.abs(this.body.velocity.x);
    let anim = 'player_idle';
    let gait = 0; // speed the cycle was drawn for (0 = not a locomotion cycle)
    switch (this.state) {
      case PlayerState.Dead: anim = 'player_land'; break;
      case PlayerState.Throw: anim = 'player_throw'; break;
      case PlayerState.Attack: anim = 'player_attack'; break;
      case PlayerState.Aim: anim = 'player_aim'; break;
      case PlayerState.Jump: anim = 'player_jump'; break;
      case PlayerState.Fall: anim = 'player_fall'; break;
      case PlayerState.Crouch: anim = 'player_crouch'; break;
      case PlayerState.Sneak: anim = 'player_sneak'; gait = T.sneakSpeed; break;
      case PlayerState.Sprint: anim = 'player_run'; gait = T.sprintSpeed; break;
      case PlayerState.Walk: anim = 'player_walk'; gait = T.walkSpeed; break;
      default: anim = 'player_idle';
    }
    if (this.landTimer > 0 && this.state <= PlayerState.Walk) anim = 'player_land';
    if (this.restartThrowAnim) {
      this.sprite.play('player_throw'); // restart even if the previous throw is still the current anim
      this.restartThrowAnim = false;
    } else if (this.restartAttackAnim) {
      this.sprite.play('player_attack');
      this.restartAttackAnim = false;
    } else {
      this.sprite.play(anim, true); // true = keep playing if it is already the current animation
    }
    // Leg speed follows ground speed, so feet don't slide while accelerating.
    this.sprite.anims.timeScale = gait > 0 ? Phaser.Math.Clamp(speed / (gait * TILE), 0.5, 1.5) : 1;

    if (this.dead) this.sprite.setTint(0xff6060);
    else if (this.hidden) this.sprite.setTint(HIDDEN_TINT);
    else this.sprite.clearTint();

    if (this.aiming) this.throwables.drawAim(this.handX(), this.handY(), launchVelocity(this.aimDistance, this.aimArc));
    else this.throwables.clearAim();
  }

  // ---------------------------------------------------------------- throw

  /** Hold Throw to aim (left / right = distance, up / down = arc height), release to throw. */
  private updateThrow(dt: number, onGround: boolean): void {
    if (this.throwTimer > 0) {
      this.throwTimer -= dt;
      if (this.throwPending && this.throwTimer <= THROW_TIME - THROW_RELEASE) {
        this.throwPending = false;
        this.throwables.throwBottle(this.handX(), this.handY(), launchVelocity(this.aimDistance, this.aimArc));
      }
      return;
    }

    const throwHeld = this.input.held(Action.Throw);
    if (!this.aiming) {
      // A fresh press (not consumed) starts aiming: holding the key after a throw does not re-aim.
      if (throwHeld && this.input.buffered(Action.Throw, 200) && onGround && !this.crouched && this.attackTimer <= 0
        && this.throwables.canThrow) {
        this.input.consume(Action.Throw);
        this.aiming = true;
        this.aimDistance = THROW.startDistance * this.facing;
        this.aimArc = THROW.startArc;
      }
      return;
    }

    if (!onGround) {
      this.aiming = false; // knocked off a ledge while aiming: cancel
      return;
    }
    this.aimDistance = Phaser.Math.Clamp(this.aimDistance + this.input.moveX * THROW.aimSpeed * dt, -THROW.maxDistance, THROW.maxDistance);
    let arcInput = 0;
    if (this.input.held(Action.Up)) arcInput += 1;
    if (this.input.held(Action.Down)) arcInput -= 1;
    this.aimArc = Phaser.Math.Clamp(this.aimArc + arcInput * THROW.arcSpeed * dt, THROW.minArc, THROW.maxArc);
    if (this.aimDistance !== 0) this.facing = Math.sign(this.aimDistance);

    if (!throwHeld) {
      this.aiming = false;
      this.throwTimer = THROW_TIME;
      this.throwPending = true;
      this.restartThrowAnim = true;
    }
  }

  /** Jumped on a Runner's head: bounce up like a stomp in Mario (the scene detects the stomp). */
  bounce(): void {
    const g = gravity();
    this.body.setVelocityY(-Math.sqrt(2 * g * T.stompBounce * TILE));
    this.jumping = true;
    this.grounded = false;
    this.lastGroundedAt = -Infinity;
    this.pulseScale(1 - T.squash * 0.7, 1 + T.squash * 0.7, 180);
    this.scene.cameras.main.shake(80, 0.004);
  }

  // ---------------------------------------------------------------- melee

  /**
   * Punch. What it does is the zombie's call (Zombie.meleeHit): a dizzy Runner takes damage, a
   * distracted Clicker or a Screamer hit from behind is taken down silently, a Clicker that is not
   * busy grabs you, anything else shrugs it off. Works from a crouch too (sneak up, punch).
   */
  private updateAttack(dt: number, onGround: boolean): void {
    if (this.attackTimer > 0) {
      this.attackTimer -= dt;
      if (this.attackPending && this.attackTimer <= ATTACK_TIME - ATTACK_HIT) {
        this.attackPending = false;
        this.strike();
      }
      return;
    }
    if (this.aiming || this.throwTimer > 0 || !onGround) return;
    if (!this.input.buffered(Action.Attack, 150)) return;
    this.input.consume(Action.Attack);
    this.attackTimer = ATTACK_TIME;
    this.attackPending = true;
    this.restartAttackAnim = true;
  }

  private strike(): void {
    const b = this.body;
    const reach = T.attackReach * TILE;
    const left = this.facing > 0 ? b.right : b.left - reach;
    const top = b.bottom - PLAYER_H; // a full-height swing even when crouched
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      if (!z.alive) continue;
      const zb = z.body;
      if (zb.right < left || zb.left > left + reach || zb.bottom < top || zb.top > b.bottom) continue;
      const result = z.meleeHit(this.feetX);
      if (result === 'hit') {
        this.noise.emit(zb.center.x, zb.center.y, T.combatNoise, NoiseKind.Combat);
        this.scene.cameras.main.shake(90, 0.005);
      } else if (result === 'takedown') {
        this.scene.cameras.main.shake(60, 0.003); // silent: no noise
      } else if (result === 'grab') {
        z.grab(); // punched a Clicker that wasn't busy: it gets you
        this.kill();
        return;
      }
    }
  }

  private handX(): number {
    return this.feetX + this.facing * TILE * 0.2;
  }

  private handY(): number {
    return this.feetY - TILE * 1.75;
  }

  // ---------------------------------------------------------------- noise, cover, state

  private footsteps(dt: number, onGround: boolean, speed: number): void {
    if (!onGround || speed < 1) {
      this.stepDistance = 0;
      return;
    }
    this.stepDistance += speed * dt;
    if (this.stepDistance < T.strideLength * TILE) return;
    this.stepDistance = 0;
    if (this.crouched) return; // sneaking is silent
    const radius = speed > T.walkSpeed * TILE * 1.1 ? T.sprintNoise : T.walkNoise;
    this.noise.emit(this.feetX, this.feetY, radius, NoiseKind.Footstep);
    this.stepCount++;
  }

  /** How loud moving is right now, for the HUD: 0 silent (still, crouched, airborne), 1 walking, 2 running. */
  get noiseLevel(): number {
    if (!this.grounded || this.crouched || this.dead) return 0;
    const speed = Math.abs(this.body.velocity.x);
    if (speed > T.walkSpeed * TILE * 1.1) return 2;
    return speed > 10 ? 1 : 0;
  }

  private behindCover(): boolean {
    const b = this.body;
    for (let i = 0; i < this.covers.length; i++) {
      const c = this.covers[i];
      if (b.right > c.x && b.left < c.right && b.bottom > c.y && b.top < c.bottom) return true;
    }
    return false;
  }

  private computeState(speed: number): PlayerState {
    if (this.attackTimer > 0) return PlayerState.Attack;
    if (this.throwTimer > 0) return PlayerState.Throw;
    if (this.aiming) return PlayerState.Aim;
    if (!this.grounded) return this.body.velocity.y < 0 ? PlayerState.Jump : PlayerState.Fall;
    if (this.crouched) return speed > 10 ? PlayerState.Sneak : PlayerState.Crouch;
    if (speed > T.walkSpeed * TILE * 1.1) return PlayerState.Sprint;
    if (speed > 10) return PlayerState.Walk;
    return PlayerState.Idle;
  }

  // ---------------------------------------------------------------- body

  /** Switch hitbox height, keeping the feet where they are. */
  private setCrouched(on: boolean): void {
    if (this.crouched === on) return;
    const b = this.body;
    const bottom = b.bottom;
    const h = on ? CROUCH_H : PLAYER_H;
    b.setSize(PLAYER_W, h);
    b.position.y = bottom - h;
    b.updateCenter();
    this.crouched = on;
  }

  private canStand(): boolean {
    return !this.blockedAt(this.body.x, this.body.bottom - PLAYER_H, PLAYER_H);
  }

  /** Would a body of the given height overlap a solid if its top-left were at (x, y)? */
  private blockedAt(x: number, y: number, h: number = this.body.height): boolean {
    const w = PLAYER_W - 2 * OVERLAP_INSET;
    return this.physics.overlapRect(x + OVERLAP_INSET, y + OVERLAP_INSET, w, h - 2 * OVERLAP_INSET, false, true).length > 0;
  }

  /**
   * Rising and the head is about to hit a ceiling: if sliding sideways by a few pixels clears it,
   * slide (smallest shift wins) and keep the full jump. A wide ceiling still stops you normally.
   */
  private correctCorner(dy: number): void {
    const b = this.body;
    const maxShift = Math.floor(T.cornerCorrection * TILE);
    if (maxShift <= 0 || !this.blockedAt(b.x, b.y + dy)) return;

    for (let d = 1; d <= maxShift; d++) {
      if (!this.blockedAt(b.x - d, b.y + dy)) {
        this.shift(-d, 0);
        return;
      }
      if (!this.blockedAt(b.x + d, b.y + dy)) {
        this.shift(d, 0);
        return;
      }
    }
  }

  /**
   * In the air, moving into a wall whose top is just above the feet: pop up onto the ledge
   * instead of sliding down its face.
   */
  private correctLedge(dx: number): void {
    const b = this.body;
    const maxShift = Math.floor(T.ledgeCorrection * TILE);
    if (maxShift <= 0 || !this.blockedAt(b.x + dx, b.y)) return;

    for (let d = 1; d <= maxShift; d++) {
      if (!this.blockedAt(b.x + dx, b.y - d)) {
        this.shift(0, -d);
        return;
      }
    }
  }

  /**
   * Move the body by (dx, dy) plus 1 px in the same direction: blockedAt() tests an inset box, so the
   * spot it calls "clear" can still overlap the solid by < OVERLAP_INSET, and Arcade would bonk on that.
   */
  private shift(dx: number, dy: number): void {
    this.body.position.x += dx + Math.sign(dx);
    this.body.position.y += dy + Math.sign(dy);
    this.body.updateCenter();
    if (this.debugView) this.debugView.onCorrection(this.feetX, dy !== 0 ? this.feetY : this.body.y);
  }

  private jump(): void {
    this.jumping = true;
    this.grounded = false;
    this.lastGroundedAt = -Infinity; // no second coyote jump

    // The ghost copies the takeoff frame and moves on every new jump.
    this.ghost.setTexture(this.sprite.texture.key, this.sprite.frame.name).setFlipX(this.sprite.flipX);
    this.ghost.setPosition(this.feetX, this.feetY).setVisible(T.ghostAlpha > 0).setAlpha(0);
    this.scene.tweens.killTweensOf(this.ghost);
    this.scene.tweens.add({ targets: this.ghost, alpha: T.ghostAlpha, duration: 90 });

    this.pulseScale(1 - T.squash * 0.6, 1 + T.squash * 0.6, 160);
    if (this.debugView) this.debugView.onJump();
  }

  private land(): void {
    const impact = Phaser.Math.Clamp(this.airborneVy / (T.maxFallSpeed * TILE), 0, 1);
    this.pulseScale(1 + T.squash * impact, 1 - T.squash * impact, 130);
    if (impact > 0.2) this.landTimer = LAND_ANIM_TIME; // small hops don't need the crouch pose
    if (impact > 0.45) { // hard landings are loud
      this.noise.emit(this.feetX, this.feetY, T.landNoise, NoiseKind.Landing);
      this.landCount++;
    }
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
 *  - "player" folder: live state, hitboxes, jump trail, time scale, infinite bottles, respawn
 *  - jump trail: the real path of the last jump + its measured height / distance in tiles,
 *    which is what level design needs ("can the player make this gap?")
 */
class PlayerDebug {
  // shown in the panel
  state = '';
  grounded = false;
  hidden = false;
  bottles = 0;
  vx = 0;
  vy = 0;
  corrections = 0;
  showHitboxes = false;
  showTrail = false;
  infiniteBottles = false;
  timeScale = 1;

  private readonly scene: Phaser.Scene;
  private readonly player: Player;
  private readonly world: Phaser.Physics.Arcade.World;
  private readonly tuning: TuningFolder<PlayerTuning>;
  private readonly folder: GUI;
  private readonly trail: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private points: Phaser.Types.Math.Vector2Like[] = [];
  private correctionPoints: Phaser.Types.Math.Vector2Like[] = []; // drawn as cyan dots on the trail
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
    t.add('walkSpeed', 1, 15, 0.1);
    t.add('sprintSpeed', 1, 20, 0.1);
    t.add('sneakSpeed', 0.5, 8, 0.1);
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
    t.add('cornerCorrection', 0, 0.5, 0.01);
    t.add('ledgeCorrection', 0, 0.5, 0.01);
    t.add('walkNoise', 0, 10, 0.1);
    t.add('sprintNoise', 0, 15, 0.1);
    t.add('landNoise', 0, 15, 0.1);
    t.add('combatNoise', 0, 15, 0.1);
    t.add('attackReach', 0.3, 3, 0.05);
    t.add('stompBounce', 0.5, 5, 0.1);
    t.add('strideLength', 0.3, 3, 0.05);
    t.add('squash', 0, 0.6, 0.01);
    t.add('ghostAlpha', 0, 1, 0.01);
    this.tuning = t;

    const f = debug.gui.addFolder('player');
    f.add(this, 'state').listen().disable();
    f.add(this, 'grounded').listen().disable();
    f.add(this, 'hidden').listen().disable();
    f.add(this, 'bottles').listen().disable();
    f.add(this, 'vx').name('vx (tiles/s)').listen().disable();
    f.add(this, 'vy').name('vy (tiles/s)').listen().disable();
    f.add(this, 'corrections').name('corner/ledge fixes').listen().disable();
    f.add(this, 'showHitboxes').name('show hitboxes').onChange(() => this.applyHitboxes());
    f.add(this, 'showTrail').name('show jump trail').onChange(() => this.applyTrailVisibility());
    f.add(this, 'infiniteBottles').name('infinite bottles');
    f.add(this, 'timeScale', 0.1, 1, 0.05).name('time scale').onChange(() => this.applyTimeScale());
    f.add(player, 'respawn').name('respawn');
    this.folder = f;

    this.trail = scene.add.graphics().setVisible(this.showTrail);
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
    this.hidden = p.hidden;
    if (this.infiniteBottles && p.throwables.count < 9) p.throwables.count = 9;
    this.bottles = p.throwables.count;
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
    this.correctionPoints = [];
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

  onCorrection(x: number, y: number): void {
    this.corrections++;
    this.correctionPoints.push({ x: x, y: y });
    this.drawTrail();
  }

  private drawTrail(): void {
    const g = this.trail;
    g.clear();
    g.fillStyle(0x66ffff, 1);
    for (let i = 0; i < this.correctionPoints.length; i++) {
      g.fillCircle(this.correctionPoints[i].x, this.correctionPoints[i].y, 7);
    }
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
