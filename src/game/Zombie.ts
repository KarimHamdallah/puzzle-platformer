import Phaser from 'phaser';
import type GUI from 'lil-gui';
import { TuningFolder, debug } from '../core/Debug';
import { ART_SCALE, TILE } from './constants';
import { NoiseKind, type Noise, type NoiseSystem } from './Noise';
import type { Player } from './Player';

/**
 * The three infected types (CraftPix "3 Zombies" sprites):
 *  - Clicker  (Zombie Man)   : BLIND, hears even normal walking. Patrols; walks to any noise whose ring
 *                              reaches it, searches, returns. Cannot be hurt: touching it = caught.
 *  - Runner   (Wild Zombie)  : sees, chases you across the level (runs, jumps up to 2.5 tiles: 3-tile
 *                              ledges are safe). A bottle STUNS it; while stunned, a pipe hit damages it.
 *                              3 hits kill it. Also starts chasing when it hears a scream.
 *  - Screamer (Zombie Woman) : lookout. Turns around on a fixed rhythm (a "?" warns before each turn),
 *                              turns toward noises she hears, sees through line of sight only and not a
 *                              crouched player behind cover. If she sees you or a bottle hits her she
 *                              screams: a huge noise that brings Clickers and sets Runners chasing.
 *                              Killable only by a silent takedown from behind.
 */
export enum ZombieKind {
  Clicker,
  Runner,
  Screamer,
}

enum ZombieState {
  Post, // standing at its post (Screamer: looking around)
  Patrol, // walking back and forth, turning at walls and ledges
  Investigate, // Clicker: walking to the last noise it heard
  Search, // Clicker: at the noise, looking around
  Return, // walking back to its post
  Chase, // Runner: after the player
  Stunned, // Runner: dizzy after a bottle hit; harmless and hittable
  Recover, // Runner: knocked back by a pipe hit
  Distracted, // Screamer: staring at a noise
  Alert, // Screamer: sees the player, screaming
  Grab, // caught the player
  Dead,
}

class ZombieTuning {
  clickerSpeed = 1.2; // tiles/s (patrol / return)
  investigateSpeed = 2.6; // tiles/s walking to a noise
  searchTime = 3; // s looking around at the noise
  clickerPause = 1.5; // s idle after turning around on patrol
  runnerSpeed = 5.5;
  runnerPatrolSpeed = 2.5;
  runnerPause = 0.5;
  runnerJump = 2.5; // tiles: can't reach 3-tile ledges
  runnerSight = 10; // tiles
  runnerLoseTime = 3; // s without seeing you before it gives up
  runnerHealth = 3;
  stunTime = 2.5; // s dizzy after a bottle hit
  screamerSight = 8; // tiles in front of the Screamer
  screamerSightHeight = 1.5; // tiles of vertical tolerance
  screamerLookTime = 4; // s facing one way before turning around
  screamerDistractTime = 3; // s staring at a noise she heard
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
  hurt: string;
  dead: string;
  jump: string;
}

const KINDS: KindInfo[] = [
  { w: 0.5, h: 1.85, idle: 'zombie_man_idle', walk: 'zombie_man_walk', fast: 'zombie_man_run', alert: 'zombie_man_idle',
    grab: 'zombie_man_attack', hurt: 'zombie_man_idle', dead: 'zombie_man_idle', jump: 'zombie_man_idle' },
  { w: 0.9, h: 1.0, idle: 'wild_zombie_idle', walk: 'wild_zombie_run', fast: 'wild_zombie_run', alert: 'wild_zombie_run',
    grab: 'wild_zombie_attack', hurt: 'wild_zombie_hurt', dead: 'wild_zombie_dead', jump: 'wild_zombie_jump' },
  { w: 0.5, h: 1.85, idle: 'zombie_woman_idle', walk: 'zombie_woman_idle', fast: 'zombie_woman_idle', alert: 'zombie_woman_scream',
    grab: 'zombie_woman_scream', hurt: 'zombie_woman_idle', dead: 'zombie_woman_dead', jump: 'zombie_woman_idle' },
];

const PROBE = 2; // px size of the wall / ledge probes
const ARRIVE = 0.25; // tiles: close enough to a target x
const CONTACT_INSET = 6; // px: contact needs real overlap, not a grazing touch
const TURN_WARNING = 0.7; // s before a Screamer turns around: "?" telegraph
const RECOVER_TIME = 0.5; // s a Runner staggers after a pipe hit
const ALERT_MIN_TIME = 1.2; // s a Screamer stays alerted after being hit by a bottle

export type MeleeResult = 'none' | 'hit' | 'takedown';

