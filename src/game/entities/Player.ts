import type GUI from 'lil-gui';
import {
  BodyType, DEBUG_ENABLED, Ease, MathUtil, Rect, TuningFolder, Vec2, debugPanel,
  type Animator, type Body, type Engine, type Group, type Input, type Sprite,
} from '../../engine';
import { Action, MoveX } from '../Actions';
import { ART_SCALE, TILE } from '../constants';
import { NoiseKind, type NoiseSystem } from '../systems/Noise';
import { LaunchVelocity, THROW, type Throwables } from '../systems/Throwing';
import { MeleeResult, type Zombie } from './Zombie';

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
  doubleJumpHeight = 2.4; // tiles, the second jump in the air (Mechanic 3: spring boots)
  dashSpeed = 22; // tiles/s, the air dash (Mechanic 3: brace boots)
  dashTime = 0.15; // s: dashSpeed x dashTime = ~3.3 tiles, no gravity meanwhile
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
  // Listen Mode
  listenTime = 4; // s of listening on a full charge
  listenRecharge = 6; // s from empty to full; run it dry and it is locked until full again
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
const OVERLAP_INSET = 0.5; // px: test a slightly smaller box, so a box that only touches a wall reads as clear

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

/** g = 2h / t²  (px/s²): the gravity that makes a jump of jumpHeight peak after timeToApex. */
function Gravity(): number {
  return (2 * T.jumpHeight * TILE) / (T.timeToApex * T.timeToApex);
}

/** v = 2h / t  (px/s): the launch speed of that jump. */
function JumpSpeed(): number {
  return (2 * T.jumpHeight * TILE) / T.timeToApex;
}

/** Launch speed for the double jump: v² = 2·g·h, with the same gravity as the first jump. */
function DoubleJumpSpeed(): number {
  return Math.sqrt(2 * Gravity() * T.doubleJumpHeight * TILE);
}

export class Player {
  readonly body: Body;
  /** Visual root, placed at the FEET so squash & stretch pivots on the ground. */
  readonly view: Group;
  readonly throwables: Throwables;

  state = PlayerState.Idle;
  grounded = false;
  jumping = false; // in the air because of a jump (not a walk-off): enables jump cut + apex hang
  crouched = false;
  crouchWanted = false; // crouch is a TOGGLE: one press of Down / S / C
  hidden = false; // crouched behind cover: sighted enemies cannot see him
  canListen = false; // Listen Mode unlocked (Hard level, then every level once Hard is finished)
  listening = false; // holding Listen: frozen, crouched, silent (the level draws what he hears)
  listenEnergy = 1; // 0..1: drains while listening, recharges otherwise
  invisible = false; // cheat: nothing can see, sense or catch him
  canDoubleJump = false; // Mechanic 3: spring boots built (the level sets it)
  private airJumpUsed = false; // the double jump is spent until he lands
  canDash = false; // Mechanic 3: X in the air dashes (the level sets it)
  private dashUsed = false; // one dash per time in the air
  private dashTimer = 0; // s left in the current dash
  pinned = false; // a machine gun is on him: frozen in place, flinching, until it kills him
  listenExhausted = false; // ran dry: locked until fully recharged
  stepCount = 0; // audible footsteps so far (the HUD noise meter pulses on each one)
  landCount = 0; // loud landings so far
  dead = false;
  facing = 1;
  /** Cover areas (crates) and the infected, for hiding and melee; the level fills these. */
  covers: Rect[] = [];
  zombies: Zombie[] = [];

  private readonly engine: Engine;
  private readonly input: Input;
  private readonly noise: NoiseSystem;
  private readonly spawnX: number;
  private readonly spawnY: number;
  private readonly sprite: Sprite;
  private readonly anim: Animator;
  private readonly ghost: Sprite;
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

