import { DEBUG_ENABLED, Ease, Rect, TuningFolder, Vec2, type Body, type Engine, type Shape, type Sprite } from '../../engine';
import { ART_SCALE, TILE } from '../constants';
import type { Zombie } from '../entities/Zombie';
import { NoiseKind, type NoiseSystem } from './Noise';

class ThrowTuning {
  stashSize = 3; // bottles in one stash pickup
  bottleNoise = 8; // tiles: how far a shattering bottle is heard
  gravity = 28; // tiles/s²
  maxDistance = 14; // tiles, either side
  minArc = 0.5; // tiles above the hand at the top of the arc
  maxArc = 7;
  startDistance = 5; // where the landing point starts when you begin aiming
  startArc = 2;
  aimSpeed = 9; // tiles/s the landing point moves while holding left / right
  arcSpeed = 4; // tiles/s while holding up / down
}

export const THROW = new ThrowTuning();

const STEP = 1 / 60; // the physics step: the preview and the real bottle integrate identically
const MAX_STEPS = 300;
const HIT_BOX = 6; // px: the bottle's collision box
const PICKUP_RADIUS = 0.6; // tiles

/**
 * Launch velocity (px/s) that peaks `arcTiles` above the hand and lands `distanceTiles` away at hand height.
 * Up: v² = 2·g·h gives the vertical speed; the flight time up and down is 2·v/g; x speed = distance / time.
 */
export function LaunchVelocity(distanceTiles: number, arcTiles: number): Vec2 {
  const g = THROW.gravity * TILE;
  const vy = -Math.sqrt(2 * g * arcTiles * TILE);
  const flightTime = (2 * -vy) / g;
  return new Vec2((distanceTiles * TILE) / flightTime, vy);
}

class Bottle {
  readonly pos: Vec2;
  readonly vel: Vec2;
  readonly sprite: Sprite;
  readonly molotov: boolean;
  readonly smoke: boolean;

  constructor(sprite: Sprite, pos: Vec2, vel: Vec2, molotov: boolean, smoke: boolean) {
    this.sprite = sprite;
    this.pos = pos;
    this.vel = vel;
    this.molotov = molotov;
    this.smoke = smoke;
  }
}

interface Pickup {
  x: number;
  y: number;
  sprite: Sprite;
  glow: Shape;
}

/**
 * Bottles: the player's inventory, bottles in flight, pickups on the floor, the aim preview.
 * A Molotov (Medium) is thrown the same way: while you have one, the next throw is the Molotov; where
 * it breaks goes to `onMolotov` (the level decides what burns).
 */
export class Throwables {
  count: number;
  stashOverride = 0; // bottles per stash for this level (0 = THROW.stashSize)
  molotovs = 0;
  onMolotov: ((x: number, y: number) => void) | null = null;
  smokes = 0; // M2 Medium: thrown after any Molotov
  preferSmoke = true; // holding both: the next throw is a smoke grenade (false: a bottle). Tab switches
  onSmoke: ((x: number, y: number) => void) | null = null;
  /** The infected, so bottles (and the aim preview) can hit them; the level fills this. */
  zombies: Zombie[] = [];

  private readonly engine: Engine;
  private readonly flying: Bottle[] = [];
  private readonly pickups: Pickup[] = [];
  private readonly aimGfx: Shape;
  private readonly path: Vec2[] = [];
  private tuning: TuningFolder<ThrowTuning> | null = null;

  constructor(engine: Engine, startCount: number) {
    this.engine = engine;
    this.count = startCount;
    this.aimGfx = engine.renderer.CreateShape().SetDepth(43); // above the Hard level's night
    engine.assets.CreateCanvasTexture('shard', 2, 2, (ctx) => {
      ctx.fillStyle = '#9fc488';
      ctx.fillRect(0, 0, 2, 2);
    });

    if (DEBUG_ENABLED) {
      const t = new TuningFolder('throw tuning', THROW);
      t.Add('stashSize', 1, 10, 1);
      t.Add('bottleNoise', 1, 20, 0.5);
      t.Add('gravity', 5, 80, 1);
      t.Add('maxDistance', 2, 30, 0.5);
      t.Add('minArc', 0, 3, 0.1);
      t.Add('maxArc', 1, 15, 0.1);
      t.Add('startDistance', 0, 15, 0.5);
      t.Add('startArc', 0, 10, 0.1);
      t.Add('aimSpeed', 1, 30, 0.5);
      t.Add('arcSpeed', 1, 15, 0.5);
      this.tuning = t;
    }
  }