export class Zombie {
  readonly kind: ZombieKind;
  readonly body: Phaser.Physics.Arcade.Body;
  state: ZombieState;
  dir: number; // +1 right, -1 left
  targetX = 0; // Investigate / Return destination
  health: number;

  private readonly physics: Phaser.Physics.Arcade.ArcadePhysics;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly icon: Phaser.GameObjects.Text;
  private readonly fx: Phaser.GameObjects.Graphics; // stun stars
  private readonly info: KindInfo;
  private readonly patrols: boolean;
  private readonly homeX: number;
  private readonly homeDir: number;
  private timer = 0; // meaning depends on the state
  private lookTimer = 0; // Screamer look cycle / Clicker search turns
  private alertTimer = 0;
  private iconTimer = 0;
  private restartAnim = false;

  constructor(scene: Phaser.Scene, kind: ZombieKind, feetX: number, feetY: number, dir: number, patrols: boolean) {
    this.kind = kind;
    this.info = KINDS[kind];
    this.dir = dir;
    this.homeDir = dir;
    this.homeX = feetX;
    this.patrols = patrols;
    this.physics = scene.physics;
    this.health = kind === ZombieKind.Runner ? T.runnerHealth : 1;
    this.state = patrols ? ZombieState.Patrol : ZombieState.Post;
    this.lookTimer = T.screamerLookTime;

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
    this.fx = scene.add.graphics().setDepth(25);
  }

  get feetX(): number {
    return this.body.center.x;
  }

  get feetY(): number {
    return this.body.bottom;
  }

  get stateName(): string {
    return ZombieState[this.state] + (this.kind === ZombieKind.Runner && this.alive ? ' hp' + this.health : '');
  }

  get alive(): boolean {
    return this.state !== ZombieState.Dead;
  }

  /** Can catch the player right now. */
  get dangerous(): boolean {
    return this.alive && this.state !== ZombieState.Stunned && this.state !== ZombieState.Recover && this.state !== ZombieState.Grab;
  }

  /** Real overlap with the player's body (a few px of grace on every side). */
  touches(p: Phaser.Physics.Arcade.Body): boolean {
    const b = this.body;
    return p.right - CONTACT_INSET > b.left && p.left + CONTACT_INSET < b.right
      && p.bottom - CONTACT_INSET > b.top && p.top + CONTACT_INSET < b.bottom;
  }

  grab(): void {
    this.setState(ZombieState.Grab);
    this.body.setVelocityX(0);
    this.showIcon('', 0);
  }

  /** A thrown bottle hit this zombie (the bottle also shatters and makes its noise). */
  hitByBottle(): void {
    if (!this.alive) return;
    if (this.kind === ZombieKind.Runner) {
      this.setState(ZombieState.Stunned);
      this.timer = T.stunTime;
      this.body.setVelocityX(0);
    } else if (this.kind === ZombieKind.Screamer) {
      this.setState(ZombieState.Alert);
      this.alertTimer = ALERT_MIN_TIME;
      this.timer = 0; // scream right away
    }
  }

  /** The player's pipe connected. `fromX` = attacker's x, to know "from behind". */
  meleeHit(fromX: number): MeleeResult {
    if (!this.alive) return 'none';
    if (this.kind === ZombieKind.Runner && this.state === ZombieState.Stunned) {
      this.health--;
      const away = Math.sign(this.feetX - fromX) || 1;
      this.body.setVelocity(away * 6 * TILE, -5 * TILE);
      if (this.health <= 0) this.die();
      else {
        this.setState(ZombieState.Recover);
        this.timer = RECOVER_TIME;
      }
      return 'hit';
    }
    if (this.kind === ZombieKind.Screamer && this.state !== ZombieState.Alert && (fromX - this.feetX) * this.dir < 0) {
      this.die(); // silent takedown from behind
      return 'takedown';
    }
    return 'none';
  }

  /** Behaviour, at the physics rate. */
  fixedUpdate(dt: number, player: Player, noise: NoiseSystem): void {
    const b = this.body;
    b.gravity.y = T.gravity * TILE; // read every step so the slider applies live
    this.iconTimer = Math.max(0, this.iconTimer - dt);
    if (this.state === ZombieState.Dead || this.state === ZombieState.Grab) {
      if (b.blocked.down) b.setVelocityX(0);
      return;
    }
    if (this.kind === ZombieKind.Clicker) this.clicker(dt, noise);
    else if (this.kind === ZombieKind.Runner) this.runner(dt, player, noise);
    else this.screamer(dt, player, noise);
  }

