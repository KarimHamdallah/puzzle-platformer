/**
 * A 2D vector, like glm::vec2. Units are whatever the caller uses (the game: world pixels).
 *  - Add / Sub / Scale / Normalized return a NEW vector: `a.Add(b)` never changes a (like a + b in C++).
 *  - Set / Copy / AddScaled change THIS vector in place, for per-step updates: `pos.AddScaled(vel, dt)`
 *    is pos += vel * dt without making a new object.
 */
export class Vec2 {
  x: number;
  y: number;

  constructor(x: number = 0, y: number = 0) {
    this.x = x;
    this.y = y;
  }

  Clone(): Vec2 {
    return new Vec2(this.x, this.y);
  }

  Set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  Copy(o: Vec2): this {
    this.x = o.x;
    this.y = o.y;
    return this;
  }

  Add(o: Vec2): Vec2 {
    return new Vec2(this.x + o.x, this.y + o.y);
  }

  Sub(o: Vec2): Vec2 {
    return new Vec2(this.x - o.x, this.y - o.y);
  }

  Scale(s: number): Vec2 {
    return new Vec2(this.x * s, this.y * s);
  }

  /** this += v * s (in place). */
  AddScaled(v: Vec2, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    return this;
  }

  Dot(o: Vec2): number {
    return this.x * o.x + this.y * o.y;
  }

  Length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  LengthSq(): number {
    return this.x * this.x + this.y * this.y;
  }

  /** Same direction, length 1. The zero vector stays zero. */
  Normalized(): Vec2 {
    const len = this.Length();
    return len > 0 ? new Vec2(this.x / len, this.y / len) : new Vec2(0, 0);
  }

  DistanceTo(o: Vec2): number {
    const dx = o.x - this.x;
    const dy = o.y - this.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** a + (b - a) * t: t = 0 gives a, t = 1 gives b. */
  static Lerp(a: Vec2, b: Vec2, t: number): Vec2 {
    return new Vec2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  }

  /** Step from `current` toward `target` by at most `maxDistance`, never past it. */
  static MoveTowards(current: Vec2, target: Vec2, maxDistance: number): Vec2 {
    const d = target.Sub(current);
    const len = d.Length();
    if (len <= maxDistance || len === 0) return target.Clone();
    return current.Add(d.Scale(maxDistance / len));
  }
}
