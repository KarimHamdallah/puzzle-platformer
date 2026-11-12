import Phaser from 'phaser';
import type GUI from 'lil-gui';
import { TuningFolder, debug } from '../core/Debug';
import { ART_SCALE, TILE } from './constants';
import type { Player } from './Player';

/**
 * The three infected types (CraftPix "3 Zombies" sprites):
 *  - Clicker  (Zombie Man)   : blind, HEARS. Slow patrol. Cannot be attacked. (noise mechanic: Day 2)
 *  - Runner   (Wild Zombie)  : SEES. Fast crawling patrol. The one you can fight. (combat: Day 4)
 *  - Screamer (Zombie Woman) : SEES. Stands guard; screams when the player is in front of her,
 *                              which will become a noise blast that pulls every Clicker.
 */
export enum ZombieKind {
  Clicker,
  Runner,
  Screamer,
}

class ZombieTuning {
  clickerSpeed = 1.2; // tiles/s
  clickerPause = 1.5; // s idle after turning around
  runnerSpeed = 5.5;
  runnerPause = 0.5;
  hearingRadius = 6; // tiles (Clicker; used by the noise mechanic, drawn by the debug view)
  screamerSight = 7; // tiles in front of the Screamer
  screamerSightHeight = 1.5; // tiles of vertical tolerance for "in front of her"
  gravity = 40; // tiles/s²
}

const T = new ZombieTuning();

interface KindInfo {
  w: number; // hitbox, tiles
  h: number;
  idle: string; // animation keys (see Assets.ts)
  move: string;
  alert: string;
}

const KINDS: KindInfo[] = [
  { w: 0.5, h: 1.85, idle: 'zombie_man_idle', move: 'zombie_man_walk', alert: 'zombie_man_idle' },
  { w: 0.9, h: 1.0, idle: 'wild_zombie_idle', move: 'wild_zombie_run', alert: 'wild_zombie_run' },
  { w: 0.5, h: 1.85, idle: 'zombie_woman_idle', move: 'zombie_woman_idle', alert: 'zombie_woman_scream' },
];

const PROBE = 2; // px size of the wall / ledge probes

export class Zombie {
  readonly kind: ZombieKind;
  readonly body: Phaser.Physics.Arcade.Body;
  dir: number; // +1 right, -1 left
  alerted = false; // Screamer: currently sees the player

  private readonly physics: Phaser.Physics.Arcade.ArcadePhysics;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly info: KindInfo;
  private pauseLeft = 0;

  constructor(scene: Phaser.Scene, kind: ZombieKind, feetX: number, feetY: number, dir: number) {
    this.kind = kind;
    this.info = KINDS[kind];
    this.dir = dir;
    this.physics = scene.physics;

    const w = this.info.w * TILE;
    const h = this.info.h * TILE;
    this.body = scene.physics.add.body(feetX - w / 2, feetY - h, w, h);
    this.body.setAllowGravity(true);
    this.body.setMaxVelocityY(15 * TILE);

    this.sprite = scene.add.sprite(feetX, feetY, this.info.idle, 0).setOrigin(0.5, 1).setScale(ART_SCALE).setDepth(8);
    this.sprite.play(this.info.idle);
  }

  get feetX(): number {
    return this.body.center.x;
  }

  get feetY(): number {
    return this.body.bottom;
  }

  /** Behaviour, at the physics rate. */
  fixedUpdate(dt: number, player: Player): void {
    const b = this.body;
    b.gravity.y = T.gravity * TILE; // read every step so the slider applies live

    if (this.kind === ZombieKind.Screamer) {
      b.setVelocityX(0);
      this.alerted = this.sees(player);
      return;
    }

    if (this.pauseLeft > 0) {
      this.pauseLeft -= dt;
      b.setVelocityX(0);
      return;
    }

    // Patrol: walk until a wall or a ledge edge, then pause and turn around. No bounds needed.
    if (b.blocked.down && (this.wallAhead() || !this.groundAhead())) {
      this.dir = -this.dir;
      this.pauseLeft = this.kind === ZombieKind.Clicker ? T.clickerPause : T.runnerPause;
      b.setVelocityX(0);
      return;
    }
    const speed = this.kind === ZombieKind.Clicker ? T.clickerSpeed : T.runnerSpeed;
    b.setVelocityX(this.dir * speed * TILE);
  }

