import Phaser from 'phaser';
import { DEBUG_ENABLED, TuningFolder } from '../core/Debug';
import { ART_SCALE, TILE } from './constants';
import { NoiseKind, type NoiseSystem } from './Noise';
import type { Zombie } from './Zombie';

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

export interface Vec {
  x: number;
  y: number;
}

/** Launch velocity (px/s) that peaks `arcTiles` above the hand and lands `distanceTiles` away at hand height. */
export function launchVelocity(distanceTiles: number, arcTiles: number): Vec {
  const g = THROW.gravity * TILE;
  const vy = -Math.sqrt(2 * g * arcTiles * TILE);
  const flightTime = (2 * -vy) / g;
  return { x: (distanceTiles * TILE) / flightTime, y: vy };
}

class Bottle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly sprite: Phaser.GameObjects.Image;
  readonly molotov: boolean;

  constructor(sprite: Phaser.GameObjects.Image, x: number, y: number, vx: number, vy: number, molotov: boolean) {
    this.sprite = sprite;
    this.molotov = molotov;
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
  }
}

interface Pickup {
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Graphics;
}

/**
 * Bottles: the player's inventory, bottles in flight, pickups on the floor, the aim preview.
 * A Molotov (Medium) is thrown the same way: while you have one, the next throw is the Molotov; where
 * it breaks goes to `onMolotov` (the scene decides what burns).
 */
export class Throwables {
  count: number;
  molotovs = 0;
  onMolotov: ((x: number, y: number) => void) | null = null;
  /** The infected, so bottles (and the aim preview) can hit them; the scene fills this. */
  zombies: Zombie[] = [];

  private readonly scene: Phaser.Scene;
  private readonly physics: Phaser.Physics.Arcade.ArcadePhysics;
  private readonly flying: Bottle[] = [];
  private readonly pickups: Pickup[] = [];
  private readonly aimGfx: Phaser.GameObjects.Graphics;
  private readonly path: Vec[] = [];
  private tuning: TuningFolder<ThrowTuning> | null = null;

  constructor(scene: Phaser.Scene, startCount: number) {
    this.scene = scene;
    this.physics = scene.physics;
    this.count = startCount;
    this.aimGfx = scene.add.graphics().setDepth(16);

    if (!scene.textures.exists('shard')) {
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0x9fc488, 1).fillRect(0, 0, 2, 2);
      g.generateTexture('shard', 2, 2);
      g.destroy();
    }

