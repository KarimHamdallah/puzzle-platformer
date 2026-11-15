import Phaser from 'phaser';
import { ART_SCALE, TILE } from './constants';
import type { Player } from './Player';
import { boltAction, gunBurst, rifleShot } from './Sfx';
import type { Zombie } from './Zombie';

/**
 * Mechanic 2: snipers on towers. The army shoots anything that moves: people or infected.
 *
 * Rifle sniper ("wait, then cross"):
 *  - Outside his area his red laser wanders between random points of weighted zones (e.g. 90% the
 *    lower path, 10% the upper route): you can watch it from safety.
 *  - The moment you step into his area he has you, and never lets go. The laser CHASES you, faster
 *    than you sprint (CHASE_SPEED). Once the dot is on you (or on the crate in front of you) he fires
 *    after AIM_TIME -> Reload (RELOAD_TIME, the laser dims but keeps following you) -> Aim...
 *    A crate between you and him takes the bullet, if you CROUCH behind it: he aims at your head, and
 *    standing it shows over the crate. Run during the reload, crate to crate.
 *  - Mad sniper (def.mad): the reload is random and sometimes he fires twice; the bolt sound is the
 *    only honest signal. Bullets that hit cover call onCoverHit (the scene breaks wooden crates).
 * Machine gunner ("no mercy"):
 *  - Watches one stretch of ground and opens fire on ANYTHING exposed in it. On you: you are pinned
 *    where you stand (Player.pinned) while he empties GUNNER_PLAYER_TIME of fire into you; no escape. A
 *    zombie takes him GUNNER_KILL_TIME to cut down, pinned down meanwhile (it can't move or grab: run
 *    right past it). Lure an infected into his ground and run while he is busy with it.
 * Shots are flashes, a camera shake, the laser line and recorded gunshots (Sfx.ts); no bullets in flight.
 */

export enum SniperKind {
  Rifle,
  Gunner,
}

/** Tiles. Rifle: weighted zones the laser wanders over. Gunner: zones[0] is the ground he watches. */
export interface SniperZone {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  weight: number;
}

export interface SniperDef {
  kind: SniperKind;
  tile: [number, number]; // the nest's feet tile (on top of a tower / roof); he faces left
  area: [number, number]; // tile x range where he can spot and shoot the player
  zones: SniperZone[];
  mad?: boolean; // rifle: random reload (MAD_RELOAD_MIN..MAX, listen for the bolt), sometimes a double shot
  blind?: [number, number, number, number][]; // tile rects x0, y0, x1, y1 he can't see (right under his nest)
  mounted?: boolean; // on a helicopter: no nest sprite; the owner moves him (setMuzzle / setZone / active)
}

enum State {
  Idle, // rifle: wandering laser / gunner: sweeping
  Aim, // rifle: chasing you, fires once the dot has been on you for AIM_TIME
  Reload, // rifle: laser dim, still following you
  Firing, // gunner: bursts at a target
}

const SWEEP_SPEED = 7; // tiles/s the laser wanders
const DWELL_MIN = 0.35; // s the laser rests on a point
const DWELL_MAX = 0.9;
const CHASE_SPEED = 11; // tiles/s the laser chases you (you sprint at 8.5)
const RELOAD_CHASE = 7; // tiles/s it keeps following you while he reloads
const LOCK_RADIUS = 0.7; // tiles: the dot this close to its target counts as "on you"
const AIM_TIME = 0.7; // s with the dot on you before the shot
const RELOAD_TIME = 1.7; // s after a shot: your window
const MAD_RELOAD_MIN = 1.0; // the mad sniper's reload is random: you can't count it, you have to hear it
const MAD_RELOAD_MAX = 2.5;
const MAD_DOUBLE_CHANCE = 0.35; // chance of a second, quick shot
const MAD_DOUBLE_DELAY = 0.35; // s between the two shots
const GUNNER_SWEEP = 5; // tiles/s
const GUNNER_BURST = 0.09; // s between machine-gun shots
const GUNNER_PLAYER_TIME = 0.9; // s he keeps firing into you (pinned, you can't move) before you fall
const GUNNER_KILL_TIME = 2.7; // s of fire to cut down a zombie (the player's window)
const MOUNTED_KILL_TIME = 1.0; // s: the helicopter's door gun, much closer, cuts an infected down fast
const MOUNTED_SPOT_TIME = 0.6; // s you can be out of cover under the helicopter before its gun opens up (time to throw)
const HEAD_INSET = 0.1; // tiles below the top of the player's body: where soldiers aim
const RAY_STEP = 6; // px
const LASER_COLOUR = 0xff2a3a;
const FLASH_TIME = 0.07; // s

