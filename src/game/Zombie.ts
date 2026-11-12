import Phaser from 'phaser';
import type GUI from 'lil-gui';
import { TuningFolder, debug } from '../core/Debug';
import { ART_SCALE, TILE } from './constants';
import { NoiseKind, type NoiseSystem } from './Noise';
import type { Player } from './Player';

/**
 * The three infected types (CraftPix "3 Zombies" sprites):
 *  - Clicker  (Zombie Man)   : BLIND, hears. Walks to any noise whose ring reaches it, searches, returns.
 *                              Cannot be attacked: touching it means being caught.
 *  - Runner   (Wild Zombie)  : sees. Fast crawling patrol. The one you will fight (combat: Day 4).
 *  - Screamer (Zombie Woman) : sees (line of sight, not through walls, not a crouched player behind
 *                              cover). When she sees you she screams: a huge noise every Clicker hears.
 */
export enum ZombieKind {
  Clicker,
  Runner,
  Screamer,
}

enum ZombieState {
  Post, // standing at its post (swaying)
  Patrol, // walking back and forth, turning at walls and ledges
  Investigate, // walking to the last noise it heard
  Search, // at the noise: looking around
  Return, // walking back to its post
  Alert, // Screamer: sees the player
  Grab, // caught the player
}

class ZombieTuning {
  clickerSpeed = 1.2; // tiles/s (patrol / return)
  investigateSpeed = 2.6; // tiles/s walking to a noise
  searchTime = 3; // s looking around at the noise
  clickerPause = 1.5; // s idle after turning around on patrol
  runnerSpeed = 5.5;
  runnerPause = 0.5;
  screamerSight = 8; // tiles in front of the Screamer
  screamerSightHeight = 1.5; // tiles of vertical tolerance
  screamNoise = 14; // tiles the scream carries
  screamInterval = 2.5; // s between screams while she keeps seeing you
  gravity = 40; // tiles/s²
}

const T = new ZombieTuning();

interface KindInfo {
  w: number; // hitbox, tiles
  h: number;
  idle: string; // animation keys (see Assets.ts)
  walk: string;
  fast: string;
  alert: string;
  grab: string;
}

const KINDS: KindInfo[] = [
  { w: 0.5, h: 1.85, idle: 'zombie_man_idle', walk: 'zombie_man_walk', fast: 'zombie_man_run', alert: 'zombie_man_idle', grab: 'zombie_man_attack' },
  { w: 0.9, h: 1.0, idle: 'wild_zombie_idle', walk: 'wild_zombie_run', fast: 'wild_zombie_run', alert: 'wild_zombie_run', grab: 'wild_zombie_attack' },
  { w: 0.5, h: 1.85, idle: 'zombie_woman_idle', walk: 'zombie_woman_idle', fast: 'zombie_woman_idle', alert: 'zombie_woman_scream', grab: 'zombie_woman_scream' },
];

const PROBE = 2; // px size of the wall / ledge probes
const ARRIVE = 0.25; // tiles: close enough to a target x
const CONTACT_INSET = 6; // px: contact needs real overlap, not a grazing touch

export class Zombie {
  readonly kind: ZombieKind;
  readonly body: Phaser.Physics.Arcade.Body;
  state: ZombieState;
  dir: number; // +1 right, -1 left
  targetX = 0; // Investigate / Return destination

  private readonly physics: Phaser.Physics.Arcade.ArcadePhysics;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly icon: Phaser.GameObjects.Text;
  private readonly info: KindInfo;
  private readonly patrols: boolean;
  private readonly homeX: number;
  private readonly homeDir: number;
  private timer = 0; // pause / search / scream timer, depends on state
  private iconTimer = 0;
  private lookTimer = 0;

  constructor(scene: Phaser.Scene, kind: ZombieKind, feetX: number, feetY: number, dir: number, patrols: boolean) {
    this.kind = kind;
    this.info = KINDS[kind];
    this.dir = dir;
    this.homeDir = dir;
    this.homeX = feetX;
    this.patrols = patrols;
    this.physics = scene.physics;
    this.state = patrols ? ZombieState.Patrol : ZombieState.Post;

    const w = this.info.w * TILE;
    const h = this.info.h * TILE;
    this.body = scene.physics.add.body(feetX - w / 2, feetY - h, w, h);
    this.body.setAllowGravity(true);
    this.body.setMaxVelocityY(15 * TILE);

    this.sprite = scene.add.sprite(feetX, feetY, this.info.idle, 0).setOrigin(0.5, 1).setScale(ART_SCALE).setDepth(8);
    this.sprite.play(this.info.idle);
    this.icon = scene.add.text(feetX, feetY, '', {
      fontFamily: 'Georgia, serif', fontSize: '44px', fontStyle: 'bold', color: '#ffe066', stroke: '#000000', strokeThickness: 7,
    }).setOrigin(0.5, 1).setDepth(25);
  }

  get feetX(): number {
    return this.body.center.x;
  }

  get feetY(): number {
    return this.body.bottom;
  }