    if (DEBUG_ENABLED) {
      const t = new TuningFolder('throw tuning', THROW);
      t.add('stashSize', 1, 10, 1);
      t.add('bottleNoise', 1, 20, 0.5);
      t.add('gravity', 5, 80, 1);
      t.add('maxDistance', 2, 30, 0.5);
      t.add('minArc', 0, 3, 0.1);
      t.add('maxArc', 1, 15, 0.1);
      t.add('startDistance', 0, 15, 0.5);
      t.add('startArc', 0, 10, 0.1);
      t.add('aimSpeed', 1, 30, 0.5);
      t.add('arcSpeed', 1, 15, 0.5);
      this.tuning = t;
    }
  }

  destroy(): void {
    if (this.tuning) this.tuning.destroy();
  }

  /**
   * A stash of bottles lying in the environment: walking over it gives `stashSize` bottles.
   * Drawn IN FRONT of the grass (depth 11) with a warm pulsing glow, so it always reads as a pickup.
   */
  addPickup(feetX: number, feetY: number): void {
    const glow = this.scene.add.graphics({ x: feetX, y: feetY - 26 }).setDepth(13);
    glow.fillStyle(0xffd27a, 0.3).fillCircle(0, 0, 42);
    glow.fillStyle(0xffe6a8, 0.45).fillCircle(0, 0, 26);
    // a 4-point sparkle above the stash, twinkling
    glow.fillStyle(0xffffff, 1);
    glow.fillTriangle(-3, -44, 3, -44, 0, -60).fillTriangle(-3, -44, 3, -44, 0, -28);
    glow.fillTriangle(-8, -47, -8, -41, -16, -44).fillTriangle(8, -47, 8, -41, 16, -44);
    this.scene.tweens.add({ targets: glow, scale: 1.2, alpha: 0.55, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const sprite = this.scene.add.image(feetX, feetY, 'stash').setOrigin(0.5, 1).setScale(ART_SCALE).setDepth(14);
    this.pickups.push({ x: feetX, y: feetY, sprite: sprite, glow: glow });
  }

  get canThrow(): boolean {
    return this.count > 0 || this.molotovs > 0;
  }

  throwBottle(x: number, y: number, v: Vec): void {
    const molotov = this.molotovs > 0;
    if (molotov) this.molotovs--;
    else if (this.count > 0) this.count--;
    else return;
    const sprite = this.scene.add.image(x, y, molotov ? 'molotov' : 'bottle').setScale(ART_SCALE).setDepth(12);
    this.flying.push(new Bottle(sprite, x, y, v.x, v.y, molotov));
  }

  /** Gameplay at the physics rate: flight, impacts (zombies, solids -> noise), pickups. */
  fixedUpdate(dt: number, noise: NoiseSystem, playerBody: Phaser.Physics.Arcade.Body): void {
    const zombies = this.zombies;
    const g = THROW.gravity * TILE;
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const b = this.flying[i];
      b.vy += g * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const hit = this.hitZombie(b.x, b.y, zombies);
      if (hit && !b.molotov) hit.hitByBottle();
      if (hit || this.hitsSolid(b.x, b.y)) {
        this.shatter(b.x, b.y);
        if (b.molotov) {
          if (this.onMolotov) this.onMolotov(b.x, b.y);
        } else {
          noise.emit(b.x, b.y, THROW.bottleNoise, NoiseKind.Bottle);
        }
        b.sprite.destroy();
        this.flying.splice(i, 1);
      }
    }

    const r = PICKUP_RADIUS * TILE;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      const near = p.x > playerBody.left - r && p.x < playerBody.right + r && p.y > playerBody.top && p.y < playerBody.bottom + r;
      if (near) {
        this.count += THROW.stashSize;
        p.sprite.destroy();
        p.glow.destroy();
        this.pickups.splice(i, 1);
      }
    }
  }

  /** Visuals, once per rendered frame. */
  update(timeMs: number): void {
    for (let i = 0; i < this.flying.length; i++) {
      const b = this.flying[i];
      b.sprite.setPosition(b.x, b.y);
      b.sprite.rotation += 0.35 * Math.sign(b.vx || 1);
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
  drawAim(x: number, y: number, v: Vec): void {
    const hitsZombie = this.predict(x, y, v);
    const g = this.aimGfx;
    g.clear();
    const molotov = this.molotovs > 0;
    g.fillStyle(molotov ? 0xff9a3c : 0xffffff, 0.9);
    for (let i = 0; i < this.path.length; i += 3) g.fillCircle(this.path[i].x, this.path[i].y, 3);
    const end = this.path[this.path.length - 1];
    if (molotov) { // where the fire starts
      g.lineStyle(4, 0xff7a2a, 1).strokeCircle(end.x, end.y, 18);
      return;
    }
    g.lineStyle(hitsZombie ? 5 : 3, hitsZombie ? 0xff4040 : 0xffe066, 1);
    g.strokeCircle(end.x, end.y, hitsZombie ? 16 : 10);
    g.lineStyle(2, 0xffe066, 0.35);
    g.strokeCircle(end.x, end.y, THROW.bottleNoise * TILE);
  }

  clearAim(): void {
    this.aimGfx.clear();
  }

  /** Fills `path`; returns true if the flight ends on a zombie (as things stand right now). */
  private predict(x: number, y: number, v: Vec): boolean {
    this.path.length = 0;
    const g = THROW.gravity * TILE;
    let px = x;
    let py = y;
    let vy = v.y;
    this.path.push({ x: px, y: py });
    for (let i = 0; i < MAX_STEPS; i++) {
      vy += g * STEP;
      px += v.x * STEP;
      py += vy * STEP;
      this.path.push({ x: px, y: py });
      if (this.hitZombie(px, py, this.zombies)) return true;
      if (this.hitsSolid(px, py)) return false;
    }
    return false;
  }

  private hitZombie(x: number, y: number, zombies: Zombie[]): Zombie | null {
    for (let i = 0; i < zombies.length; i++) {
      const b = zombies[i].body;
      if (zombies[i].alive && x > b.left && x < b.right && y > b.top && y < b.bottom) return zombies[i];
    }
    return null;
  }

  private hitsSolid(x: number, y: number): boolean {
    return this.physics.overlapRect(x - HIT_BOX / 2, y - HIT_BOX / 2, HIT_BOX, HIT_BOX, false, true).length > 0;
  }

  private shatter(x: number, y: number): void {
    const shards = this.scene.add.particles(x, y, 'shard', {
      speed: { min: 120, max: 380 },
      angle: { min: 200, max: 340 },
      lifespan: 550,
      gravityY: 1600,
      scale: ART_SCALE,
      emitting: false,
    });
    shards.setDepth(13);
    shards.explode(14);
    this.scene.time.delayedCall(800, () => shards.destroy());
  }
}