  constructor(engine: Engine, noise: NoiseSystem, throwables: Throwables, spawnFeetX: number, spawnFeetY: number) {
    this.engine = engine;
    this.input = engine.input;
    this.noise = noise;
    this.throwables = throwables;
    this.spawnX = spawnFeetX;
    this.spawnY = spawnFeetY;

    // Physics: a bare body (no sprite). gravityScale 0: the player applies his own, variable gravity.
    this.body = engine.physics.CreateBody({
      type: BodyType.Dynamic, x: spawnFeetX - PLAYER_W / 2, y: spawnFeetY - PLAYER_H, w: PLAYER_W, h: PLAYER_H, gravityScale: 0,
    });

    const r = engine.renderer;
    // Takeoff ghost: a black silhouette of the exact takeoff frame, left where the last jump started.
    this.ghost = r.CreateSprite(0, 0, 'player_idle').SetOrigin(0.5, 1).SetScale(ART_SCALE);
    this.ghost.SetTintFill(0x000000).SetVisible(false).SetDepth(9);

    // The survivor sprite sits inside a group at the feet (squash & stretch pivots there).
    this.sprite = r.CreateSprite(0, 0, 'player_idle').SetOrigin(0.5, 1).SetScale(ART_SCALE);
    this.anim = engine.animations.Create(this.sprite);
    this.anim.Play('player_idle');
    this.view = r.CreateGroup(spawnFeetX, spawnFeetY).SetDepth(10).Add(this.sprite);

    if (DEBUG_ENABLED) this.debugView = new PlayerDebug(engine, this);
  }

  Destroy(): void {
    if (this.debugView) this.debugView.Destroy();
  }

  get feetX(): number {
    return this.body.centerX;
  }

  get feetY(): number {
    return this.body.bottom;
  }

  Respawn(): void {
    this.SetCrouched(false);
    this.body.Teleport(this.spawnX - PLAYER_W / 2, this.spawnY - PLAYER_H);
    this.grounded = false;
    this.jumping = false;
    this.aiming = false;
    this.dead = false;
    this.lastGroundedAt = -Infinity;
    this.ghost.SetVisible(false);
  }

  /** Caught by an infected. The level restarts shortly after. */
  Kill(): void {
    if (this.dead) return;
    this.dead = true;
    this.aiming = false;
    this.throwables.ClearAim();
    this.body.SetVelocity(0, 0);
  }

