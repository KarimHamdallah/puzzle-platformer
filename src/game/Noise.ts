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

// Per NoiseKind: ring drawn in the world?, ring colour, ring duration (s), line width.
// The player's own movement (footsteps, landings) has no ring: the HUD's NoiseMeter shows it.
const RING_SHOWN = [false, false, true, true, true];
const RING_COLOUR = [0xffffff, 0xffffff, 0xffe066, 0xff4040, 0xff9a40];
const RING_TIME = [0.35, 0.45, 0.8, 1.1, 0.6];
const RING_WIDTH = [2, 3, 4, 5, 4];

/**
 * Every sound in the level, for the blind Clickers.
 *  - emit() during a physics step queues a noise; beginStep() makes the queue readable as `heard`
 *    for the NEXT step. One step of latency, but the order in which things update never matters.
 *  - Lures and fights (bottles, screams, punches) spawn an expanding ring that ends exactly at its
 *    radius: the player SEES how far a sound travels, so luring is readable, never trial and error.
 *    The player's own steps show in the HUD instead (NoiseMeter): rings around him were noise.
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
    if (RING_SHOWN[kind]) this.rings.push({ x: x, y: y, radius: radius, age: 0, duration: RING_TIME[kind], colour: RING_COLOUR[kind], width: RING_WIDTH[kind] });
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

const METER_ARCS = [0, 2, 3]; // waves per noise level (silent, walking, running)
const METER_COLOURS = [0xf0e6c8, 0xf0e6c8, 0xff9a40];
const LANDING_COLOUR = 0xff5a48;
const PULSE_TIME = 0.28; // s: a step's waves pop, then settle
const LANDING_TIME = 0.45;

/**
 * HUD noise meter (top left): a boot, and sound waves coming off its toe. Still or crouched: the boot
 * alone (silent). Walking: two waves. Running: three, orange. Every audible step makes them pulse; a
 * hard landing flashes three red ones. The player reads how loud he is without rings around him.
 */
export class NoiseMeter {
  private readonly boot: Phaser.GameObjects.Image;
  private readonly waves: Phaser.GameObjects.Graphics;
  private readonly x: number; // wave centre (the boot's toe), screen px
  private readonly y: number;
  private pulse = 0;
  private landing = 0;
  private lastSteps = 0;
  private lastLandings = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.boot = scene.add.image(x, y, 'boot').setScale(3).setScrollFactor(0).setDepth(50);
    this.x = x + 20;
    this.y = y + 6;
    this.waves = scene.add.graphics().setScrollFactor(0).setDepth(50);
  }

  /** Once per frame. level: 0 silent, 1 walking, 2 running; steps / landings: running counts. */
  update(deltaMs: number, level: number, steps: number, landings: number): void {
    const dt = deltaMs / 1000;
    if (steps !== this.lastSteps) this.pulse = 1;
    if (landings !== this.lastLandings) this.landing = 1;
    this.lastSteps = steps;
    this.lastLandings = landings;
    this.pulse = Math.max(0, this.pulse - dt / PULSE_TIME);
    this.landing = Math.max(0, this.landing - dt / LANDING_TIME);

    this.boot.setAlpha(level === 0 && this.landing === 0 ? 0.75 : 1);
    const g = this.waves;
    g.clear();
    const landing = this.landing > 0;
    const arcs = landing ? 3 : METER_ARCS[level];
    const colour = landing ? LANDING_COLOUR : METER_COLOURS[level];
    const pop = landing ? this.landing : this.pulse;
    for (let i = 0; i < arcs; i++) {
      const r = 14 + i * 11 + pop * 4;
      const alpha = 0.5 + 0.5 * pop;
      g.lineStyle(9, 0x000000, 0.55 * alpha); // dark edge: readable over bright backgrounds, like the HUD text
      g.beginPath();
      g.arc(this.x, this.y, r, -Math.PI * 0.3, Math.PI * 0.3);
      g.strokePath();
      g.lineStyle(5, colour, alpha);
      g.beginPath();
      g.arc(this.x, this.y, r, -Math.PI * 0.3, Math.PI * 0.3);
      g.strokePath();
    }
  }
}