  /** Visuals, once per rendered frame. */
  update(timeMs: number): void {
    this.sprite.setPosition(this.feetX, this.feetY);
    this.sprite.setFlipX(this.dir < 0);
    const headY = this.feetY - this.body.height;
    this.icon.setPosition(this.feetX, headY - 6);
    this.icon.setVisible(this.iconTimer > 0 && this.alive);

    this.fx.clear();
    if (this.state === ZombieState.Stunned) { // three stars orbiting the head
      this.fx.fillStyle(0xffe066, 1);
      for (let i = 0; i < 3; i++) {
        const a = timeMs / 180 + (i * Math.PI * 2) / 3;
        this.fx.fillCircle(this.feetX + Math.cos(a) * 26, headY - 10 + Math.sin(a) * 8, 6);
      }
    }

    let anim = this.info.idle;
    const moving = Math.abs(this.body.velocity.x) > 1;
    switch (this.state) {
      case ZombieState.Dead: anim = this.info.dead; break;
      case ZombieState.Grab: anim = this.info.grab; break;
      case ZombieState.Stunned:
      case ZombieState.Recover: anim = this.info.hurt; break;
      case ZombieState.Alert: anim = this.info.alert; break;
      case ZombieState.Investigate:
      case ZombieState.Chase: anim = moving ? this.info.fast : this.info.idle; break;
      default: anim = moving ? this.info.walk : this.info.idle;
    }
    if (this.kind === ZombieKind.Runner && !this.body.blocked.down && this.alive && this.state === ZombieState.Chase) anim = this.info.jump;
    if (this.restartAnim) {
      this.sprite.play(anim);
      this.restartAnim = false;
    } else {
      this.sprite.play(anim, true);
    }
  }

  // ---------------------------------------------------------------- Clicker

  private clicker(dt: number, noise: NoiseSystem): void {
    const b = this.body;
    const heard = this.loudestHeard(noise, false);
    if (heard) {
      this.targetX = heard.x;
      this.state = ZombieState.Investigate;
      this.showIcon('!', 0.8);
    }
    switch (this.state) {
      case ZombieState.Post:
        b.setVelocityX(0);
        break;
      case ZombieState.Patrol:
        this.patrol(dt, T.clickerSpeed, T.clickerPause);
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
        if (this.timer <= 0) this.state = ZombieState.Return;
        break;
      case ZombieState.Return:
        if (this.walkTo(this.homeX, T.clickerSpeed)) {
          this.dir = this.homeDir;
          this.state = this.patrols ? ZombieState.Patrol : ZombieState.Post;
        }
        break;
    }
  }

  // ---------------------------------------------------------------- Runner

  private runner(dt: number, player: Player, noise: NoiseSystem): void {
    const b = this.body;
    switch (this.state) {
      case ZombieState.Stunned:
        if (b.blocked.down) b.setVelocityX(0);
        this.timer -= dt;
        if (this.timer <= 0) this.startChase();
        return;
      case ZombieState.Recover:
        if (b.blocked.down) b.setVelocityX(b.velocity.x * 0.85);
        this.timer -= dt;
        if (this.timer <= 0) this.startChase();
        return;
    }

    const scream = this.loudestHeard(noise, true);
    if (this.state !== ZombieState.Chase && (scream || this.runnerSees(player, true))) this.startChase();

    switch (this.state) {
      case ZombieState.Patrol:
        this.patrol(dt, T.runnerPatrolSpeed, T.runnerPause);
        break;
      case ZombieState.Return:
        if (this.walkTo(this.homeX, T.runnerPatrolSpeed)) this.state = ZombieState.Patrol;
        break;
      case ZombieState.Chase: {
        if (this.runnerSees(player, false)) this.timer = T.runnerLoseTime;
        else this.timer -= dt;
        if (this.timer <= 0) {
          this.state = ZombieState.Return;
          this.showIcon('?', 1);
          break;
        }
        const dx = player.feetX - this.feetX;
        if (Math.abs(dx) > ARRIVE * TILE) this.dir = Math.sign(dx);
        if (!b.blocked.down) break; // keep momentum in the air
        if (this.wallAhead() || !this.groundAhead()) {
          b.setVelocity(this.dir * T.runnerSpeed * TILE, -Math.sqrt(2 * T.gravity * TILE * T.runnerJump * TILE));
        } else {
          b.setVelocityX(Math.abs(dx) > ARRIVE * TILE ? this.dir * T.runnerSpeed * TILE : 0);
        }
        break;
      }
    }
  }

  private startChase(): void {
    if (this.state !== ZombieState.Chase) this.showIcon('!', 0.8);
    this.state = ZombieState.Chase;
    this.timer = T.runnerLoseTime;
  }