  /** Gameplay. Called by the level on every fixed step (60 Hz), before the physics step moves the body. */
  FixedUpdate(dt: number): void {
    const b = this.body;
    const input = this.input;
    this.simTime += dt;
    if (this.dead) {
      b.SetVelocity(0, 0);
      this.state = PlayerState.Dead;
      return;
    }

    // Ground check. Ignored while moving up: right after a jump the contact flag can be one step stale.
    const onGround = b.contacts.down && b.velocity.y >= 0;
    if (onGround) {
      if (!this.grounded) this.Land();
      this.lastGroundedAt = this.simTime;
      this.jumping = false;
      this.airJumpUsed = false;
      this.dashUsed = false;
    } else {
      this.airborneVy = b.velocity.y;
    }
    this.grounded = onGround;

    // Crouch toggle: a Down press on the ground flips it (presses in the air / while aiming are eaten,
    // so a fast-fall or an arc adjustment never toggles crouch on landing). Sprinting, jumping,
    // falling and aiming stand you up; standing needs head room.
    if (input.Buffered(Action.Down, 150)) {
      input.Consume(Action.Down);
      if (onGround && !this.aiming) this.crouchWanted = !this.crouchWanted;
    }
    if (!onGround || input.Held(Action.Sprint) || input.Held(Action.Throw)) this.crouchWanted = false;
    // Listen Mode: hold on the ground to freeze in a crouch (still hidden behind cover, silent).
    this.listening = this.canListen && onGround && input.Held(Action.Listen) && !this.aiming
      && this.throwTimer <= 0 && this.attackTimer <= 0 && !this.listenExhausted;
    if (this.listening) {
      this.listenEnergy -= dt / T.listenTime;
      if (this.listenEnergy <= 0) { // ran dry: it stops by itself, and waits for a full recharge
        this.listenEnergy = 0;
        this.listenExhausted = true;
        this.listening = false;
      }
    } else {
      this.listenEnergy = Math.min(1, this.listenEnergy + dt / T.listenRecharge);
      if (this.listenEnergy >= 1) this.listenExhausted = false;
    }
    const crouchNow = this.crouchWanted || this.listening;
    if (crouchNow && !this.crouched) this.SetCrouched(true);
    else if (!crouchNow && this.crouched && this.CanStand()) this.SetCrouched(false);

    this.UpdateThrow(dt, onGround);
    this.UpdateAttack(dt, onGround);

    // Horizontal: gait speed, then accel / decel / turn toward it.
    let gaitSpeed = T.walkSpeed;
    if (this.crouched) gaitSpeed = T.sneakSpeed;
    else if (input.Held(Action.Sprint)) gaitSpeed = T.sprintSpeed;
    const locked = this.aiming || this.throwTimer > 0 || this.attackTimer > 0 || this.listening || this.pinned;
    const target = locked ? 0 : MoveX(input) * gaitSpeed * TILE;
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
    vx = time <= 0 ? target : MathUtil.MoveTowards(vx, target, rate * dt);

    // Jump: buffered press + coyote time. Jumping from a crouch stands up first (if there is room).
    const g = Gravity();
    let vy = b.velocity.y;
    const canJump = !locked && !this.jumping && this.simTime - this.lastGroundedAt <= T.coyoteMs / 1000;
    if (canJump && input.Buffered(Action.Jump, T.jumpBufferMs) && (!this.crouched || this.CanStand())) {
      input.Consume(Action.Jump);
      this.SetCrouched(false);
      this.crouchWanted = false;
      // +half a gravity step: gravity is applied below in this same step, and the fixed-step
      // integrator would otherwise lose ~jumpHeight*dt/timeToApex (≈0.15 tiles) on every jump.
      vy = -(JumpSpeed() + 0.5 * g * dt);
      this.Jump();
    } else if (this.canDoubleJump && !this.airJumpUsed && !onGround && !locked && input.Buffered(Action.Jump, T.jumpBufferMs)) {
      // Spring boots: one more jump in the air. It replaces the fall speed (a fresh launch, not a boost).
      input.Consume(Action.Jump);
      this.airJumpUsed = true;
      vy = -(DoubleJumpSpeed() + 0.5 * g * dt);
      this.Jump();
    }

    // Dash: X in the air, once until he lands. A straight burst the way he faces: fixed speed, no gravity.
    if (this.canDash && !onGround && !this.dashUsed && !locked && input.Buffered(Action.Attack, T.jumpBufferMs)) {
      input.Consume(Action.Attack);
      this.dashUsed = true;
      this.dashTimer = T.dashTime;
      this.PulseScale(1 + T.squash, 1 - T.squash, 0.14); // stretched by the burst
    }
    const fastFalling = vy > 0 && input.Held(Action.Down);
    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      // the burst; on its last step back to a sprint, so a dash is always the same extra distance
      vx = this.facing * (this.dashTimer > 0 ? T.dashSpeed : T.sprintSpeed) * TILE;
      vy = 0;
    } else {
      // Gravity with modifiers.
      const jumpHeld = input.Held(Action.Jump);
      let mult = 1;
      if (vy > 0) mult = T.fallGravityMult;
      else if (vy < 0 && this.jumping && !jumpHeld) mult = T.jumpCutGravityMult;
      if (this.jumping && jumpHeld && Math.abs(vy) < T.apexThreshold * TILE) mult *= T.apexGravityMult;
      if (fastFalling) mult *= T.fastFallGravityMult;

      vy += g * mult * dt;
      vy = Math.min(vy, (fastFalling ? T.fastFallSpeed : T.maxFallSpeed) * TILE);
    }

