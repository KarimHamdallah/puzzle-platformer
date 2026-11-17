import { MathUtil, type Engine, type Rect, type Shape, type Sprite } from '../../engine';
import { ART_SCALE, TILE } from '../constants';
import type { Player } from './Player';
import { Sniper, SniperKind } from './Sniper';
import type { Zombie } from './Zombie';

/**
 * Mechanic 2 Hard: the escape. An army helicopter follows you along the valley, carrying the two
 * weapons you know: the mad sniper in its side door and a gun under its nose.
 *  - It follows your x at FOLLOW_SPEED (slower than your sprint): run crate to crate and you pull
 *    ahead; every stop in cover lets it close in. Far behind (CATCH_UP_GAP), it speeds up.
 *  - The door gun covers the ground under and just ahead of it (GUN_BACK..GUN_AHEAD tiles): if it gets
 *    over you, step out of cover and you are pinned and dead. Infected under it draw its fire, and
 *    while the gunner cuts one down the pilot holds the helicopter still: lure a Clicker back to it.
 *  - The sniper hunts you the whole time (random reload, double shots): crouch behind cover.
 *  - Past `safeX` (the tunnel) it can't follow: both weapons stop.
 */

export interface HeliDef {
  y: number; // tile row it flies at
  safeX: number; // tile x: past this (the tunnel) you are out of its reach
}

const FOLLOW_SPEED = 2.6; // tiles/s (you sprint at 8.5): each crate stop (~2.5 s) lets it gain a little
const CATCH_UP_SPEED = 6;
const CATCH_UP_GAP = 18; // tiles behind you before it hurries
const START_BEHIND = 14; // tiles behind the player when the level (or a checkpoint) starts
const START_GRACE = 2; // s before the first rifle shot
const GUN_BACK = 1.5; // tiles behind its centre the door gun still covers
const GUN_AHEAD = 3; // tiles ahead of its centre
const SNIPER_DOOR_X = 8; // px from the sprite centre (scaled) to the sniper's barrel
const SNIPER_DOOR_Y = -6;
const GUN_X = 88; // px to the door gun's muzzle
const GUN_Y = 36;

export class Helicopter {
  readonly sniper: Sniper;
  readonly gunner: Sniper;

  private readonly player: Player;
  private readonly def: HeliDef;
  private readonly sprite: Sprite;
  private readonly rotor: Shape;
  private x: number; // px, centre
  private readonly y: number;
  private vx = 0;
  private active = false; // waits for Start()

  constructor(engine: Engine, def: HeliDef, player: Player, zombies: Zombie[], covers: Rect[],
    solidAt: (x: number, y: number) => boolean, onCoverHit: (x: number, y: number) => void) {
    this.player = player;
    this.def = def;
    this.x = player.feetX - START_BEHIND * TILE;
    this.y = def.y * TILE;
    this.sprite = engine.renderer.CreateSprite(this.x, this.y, 'helicopter').SetScale(ART_SCALE).SetDepth(29);
    this.rotor = engine.renderer.CreateShape().SetDepth(29);
    const whole: [number, number] = [0, 9999];
    this.sniper = new Sniper(engine, {
      kind: SniperKind.Rifle, tile: [0, 0], area: whole, mad: true, mounted: true,
      zones: [{ x0: 0, y0: 0, x1: 1, y1: 1, weight: 1 }],
    }, player, zombies, covers, solidAt, onCoverHit);
    this.gunner = new Sniper(engine, {
      kind: SniperKind.Gunner, tile: [0, 0], area: whole, mounted: true,
      zones: [{ x0: 0, y0: 0, x1: 1, y1: 1, weight: 1 }],
    }, player, zombies, covers, solidAt, onCoverHit);
    this.sniper.active = false;
    this.gunner.active = false;
    this.PlaceWeapons(0);
  }

  /** The chase begins (after the opening thoughts). */
  Start(): void {
    this.active = true;
    const ground = this.player.feetY - TILE; // both dots start on the ground under the helicopter
    this.sniper.SetLaser(this.x, ground);
    this.gunner.SetLaser(this.x, ground);
    this.sniper.HoldFire(START_GRACE); // a moment to get moving (level start, checkpoint)
  }

  /** At the physics rate: fly after the player, carry the weapons, then let them work. */
  FixedUpdate(dt: number, timeMs: number): void {
    const p = this.player;
    const safe = p.feetX > this.def.safeX * TILE;
    const hunting = this.active && !safe && !p.dead;
    if (hunting) {
      const gap = p.feetX - this.x;
      const speed = (Math.abs(gap) > CATCH_UP_GAP * TILE ? CATCH_UP_SPEED : FOLLOW_SPEED) * TILE;
      // the gunner is cutting down an infected: the pilot holds the helicopter steady for him
      const want = this.gunner.busyWithInfected ? 0 : MathUtil.Clamp(gap * 3, -speed, speed); // eases in over you
      this.vx += (want - this.vx) * Math.min(1, dt * 2.5);
      this.x += this.vx * dt;
    } else {
      this.vx *= 0.95;
      this.x += this.vx * dt;
    }
    this.sniper.active = hunting;
    this.gunner.active = hunting;
    this.PlaceWeapons(timeMs);
    this.sniper.FixedUpdate(dt);
    this.gunner.FixedUpdate(dt);
  }

  private PlaceWeapons(timeMs: number): void {
    const bob = Math.sin(timeMs / 420) * 6;
    this.sniper.SetMuzzle(this.x + SNIPER_DOOR_X, this.y + SNIPER_DOOR_Y + bob);
    this.gunner.SetMuzzle(this.x + GUN_X, this.y + GUN_Y + bob);
    const cx = this.x / TILE;
    this.gunner.SetZone(cx - GUN_BACK, this.def.y + 2, cx + GUN_AHEAD, 40);
  }

  /** Visuals, once per frame: body bob + tilt into the chase, a spinning rotor. */
  Update(timeMs: number): void {
    const bob = Math.sin(timeMs / 420) * 6;
    const tilt = MathUtil.Clamp(this.vx / (CATCH_UP_SPEED * TILE), -1, 1) * 0.08;
    this.sprite.SetPosition(this.x, this.y + bob).SetRotation(tilt);
    const g = this.rotor;
    g.Clear();
    const span = 120 + Math.abs(Math.sin(timeMs / 30)) * 80; // the blades blur in and out
    const top = this.y + bob - 40;
    g.FillStyle(0x2a2a2a, 0.85).FillRect(this.x + 2 - span, top, span * 2, 4);
    g.FillStyle(0x2a2a2a, 0.35).FillRect(this.x + 2 - span * 1.15, top + 1, span * 2.3, 2);
    this.sniper.Update(timeMs);
    this.gunner.Update(timeMs);
  }
}
