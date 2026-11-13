import Phaser from 'phaser';
import type GUI from 'lil-gui';
import { TuningFolder, debug } from '../core/Debug';
import { ART_SCALE, TILE } from './constants';
import { NoiseKind, type Noise, type NoiseSystem } from './Noise';
import type { Player } from './Player';

/**
 * The three infected types (CraftPix "3 Zombies" sprites). A player crouched behind a cover crate is
 * invisible AND untouchable for all of them: hiding is how you break a chase.
 *
 *  - Clicker  (Zombie Man)   : BLIND. Senses you within a short radius all around (even sneaking) and
 *                              hears your footsteps; then it HUNTS you and keeps following your noise.
 *                              A thrown bottle (or a scream) DISTRACTS it: it walks there and listens.
 *                              Only while it is distracted can you sneak up and take it down from
 *                              behind. Punch it any other time and it grabs you.
 *  - Runner   (Wild Zombie)  : sees (line of sight), chases your last seen position, jumps after you.
 *                              Jump on its head (Mario stomp) or hit it with a bottle: it gets DIZZY.
 *                              Punch it while dizzy, several times, until it dies.
 *  - Screamer (Zombie Woman) : lookout turning around on a fixed rhythm ("?" warns before each turn),
 *                              turns toward noises, sees through line of sight only. If she sees you, a
 *                              bottle hits her or you punch her from the front, she screams: Clickers
 *                              come to her, Runners start chasing. Silent takedown from behind only.
 */
export enum ZombieKind {
  Clicker,
  Runner,
  Screamer,
}

enum ZombieState {
  Post, // standing at its post (Screamer: looking around)
  Patrol, // walking back and forth, turning at walls and ledges
  Investigate, // Clicker: walking to a distraction (bottle / scream)
  Search, // Clicker: listening at the spot (distracted) or looking for you after a hunt
  Hunt, // Clicker: following the player's noise
  Return, // walking back to its post
  Chase, // Runner: after the player's last seen position
  Stunned, // Runner: dizzy (stomp / bottle); harmless, punch it
  Distracted, // Screamer: staring at a noise
  Alert, // Screamer: sees the player, screaming
  Grab, // caught the player
  Dead,
}

class ZombieTuning {
  clickerSpeed = 1.2; // tiles/s (patrol / return)
  investigateSpeed = 2.6; // tiles/s walking to a distraction
  huntSpeed = 4.6; // tiles/s following you (faster than walking, slower than sprinting)
  clickerSense = 2; // tiles all around: senses you even sneaking (not when hidden or when distracted)
  huntLoseTime = 2.5; // s without hearing you before it stops hunting
  searchTime = 5; // s listening at a spot: the takedown window (sneak speed 2.2 -> ~11 tiles of approach)
  clickerPause = 1.5; // s idle after turning around on patrol
  runnerSpeed = 9; // faster than the player's sprint (8.5): you can't outrun it, stomp it or hide
  runnerPatrolSpeed = 2.5;
  runnerPause = 0.5;
  runnerJump = 3.3; // tiles: follows you onto 3-tile ledges
  runnerSight = 10; // tiles
  runnerLoseTime = 5; // s without seeing you before it gives up
  runnerHealth = 3; // punches while dizzy
  stunTime = 3; // s dizzy after a stomp / bottle
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
    grab: 'zombie_man_attack', hurt: 'zombie_man_idle', dead: 'zombie_man_dead', jump: 'zombie_man_idle' },
  { w: 0.9, h: 1.0, idle: 'wild_zombie_idle', walk: 'wild_zombie_run', fast: 'wild_zombie_run', alert: 'wild_zombie_run',
    grab: 'wild_zombie_attack', hurt: 'wild_zombie_hurt', dead: 'wild_zombie_dead', jump: 'wild_zombie_jump' },
  { w: 0.5, h: 1.85, idle: 'zombie_woman_idle', walk: 'zombie_woman_idle', fast: 'zombie_woman_idle', alert: 'zombie_woman_scream',
    grab: 'zombie_woman_scream', hurt: 'zombie_woman_idle', dead: 'zombie_woman_dead', jump: 'zombie_woman_idle' },
];

