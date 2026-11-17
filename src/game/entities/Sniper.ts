import { MathUtil, Rect, Vec2, type Engine, type Shape } from '../../engine';
import { ART_SCALE, TILE } from '../constants';
import { BoltAction, GunBurst, RifleShot } from '../Assets';
import type { Player } from './Player';
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
 *    only honest signal. Bullets that hit cover call onCoverHit (the level breaks wooden crates).
 * Machine gunner ("no mercy"):
 *  - Watches one stretch of ground and opens fire on ANYTHING exposed in it. On you: you are pinned
 *    where you stand (Player.pinned) while he empties GUNNER_PLAYER_TIME of fire into you; no escape. A
 *    zombie takes him GUNNER_KILL_TIME to cut down, pinned down meanwhile (it can't move or grab: run
 *    right past it). Lure an infected into his ground and run while he is busy with it.
 * Shots are flashes, a camera shake, the laser line and recorded gunshots; no bullets in flight.
 * Debug ("show hitboxes"): his area, the gunner's ground, and the line of fire as a ray.
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
  mounted?: boolean; // on a helicopter: no nest sprite; the owner moves him (SetMuzzle / SetZone / active)
}

enum State {
  Idle, // rifle: wandering laser / gunner: sweeping
  Aim, // rifle: chasing you, fires once the dot has been on you for AIM_TIME
  Reload, // rifle: laser dim, still following you
  Firing, // gunner: bursts at a target
}

/** A shot's path: where it stopped, and whether something stopped it before its end point. */
interface RayResult {
  point: Vec2;
  blocked: boolean;
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
  active = true; // mounted: off until the helicopter arrives, off once you are out of reach

  private readonly engine: Engine;
  private readonly def: SniperDef;
  private readonly player: Player;
  private readonly zombies: Zombie[];
  private readonly covers: Rect[];
  private readonly solidAt: (x: number, y: number) => boolean;
  private readonly onCoverHit: (x: number, y: number) => void; // a bullet hit cover (crates break)
  private doubleShot = false; // the mad sniper's second shot is coming
  private readonly gfx: Shape;
  private readonly muzzle: Vec2;
  private state = State.Idle;
  private timer = 0;
  private readonly laser: Vec2; // where he is pointing (px)
  private readonly goal: Vec2; // rifle idle: next point to wander to / gunner: sweep end
  private sweepDir = -1;
  private spotted = 0; // mounted gunner: s you have been exposed in his ground
  private target: Zombie | null = null; // gunner: the infected he is cutting down (null = the player)
  private burst = 0;
  private flash = 0; // s left of the muzzle / impact flash
  private readonly impact = new Vec2();
  private readonly hits = new Map<Zombie, number>(); // gunner: s of fire each infected has taken

  constructor(engine: Engine, def: SniperDef, player: Player, zombies: Zombie[], covers: Rect[],
    solidAt: (x: number, y: number) => boolean, onCoverHit: (x: number, y: number) => void) {
    this.engine = engine;
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
    if (!def.mounted) {
      engine.renderer.CreateSprite(feetX, feetY, gunner ? 'gunner_nest' : 'sniper_nest').SetOrigin(0.5, 1).SetScale(ART_SCALE).SetFlipX(true).SetDepth(6);
    }
    this.muzzle = new Vec2(feetX + (gunner ? -54 : -60), feetY - 54); // barrel tip of the (flipped) nest sprite
    const z = def.zones[0];
    this.laser = new Vec2((z.x0 + z.x1) * 0.5 * TILE, z.y1 * TILE);
    this.goal = this.laser.Clone();
    this.gfx = engine.renderer.CreateShape().SetDepth(30);
  }

  /** Mounted: where the barrel is now (px). */
  SetMuzzle(x: number, y: number): void {
    this.muzzle.Set(x, y);
  }

  /** Rifle: as if he had just fired (the laser follows, the shot waits `seconds`). */
  HoldFire(seconds: number): void {
    this.state = State.Reload;
    this.timer = seconds;
  }

  /** Gunner: cutting down an infected right now. */
  get busyWithInfected(): boolean {
    return this.state === State.Firing && this.target !== null;
  }

  /** Mounted: the laser dot starts here (px), not where the level's zone would put it. */
  SetLaser(x: number, y: number): void {
    this.laser.Set(x, y);
    this.goal.Set(x, y);
  }

