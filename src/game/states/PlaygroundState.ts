import { BodyType, CameraFollow, DEBUG_ENABLED, Ease, GameState, MathUtil, Rect, TuningFolder, type Body, type Engine, type Group, type Shape, type TextStyle } from '../../engine';
import { Action, MoveX } from '../Actions';
import { TILE } from '../constants';
import { StateId } from './StateId';

// ---------------------------------------------------------------- Day 1, as it was
// The very first movement test (commit aa7980a): the greybox room and the white cube with eyes, with
// its own controller and tuning, ported unchanged in behaviour. The survivor's controller grew out of
// this one later; this level keeps the original to compare against. The camera is today's dead-zone
// rig: Day 1's plain smoothed follow chased every step and made the cube jitter.

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
 * Signs in the room: what was built on Day 1, each one placed next to the piece of the room that
 * shows it. x / y = top-left in tiles.
 */
interface Sign {
  x: number;
  y: number;
  title: string;
  text: string;
}

const SIGNS: Sign[] = [
  { x: 1.6, y: 2.2, title: 'MOVEMENT FEEL',
    text: '0.08 s to full speed, 0.06 s to stop, 0.05 s to turn around. Softer control in the air.' },
  { x: 1.6, y: 6.6, title: 'JUMP BUFFER',
    text: 'Press jump up to 0.12 s before you land: the jump still happens.' },
  { x: 1.6, y: 10.6, title: 'SQUASH & STRETCH  +  TAKEOFF GHOST',
    text: 'Stretch on takeoff, squash on landing. A dark ghost marks where your last jump started.' },
  { x: 13.6, y: 16.4, title: 'COYOTE TIME  →',
    text: 'Walk off this edge: you can still jump for 0.1 s.' },
  { x: 21.4, y: 13.2, title: 'FAST FALL',
    text: 'Hold ↓ in the air: fall faster.' },
  { x: 30.4, y: 2.2, title: 'APEX HANG  +  HEAVY FALL',
    text: 'Hold jump at the top: gravity halves for a little hang time. Falling is 1.7x faster: snappy, not floaty.' },
  { x: 29.4, y: 13.2, title: 'VARIABLE JUMP HEIGHT',
    text: 'Tap = short hop (1.8 tiles). Hold = full jump (3.2 tiles). This pillar is 3 tiles tall: only a held jump clears it.' },
  { x: 43, y: 2.2, title: 'CAMERA DEAD ZONE',
    text: 'Small moves sideways leave the camera still: no jitter. Move far enough and it follows, looking ahead of you; jumps lift it smoothly.' },
];
const SIGN_WIDTH = 7.4; // tiles

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

/** Gravity (px/s²) and jump launch speed (px/s) derived from the tuning: g = 2h / t², v = 2h / t. */
function CubeGravity(): number {
  return (2 * T.jumpHeight * TILE) / (T.timeToApex * T.timeToApex);
}

function CubeJumpSpeed(): number {
  return (2 * T.jumpHeight * TILE) / T.timeToApex;
}

/** The Day 1 cube: white block + two grey eyes that look where you move. */
class Cube {
  readonly body: Body;
  /** Visual root, positioned at the FEET centre so squash & stretch pivots on the ground. */
  readonly view: Group;
  grounded = false;
  jumping = false; // rising/falling after a jump (not after walking off a ledge): enables jump cut + apex hang
  facing = 1;

  private readonly engine: Engine;
  private readonly ghost: Shape;
  private readonly eyes: Shape;
  private simTime = 0; // physics time, s
  private lastGroundedAt = -Infinity;
  private airborneVy = 0;

  constructor(engine: Engine, feetX: number, feetY: number) {
    this.engine = engine;
    const r = engine.renderer;
    // Physics: a bare body (no sprite). We integrate gravity ourselves.
    this.body = engine.physics.CreateBody({ type: BodyType.Dynamic, x: feetX - CUBE_W / 2, y: feetY - CUBE_H, w: CUBE_W, h: CUBE_H, gravityScale: 0 });

    // Takeoff ghost: same silhouette, dark and translucent, left where the last jump started.
    this.ghost = r.CreateShape().SetVisible(false).SetDepth(5);
    this.ghost.FillStyle(GHOST_COLOR, 1).FillRect(-CUBE_W / 2, -CUBE_H, CUBE_W, CUBE_H);

    const shape = r.CreateShape().FillStyle(CUBE_COLOR, 1).FillRect(-CUBE_W / 2, -CUBE_H, CUBE_W, CUBE_H);
    this.eyes = r.CreateShape().FillStyle(EYES_COLOR, 1);
    this.eyes.FillRect(-9, -CUBE_H * 0.78, 6, 14).FillRect(3, -CUBE_H * 0.78, 6, 14);
    this.view = r.CreateGroup(feetX, feetY).SetDepth(10).Add(shape, this.eyes);
  }