export class Sniper {
  private readonly scene: Phaser.Scene;
  private readonly def: SniperDef;
  private readonly player: Player;
  private readonly zombies: Zombie[];
  private readonly covers: Phaser.Geom.Rectangle[];
  private readonly solidAt: (x: number, y: number) => boolean;
  private readonly onCoverHit: (x: number, y: number) => void; // a bullet hit cover (crates break)
  private doubleShot = false; // the mad sniper's second shot is coming
  private readonly gfx: Phaser.GameObjects.Graphics;
  private muzzleX: number;
  private muzzleY: number;
  active = true; // mounted: off until the helicopter arrives, off once you are out of reach
  private state = State.Idle;
  private timer = 0;
  private laserX: number; // where he is pointing (px)
  private laserY: number;
  private goalX: number; // rifle idle: next point to wander to / gunner: sweep end
  private goalY: number;
  private sweepDir = -1;
  private spotted = 0; // mounted gunner: s you have been exposed in his ground
  private target: Zombie | null = null; // gunner: the infected he is cutting down (null = the player)
  private burst = 0;
  private flash = 0; // s left of the muzzle / impact flash
  private impactX = 0;
  private impactY = 0;
  private hits = new Map<Zombie, number>(); // gunner: s of fire each infected has taken

  constructor(scene: Phaser.Scene, def: SniperDef, player: Player, zombies: Zombie[], covers: Phaser.Geom.Rectangle[],
    solidAt: (x: number, y: number) => boolean, onCoverHit: (x: number, y: number) => void) {
    this.scene = scene;
    // A copy: a mounted gunner's zone moves every frame, the level's data must not.
    this.def = { ...def, zones: def.zones.map(z => ({ ...z })) };
    this.player = player;
    this.zombies = zombies;
    this.covers = covers;
    this.solidAt = solidAt;
    this.onCoverHit = onCoverHit;
    const feetX = (def.tile[0] + 0.5) * TILE;
    const feetY = (def.tile[1] + 1) * TILE;
    const gunner = def.kind === SniperKind.Gunner;
    if (!def.mounted) scene.add.image(feetX, feetY, gunner ? 'gunner_nest' : 'sniper_nest').setOrigin(0.5, 1).setScale(ART_SCALE).setFlipX(true).setDepth(6);
    this.muzzleX = feetX + (gunner ? -54 : -60); // barrel tip of the (flipped) nest sprite
    this.muzzleY = feetY - 54;
    const z = def.zones[0];
    this.laserX = (z.x0 + z.x1) * 0.5 * TILE;
    this.laserY = z.y1 * TILE;
    this.goalX = this.laserX;
    this.goalY = this.laserY;
    this.gfx = scene.add.graphics().setDepth(30);
  }

  /** Mounted: where the barrel is now (px). */
  setMuzzle(x: number, y: number): void {
    this.muzzleX = x;
    this.muzzleY = y;
  }

  /** Rifle: as if he had just fired (the laser follows, the shot waits `seconds`). */
  holdFire(seconds: number): void {
    this.state = State.Reload;
    this.timer = seconds;
  }

  /** Gunner: cutting down an infected right now. */
  get busyWithInfected(): boolean {
    return this.state === State.Firing && this.target !== null;
  }

  /** Mounted: the laser dot starts here (px), not where the level's zone would put it. */
  setLaser(x: number, y: number): void {
    this.laserX = x;
    this.laserY = y;
    this.goalX = x;
    this.goalY = y;
  }

  /** Mounted gunner: the ground he covers now (tiles). */
  setZone(x0: number, y0: number, x1: number, y1: number): void {
    const z = this.def.zones[0];
    z.x0 = x0;
    z.y0 = y0;
    z.x1 = x1;
    z.y1 = y1;
  }