  /** Mounted gunner: the ground he covers now (tiles). */
  SetZone(x0: number, y0: number, x1: number, y1: number): void {
    const z = this.def.zones[0];
    z.x0 = x0;
    z.y0 = y0;
    z.x1 = x1;
    z.y1 = y1;
  }

  /** Gameplay, at the physics rate. */
  FixedUpdate(dt: number): void {
    this.flash = Math.max(0, this.flash - dt);
    if (!this.active) { // switched off: no aiming, no firing, the laser goes dark
      if (this.state !== State.Idle) this.state = State.Reload;
      this.timer = Math.max(this.timer, 0.5);
      if (this.player.pinned && !this.player.dead) this.player.pinned = false;
      return;
    }
    if (this.def.kind === SniperKind.Rifle) this.Rifle(dt);
    else this.Gunner(dt);
  }

  // ---------------------------------------------------------------- rifle

  private Rifle(dt: number): void {
    const p = this.player;
    // invisible (cheat) or in a blind spot (right under his nest): he can't find you
    const inArea = !p.dead && !p.invisible && this.PlayerInArea() && !this.InBlindSpot();
    switch (this.state) {
      case State.Idle:
        this.Wander(dt);
        if (inArea) this.StartAim(); // step into his area and he has you
        break;
      case State.Aim: {
        if (!inArea) { // got out (under the tower, past it): back to wandering
          this.state = State.Idle;
          this.PickGoal();
          break;
        }
        const aim = this.AimPoint();
        this.Track(dt, aim, CHASE_SPEED);
        if (this.laser.DistanceTo(aim) < LOCK_RADIUS * TILE) this.timer -= dt;
        if (this.timer <= 0) this.FireRifle();
        break;
      }
      case State.Reload:
        if (!p.dead) this.Track(dt, this.AimPoint(), RELOAD_CHASE);
        this.timer -= dt;
        if (this.timer <= 0) {
          if (inArea) this.StartAim(); // once he has you, he keeps going
          else this.state = State.Idle;
        }
        break;
    }
  }

  private StartAim(): void {
    this.state = State.Aim;
    this.timer = AIM_TIME;
  }

  private FireRifle(): void {
    const p = this.player;
    const hit = this.Ray(this.muzzle, this.AimPoint());
    if (!hit.blocked && p.hidden && !p.invisible) { // crouched behind cover, seen from above: the round takes the cover
      const c = this.CoverOver(p.body.centerX, p.body.bottom - 1);
      if (c) {
        hit.point.Set(MathUtil.Clamp(p.body.centerX, c.x, c.right), c.y + 4);
        hit.blocked = true;
      }
    }
    this.ShotEffects(hit.point, 0.008, 0.18);
    RifleShot(this.engine);
    if (hit.blocked && this.InCover(hit.point)) this.onCoverHit(hit.point.x, hit.point.y);
    if (!hit.blocked && !p.dead) p.Kill(); // in the open: one shot
    if (this.def.mad && !this.doubleShot && Math.random() < MAD_DOUBLE_CHANCE) { // a second shot, right away
      this.doubleShot = true;
      this.state = State.Aim;
      this.timer = MAD_DOUBLE_DELAY;
      return;
    }
    this.doubleShot = false;
    this.state = State.Reload;
    this.timer = this.def.mad ? MathUtil.RandomRange(MAD_RELOAD_MIN, MAD_RELOAD_MAX) : RELOAD_TIME;
    BoltAction(this.engine, this.def.mad ? 0.25 : this.timer * 0.35); // you hear him reload: your window
  }