  get feetX(): number {
    return this.body.centerX;
  }

  get feetY(): number {
    return this.body.bottom;
  }

  Respawn(): void {
    this.body.Teleport(SPAWN_X * TILE - CUBE_W / 2, SPAWN_Y * TILE - CUBE_H);
    this.jumping = false;
    this.grounded = false;
    this.lastGroundedAt = -Infinity;
    this.ghost.SetVisible(false);
  }

  /** Visuals, once per rendered frame. */
  Update(dt: number): void {
    this.view.SetPosition(this.feetX, this.feetY);
    // Eyes drift toward the facing side and look up/down with vertical speed.
    const targetX = this.facing * CUBE_W * 0.16;
    const targetY = MathUtil.Clamp(this.body.velocity.y / CubeJumpSpeed(), -1, 1) * 5;
    const k = MathUtil.Smoothing(dt, 0.05); // frame-rate independent smoothing
    this.eyes.x += (targetX - this.eyes.x) * k;
    this.eyes.y += (targetY - this.eyes.y) * k;
  }

  /** Gameplay, at the physics rate. */
  FixedUpdate(dt: number): void {
    const b = this.body;
    const input = this.engine.input;
    this.simTime += dt;

    // Ground check. Ignore it while moving up (we just jumped; contact flags can be stale for a step).
    const onGround = b.contacts.down && b.velocity.y >= 0;
    if (onGround) {
      if (!this.grounded) this.Land();
      this.lastGroundedAt = this.simTime;
      this.jumping = false;
    } else {
      this.airborneVy = b.velocity.y;
    }
    this.grounded = onGround;

    // horizontal: move toward target speed with separate accel / decel / turn times
    const runSpeed = T.runSpeed * TILE;
    const target = MoveX(input) * runSpeed;
    let vx = b.velocity.x;
    let time: number;
    if (target !== 0) {
      const turning = vx !== 0 && Math.sign(target) !== Math.sign(vx);
      time = onGround ? (turning ? T.turnTime : T.accelTime) : T.airAccelTime;
      this.facing = Math.sign(target);
    } else {
      time = onGround ? T.decelTime : T.airDecelTime;
    }
    vx = time <= 0 ? target : MathUtil.MoveTowards(vx, target, (runSpeed / time) * dt);

    // jump: buffered press + coyote time
    const gravity = CubeGravity();
    let vy = b.velocity.y;
    const canJump = !this.jumping && this.simTime - this.lastGroundedAt <= T.coyoteMs / 1000;
    if (canJump && input.Buffered(Action.Jump, T.jumpBufferMs)) {
      input.Consume(Action.Jump);
      // +half a gravity step: gravity is applied below in this same step, and the fixed-step
      // integrator would otherwise lose ~0.15 tiles on every jump.
      vy = -(CubeJumpSpeed() + 0.5 * gravity * dt);
      this.Jump();
    }

    // gravity with modifiers
    let g = gravity;
    if (vy > 0) g *= T.fallGravityMult;
    else if (vy < 0 && this.jumping && !input.Held(Action.Jump)) g *= T.jumpCutGravityMult;
    if (this.jumping && input.Held(Action.Jump) && Math.abs(vy) < T.apexThreshold * TILE) g *= T.apexGravityMult;
    const fastFalling = input.Held(Action.Down) && vy > 0;
    if (fastFalling) g *= T.fastFallGravityMult;

    vy += g * dt;
    vy = Math.min(vy, (fastFalling ? T.fastFallSpeed : T.maxFallSpeed) * TILE);
    b.SetVelocity(vx, vy);
  }

  private Jump(): void {
    this.jumping = true;
    this.grounded = false;
    this.lastGroundedAt = -Infinity; // no second coyote jump

    // Ghost marks the takeoff frame; it moves on every new jump.
    this.ghost.SetPosition(this.feetX, this.feetY).SetVisible(T.ghostAlpha > 0).SetAlpha(0);
    this.engine.tweens.Kill(this.ghost);
    this.engine.tweens.To(this.ghost, { alpha: T.ghostAlpha }, 0.09);
    this.PulseScale(1 - T.squash * 0.6, 1 + T.squash * 0.6, 0.16);
  }

  private Land(): void {
    const impact = MathUtil.Clamp(this.airborneVy / (T.maxFallSpeed * TILE), 0, 1);
    this.PulseScale(1 + T.squash * impact, 1 - T.squash * impact, 0.13);
  }

  /** Squash & stretch: snap to (sx, sy) then spring back to 1. Visual only, the hitbox never changes. */
  private PulseScale(sx: number, sy: number, seconds: number): void {
    if (T.squash <= 0) return;
    this.engine.tweens.Kill(this.view);
    this.view.SetScale(sx, sy);
    this.engine.tweens.To(this.view, { scaleX: 1, scaleY: 1 }, seconds, { ease: Ease.BackOut });
  }
}

// ---------------------------------------------------------------- the state