  private runnerSees(player: Player, needFacing: boolean): boolean {
    if (player.hidden || player.dead) return false;
    const dx = player.feetX - this.feetX;
    if (needFacing && dx * this.dir <= 0) return false;
    if (Math.abs(dx) > T.runnerSight * TILE || Math.abs(player.feetY - this.feetY) > 4 * TILE) return false;
    return this.lineOfSight(player);
  }

  // ---------------------------------------------------------------- Screamer

  private screamer(dt: number, player: Player, noise: NoiseSystem): void {
    this.body.setVelocityX(0);
    this.alertTimer -= dt;

    if (this.sees(player) || this.alertTimer > 0) {
      if (this.state !== ZombieState.Alert) this.timer = 0; // first sight: scream immediately
      this.state = ZombieState.Alert;
      this.timer -= dt;
      if (this.timer <= 0) {
        noise.emit(this.feetX, this.feetY - this.body.height * 0.8, T.screamNoise, NoiseKind.Scream);
        this.timer = T.screamInterval;
        this.showIcon('!', 0.8);
      }
      return;
    }
    if (this.state === ZombieState.Alert) {
      this.state = ZombieState.Post;
      this.lookTimer = T.screamerLookTime;
    }

    const heard = this.loudestHeard(noise, false);
    if (heard) { // turns toward the sound and stares at it
      this.dir = Math.sign(heard.x - this.feetX) || this.dir;
      this.state = ZombieState.Distracted;
      this.timer = T.screamerDistractTime;
      this.showIcon('?', 0.6);
    }
    if (this.state === ZombieState.Distracted) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = ZombieState.Post;
        this.lookTimer = T.screamerLookTime;
      }
      return;
    }

    // Look cycle: face one way for screamerLookTime, warn with "?", turn around.
    this.lookTimer -= dt;
    if (this.lookTimer <= TURN_WARNING && this.iconTimer <= 0) this.showIcon('?', TURN_WARNING);
    if (this.lookTimer <= 0) {
      this.dir = -this.dir;
      this.lookTimer = T.screamerLookTime;
    }
  }

  /** Screamer sight: in front, in range, not hidden behind cover, nothing solid in between. */
  sees(player: Player): boolean {
    if (player.hidden || player.dead || !this.alive) return false;
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

  // ---------------------------------------------------------------- shared

  /** Most recent noise whose ring reaches this zombie's head. screamsOnly: Runners only react to screams. */
  private loudestHeard(noise: NoiseSystem, screamsOnly: boolean): Noise | null {
    const headY = this.feetY - this.body.height * 0.8;
    let found: Noise | null = null;
    for (let i = 0; i < noise.heard.length; i++) {
      const n = noise.heard[i];
      if (screamsOnly && n.kind !== NoiseKind.Scream) continue;
      if (this.kind === ZombieKind.Screamer && n.kind === NoiseKind.Scream) continue; // her own voice
      if (Phaser.Math.Distance.Between(n.x, n.y, this.feetX, headY) <= n.radius) found = n;
    }
    return found;
  }

  private patrol(dt: number, speedTiles: number, pause: number): void {
    const b = this.body;
    if (this.timer > 0) {
      this.timer -= dt;
      b.setVelocityX(0);
      return;
    }
    if (b.blocked.down && (this.wallAhead() || !this.groundAhead())) {
      this.dir = -this.dir;
      this.timer = pause;
      b.setVelocityX(0);
      return;
    }
    b.setVelocityX(this.dir * speedTiles * TILE);
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

  private die(): void {
    this.setState(ZombieState.Dead);
    this.showIcon('', 0);
  }

  private setState(s: ZombieState): void {
    this.state = s;
    this.restartAnim = true; // one-shot animations (grab, hurt, dead) play from the start
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
 * state (and Runner health) under each zombie, Clicker destinations, Screamer sight area
 * (red while alert) and her line of sight to the player (green clear / red blocked).
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
    t.add('runnerPatrolSpeed', 0, 8, 0.1);
    t.add('runnerPause', 0, 5, 0.1);
    t.add('runnerJump', 0, 5, 0.1);
    t.add('runnerSight', 0, 20, 0.5);
    t.add('runnerLoseTime', 0, 10, 0.1);
    t.add('runnerHealth', 1, 10, 1);
    t.add('stunTime', 0.2, 6, 0.1);
    t.add('screamerSight', 0, 20, 0.5);
    t.add('screamerSightHeight', 0, 5, 0.1);
    t.add('screamerLookTime', 0.5, 10, 0.1);
    t.add('screamerDistractTime', 0, 10, 0.1);
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
      if (!z.alive) continue;

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
