import { Rect } from '../math/Rect';
import { Vec2 } from '../math/Vec2';

/**
 *  Static : never moves (walls, floors, doors). Other bodies collide with it.
 *  Dynamic: moved by its velocity every step, pushed out of static bodies, contacts recorded.
 *  Kinematic: moved by its velocity, collides with nothing (a moving platform, a camera target).
 */
export enum BodyType {
  Static,
  Dynamic,
  Kinematic,
}

/** What CreateBody needs, like Box2D's b2BodyDef. */
export interface BodyDef {
  type: BodyType;
  x: number; // top-left, px
  y: number;
  w: number;
  h: number;
  gravityScale?: number; // x world gravity (default 1). 0: the owner applies its own gravity
  userData?: unknown; // anything the game wants to find again from the body
}

/** Which sides touched something solid during the last step. down = standing on something. */
export class Contacts {
  down = false;
  up = false;
  left = false;
  right = false;

  Clear(): void {
    this.down = false;
    this.up = false;
    this.left = false;
    this.right = false;
  }
}

/** An axis-aligned box in the physics world. `position` is its TOP-LEFT corner, in px. */
export class Body {
  readonly type: BodyType;
  readonly position: Vec2;
  readonly size: Vec2;
  readonly velocity = new Vec2(0, 0); // px/s
  readonly contacts = new Contacts();
  gravityScale: number;
  userData: unknown;
  enabled = true; // false: ignored by the step and by queries (a door that is open)

  constructor(def: BodyDef) {
    this.type = def.type;
    this.position = new Vec2(def.x, def.y);
    this.size = new Vec2(def.w, def.h);
    this.gravityScale = def.gravityScale ?? 1;
    this.userData = def.userData;
  }

  get left(): number { return this.position.x; }
  get right(): number { return this.position.x + this.size.x; }
  get top(): number { return this.position.y; }
  get bottom(): number { return this.position.y + this.size.y; }
  get width(): number { return this.size.x; }
  get height(): number { return this.size.y; }
  get centerX(): number { return this.position.x + this.size.x / 2; }
  get centerY(): number { return this.position.y + this.size.y / 2; }

  Center(): Vec2 {
    return new Vec2(this.centerX, this.centerY);
  }

  Bounds(): Rect {
    return new Rect(this.position.x, this.position.y, this.size.x, this.size.y);
  }

  /** Real overlap with another body (touching edges don't count). */
  Overlaps(o: Body): boolean {
    return this.left < o.right && this.right > o.left && this.top < o.bottom && this.bottom > o.top;
  }

  SetVelocity(vx: number, vy: number): void {
    this.velocity.Set(vx, vy);
  }

  /** New size; the top-left stays where it is (move position yourself to keep the feet in place). */
  SetSize(w: number, h: number): void {
    this.size.Set(w, h);
  }

  /** Jump to a new top-left position: no velocity, no contacts. */
  Teleport(x: number, y: number): void {
    this.position.Set(x, y);
    this.velocity.Set(0, 0);
    this.contacts.Clear();
  }
}