/** The movement test room: the cube, the greybox, the signs, the dead-zone camera. */
export class PlaygroundState extends GameState {
  private cube!: Cube;
  private cameraRig!: CameraFollow;
  private tuning: TuningFolder<CubeTuning> | null = null;

  OnStart(): void {
    const e = this.engine;
    const r = e.renderer;
    e.camera.SetBackground(BACKGROUND);
    e.camera.FadeIn(0.2);

    for (let i = 0; i < SOLIDS.length; i++) {
      const s = SOLIDS[i];
      const box = new Rect(s.x * TILE, s.y * TILE, s.w * TILE, s.h * TILE);
      r.CreateShape().FillStyle(SOLID, 1).FillRect(box.x, box.y, box.w, box.h);
      e.physics.CreateStaticBox(box);
    }

    this.cube = new Cube(e, SPAWN_X * TILE, SPAWN_Y * TILE);
    // dead zone: small moves don't move the camera
    this.cameraRig = new CameraFollow(e.camera, r, this.cube.body, new Rect(0, 0, ROOM_W * TILE, ROOM_H * TILE), TILE);

    if (DEBUG_ENABLED) {
      const t = new TuningFolder('cube tuning', T);
      t.Add('runSpeed', 1, 20, 0.1);
      t.Add('accelTime', 0, 0.6, 0.01);
      t.Add('decelTime', 0, 0.6, 0.01);
      t.Add('turnTime', 0, 0.6, 0.01);
      t.Add('airAccelTime', 0, 1, 0.01);
      t.Add('airDecelTime', 0, 1, 0.01);
      t.Add('jumpHeight', 0.5, 8, 0.1);
      t.Add('timeToApex', 0.1, 1, 0.01);
      t.Add('fallGravityMult', 0.5, 4, 0.05);
      t.Add('jumpCutGravityMult', 1, 6, 0.1);
      t.Add('apexThreshold', 0, 6, 0.1);
      t.Add('apexGravityMult', 0.1, 1, 0.05);
      t.Add('maxFallSpeed', 2, 40, 0.5);
      t.Add('fastFallSpeed', 2, 50, 0.5);
      t.Add('fastFallGravityMult', 1, 4, 0.1);
      t.Add('coyoteMs', 0, 300, 5);
      t.Add('jumpBufferMs', 0, 300, 5);
      t.Add('squash', 0, 0.6, 0.01);
      t.Add('ghostAlpha', 0, 1, 0.01);
      this.tuning = t;
    }

    for (let i = 0; i < SIGNS.length; i++) this.AddSign(SIGNS[i]);

    const title: TextStyle = { family: 'Georgia, serif', size: 34, style: 'bold', color: '#ffffff', stroke: '#1d3a2a', strokeThickness: 6 };
    r.CreateText(1.6 * TILE, 1.2 * TILE, 'DAY 1  -  MOVEMENT TEST ROOM', title).SetDepth(2); // in the room, above the first sign
    const help: TextStyle = { family: 'Georgia, serif', size: 22, color: '#ffffff', stroke: '#1d3a2a', strokeThickness: 4 };
    r.CreateText(24, e.height - 20, 'Move ←→   Jump Space (hold = higher)   Fast fall ↓   Respawn R   Level select Esc', help)
      .SetOrigin(0, 1).SetFixed().SetDepth(50);
  }

  OnDestroy(): void {
    if (this.tuning) this.tuning.Destroy();
    this.cameraRig.Destroy();
  }

  OnFixedUpdate(dt: number): void {
    this.cube.FixedUpdate(dt);
  }

  OnUpdate(dt: number): void {
    const input = this.engine.input;
    if (input.Pressed(Action.Back)) {
      this.engine.states.ChangeState(StateId.Menu);
      return;
    }
    if (input.Pressed(Action.Reset)) {
      this.cube.Respawn();
      this.cameraRig.Snap();
    }
    this.cube.Update(dt);
    this.cameraRig.Update(dt);
  }

  /** A title line and a wrapped description, on a faint dark plate so it reads over the green. */
  private AddSign(sign: Sign): void {
    const r = this.engine.renderer;
    const x = sign.x * TILE;
    const y = sign.y * TILE;
    const title = r.CreateText(x + 16, y + 12, sign.title, { family: 'Georgia, serif', size: 26, style: 'bold', color: '#ffffff' }).SetDepth(2);
    const w = Math.max(SIGN_WIDTH * TILE, title.width + 32); // long titles widen the plate
    const body = r.CreateText(x + 16, y + 12 + title.height + 4, sign.text,
      { family: 'Georgia, serif', size: 21, color: '#e8f5ec', wrapWidth: w - 32, lineSpacing: 4 }).SetDepth(2);
    const h = title.height + body.height + 30;
    r.CreateShape().FillStyle(0x1d3a2a, 0.45).FillRect(x, y, w, h).SetDepth(1);
  }
}