    // Forgiveness: look one step ahead and fix "missed by a few pixels" before the physics step collides.
    if (vy < 0) this.CorrectCorner(vy * dt);
    else if (!onGround && vx !== 0) this.CorrectLedge(vx * dt);

    b.SetVelocity(vx, vy);

    this.Footsteps(dt, onGround, Math.abs(vx));
    this.hidden = this.invisible || (this.crouched && this.BehindCover());
    this.state = this.ComputeState(Math.abs(vx));

    if (this.debugView) this.debugView.OnStep();
  }

  /** Visuals. Called by the level once per rendered frame. */
  Update(dt: number): void {
    this.view.SetPosition(this.feetX, this.feetY);
    this.sprite.SetFlipX(this.facing < 0);
    this.landTimer = Math.max(0, this.landTimer - dt);

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
      this.anim.Play('player_throw'); // restart even if the previous throw is still the current clip
      this.restartThrowAnim = false;
    } else if (this.restartAttackAnim) {
      this.anim.Play('player_attack');
      this.restartAttackAnim = false;
    } else {
      this.anim.Play(anim, true); // true = keep playing if it is already the current clip
    }
    // Leg speed follows ground speed, so feet don't slide while accelerating.
    this.anim.timeScale = gait > 0 ? MathUtil.Clamp(speed / (gait * TILE), 0.5, 1.5) : 1;

    if (this.pinned && !this.dead) this.sprite.SetTint((Math.floor(this.simTime * 20) % 2) === 0 ? 0xffffff : 0xff6a5a); // hit, hit, hit
    else if (this.dead) this.sprite.SetTint(0xff6060);
    else if (this.hidden) this.sprite.SetTint(HIDDEN_TINT);
    else this.sprite.ClearTint();
    this.sprite.SetAlpha(this.invisible ? 0.45 : 1);

    if (this.aiming) this.throwables.DrawAim(this.HandX(), this.HandY(), LaunchVelocity(this.aimDistance, this.aimArc));
    else this.throwables.ClearAim();
    if (this.debugView) this.debugView.Draw();
  }

  // ---------------------------------------------------------------- throw

  /** Hold Throw to aim (left / right = distance, up / down = arc height), release to throw. */
  private UpdateThrow(dt: number, onGround: boolean): void {
    const input = this.input;
    if (this.throwTimer > 0) {
      this.throwTimer -= dt;
      if (this.throwPending && this.throwTimer <= THROW_TIME - THROW_RELEASE) {
        this.throwPending = false;
        this.throwables.ThrowBottle(this.HandX(), this.HandY(), LaunchVelocity(this.aimDistance, this.aimArc));
      }
      return;
    }

    const throwHeld = input.Held(Action.Throw);
    if (!this.aiming) {
      // A fresh press (not consumed) starts aiming: holding the key after a throw does not re-aim.
      if (throwHeld && input.Buffered(Action.Throw, 200) && onGround && !this.crouched && this.attackTimer <= 0
        && this.throwables.canThrow) {
        input.Consume(Action.Throw);
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
    this.aimDistance = MathUtil.Clamp(this.aimDistance + MoveX(input) * THROW.aimSpeed * dt, -THROW.maxDistance, THROW.maxDistance);
    let arcInput = 0;
    if (input.Held(Action.Up)) arcInput += 1;
    if (input.Held(Action.Down)) arcInput -= 1;
    this.aimArc = MathUtil.Clamp(this.aimArc + arcInput * THROW.arcSpeed * dt, THROW.minArc, THROW.maxArc);
    if (this.aimDistance !== 0) this.facing = Math.sign(this.aimDistance);

    if (!throwHeld) {
      this.aiming = false;
      this.throwTimer = THROW_TIME;
      this.throwPending = true;
      this.restartThrowAnim = true;
    }
  }

  /** Jumped on a Runner's head: bounce up like a stomp in Mario (the level detects the stomp). */
  Bounce(): void {
    this.body.velocity.y = -Math.sqrt(2 * Gravity() * T.stompBounce * TILE); // v² = 2·g·h
    this.jumping = true;
    this.grounded = false;
    this.lastGroundedAt = -Infinity;
    this.PulseScale(1 - T.squash * 0.7, 1 + T.squash * 0.7, 0.18);
    this.engine.camera.Shake(0.08, 0.004);
  }

  // ---------------------------------------------------------------- melee

  /**
   * Punch. What it does is the zombie's call (Zombie.MeleeHit): a dizzy Runner takes damage, a
   * distracted Clicker or a Screamer hit from behind is taken down silently, a Clicker that is not
   * busy grabs you, anything else shrugs it off. Works from a crouch too (sneak up, punch).
   */
  private UpdateAttack(dt: number, onGround: boolean): void {
    if (this.attackTimer > 0) {
      this.attackTimer -= dt;
      if (this.attackPending && this.attackTimer <= ATTACK_TIME - ATTACK_HIT) {
        this.attackPending = false;
        this.Strike();
      }
      return;
    }
    if (this.aiming || this.throwTimer > 0 || !onGround) return;
    if (!this.input.Buffered(Action.Attack, 150)) return;
    this.input.Consume(Action.Attack);
    this.attackTimer = ATTACK_TIME;
    this.attackPending = true;
    this.restartAttackAnim = true;
  }

  private Strike(): void {
    const b = this.body;
    const reach = T.attackReach * TILE;
    const left = this.facing > 0 ? b.right : b.left - reach;
    const top = b.bottom - PLAYER_H; // a full-height swing even when crouched
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      if (!z.alive) continue;
      const zb = z.body;
      if (zb.right < left || zb.left > left + reach || zb.bottom < top || zb.top > b.bottom) continue;
      const result = z.MeleeHit(this.feetX);
      if (result === MeleeResult.Hit) {
        this.noise.Emit(zb.centerX, zb.centerY, T.combatNoise, NoiseKind.Combat);
        this.engine.camera.Shake(0.09, 0.005);
      } else if (result === MeleeResult.Takedown) {
        this.engine.camera.Shake(0.06, 0.003); // silent: no noise
      } else if (result === MeleeResult.Grab) {
        z.Grab(); // punched a Clicker that wasn't busy: it gets you
        this.Kill();
        return;
      }
    }
  }

  private HandX(): number {
    return this.feetX + this.facing * TILE * 0.2;
  }

  private HandY(): number {
    return this.feetY - TILE * 1.75;
  }

  // ---------------------------------------------------------------- noise, cover, state

  private Footsteps(dt: number, onGround: boolean, speed: number): void {
    if (!onGround || speed < 1) {
      this.stepDistance = 0;
      return;
    }
    this.stepDistance += speed * dt;
    if (this.stepDistance < T.strideLength * TILE) return;
    this.stepDistance = 0;
    if (this.crouched) return; // sneaking is silent
    const radius = speed > T.walkSpeed * TILE * 1.1 ? T.sprintNoise : T.walkNoise;
    this.noise.Emit(this.feetX, this.feetY, radius, NoiseKind.Footstep);
    this.stepCount++;
  }

  /** How loud moving is right now, for the HUD: 0 silent (still, crouched, airborne), 1 walking, 2 running. */
  get noiseLevel(): number {
    if (!this.grounded || this.crouched || this.dead) return 0;
    const speed = Math.abs(this.body.velocity.x);
    if (speed > T.walkSpeed * TILE * 1.1) return 2;
    return speed > 10 ? 1 : 0;
  }

  private BehindCover(): boolean {
    const box = this.body.Bounds();
    for (let i = 0; i < this.covers.length; i++) if (box.Overlaps(this.covers[i])) return true;
    return false;
  }

  private ComputeState(speed: number): PlayerState {
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
  private SetCrouched(on: boolean): void {
    if (this.crouched === on) return;
    const b = this.body;
    const bottom = b.bottom;
    const h = on ? CROUCH_H : PLAYER_H;
    b.SetSize(PLAYER_W, h);
    b.position.y = bottom - h;
    this.crouched = on;
  }

  private CanStand(): boolean {
    return !this.BlockedAt(this.body.left, this.body.bottom - PLAYER_H, PLAYER_H);
  }

  /** Would a body of the given height overlap a solid if its top-left were at (x, y)? */
  private BlockedAt(x: number, y: number, h: number = this.body.height): boolean {
    const box = new Rect(x + OVERLAP_INSET, y + OVERLAP_INSET, PLAYER_W - 2 * OVERLAP_INSET, h - 2 * OVERLAP_INSET);
    return this.engine.physics.QueryBox(box);
  }

  /**
   * Rising and the head is about to hit a ceiling: if sliding sideways by a few pixels clears it,
   * slide (smallest shift wins) and keep the full jump. A wide ceiling still stops you normally.
   */
  private CorrectCorner(dy: number): void {
    const b = this.body;
    const maxShift = Math.floor(T.cornerCorrection * TILE);
    if (maxShift <= 0 || !this.BlockedAt(b.left, b.top + dy)) return;

    for (let d = 1; d <= maxShift; d++) {
      if (!this.BlockedAt(b.left - d, b.top + dy)) {
        this.Shift(-d, 0);
        return;
      }
      if (!this.BlockedAt(b.left + d, b.top + dy)) {
        this.Shift(d, 0);
        return;
      }
    }
  }

  /**
   * In the air, moving into a wall whose top is just above the feet: pop up onto the ledge
   * instead of sliding down its face.
   */
  private CorrectLedge(dx: number): void {
    const b = this.body;
    const maxShift = Math.floor(T.ledgeCorrection * TILE);
    if (maxShift <= 0 || !this.BlockedAt(b.left + dx, b.top)) return;

    for (let d = 1; d <= maxShift; d++) {
      if (!this.BlockedAt(b.left + dx, b.top - d)) {
        this.Shift(0, -d);
        return;
      }
    }
  }

  /**
   * Move the body by (dx, dy) plus 1 px in the same direction: BlockedAt() tests an inset box, so the
   * spot it calls "clear" can still overlap the solid by < OVERLAP_INSET.
   */
  private Shift(dx: number, dy: number): void {
    this.body.position.x += dx + Math.sign(dx);
    this.body.position.y += dy + Math.sign(dy);
    if (this.debugView) this.debugView.OnCorrection(this.feetX, dy !== 0 ? this.feetY : this.body.top);
  }

  private Jump(): void {
    this.jumping = true;
    this.grounded = false;
    this.lastGroundedAt = -Infinity; // no second coyote jump

    // The ghost copies the takeoff frame and moves on every new jump.
    this.ghost.SetTexture(this.sprite.textureKey, this.sprite.frame).SetFlipX(this.sprite.flipX);
    this.ghost.SetPosition(this.feetX, this.feetY).SetVisible(T.ghostAlpha > 0).SetAlpha(0);
    this.engine.tweens.Kill(this.ghost);
    this.engine.tweens.To(this.ghost, { alpha: T.ghostAlpha }, 0.09);

    this.PulseScale(1 - T.squash * 0.6, 1 + T.squash * 0.6, 0.16);
    if (this.debugView) this.debugView.OnJump();
  }

  private Land(): void {
    const impact = MathUtil.Clamp(this.airborneVy / (T.maxFallSpeed * TILE), 0, 1);
    this.PulseScale(1 + T.squash * impact, 1 - T.squash * impact, 0.13);
    if (impact > 0.2) this.landTimer = LAND_ANIM_TIME; // small hops don't need the crouch pose
    if (impact > 0.45) { // hard landings are loud
      this.noise.Emit(this.feetX, this.feetY, T.landNoise, NoiseKind.Landing);
      this.landCount++;
    }
    if (this.debugView) this.debugView.OnLand();
  }

  /** Squash & stretch: snap to (sx, sy), spring back to 1. Visual only, the hitbox never changes. */
  private PulseScale(sx: number, sy: number, seconds: number): void {
    if (T.squash <= 0) return;
    this.engine.tweens.Kill(this.view);
    this.view.SetScale(sx, sy);
    this.engine.tweens.To(this.view, { scaleX: 1, scaleY: 1 }, seconds, { ease: Ease.BackOut });
  }
}

/**
 * Debug view for the player (debug builds only):
 *  - "player tuning" folder: a slider for every PlayerTuning value
 *  - "player" folder: live state, hitboxes, jump trail, time scale, infinite bottles, respawn
 *  - jump trail: the real path of the last jump + its measured height / distance in tiles,
 *    which is what level design needs ("can the player make this gap?"). Drawn with DebugDraw.
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

  private readonly engine: Engine;
  private readonly player: Player;
  private readonly tuning: TuningFolder<PlayerTuning>;
  private readonly folder: GUI;
  private points: Vec2[] = [];
  private correctionPoints: Vec2[] = []; // drawn as cyan dots on the trail
  private start = new Vec2();
  private apex = new Vec2();
  private label = ''; // measured jump, shown above the apex
  private tracking = false;

  constructor(engine: Engine, player: Player) {
    this.engine = engine;
    this.player = player;

    const t = new TuningFolder('player tuning', T);
    t.Add('walkSpeed', 1, 15, 0.1);
    t.Add('sprintSpeed', 1, 20, 0.1);
    t.Add('sneakSpeed', 0.5, 8, 0.1);
    t.Add('accelTime', 0, 0.6, 0.01);
    t.Add('decelTime', 0, 0.6, 0.01);
    t.Add('turnTime', 0, 0.6, 0.01);
    t.Add('airAccelTime', 0, 1, 0.01);
    t.Add('airDecelTime', 0, 1, 0.01);
    t.Add('jumpHeight', 0.5, 8, 0.1);
    t.Add('timeToApex', 0.1, 1, 0.01);
    t.Add('doubleJumpHeight', 0.5, 6, 0.1);
    t.Add('dashSpeed', 5, 40, 0.5);
    t.Add('dashTime', 0.05, 0.5, 0.01);
    t.Add('fallGravityMult', 0.5, 4, 0.05);
    t.Add('jumpCutGravityMult', 1, 6, 0.1);
    t.Add('apexThreshold', 0, 6, 0.1);
    t.Add('apexGravityMult', 0.1, 1, 0.05);
    t.Add('maxFallSpeed', 2, 40, 0.5);
    t.Add('fastFallSpeed', 2, 50, 0.5);
    t.Add('fastFallGravityMult', 1, 4, 0.1);
    t.Add('coyoteMs', 0, 300, 5);
    t.Add('jumpBufferMs', 0, 300, 5);
    t.Add('cornerCorrection', 0, 0.5, 0.01);
    t.Add('ledgeCorrection', 0, 0.5, 0.01);
    t.Add('walkNoise', 0, 10, 0.1);
    t.Add('sprintNoise', 0, 15, 0.1);
    t.Add('landNoise', 0, 15, 0.1);
    t.Add('combatNoise', 0, 15, 0.1);
    t.Add('attackReach', 0.3, 3, 0.05);
    t.Add('stompBounce', 0.5, 5, 0.1);
    t.Add('strideLength', 0.3, 3, 0.05);
    t.Add('squash', 0, 0.6, 0.01);
    t.Add('ghostAlpha', 0, 1, 0.01);
    t.Add('listenTime', 0.5, 15, 0.1);
    t.Add('listenRecharge', 0.5, 20, 0.1);
    this.tuning = t;

    const f = debugPanel.gui.addFolder('player');
    f.add(this, 'state').listen().disable();
    f.add(this, 'grounded').listen().disable();
    f.add(this, 'hidden').listen().disable();
    f.add(this, 'bottles').listen().disable();
    f.add(this, 'vx').name('vx (tiles/s)').listen().disable();
    f.add(this, 'vy').name('vy (tiles/s)').listen().disable();
    f.add(this, 'corrections').name('corner/ledge fixes').listen().disable();
    f.add(this, 'showHitboxes').name('show hitboxes').onChange(() => { engine.physics.drawBodies = this.showHitboxes; });
    f.add(this, 'showTrail').name('show jump trail');
    f.add(this, 'infiniteBottles').name('infinite bottles');
    f.add(this, 'timeScale', 0.1, 1, 0.05).name('time scale').onChange(() => { engine.timeScale = this.timeScale; });
    f.add(player, 'Respawn').name('respawn');
    this.folder = f;
  }

  Destroy(): void {
    this.tuning.Destroy();
    this.folder.destroy();
  }

  OnStep(): void {
    const p = this.player;
    this.state = PlayerState[p.state];
    this.grounded = p.grounded;
    this.hidden = p.hidden;
    if (this.infiniteBottles && p.throwables.count < 9) p.throwables.count = 9;
    this.bottles = p.throwables.count;
    this.vx = Math.round((p.body.velocity.x / TILE) * 100) / 100;
    this.vy = p.grounded ? 0 : Math.round((p.body.velocity.y / TILE) * 100) / 100;

    if (!this.tracking) return;
    this.points.push(new Vec2(p.feetX, p.feetY));
    if (p.feetY < this.apex.y) this.apex.Set(p.feetX, p.feetY);
  }

  OnJump(): void {
    this.start.Set(this.player.feetX, this.player.feetY);
    this.apex.Copy(this.start);
    this.points = [this.start.Clone()];
    this.correctionPoints = [];
    this.tracking = true;
    this.label = '';
  }

  OnLand(): void {
    if (!this.tracking) return;
    this.tracking = false;
    const height = (this.start.y - this.apex.y) / TILE;
    const distance = Math.abs(this.player.feetX - this.start.x) / TILE;
    const rise = (this.start.y - this.player.feetY) / TILE;
    const riseText = (rise >= 0 ? 'up ' : 'down ') + Math.abs(rise).toFixed(2);
    this.label = 'height ' + height.toFixed(2) + 't   distance ' + distance.toFixed(2) + 't   ' + riseText + 't';
  }

  OnCorrection(x: number, y: number): void {
    this.corrections++;
    this.correctionPoints.push(new Vec2(x, y));
  }

  /** Every frame (immediate mode): the last jump's path, its takeoff and apex lines, the measurement. */
  Draw(): void {
    if (!this.showTrail) return;
    const d = this.engine.debug;
    for (let i = 0; i < this.correctionPoints.length; i++) d.Point(this.correctionPoints[i], 0x66ffff, 7);
    if (this.points.length < 2) return;
    for (let i = 1; i < this.points.length; i++) d.Line(this.points[i - 1], this.points[i], 0xffffff, 0.8, 3);
    d.Line(new Vec2(this.start.x - 60, this.start.y), new Vec2(this.start.x + 60, this.start.y), 0xffffff, 0.35, 1); // takeoff height
    d.Line(new Vec2(this.apex.x - 40, this.apex.y), new Vec2(this.apex.x + 40, this.apex.y), 0xffff66, 0.9); // apex
    d.Point(this.apex, 0xffff66, 5);
    if (this.label) d.Text(new Vec2(this.apex.x, this.apex.y - 70), this.label);
  }
}
