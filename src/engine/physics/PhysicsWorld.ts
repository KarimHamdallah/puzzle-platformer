import type { DebugDraw } from '../debug/DebugDraw';
import type { Rect } from '../math/Rect';
import { Vec2 } from '../math/Vec2';
import { Body, BodyType, type BodyDef } from './Body';

/** Where a ray first touched a static body. */
export interface RayHit {
  point: Vec2;
  fraction: number; // 0 = at `from`, 1 = at `to`
  body: Body;
}

const DEBUG_STATIC = 0x66ccff;
const DEBUG_DYNAMIC = 0x7cff7c;

/**
 * A small AABB physics world, used like Box2D:
 *    world.CreateBody({ type: BodyType.Dynamic, x, y, w, h });   body.SetVelocity(...);   world.Step(dt);
 *
 * Step(dt), for every dynamic body (moves, then collisions, one axis at a time):
 *   1. velocity += gravity * gravityScale * dt
 *   2. X: position.x += velocity.x * dt. If it now overlaps a static body, push it back out against the
 *      side it came from, zero velocity.x, and set contacts.left / right.
 *   3. Y: the same for position.y: landing on a floor sets contacts.down, a ceiling contacts.up.
 * Moving each axis on its own means a body sliding along a wall never "catches" on the seam between two
 * boxes, and a body standing on a floor touches it (edge to edge) without overlapping it.
 * Dynamic bodies don't collide with each other: the game checks those contacts itself (stomps, grabs).
 */
export class PhysicsWorld {
  readonly gravity = new Vec2(0, 0); // px/s²
  paused = false; // true: the engine runs no fixed steps (a dialogue is open)
  drawBodies = false; // debug: draw every body's box

  private statics: Body[] = [];
  private movers: Body[] = []; // dynamic + kinematic

  CreateBody(def: BodyDef): Body {
    const b = new Body(def);
    if (def.type === BodyType.Static) this.statics.push(b);
    else this.movers.push(b);
    return b;
  }

  /** A static box: CreateBody shorthand for walls and floors. */
  CreateStaticBox(box: Rect, userData: unknown = null): Body {
    return this.CreateBody({ type: BodyType.Static, x: box.x, y: box.y, w: box.w, h: box.h, userData: userData });
  }

  DestroyBody(b: Body): void {
    const list = b.type === BodyType.Static ? this.statics : this.movers;
    const i = list.indexOf(b);
    if (i >= 0) list.splice(i, 1);
  }

  /** Engine only: a state ended. */
  Clear(): void {
    this.statics = [];
    this.movers = [];
    this.gravity.Set(0, 0);
    this.paused = false;
    this.drawBodies = false;
  }

  /** Does this box overlap any static body? ("can I stand up here?", "is there a wall ahead?") */
  QueryBox(box: Rect): boolean {
    return this.FirstStaticIn(box) !== null;
  }

  /** The first static body overlapping the box, or null. */
  FirstStaticIn(box: Rect): Body | null {
    for (let i = 0; i < this.statics.length; i++) {
      const s = this.statics[i];
      if (!s.enabled) continue;
      if (box.x < s.right && box.right > s.left && box.y < s.bottom && box.bottom > s.top) return s;
    }
    return null;
  }

  /** The nearest static body the segment from -> to passes through (line of sight), or null. */
  RayCast(from: Vec2, to: Vec2): RayHit | null {
    const d = to.Sub(from);
    let best: RayHit | null = null;
    for (let i = 0; i < this.statics.length; i++) {
      const s = this.statics[i];
      if (!s.enabled) continue;
      const t = SegmentVsBox(from, d, s);
      if (t < 0 || (best && t >= best.fraction)) continue;
      best = { point: from.Add(d.Scale(t)), fraction: t, body: s };
    }
    return best;
  }

  /** Advance every moving body by dt seconds. */
  Step(dt: number): void {
    for (let i = 0; i < this.movers.length; i++) {
      const b = this.movers[i];
      if (!b.enabled) continue;
      if (b.type === BodyType.Kinematic) {
        b.position.AddScaled(b.velocity, dt);
        continue;
      }
      b.velocity.AddScaled(this.gravity, b.gravityScale * dt);
      b.contacts.Clear();
      b.position.x += b.velocity.x * dt;
      this.ResolveX(b);
      b.position.y += b.velocity.y * dt;
      this.ResolveY(b);
    }
  }

  /** Debug: every body's box (static blue, moving green). Call once per frame. */
  DebugDraw(draw: DebugDraw): void {
    for (let i = 0; i < this.statics.length; i++) if (this.statics[i].enabled) draw.Box(this.statics[i].Bounds(), DEBUG_STATIC, false, 0.6);
    for (let i = 0; i < this.movers.length; i++) draw.Box(this.movers[i].Bounds(), DEBUG_DYNAMIC, false, 0.9);
  }

  /** Push b out of static bodies along X, against the way it was moving. */
  private ResolveX(b: Body): void {
    const vx = b.velocity.x;
    if (vx === 0) return; // no X movement: an overlap here is for the Y pass to sort out
    for (let i = 0; i < this.statics.length; i++) {
      const s = this.statics[i];
      if (!s.enabled || !b.Overlaps(s)) continue;
      if (vx > 0) {
        b.position.x = s.left - b.width;
        b.contacts.right = true;
      } else {
        b.position.x = s.right;
        b.contacts.left = true;
      }
      b.velocity.x = 0;
    }
  }

  private ResolveY(b: Body): void {
    const vy = b.velocity.y;
    if (vy === 0) return;
    for (let i = 0; i < this.statics.length; i++) {
      const s = this.statics[i];
      if (!s.enabled || !b.Overlaps(s)) continue;
      if (vy > 0) {
        b.position.y = s.top - b.height;
        b.contacts.down = true;
      } else {
        b.position.y = s.bottom;
        b.contacts.up = true;
      }
      b.velocity.y = 0;
    }
  }
}

/**
 * Slab test: where along from + d * t (t in 0..1) does the segment enter the box? -1 = it doesn't.
 * For each axis, the segment is inside the box's slab between tNear and tFar; it hits the box where all
 * slabs overlap. A start point already inside the box hits at t = 0.
 */
function SegmentVsBox(from: Vec2, d: Vec2, box: Body): number {
  let tMin = 0;
  let tMax = 1;
  const lo = [box.left, box.top];
  const hi = [box.right, box.bottom];
  const o = [from.x, from.y];
  const dir = [d.x, d.y];
  for (let axis = 0; axis < 2; axis++) {
    if (Math.abs(dir[axis]) < 1e-9) {
      if (o[axis] <= lo[axis] || o[axis] >= hi[axis]) return -1; // parallel and outside this slab
      continue;
    }
    let t0 = (lo[axis] - o[axis]) / dir[axis];
    let t1 = (hi[axis] - o[axis]) / dir[axis];
    if (t0 > t1) {
      const swap = t0;
      t0 = t1;
      t1 = swap;
    }
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMin >= tMax) return -1; // the slabs don't overlap (touching an edge is not a hit)
  }
  return tMin;
}