  get stateName(): string {
    return ZombieState[this.state];
  }

  /** Real overlap with the player's body (a few px of grace on every side). */
  touches(p: Phaser.Physics.Arcade.Body): boolean {
    const b = this.body;
    return p.right - CONTACT_INSET > b.left && p.left + CONTACT_INSET < b.right
      && p.bottom - CONTACT_INSET > b.top && p.top + CONTACT_INSET < b.bottom;
  }

  grab(): void {
    this.state = ZombieState.Grab;
    this.body.setVelocityX(0);
    this.sprite.play(this.info.grab);
    this.showIcon('', 0);
  }

  /** Behaviour, at the physics rate. */
  fixedUpdate(dt: number, player: Player, noise: NoiseSystem): void {
    const b = this.body;
    b.gravity.y = T.gravity * TILE; // read every step so the slider applies live
    this.iconTimer = Math.max(0, this.iconTimer - dt);
    if (this.state === ZombieState.Grab) {
      b.setVelocityX(0);
      return;
    }

    if (this.kind === ZombieKind.Screamer) {
      this.screamer(dt, player, noise);
      return;
    }
    if (this.kind === ZombieKind.Clicker) this.listen(noise);

    switch (this.state) {
      case ZombieState.Post:
        b.setVelocityX(0);
        break;
      case ZombieState.Patrol:
        this.patrol(dt);
        break;
      case ZombieState.Investigate:
        if (this.walkTo(this.targetX, T.investigateSpeed)) {
          this.state = ZombieState.Search;
          this.timer = T.searchTime;
          this.lookTimer = 0.9;
          this.showIcon('?', T.searchTime);
        }
        break;
      case ZombieState.Search:
        b.setVelocityX(0);
        this.timer -= dt;
        this.lookTimer -= dt;
        if (this.lookTimer <= 0) {
          this.dir = -this.dir; // looks around
          this.lookTimer = 0.9;
        }
        if (this.timer <= 0) {
          this.state = ZombieState.Return;
          this.targetX = this.homeX;
        }
        break;
      case ZombieState.Return:
        if (this.walkTo(this.homeX, T.clickerSpeed)) {
          this.dir = this.homeDir;
          this.state = this.patrols ? ZombieState.Patrol : ZombieState.Post;
        }
        break;
    }
  }

  /** Visuals, once per rendered frame. */
  update(): void {
    this.sprite.setPosition(this.feetX, this.feetY);
    this.sprite.setFlipX(this.dir < 0);
    this.icon.setPosition(this.feetX, this.feetY - this.body.height - 6);
    this.icon.setVisible(this.iconTimer > 0);
    if (this.state === ZombieState.Grab) return;

    let anim = this.info.idle;
    const moving = Math.abs(this.body.velocity.x) > 1;
    if (this.state === ZombieState.Alert) anim = this.info.alert;
    else if (this.state === ZombieState.Investigate && moving) anim = this.info.fast;
    else if (moving) anim = this.info.walk;
    this.sprite.play(anim, true);
  }

  // ---------------------------------------------------------------- behaviours

  /** Clicker: the most recent noise whose ring reaches its head becomes the new destination. */
  private listen(noise: NoiseSystem): void {
    const headY = this.feetY - this.body.height * 0.8;
    for (let i = 0; i < noise.heard.length; i++) {
      const n = noise.heard[i];
      if (Phaser.Math.Distance.Between(n.x, n.y, this.feetX, headY) > n.radius) continue;
      this.targetX = n.x;
      this.state = ZombieState.Investigate;
      this.showIcon('!', 0.8);
    }
  }

  private screamer(dt: number, player: Player, noise: NoiseSystem): void {
    this.body.setVelocityX(0);
    const sees = this.sees(player);
    if (!sees) {
      this.state = ZombieState.Post;
      return;
    }
    if (this.state !== ZombieState.Alert) this.timer = 0; // first sight: scream immediately
    this.state = ZombieState.Alert;
    this.timer -= dt;
    if (this.timer <= 0) {
      noise.emit(this.feetX, this.feetY - this.body.height * 0.8, T.screamNoise, NoiseKind.Scream);
      this.timer = T.screamInterval;
      this.showIcon('!', 0.8);
    }
  }

  /** In front of her, in range, not hidden behind cover, and nothing solid in between. */
  sees(player: Player): boolean {
    if (player.hidden || player.dead) return false;
    const dx = player.feetX - this.feetX;
    if (dx * this.dir <= 0 || Math.abs(dx) > T.screamerSight * TILE) return false;
    if (Math.abs(player.feetY - this.feetY) > T.screamerSightHeight * TILE) return false;
    return this.lineOfSight(player);
  }

