import Phaser from 'phaser';
import { TILE } from './constants';

export enum NoiseKind {
  Footstep,
  Landing,
  Bottle,
  Scream,
  Combat,
}

/** A sound: anything within `radius` px of (x, y) can hear it. */
export interface Noise {
  x: number;
  y: number;
  radius: number;
  kind: NoiseKind;
}

interface Ring {
  x: number;
  y: number;
  radius: number;
  age: number;
  duration: number;
  colour: number;
  width: number;
}

// Per NoiseKind: ring colour, ring duration (s), line width.
const RING_COLOUR = [0xffffff, 0xffffff, 0xffe066, 0xff4040, 0xff9a40];
const RING_TIME = [0.35, 0.45, 0.8, 1.1, 0.6];
const RING_WIDTH = [2, 3, 4, 5, 4];

/**
 * Every sound in the level, for the blind Clickers.
 *  - emit() during a physics step queues a noise; beginStep() makes the queue readable as `heard`
 *    for the NEXT step. One step of latency, but the order in which things update never matters.
 *  - Every noise also spawns an expanding ring that ends exactly at its radius: the player SEES how
 *    far a sound travels, so luring is readable, never trial and error.
 */
export class NoiseSystem {
  heard: Noise[] = [];

  private queued: Noise[] = [];
  private readonly rings: Ring[] = [];
  private readonly gfx: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.gfx = scene.add.graphics().setDepth(15);
  }

  /** radiusTiles: how far it carries. */
  emit(x: number, y: number, radiusTiles: number, kind: NoiseKind): void {
    if (radiusTiles <= 0) return;
    const radius = radiusTiles * TILE;
    this.queued.push({ x: x, y: y, radius: radius, kind: kind });
    this.rings.push({ x: x, y: y, radius: radius, age: 0, duration: RING_TIME[kind], colour: RING_COLOUR[kind], width: RING_WIDTH[kind] });
  }

  /** Called by the scene at the start of every physics step. */
  beginStep(): void {
    this.heard = this.queued;
    this.queued = [];
  }

  /** Rings, once per rendered frame. */
  update(deltaMs: number): void {
    const g = this.gfx;
    g.clear();
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += deltaMs / 1000;
      if (r.age >= r.duration) {
        this.rings.splice(i, 1);
        continue;
      }
      const t = r.age / r.duration;
      const eased = 1 - (1 - t) * (1 - t); // fast start, settles on the true radius
      g.lineStyle(r.width, r.colour, 0.85 * (1 - t));
      g.strokeCircle(r.x, r.y, r.radius * eased);
    }
  }
}
