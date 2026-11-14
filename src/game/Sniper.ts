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
 *    A crate between you and him takes the bullet. Run during the reload, crate to crate.
 * Machine gunner ("no mercy"):
 *  - Watches one stretch of ground and opens fire on ANYTHING exposed in it: you die in a blink, a
 *    zombie takes him GUNNER_KILL_TIME to cut down, pinned down meanwhile (it can't move or grab: run
 *    right past it). Lure an infected into his ground and run while he is busy with it.
 * Shots are flashes, a camera shake, the laser line and synthesised sound (Sfx.ts); no bullets in flight.
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
const RELOAD_TIME = 1.4; // s after a shot: your window
const GUNNER_SWEEP = 5; // tiles/s
const GUNNER_BURST = 0.09; // s between machine-gun shots
const GUNNER_REACTION = 0.15; // s before the first burst hits you
const GUNNER_KILL_TIME = 2.2; // s of fire to cut down a zombie (the player's window)
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
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly muzzleX: number;
  private readonly muzzleY: number;
  private state = State.Idle;
  private timer = 0;
  private laserX: number; // where he is pointing (px)
  private laserY: number;
  private goalX: number; // rifle idle: next point to wander to / gunner: sweep end
  private goalY: number;
  private sweepDir = -1;
  private target: Zombie | null = null; // gunner: the infected he is cutting down (null = the player)
  private burst = 0;
  private flash = 0; // s left of the muzzle / impact flash
  private impactX = 0;
  private impactY = 0;
  private hits = new Map<Zombie, number>(); // gunner: s of fire each infected has taken

  constructor(scene: Phaser.Scene, def: SniperDef, player: Player, zombies: Zombie[], covers: Phaser.Geom.Rectangle[],
    solidAt: (x: number, y: number) => boolean) {
    this.scene = scene;
    this.def = def;
    this.player = player;
    this.zombies = zombies;
    this.covers = covers;
    this.solidAt = solidAt;
    const feetX = (def.tile[0] + 0.5) * TILE;
    const feetY = (def.tile[1] + 1) * TILE;
    const gunner = def.kind === SniperKind.Gunner;
    scene.add.image(feetX, feetY, gunner ? 'gunner_nest' : 'sniper_nest').setOrigin(0.5, 1).setScale(ART_SCALE).setFlipX(true).setDepth(6);
    this.muzzleX = feetX + (gunner ? -54 : -60); // barrel tip of the (flipped) nest sprite
    this.muzzleY = feetY - 54;
    const z = def.zones[0];
    this.laserX = (z.x0 + z.x1) * 0.5 * TILE;
    this.laserY = z.y1 * TILE;
    this.goalX = this.laserX;
    this.goalY = this.laserY;
    this.gfx = scene.add.graphics().setDepth(30);
  }

  /** Gameplay, at the physics rate. */
  fixedUpdate(dt: number): void {
    this.flash = Math.max(0, this.flash - dt);
    if (this.def.kind === SniperKind.Rifle) this.rifle(dt);
    else this.gunner(dt);
  }

  // ---------------------------------------------------------------- rifle

  private rifle(dt: number): void {
    const p = this.player;
    const inArea = !p.dead && this.playerInArea();
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
        const ty = p.body.center.y;
        this.track(dt, tx, ty, CHASE_SPEED);
        if (Phaser.Math.Distance.Between(this.laserX, this.laserY, tx, ty) < LOCK_RADIUS * TILE) this.timer -= dt;
        if (this.timer <= 0) this.fireRifle();
        break;
      }
      case State.Reload:
        if (!p.dead) this.track(dt, p.body.center.x, p.body.center.y, RELOAD_CHASE);
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
    const hit = this.ray(this.muzzleX, this.muzzleY, p.body.center.x, p.body.center.y);
    this.shotEffects(hit.x, hit.y, 0.008, 180);
    rifleShot(this.scene);
    boltAction(this.scene, RELOAD_TIME * 0.35); // you hear him reload: your window
    if (!hit.blocked && !p.dead) p.kill(); // in the open: one shot
    this.state = State.Reload;
    this.timer = RELOAD_TIME;
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
      const still = t ? t.alive && this.inZone(t.body.center.x, t.body.center.y) && this.exposed(t.body.center.x, t.body.center.y)
        : !p.dead && this.inZone(p.body.center.x, p.body.center.y) && this.exposed(p.body.center.x, p.body.center.y);
      if (!still) {
        this.state = State.Idle;
        this.target = null;
        return;
      }
      const tx = t ? t.body.center.x : p.body.center.x;
      const ty = t ? t.body.center.y : p.body.center.y;
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
        if (took >= GUNNER_KILL_TIME) {
          t.shot();
          this.state = State.Idle;
          this.target = null;
        }
      } else if (this.timer >= GUNNER_REACTION) {
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
    if (!p.dead && this.inZone(p.body.center.x, p.body.center.y) && this.exposed(p.body.center.x, p.body.center.y)) this.startFiring(null);
  }

  private startFiring(target: Zombie | null): void {
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