  /** Gameplay, at the physics rate. */
  fixedUpdate(dt: number): void {
    this.flash = Math.max(0, this.flash - dt);
    if (!this.active) { // switched off: no aiming, no firing, the laser goes dark
      if (this.state !== State.Idle) this.state = State.Reload;
      this.timer = Math.max(this.timer, 0.5);
      if (this.player.pinned && !this.player.dead) this.player.pinned = false;
      return;
    }
    if (this.def.kind === SniperKind.Rifle) this.rifle(dt);
    else this.gunner(dt);
  }

  // ---------------------------------------------------------------- rifle

  private rifle(dt: number): void {
    const p = this.player;
    // invisible (cheat) or in a blind spot (right under his nest): he can't find you
    const inArea = !p.dead && !p.invisible && this.playerInArea() && !this.inBlindSpot();
    switch (this.state) {
      case State.Idle:
        this.wander(dt);
        if (inArea) this.startAim(); // step into his area and he has you
        break;
      case State.Aim: {
        if (!inArea) { // got out (under the tower, past it): back to wandering
          this.state = State.Idle;
          this.pickGoal();
          break;
        }
        const tx = p.body.center.x;
        const ty = this.headY();
        this.track(dt, tx, ty, CHASE_SPEED);
        if (Phaser.Math.Distance.Between(this.laserX, this.laserY, tx, ty) < LOCK_RADIUS * TILE) this.timer -= dt;
        if (this.timer <= 0) this.fireRifle();
        break;
      }
      case State.Reload:
        if (!p.dead) this.track(dt, p.body.center.x, this.headY(), RELOAD_CHASE);
        this.timer -= dt;
        if (this.timer <= 0) {
          if (inArea) this.startAim(); // once he has you, he keeps going
          else this.state = State.Idle;
        }
        break;
    }
  }

  private startAim(): void {
    this.state = State.Aim;
    this.timer = AIM_TIME;
  }

  private fireRifle(): void {
    const p = this.player;
    const hit = this.ray(this.muzzleX, this.muzzleY, p.body.center.x, this.headY());
    if (!hit.blocked && p.hidden && !p.invisible) { // crouched behind cover, seen from above: the round takes the cover
      const c = this.coverOver(p.body.center.x, p.body.bottom - 1);
      if (c) {
        hit.x = Phaser.Math.Clamp(p.body.center.x, c.x, c.right);
        hit.y = c.y + 4;
        hit.blocked = true;
      }
    }
    this.shotEffects(hit.x, hit.y, 0.008, 180);
    rifleShot(this.scene);
    if (hit.blocked && this.inCover(hit.x, hit.y)) this.onCoverHit(hit.x, hit.y);
    if (!hit.blocked && !p.dead) p.kill(); // in the open: one shot
    if (this.def.mad && !this.doubleShot && Math.random() < MAD_DOUBLE_CHANCE) { // a second shot, right away
      this.doubleShot = true;
      this.state = State.Aim;
      this.timer = MAD_DOUBLE_DELAY;
      return;
    }
    this.doubleShot = false;
    this.state = State.Reload;
    this.timer = this.def.mad ? MAD_RELOAD_MIN + Math.random() * (MAD_RELOAD_MAX - MAD_RELOAD_MIN) : RELOAD_TIME;
    boltAction(this.scene, this.def.mad ? 0.25 : this.timer * 0.35); // you hear him reload: your window
  }