  /** Visuals, once per rendered frame. */
  update(): void {
    this.sprite.setPosition(this.feetX, this.feetY);
    this.sprite.setFlipX(this.dir < 0);
    let anim = this.info.idle;
    if (this.alerted) anim = this.info.alert;
    else if (Math.abs(this.body.velocity.x) > 1) anim = this.info.move;
    this.sprite.play(anim, true);
  }

  private sees(player: Player): boolean {
    const dx = player.feetX - this.feetX;
    const inFront = dx * this.dir > 0 && Math.abs(dx) <= T.screamerSight * TILE;
    return inFront && Math.abs(player.feetY - this.feetY) <= T.screamerSightHeight * TILE;
  }

  private wallAhead(): boolean {
    const b = this.body;
    const x = this.dir > 0 ? b.right + 1 : b.left - 1 - PROBE;
    return this.physics.overlapRect(x, b.top + 4, PROBE, b.height - 8, false, true).length > 0;
  }

  private groundAhead(): boolean {
    const b = this.body;
    const x = this.dir > 0 ? b.right + 1 : b.left - 1 - PROBE;
    return this.physics.overlapRect(x, b.bottom + 2, PROBE, PROBE, false, true).length > 0;
  }
}

/**
 * Debug view for all zombies: "zombie tuning" sliders + "zombies" folder.
 * Draws the Clickers' hearing radius and the Screamers' sight area (red while she sees you).
 */
export class ZombieDebug {
  showSenses = true;

  private readonly zombies: Zombie[];
  private readonly tuning: TuningFolder<ZombieTuning>;
  private readonly folder: GUI;
  private readonly gfx: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, zombies: Zombie[]) {
    this.zombies = zombies;
    const t = new TuningFolder('zombie tuning', T);
    t.add('clickerSpeed', 0, 6, 0.1);
    t.add('clickerPause', 0, 5, 0.1);
    t.add('runnerSpeed', 0, 12, 0.1);
    t.add('runnerPause', 0, 5, 0.1);
    t.add('hearingRadius', 0, 15, 0.5);
    t.add('screamerSight', 0, 15, 0.5);
    t.add('screamerSightHeight', 0, 5, 0.1);
    t.add('gravity', 5, 80, 1);
    this.tuning = t;

    this.folder = debug.gui.addFolder('zombies').close();
    this.folder.add(this, 'showSenses').name('show senses');
    this.gfx = scene.add.graphics().setDepth(20);
  }

  destroy(): void {
    this.tuning.destroy();
    this.folder.destroy();
  }

  draw(): void {
    const g = this.gfx;
    g.clear();
    if (!this.showSenses) return;
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      const headY = z.feetY - z.body.height * 0.8;
      if (z.kind === ZombieKind.Clicker) {
        g.lineStyle(2, 0x66ccff, 0.8);
        g.strokeCircle(z.feetX, headY, T.hearingRadius * TILE);
      } else if (z.kind === ZombieKind.Screamer) {
        // exactly the area sees() tests: where the player's FEET must be
        const w = T.screamerSight * TILE;
        const band = T.screamerSightHeight * TILE;
        const x = z.dir > 0 ? z.feetX : z.feetX - w;
        g.fillStyle(z.alerted ? 0xff3030 : 0xffee55, z.alerted ? 0.3 : 0.15);
        g.fillRect(x, z.feetY - band, w, band * 2);
      }
    }
  }
}