  Destroy(): void {
    if (this.tuning) this.tuning.Destroy();
  }

  /**
   * A stash of bottles lying in the environment: walking over it gives `stashSize` bottles.
   * Drawn IN FRONT of the grass (depth 11) with a warm pulsing glow, so it always reads as a pickup.
   */
  AddPickup(feetX: number, feetY: number): void {
    const r = this.engine.renderer;
    const glow = r.CreateShape(feetX, feetY - 26).SetDepth(13);
    glow.FillStyle(0xffd27a, 0.3).FillCircle(0, 0, 42);
    glow.FillStyle(0xffe6a8, 0.45).FillCircle(0, 0, 26);
    // a 4-point sparkle above the stash, twinkling
    glow.FillStyle(0xffffff, 1);
    glow.FillTriangle(-3, -44, 3, -44, 0, -60).FillTriangle(-3, -44, 3, -44, 0, -28);
    glow.FillTriangle(-8, -47, -8, -41, -16, -44).FillTriangle(8, -47, 8, -41, 16, -44);
    this.engine.tweens.To(glow, { scale: 1.2, alpha: 0.55 }, 0.65, { yoyo: true, repeat: -1, ease: Ease.SineInOut });
    const sprite = r.CreateSprite(feetX, feetY, 'stash').SetOrigin(0.5, 1).SetScale(ART_SCALE).SetDepth(14);
    this.pickups.push({ x: feetX, y: feetY, sprite: sprite, glow: glow });
  }

  /** The next throw is a smoke grenade (no Molotov in hand). */
  get smokeNext(): boolean {
    return this.smokes > 0 && (this.preferSmoke || this.count === 0);
  }

  get canThrow(): boolean {
    return this.count > 0 || this.molotovs > 0 || this.smokes > 0;
  }

  ThrowBottle(x: number, y: number, v: Vec2): void {
    const molotov = this.molotovs > 0;
    const smoke = !molotov && this.smokeNext;
    if (molotov) this.molotovs--;
    else if (smoke) this.smokes--;
    else if (this.count > 0) this.count--;
    else return;
    const texture = molotov ? 'molotov' : smoke ? 'smoke_grenade' : 'bottle';
    const sprite = this.engine.renderer.CreateSprite(x, y, texture).SetScale(ART_SCALE).SetDepth(12);
    this.flying.push(new Bottle(sprite, new Vec2(x, y), v.Clone(), molotov, smoke));
  }

  /** Gameplay at the physics rate: flight, impacts (zombies, solids -> noise), pickups. */
  FixedUpdate(dt: number, noise: NoiseSystem, playerBody: Body): void {
    const g = THROW.gravity * TILE;
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const b = this.flying[i];
      b.vel.y += g * dt; // semi-implicit Euler: velocity first, then position with the new velocity
      b.pos.AddScaled(b.vel, dt);
      const hit = this.HitZombie(b.pos);
      if (hit && !b.molotov && !b.smoke) hit.HitByBottle();
      if (hit || this.HitsSolid(b.pos)) {
        this.Shatter(b.pos.x, b.pos.y);
        if (b.molotov) {
          if (this.onMolotov) this.onMolotov(b.pos.x, b.pos.y);
        } else if (b.smoke) {
          if (this.onSmoke) this.onSmoke(b.pos.x, b.pos.y);
        } else {
          noise.Emit(b.pos.x, b.pos.y, THROW.bottleNoise, NoiseKind.Bottle);
        }
        b.sprite.Destroy();
        this.flying.splice(i, 1);
      }
    }