  /** Idle laser: glide to a random point of a weighted zone, rest, pick another. */
  private Wander(dt: number): void {
    if (this.Track(dt, this.goal, SWEEP_SPEED)) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.PickGoal();
        this.timer = MathUtil.RandomRange(DWELL_MIN, DWELL_MAX);
      }
    }
  }

  /** A random point in one of the zones; a zone with twice the weight is picked twice as often. */
  private PickGoal(): void {
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
    this.goal.Set(MathUtil.RandomRange(z.x0, z.x1) * TILE, MathUtil.RandomRange(z.y0, z.y1) * TILE);
  }

  // ---------------------------------------------------------------- gunner

  private Gunner(dt: number): void {
    const zone = this.def.zones[0];
    const p = this.player;
    if (this.state === State.Firing) {
      const t = this.target;
      // A zombie can stumble out of his ground; you can't: once he is on you, you are pinned until you fall.
      const still = t ? t.alive && this.InZone(t.body.Center()) && this.Exposed(t.body.Center())
        : !p.dead && (!this.def.mounted || this.Exposed(this.AimPoint())); // the helicopter's: smoke breaks his aim
      if (!still && !t && !p.dead) p.pinned = false;
      if (!still) {
        this.state = State.Idle;
        this.target = null;
        return;
      }
      const aim = t ? t.body.Center() : this.AimPoint();
      this.Track(dt, aim, 40);
      this.timer += dt;
      this.burst -= dt;
      if (this.burst <= 0) {
        this.burst = GUNNER_BURST;
        this.ShotEffects(new Vec2(aim.x + (Math.random() - 0.5) * 20, aim.y + (Math.random() - 0.5) * 30), 0.003, 0.07);
        GunBurst(this.engine);
      }
      if (t) {
        t.Suppress(); // pinned down: it can't move, hear or grab while he shoots it
        const took = (this.hits.get(t) ?? 0) + dt;
        this.hits.set(t, took);
        if (took >= (this.def.mounted ? MOUNTED_KILL_TIME : GUNNER_KILL_TIME)) {
          t.Shot();
          this.state = State.Idle;
          this.target = null;
        }
      } else if (this.timer >= GUNNER_PLAYER_TIME) {
        p.pinned = false;
        p.Kill();
        this.state = State.Idle;
      }
      return;
    }

    // Sweep back and forth across the watched ground.
    const sweepTo = new Vec2((this.sweepDir < 0 ? zone.x0 : zone.x1) * TILE, (zone.y0 + zone.y1) * 0.5 * TILE);
    if (this.Track(dt, sweepTo, GUNNER_SWEEP)) this.sweepDir = -this.sweepDir;

    // Anything exposed in his ground: infected first (they are what he sees moving), then you.
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      if (!z.alive) continue;
      const c = z.body.Center();
      if (this.InZone(c) && this.Exposed(c)) {
        this.StartFiring(z);
        return;
      }
    }
    // you: only out of hiding (crouched behind cover he can't tell you from the crates, even from above)
    const seen = !p.dead && !p.invisible && !p.hidden && this.InZone(p.body.Center()) && this.Exposed(this.AimPoint());
    this.spotted = seen ? this.spotted + dt : 0;
    if (seen && (!this.def.mounted || this.spotted >= MOUNTED_SPOT_TIME)) {
      this.spotted = 0;
      this.StartFiring(null);
    }
  }

  private StartFiring(target: Zombie | null): void {
    if (!target) this.player.pinned = true; // caught in the open: frozen under the fire
    this.state = State.Firing;
    this.target = target;
    this.timer = 0;
    this.burst = 0;
  }

  /** The watched ground in px. */
  private ZoneRect(): Rect {
    const z = this.def.zones[0];
    return new Rect(z.x0 * TILE, z.y0 * TILE, (z.x1 - z.x0) * TILE, (z.y1 - z.y0) * TILE);
  }

  private InZone(p: Vec2): boolean {
    const r = this.ZoneRect();
    return p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom;
  }

  // ---------------------------------------------------------------- shared

  /**
   * Soldiers aim at your head. A big crate (~1.6 tiles) hides you only crouched (1.15 tall); standing
   * (1.8) your head shows over it.
   */
  private AimPoint(): Vec2 {
    return new Vec2(this.player.body.centerX, this.player.body.top + HEAD_INSET * TILE);
  }

  /** The player is somewhere he can't see: right under his nest, he can't lean out that far. */
  private InBlindSpot(): boolean {
    const spots = this.def.blind;
    if (!spots) return false;
    const x = this.player.body.centerX / TILE;
    const y = this.player.body.centerY / TILE;
    for (let i = 0; i < spots.length; i++) {
      const b = spots[i];
      if (x > b[0] && x < b[2] && y > b[1] && y < b[3]) return true;
    }
    return false;
  }

  private PlayerInArea(): boolean {
    const x = this.player.feetX;
    return x > this.def.area[0] * TILE && x < this.def.area[1] * TILE;
  }

  private Exposed(p: Vec2): boolean {
    return !this.Ray(this.muzzle, p).blocked;
  }

  /** Move the laser toward `target` at `speed` tiles/s. True when it got there. */
  private Track(dt: number, target: Vec2, speed: number): boolean {
    this.laser.Copy(Vec2.MoveTowards(this.laser, target, speed * TILE * dt));
    return this.laser.DistanceTo(target) === 0;
  }

  /**
   * March from `from` toward `to` in RAY_STEP px steps: the first solid tile or cover in the way.
   * blocked = something stopped it before the end point.
   */
  private Ray(from: Vec2, to: Vec2): RayResult {
    const len = from.DistanceTo(to);
    const n = Math.max(1, Math.ceil(len / RAY_STEP));
    for (let i = 1; i <= n; i++) {
      const p = Vec2.Lerp(from, to, i / n);
      if (this.solidAt(p.x, p.y) || this.InCover(p)) return { point: p, blocked: i < n };
    }
    return { point: to.Clone(), blocked: false };
  }

  /** The cover rectangle a crouched player at (x, feetY) is hiding behind, if any. */
  private CoverOver(x: number, feetY: number): Rect | null {
    const halfW = this.player.body.width * 0.5;
    for (let i = 0; i < this.covers.length; i++) {
      const c = this.covers[i];
      if (x + halfW > c.x && x - halfW < c.right && feetY > c.y && feetY - TILE < c.bottom) return c;
    }
    return null;
  }

  private InCover(p: Vec2): boolean {
    for (let i = 0; i < this.covers.length; i++) if (this.covers[i].ContainsPoint(p)) return true;
    return false;
  }

  /** Where the laser beam stops: it continues past the aim point until something solid takes it. */
  private LaserEnd(): Vec2 {
    const dir = this.laser.Sub(this.muzzle).Normalized();
    if (dir.LengthSq() === 0) return this.laser.Clone();
    return this.Ray(this.muzzle, this.muzzle.Add(dir.Scale(80 * TILE))).point;
  }

  private ShotEffects(at: Vec2, shake: number, shakeSeconds: number): void {
    this.flash = FLASH_TIME;
    this.impact.Copy(at);
    this.engine.camera.Shake(shakeSeconds, shake);
  }

  /** Visuals, once per rendered frame. */
  Update(timeMs: number): void {
    const g = this.gfx;
    g.Clear();
    this.DrawDebug();
    if (!this.active && this.flash <= 0) return;
    const m = this.muzzle;
    if (this.flash > 0) { // muzzle and impact flashes
      g.FillStyle(0xfff2c0, 0.95).FillCircle(m.x, m.y, 16);
      g.FillStyle(0xffffff, 0.9).FillCircle(this.impact.x, this.impact.y, 12);
      g.FillStyle(0xffd060, 0.45).FillCircle(this.impact.x, this.impact.y, 28);
    }
    const reloading = this.state === State.Reload;
    const hot = this.state === State.Aim || this.state === State.Firing;
    // Wandering: the beam runs on until something solid takes it. Locked on: it stops on the target
    // (the dot sits on you), or on the cover in front of you.
    const end = hot || reloading ? this.Ray(m, this.laser).point : this.LaserEnd();
    const pulse = reloading ? 0.35 : hot ? 0.75 + Math.sin(timeMs / 45) * 0.25 : 1; // reloading: dim, still on you
    g.LineStyle(hot ? 10 : 7, LASER_COLOUR, 0.12 * pulse).Line(m.x, m.y, end.x, end.y);
    g.LineStyle(hot ? 4 : 3, LASER_COLOUR, 0.35 * pulse).Line(m.x, m.y, end.x, end.y);
    g.LineStyle(hot ? 2 : 1.5, 0xff7080, 0.95).Line(m.x, m.y, end.x, end.y);
    g.FillStyle(LASER_COLOUR, 0.35).FillCircle(end.x, end.y, hot ? 12 : 9);
    g.FillStyle(0xffb0b8, 1).FillCircle(end.x, end.y, hot ? 4 : 3);
  }

  /** With "show hitboxes" on: the rifle's area / the gunner's ground, and his line of fire to the player. */
  private DrawDebug(): void {
    if (!this.engine.physics.drawBodies) return;
    const d = this.engine.debug;
    if (this.def.kind === SniperKind.Gunner) d.Box(this.ZoneRect(), 0xff9a40, false, 0.8);
    else d.Box(new Rect(this.def.area[0] * TILE, 0, (this.def.area[1] - this.def.area[0]) * TILE, 40 * TILE), 0xff5a5a, false, 0.4);
    if (!this.active || this.player.dead) return;
    const aim = this.AimPoint();
    const shot = this.Ray(this.muzzle, aim);
    d.Ray(this.muzzle, aim.Sub(this.muzzle), this.muzzle.DistanceTo(shot.point), shot.blocked ? 0xffaa33 : 0xff3030);
  }
}