const PROBE = 2; // px size of the wall / ledge probes
const ARRIVE = 0.25; // tiles: close enough to a target x
const CONTACT_INSET = 6; // px: contact needs real overlap, not a grazing touch
const TURN_WARNING = 0.7; // s before a Screamer turns around: "?" telegraph
const PUNCH_KEEPS_DIZZY = 0.6; // s: a punch never lets the dizzy window end right after it

export type MeleeResult = 'none' | 'hit' | 'takedown' | 'grab';

export class Zombie {
  readonly kind: ZombieKind;
  readonly body: Phaser.Physics.Arcade.Body;
  state: ZombieState;
  dir: number; // +1 right, -1 left
  targetX = 0; // Investigate / Hunt / Chase / Return destination
  health: number;
  distracted = false; // Clicker: busy with a bottle / scream (the only time it can be taken down)

  private readonly physics: Phaser.Physics.Arcade.ArcadePhysics;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly icon: Phaser.GameObjects.Text;
  private readonly fx: Phaser.GameObjects.Graphics; // dizzy stars
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
    let s = ZombieState[this.state];
    if (this.distracted) s += '*';
    if (this.kind === ZombieKind.Runner && this.alive) s += ' hp' + this.health;
    return s;
  }

  get alive(): boolean {
    return this.state !== ZombieState.Dead;
  }

  /** Can catch the player right now. */
  get dangerous(): boolean {
    return this.alive && this.state !== ZombieState.Stunned && this.state !== ZombieState.Grab;
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

  /** The player landed on this zombie's head. Runner: dizzy. Returns true if it was a valid stomp. */
  stomped(): boolean {
    if (this.kind !== ZombieKind.Runner || !this.alive) return false;
    this.stun();
    return true;
  }

  /** A thrown bottle hit this zombie (the bottle also shatters and makes its noise). */
  hitByBottle(): void {
    if (!this.alive) return;
    if (this.kind === ZombieKind.Runner) this.stun();
    else if (this.kind === ZombieKind.Screamer) this.startScreaming();
  }

  /** The player's punch connected. `fromX` = attacker's x, to know "from behind". */
  meleeHit(fromX: number): MeleeResult {
    if (!this.alive) return 'none';
    const fromBehind = (fromX - this.feetX) * this.dir < 0;

    if (this.kind === ZombieKind.Runner) {
      if (this.state !== ZombieState.Stunned) return 'none';
      this.health--;
      this.body.setVelocityX(Math.sign(this.feetX - fromX) * TILE);
      this.timer = Math.max(this.timer, PUNCH_KEEPS_DIZZY);
      if (this.health <= 0) this.die();
      return 'hit';
    }
    if (this.kind === ZombieKind.Clicker) {
      const busy = this.distracted && (this.state === ZombieState.Investigate || this.state === ZombieState.Search);
      if (busy && fromBehind) {
        this.die();
        return 'takedown';
      }
      return 'grab'; // not busy, or from the front: it gets you
    }
    // Screamer
    if (this.state !== ZombieState.Alert && fromBehind) {
      this.die();
      return 'takedown';
    }
    this.startScreaming();
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
    if (this.kind === ZombieKind.Clicker) this.clicker(dt, player, noise);
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
      case ZombieState.Stunned: anim = this.info.hurt; break;
      case ZombieState.Alert: anim = this.info.alert; break;
      case ZombieState.Investigate:
      case ZombieState.Hunt:
      case ZombieState.Chase: anim = moving ? this.info.fast : this.info.idle; break;
      default: anim = moving ? this.info.walk : this.info.idle;
    }
    if (this.kind === ZombieKind.Runner && !this.body.blocked.down && this.state === ZombieState.Chase) anim = this.info.jump;
    if (this.restartAnim) {
      this.sprite.play(anim);
      this.restartAnim = false;
    } else {
      this.sprite.play(anim, true);
    }
  }

  // ---------------------------------------------------------------- Clicker

  private clicker(dt: number, player: Player, noise: NoiseSystem): void {
    const b = this.body;
    const lure = this.lastHeard(noise, true);
    const steps = this.lastHeard(noise, false);
    const sensed = !this.distracted && this.senses(player);

    if (lure) { // bottle / scream: go and listen there
      this.targetX = lure.x;
      this.state = ZombieState.Investigate;
      this.distracted = true;
      this.showIcon('!', 0.8);
    } else if (steps || sensed) { // your footsteps, or you are right next to it: hunt you
      if (this.state !== ZombieState.Hunt) this.showIcon('!', 0.8);
      this.state = ZombieState.Hunt;
      this.distracted = false;
      this.targetX = steps ? steps.x : player.feetX;
      this.timer = T.huntLoseTime;
    }

    switch (this.state) {
      case ZombieState.Post:
        b.setVelocityX(0);
        break;
      case ZombieState.Patrol:
        this.patrol(dt, T.clickerSpeed, T.clickerPause);
        break;
      case ZombieState.Investigate:
        if (this.walkTo(this.targetX, T.investigateSpeed)) this.startSearch();
        break;
      case ZombieState.Hunt:
        this.walkTo(this.targetX, T.huntSpeed);
        this.timer -= dt;
        if (this.timer <= 0) {
          this.distracted = false;
          this.startSearch();
        }
        break;
      case ZombieState.Search:
        b.setVelocityX(0);
        this.timer -= dt;
        if (!this.distracted) { // looking for you: turns around; listening to a lure: keeps facing it
          this.lookTimer -= dt;
          if (this.lookTimer <= 0) {
            this.dir = -this.dir;
            this.lookTimer = 0.9;
          }
        }
        if (this.timer <= 0) {
          this.distracted = false;
          this.state = ZombieState.Return;
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

  private startSearch(): void {
    this.state = ZombieState.Search;
    this.timer = T.searchTime;
    this.lookTimer = 0.9;
    this.showIcon('?', T.searchTime);
  }

  /** Clicker's close-range sense: all around, works on a sneaking player, not on a hidden one. */
  private senses(player: Player): boolean {
    if (player.hidden || player.dead) return false;
    const headY = this.feetY - this.body.height * 0.5;
    const py = player.feetY - player.body.height * 0.5;
    return Phaser.Math.Distance.Between(this.feetX, headY, player.feetX, py) <= T.clickerSense * TILE;
  }

  // ---------------------------------------------------------------- Runner

  private runner(dt: number, player: Player, noise: NoiseSystem): void {
    const b = this.body;
    if (this.state === ZombieState.Stunned) {
      if (b.blocked.down) b.setVelocityX(b.velocity.x * 0.8);
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = ZombieState.Chase;
        this.targetX = player.feetX;
        this.timer = T.runnerLoseTime;
        this.showIcon('!', 0.8);
      }
      return;
    }

    const scream = this.lastHeard(noise, true, true);
    if (scream && this.state !== ZombieState.Chase) {
      this.startChase(scream.x);
    } else if (this.state !== ZombieState.Chase && this.runnerSees(player, true)) {
      this.startChase(player.feetX);
    }

    switch (this.state) {
      case ZombieState.Patrol:
        this.patrol(dt, T.runnerPatrolSpeed, T.runnerPause);
        break;
      case ZombieState.Return:
        if (this.walkTo(this.homeX, T.runnerPatrolSpeed)) this.state = ZombieState.Patrol;
        break;
      case ZombieState.Chase: {
        if (this.runnerSees(player, false)) {
          this.targetX = player.feetX; // only what it can SEE: hiding sends it to your last seen spot
          this.timer = T.runnerLoseTime;
        } else {
          this.timer -= dt;
        }
        if (this.timer <= 0) {
          this.state = ZombieState.Return;
          this.showIcon('?', 1);
          break;
        }
        if (!b.blocked.down) break; // keep momentum in the air
        const dx = this.targetX - this.feetX;
        if (Math.abs(dx) <= ARRIVE * TILE) {
          b.setVelocityX(0);
          if (this.iconTimer <= 0) this.showIcon('?', 0.6); // lost you: looking around
          break;
        }
        this.dir = Math.sign(dx);
        if (this.wallAhead() || !this.groundAhead()) {
          b.setVelocity(this.dir * T.runnerSpeed * TILE, -Math.sqrt(2 * T.gravity * TILE * T.runnerJump * TILE));
        } else {
          b.setVelocityX(this.dir * T.runnerSpeed * TILE);
        }
        break;
      }
    }
  }

  private startChase(x: number): void {
    this.showIcon('!', 0.8);
    this.state = ZombieState.Chase;
    this.targetX = x;
    this.timer = T.runnerLoseTime;
  }

  private stun(): void {
    this.setState(ZombieState.Stunned);
    this.timer = T.stunTime;
    this.body.setVelocityX(0);
    this.showIcon('', 0);
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

    const heard = this.lastHeard(noise, false) ?? this.lastHeard(noise, true);
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

  private startScreaming(): void {
    if (!this.alive) return;
    this.state = ZombieState.Alert;
    this.alertTimer = 1.2;
    this.timer = 0; // scream right away
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

  /**
   * Most recent noise whose ring reaches this zombie's head.
   *  lures = true  : bottles and screams (things to investigate)
   *  lures = false : the player's own noises (footsteps, landings, punches)
   * screamsOnly narrows lures to screams (Runners don't care about bottles).
   */
  private lastHeard(noise: NoiseSystem, lures: boolean, screamsOnly: boolean = false): Noise | null {
    const headY = this.feetY - this.body.height * 0.8;
    let found: Noise | null = null;
    for (let i = 0; i < noise.heard.length; i++) {
      const n = noise.heard[i];
      const isLure = n.kind === NoiseKind.Bottle || n.kind === NoiseKind.Scream;
      if (isLure !== lures) continue;
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
    this.distracted = false;
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
 * state under each zombie ("*" = distracted, Runner health), Clicker sense radius and destination,
 * Screamer sight area (red while alert) and her line of sight to the player.
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
    t.add('huntSpeed', 0, 10, 0.1);
    t.add('clickerSense', 0, 6, 0.1);
    t.add('huntLoseTime', 0, 10, 0.1);
    t.add('searchTime', 0, 10, 0.1);
    t.add('clickerPause', 0, 5, 0.1);
    t.add('runnerSpeed', 0, 14, 0.1);
    t.add('runnerPatrolSpeed', 0, 8, 0.1);
    t.add('runnerPause', 0, 5, 0.1);
    t.add('runnerJump', 0, 6, 0.1);
    t.add('runnerSight', 0, 20, 0.5);
    t.add('runnerLoseTime', 0, 15, 0.1);
    t.add('runnerHealth', 1, 10, 1);
    t.add('stunTime', 0.2, 8, 0.1);
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

      if (z.kind === ZombieKind.Clicker) {
        if (!z.distracted) { // the close-range sense
          g.lineStyle(2, 0x66ccff, 0.5);
          g.strokeCircle(z.feetX, z.feetY - z.body.height * 0.5, T.clickerSense * TILE);
        }
        if (z.state === ZombieState.Investigate || z.state === ZombieState.Hunt || z.state === ZombieState.Return) {
          g.lineStyle(2, 0xffe066, 0.8);
          g.lineBetween(z.feetX, z.feetY - 10, z.targetX, z.feetY - 10);
          g.fillStyle(0xffe066, 1).fillCircle(z.targetX, z.feetY - 10, 6);
        }
      } else if (z.kind === ZombieKind.Screamer) {
        const w = T.screamerSight * TILE;
        const band = T.screamerSightHeight * TILE;
        const x = z.dir > 0 ? z.feetX : z.feetX - w;
        const alert = z.state === ZombieState.Alert;
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