  lineOfSight(player: Player): boolean {
    const x0 = this.feetX;
    const y0 = this.feetY - this.body.height * 0.8;
    const x1 = player.feetX;
    const y1 = player.feetY - player.body.height * 0.6;
    const steps = Math.ceil(Phaser.Math.Distance.Between(x0, y0, x1, y1) / 12);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.physics.overlapRect(x0 + (x1 - x0) * t - 1, y0 + (y1 - y0) * t - 1, 2, 2, false, true).length > 0) return false;
    }
    return true;
  }

  private patrol(dt: number): void {
    const b = this.body;
    if (this.timer > 0) {
      this.timer -= dt;
      b.setVelocityX(0);
      return;
    }
    if (b.blocked.down && (this.wallAhead() || !this.groundAhead())) {
      this.dir = -this.dir;
      this.timer = this.kind === ZombieKind.Clicker ? T.clickerPause : T.runnerPause;
      b.setVelocityX(0);
      return;
    }
    const speed = this.kind === ZombieKind.Clicker ? T.clickerSpeed : T.runnerSpeed;
    b.setVelocityX(this.dir * speed * TILE);
  }

  /** Walk toward x on the current floor. True when arrived, or when a wall / ledge edge stops it. */
  private walkTo(x: number, speedTiles: number): boolean {
    const b = this.body;
    const dx = x - this.feetX;
    if (Math.abs(dx) <= ARRIVE * TILE) {
      b.setVelocityX(0);
      return true;
    }
    this.dir = Math.sign(dx);
    if (b.blocked.down && (this.wallAhead() || !this.groundAhead())) {
      b.setVelocityX(0);
      return true; // as close as it can get without leaving its floor
    }
    b.setVelocityX(this.dir * speedTiles * TILE);
    return false;
  }

  private showIcon(text: string, seconds: number): void {
    this.icon.setText(text);
    this.iconTimer = seconds;
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
 * Debug view for all zombies: "zombie tuning" sliders + "zombies" folder with an overlay:
 * state name above each zombie, the Clickers' destination, the Screamer's sight area
 * (red while she sees you) and her line of sight to the player (green clear / red blocked).
 */
export class ZombieDebug {
  showSenses = true;

  private readonly zombies: Zombie[];
  private readonly tuning: TuningFolder<ZombieTuning>;
  private readonly folder: GUI;
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly labels: Phaser.GameObjects.Text[] = [];

  constructor(scene: Phaser.Scene, zombies: Zombie[]) {
    this.zombies = zombies;
    const t = new TuningFolder('zombie tuning', T);
    t.add('clickerSpeed', 0, 6, 0.1);
    t.add('investigateSpeed', 0, 8, 0.1);
    t.add('searchTime', 0, 10, 0.1);
    t.add('clickerPause', 0, 5, 0.1);
    t.add('runnerSpeed', 0, 12, 0.1);
    t.add('runnerPause', 0, 5, 0.1);
    t.add('screamerSight', 0, 20, 0.5);
    t.add('screamerSightHeight', 0, 5, 0.1);
    t.add('screamNoise', 0, 30, 0.5);
    t.add('screamInterval', 0.5, 10, 0.1);
    t.add('gravity', 5, 80, 1);
    this.tuning = t;

    this.folder = debug.gui.addFolder('zombies').close();
    this.folder.add(this, 'showSenses').name('show senses + states');
    this.gfx = scene.add.graphics().setDepth(20);
    for (let i = 0; i < zombies.length; i++) {
      this.labels.push(scene.add.text(0, 0, '', {
        fontFamily: 'Consolas, monospace', fontSize: '18px', color: '#ffffff', backgroundColor: '#00000088',
      }).setOrigin(0.5, 0).setDepth(21));
    }
  }

  destroy(): void {
    this.tuning.destroy();
    this.folder.destroy();
  }

  draw(player: Player): void {
    const g = this.gfx;
    g.clear();
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      const label = this.labels[i];
      label.setVisible(this.showSenses);
      if (!this.showSenses) continue;
      label.setText(z.stateName).setPosition(z.feetX, z.feetY + 6);

      if (z.kind === ZombieKind.Clicker && (z.stateName === 'Investigate' || z.stateName === 'Return')) {
        g.lineStyle(2, 0xffe066, 0.8);
        g.lineBetween(z.feetX, z.feetY - 10, z.targetX, z.feetY - 10);
        g.fillStyle(0xffe066, 1).fillCircle(z.targetX, z.feetY - 10, 6);
      } else if (z.kind === ZombieKind.Screamer) {
        const w = T.screamerSight * TILE;
        const band = T.screamerSightHeight * TILE;
        const x = z.dir > 0 ? z.feetX : z.feetX - w;
        const alert = z.stateName === 'Alert';
        g.fillStyle(alert ? 0xff3030 : 0xffee55, alert ? 0.3 : 0.15);
        g.fillRect(x, z.feetY - band, w, band * 2); // where the player's FEET must be
        if (Phaser.Math.Distance.Between(z.feetX, z.feetY, player.feetX, player.feetY) > w * 1.5) continue; // only near her
        const clear = z.lineOfSight(player);
        g.lineStyle(2, clear ? 0x66ff66 : 0xff4444, 0.6);
        g.lineBetween(z.feetX, z.feetY - z.body.height * 0.8, player.feetX, player.feetY - player.body.height * 0.6);
      }
    }
  }
}
