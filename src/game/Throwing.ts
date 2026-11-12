import Phaser from 'phaser';
import { DEBUG_ENABLED, TuningFolder } from '../core/Debug';
import { ART_SCALE, TILE } from './constants';
import { NoiseKind, type NoiseSystem } from './Noise';

class ThrowTuning {
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

  constructor(sprite: Phaser.GameObjects.Image, x: number, y: number, vx: number, vy: number) {
    this.sprite = sprite;
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
}

/**
 * Bottles: the player's inventory, bottles in flight, pickups on the floor, the aim preview.
 */
export class Throwables {
  count: number;

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

  addPickup(feetX: number, feetY: number): void {
    const sprite = this.scene.add.image(feetX, feetY, 'bottle').setOrigin(0.5, 1).setScale(ART_SCALE).setDepth(2);
    this.pickups.push({ x: feetX, y: feetY, sprite: sprite });
  }

  throwBottle(x: number, y: number, v: Vec): void {
    if (this.count <= 0) return;
    this.count--;
    const sprite = this.scene.add.image(x, y, 'bottle').setScale(ART_SCALE).setDepth(12);
    this.flying.push(new Bottle(sprite, x, y, v.x, v.y));
  }

  /** Gameplay at the physics rate: flight, impacts (noise), pickups. */
  fixedUpdate(dt: number, noise: NoiseSystem, playerBody: Phaser.Physics.Arcade.Body): void {
    const g = THROW.gravity * TILE;
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const b = this.flying[i];
      b.vy += g * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (this.hitsSolid(b.x, b.y)) {
        this.shatter(b.x, b.y);
        noise.emit(b.x, b.y, THROW.bottleNoise, NoiseKind.Bottle);
        b.sprite.destroy();
        this.flying.splice(i, 1);
      }
    }

    const r = PICKUP_RADIUS * TILE;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      const near = p.x > playerBody.left - r && p.x < playerBody.right + r && p.y > playerBody.top && p.y < playerBody.bottom + r;
      if (near) {
        this.count++;
        p.sprite.destroy();
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
      p.sprite.y = p.y - 4 - Math.sin(timeMs / 300 + p.x) * 4; // gentle bob so pickups read as pickups
    }
  }

  /**
   * Aim preview: dotted arc along the exact path the bottle will take (same integrator, same step),
   * a landing marker, and the noise radius at the landing point (who will hear it).
   */
  drawAim(x: number, y: number, v: Vec): void {
    this.predict(x, y, v);
    const g = this.aimGfx;
    g.clear();
    g.fillStyle(0xffffff, 0.9);
    for (let i = 0; i < this.path.length; i += 3) g.fillCircle(this.path[i].x, this.path[i].y, 3);
    const end = this.path[this.path.length - 1];
    g.lineStyle(3, 0xffe066, 1);
    g.strokeCircle(end.x, end.y, 10);
    g.lineStyle(2, 0xffe066, 0.35);
    g.strokeCircle(end.x, end.y, THROW.bottleNoise * TILE);
  }

  clearAim(): void {
    this.aimGfx.clear();
  }

  private predict(x: number, y: number, v: Vec): void {
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
      if (this.hitsSolid(px, py)) return;
    }
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