    const r = PICKUP_RADIUS * TILE;
    const pb = playerBody;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      const near = p.x > pb.left - r && p.x < pb.right + r && p.y > pb.top && p.y < pb.bottom + r;
      if (near) {
        this.count += this.stashOverride > 0 ? this.stashOverride : THROW.stashSize;
        p.sprite.Destroy();
        p.glow.Destroy();
        this.engine.tweens.Kill(p.glow);
        this.pickups.splice(i, 1);
      }
    }
  }

  /** Visuals, once per rendered frame. */
  Update(timeMs: number): void {
    for (let i = 0; i < this.flying.length; i++) {
      const b = this.flying[i];
      b.sprite.SetPosition(b.pos.x, b.pos.y);
      b.sprite.rotation += 0.35 * Math.sign(b.vel.x || 1);
    }
    for (let i = 0; i < this.pickups.length; i++) {
      const p = this.pickups[i];
      p.sprite.y = p.y - 14 - Math.sin(timeMs / 300 + p.x) * 5; // floats above the grass, gentle bob
    }
  }

  /**
   * Aim preview: dotted arc along the exact path the bottle will take (same integrator, same step,
   * stops on solids AND on zombies), a landing marker (red = it will hit a zombie), and the noise
   * radius at the landing point (who will hear it).
   */
  DrawAim(x: number, y: number, v: Vec2): void {
    const hitsZombie = this.Predict(new Vec2(x, y), v);
    const g = this.aimGfx;
    g.Clear();
    const molotov = this.molotovs > 0;
    const smoke = !molotov && this.smokeNext;
    g.FillStyle(molotov ? 0xff9a3c : smoke ? 0xb8b6ae : 0xffffff, 0.9);
    for (let i = 0; i < this.path.length; i += 3) g.FillCircle(this.path[i].x, this.path[i].y, 3);
    const end = this.path[this.path.length - 1];
    if (molotov) { // where the fire starts
      g.LineStyle(4, 0xff7a2a, 1).StrokeCircle(end.x, end.y, 18);
      return;
    }
    if (smoke) { // where the cloud will stand
      g.LineStyle(3, 0xd8d6ce, 0.8).StrokeRect(end.x - 3.5 * TILE, end.y - 4.3 * TILE, 7 * TILE, 4.6 * TILE);
      return;
    }
    g.LineStyle(hitsZombie ? 5 : 3, hitsZombie ? 0xff4040 : 0xffe066, 1);
    g.StrokeCircle(end.x, end.y, hitsZombie ? 16 : 10);
    g.LineStyle(2, 0xffe066, 0.35).StrokeCircle(end.x, end.y, THROW.bottleNoise * TILE);
  }

  ClearAim(): void {
    this.aimGfx.Clear();
  }

  /** Fills `path`; returns true if the flight ends on a zombie (as things stand right now). */
  private Predict(start: Vec2, v: Vec2): boolean {
    this.path.length = 0;
    const g = THROW.gravity * TILE;
    const pos = start.Clone();
    const vel = v.Clone();
    this.path.push(pos.Clone());
    for (let i = 0; i < MAX_STEPS; i++) {
      vel.y += g * STEP;
      pos.AddScaled(vel, STEP);
      this.path.push(pos.Clone());
      if (this.HitZombie(pos)) return true;
      if (this.HitsSolid(pos)) return false;
    }
    return false;
  }

  private HitZombie(p: Vec2): Zombie | null {
    const zombies = this.zombies;
    for (let i = 0; i < zombies.length; i++) {
      const b = zombies[i].body;
      if (zombies[i].alive && p.x > b.left && p.x < b.right && p.y > b.top && p.y < b.bottom) return zombies[i];
    }
    return null;
  }

  private HitsSolid(p: Vec2): boolean {
    return this.engine.physics.QueryBox(Rect.FromCenter(p.x, p.y, HIT_BOX, HIT_BOX));
  }

  private Shatter(x: number, y: number): void {
    this.engine.renderer.Burst(x, y, 'shard', 14, {
      speedMin: 120, speedMax: 380, angleMin: 200, angleMax: 340, lifespan: 0.55, gravityY: 1600, scale: ART_SCALE, depth: 13,
    });
  }
}