  /** Idle laser: glide to a random point of a weighted zone, rest, pick another. */
  private wander(dt: number): void {
    if (this.track(dt, this.goalX, this.goalY, SWEEP_SPEED)) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.pickGoal();
        this.timer = DWELL_MIN + Math.random() * (DWELL_MAX - DWELL_MIN);
      }
    }
  }

  private pickGoal(): void {
    const zones = this.def.zones;
    let total = 0;
    for (let i = 0; i < zones.length; i++) total += zones[i].weight;
    let r = Math.random() * total;
    let z = zones[0];
    for (let i = 0; i < zones.length; i++) {
      r -= zones[i].weight;
      if (r <= 0) {
        z = zones[i];
        break;
      }
    }
    this.goalX = (z.x0 + Math.random() * (z.x1 - z.x0)) * TILE;
    this.goalY = (z.y0 + Math.random() * (z.y1 - z.y0)) * TILE;
  }

  // ---------------------------------------------------------------- gunner

  private gunner(dt: number): void {
    const zone = this.def.zones[0];
    const p = this.player;
    if (this.state === State.Firing) {
      const t = this.target;
      // A zombie can stumble out of his ground; you can't: once he is on you, you are pinned until you fall.
      const still = t ? t.alive && this.inZone(t.body.center.x, t.body.center.y) && this.exposed(t.body.center.x, t.body.center.y)
        : !p.dead && (!this.def.mounted || this.exposed(p.body.center.x, this.headY())); // the helicopter's: smoke breaks his aim
      if (!still && !t && !p.dead) p.pinned = false;
      if (!still) {
        this.state = State.Idle;
        this.target = null;
        return;
      }
      const tx = t ? t.body.center.x : p.body.center.x;
      const ty = t ? t.body.center.y : this.headY();
      this.track(dt, tx, ty, 40);
      this.timer += dt;
      this.burst -= dt;
      if (this.burst <= 0) {
        this.burst = GUNNER_BURST;
        this.shotEffects(tx + (Math.random() - 0.5) * 20, ty + (Math.random() - 0.5) * 30, 0.003, 70);
        gunBurst(this.scene);
      }
      if (t) {
        t.suppress(); // pinned down: it can't move, hear or grab while he shoots it
        const took = (this.hits.get(t) ?? 0) + dt;
        this.hits.set(t, took);
        if (took >= (this.def.mounted ? MOUNTED_KILL_TIME : GUNNER_KILL_TIME)) {
          t.shot();
          this.state = State.Idle;
          this.target = null;
        }
      } else if (this.timer >= GUNNER_PLAYER_TIME) {
        p.pinned = false;
        p.kill();
        this.state = State.Idle;
      }
      return;
    }

    // Sweep back and forth across the watched ground.
    const y = (zone.y0 + zone.y1) * 0.5 * TILE;
    const goal = (this.sweepDir < 0 ? zone.x0 : zone.x1) * TILE;
    if (this.track(dt, goal, y, GUNNER_SWEEP)) this.sweepDir = -this.sweepDir;

    // Anything exposed in his ground: infected first (they are what he sees moving), then you.
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      if (!z.alive) continue;
      const cx = z.body.center.x;
      const cy = z.body.center.y;
      if (this.inZone(cx, cy) && this.exposed(cx, cy)) {
        this.startFiring(z);
        return;
      }
    }
    // you: only out of hiding (crouched behind cover he can't tell you from the crates, even from above)
    const seen = !p.dead && !p.invisible && !p.hidden && this.inZone(p.body.center.x, p.body.center.y) && this.exposed(p.body.center.x, this.headY());
    this.spotted = seen ? this.spotted + dt : 0;
    if (seen && (!this.def.mounted || this.spotted >= MOUNTED_SPOT_TIME)) {
      this.spotted = 0;
      this.startFiring(null);
    }
  }

  private startFiring(target: Zombie | null): void {
    if (!target) this.player.pinned = true; // caught in the open: frozen under the fire
    this.state = State.Firing;
    this.target = target;
    this.timer = 0;
    this.burst = 0;
  }

  private inZone(x: number, y: number): boolean {
    const z = this.def.zones[0];
    return x > z.x0 * TILE && x < z.x1 * TILE && y > z.y0 * TILE && y < z.y1 * TILE;
  }

  // ---------------------------------------------------------------- shared

  /**
   * Soldiers aim at your head. A big crate (~1.6 tiles) hides you only crouched (1.15 tall); standing
   * (1.8) your head shows over it.
   */
  private headY(): number {
    return this.player.body.top + HEAD_INSET * TILE;
  }

  /** The player is somewhere he can't see: right under his nest, he can't lean out that far. */
  private inBlindSpot(): boolean {
    const spots = this.def.blind;
    if (!spots) return false;
    const x = this.player.body.center.x / TILE;
    const y = this.player.body.center.y / TILE;
    for (let i = 0; i < spots.length; i++) {
      const b = spots[i];
      if (x > b[0] && x < b[2] && y > b[1] && y < b[3]) return true;
    }
    return false;
  }

  private playerInArea(): boolean {
    const x = this.player.feetX;
    return x > this.def.area[0] * TILE && x < this.def.area[1] * TILE;
  }

  private exposed(x: number, y: number): boolean {
    return !this.ray(this.muzzleX, this.muzzleY, x, y).blocked;
  }

  /** Move the laser toward (x, y) at `speed` tiles/s. True when it got there. */
  private track(dt: number, x: number, y: number, speed: number): boolean {
    const dx = x - this.laserX;
    const dy = y - this.laserY;
    const d = Math.hypot(dx, dy);
    const step = speed * TILE * dt;
    if (d <= step) {
      this.laserX = x;
      this.laserY = y;
      return true;
    }
    this.laserX += (dx / d) * step;
    this.laserY += (dy / d) * step;
    return false;
  }

  /**
   * March from (x0, y0) toward (x1, y1): the first solid tile or cover crate in the way.
   * blocked = something stopped it before the end point.
   */
  private ray(x0: number, y0: number, x1: number, y1: number): { x: number; y: number; blocked: boolean } {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(len / RAY_STEP));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      if (this.solidAt(x, y) || this.inCover(x, y)) return { x: x, y: y, blocked: i < n };
    }
    return { x: x1, y: y1, blocked: false };
  }

  /** The cover rectangle a crouched player at (x, feetY) is hiding behind, if any. */
  private coverOver(x: number, feetY: number): Phaser.Geom.Rectangle | null {
    const halfW = this.player.body.width * 0.5;
    for (let i = 0; i < this.covers.length; i++) {
      const c = this.covers[i];
      if (x + halfW > c.x && x - halfW < c.right && feetY > c.y && feetY - TILE < c.bottom) return c;
    }
    return null;
  }

  private inCover(x: number, y: number): boolean {
    for (let i = 0; i < this.covers.length; i++) if (this.covers[i].contains(x, y)) return true;
    return false;
  }

  /** Where the laser beam stops: it continues past the aim point until something solid takes it. */
  private laserEnd(): { x: number; y: number } {
    const dx = this.laserX - this.muzzleX;
    const dy = this.laserY - this.muzzleY;
    const d = Math.hypot(dx, dy) || 1;
    const far = 80 * TILE;
    return this.ray(this.muzzleX, this.muzzleY, this.muzzleX + (dx / d) * far, this.muzzleY + (dy / d) * far);
  }

  private shotEffects(x: number, y: number, shake: number, shakeMs: number): void {
    this.flash = FLASH_TIME;
    this.impactX = x;
    this.impactY = y;
    this.scene.cameras.main.shake(shakeMs, shake);
  }

  /** Visuals, once per rendered frame. */
  update(timeMs: number): void {
    const g = this.gfx;
    g.clear();
    if (!this.active && this.flash <= 0) return;
    if (this.flash > 0) { // muzzle and impact flashes
      g.fillStyle(0xfff2c0, 0.95).fillCircle(this.muzzleX, this.muzzleY, 16);
      g.fillStyle(0xffffff, 0.9).fillCircle(this.impactX, this.impactY, 12);
      g.fillStyle(0xffd060, 0.45).fillCircle(this.impactX, this.impactY, 28);
    }
    const reloading = this.state === State.Reload;
    const hot = this.state === State.Aim || this.state === State.Firing;
    // Wandering: the beam runs on until something solid takes it. Locked on: it stops on the target
    // (the dot sits on you), or on the cover in front of you.
    const end = hot || reloading ? this.ray(this.muzzleX, this.muzzleY, this.laserX, this.laserY) : this.laserEnd();
    const pulse = reloading ? 0.35 : hot ? 0.75 + Math.sin(timeMs / 45) * 0.25 : 1; // reloading: dim, still on you
    g.lineStyle(hot ? 10 : 7, LASER_COLOUR, 0.12 * pulse).lineBetween(this.muzzleX, this.muzzleY, end.x, end.y);
    g.lineStyle(hot ? 4 : 3, LASER_COLOUR, 0.35 * pulse).lineBetween(this.muzzleX, this.muzzleY, end.x, end.y);
    g.lineStyle(hot ? 2 : 1.5, 0xff7080, 0.95).lineBetween(this.muzzleX, this.muzzleY, end.x, end.y);
    g.fillStyle(LASER_COLOUR, 0.35).fillCircle(end.x, end.y, hot ? 12 : 9);
    g.fillStyle(0xffb0b8, 1).fillCircle(end.x, end.y, hot ? 4 : 3);
  }
}
