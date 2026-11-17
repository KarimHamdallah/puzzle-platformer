import { Vec2 } from './Vec2';

/** An axis-aligned rectangle: top-left (x, y), width w, height h. Y grows downward (screen coordinates). */
export class Rect {
  x: number;
  y: number;
  w: number;
  h: number;

  constructor(x: number = 0, y: number = 0, w: number = 0, h: number = 0) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }

  static FromCenter(cx: number, cy: number, w: number, h: number): Rect {
    return new Rect(cx - w / 2, cy - h / 2, w, h);
  }

  get left(): number { return this.x; }
  get right(): number { return this.x + this.w; }
  get top(): number { return this.y; }
  get bottom(): number { return this.y + this.h; }
  get centerX(): number { return this.x + this.w / 2; }
  get centerY(): number { return this.y + this.h / 2; }

  Center(): Vec2 {
    return new Vec2(this.centerX, this.centerY);
  }

  Set(x: number, y: number, w: number, h: number): this {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    return this;
  }

  Clone(): Rect {
    return new Rect(this.x, this.y, this.w, this.h);
  }

  /** The point is inside or on the edge. */
  Contains(px: number, py: number): boolean {
    return this.w > 0 && this.h > 0 && px >= this.x && px <= this.right && py >= this.y && py <= this.bottom;
  }

  ContainsPoint(p: Vec2): boolean {
    return this.Contains(p.x, p.y);
  }

  /** Real overlap: rectangles that only touch along an edge do NOT overlap. */
  Overlaps(o: Rect): boolean {
    return this.x < o.right && this.right > o.x && this.y < o.bottom && this.bottom > o.y;
  }

  /** A copy grown by dx on the left and right and dy on the top and bottom. */
  Inflated(dx: number, dy: number): Rect {
    return new Rect(this.x - dx, this.y - dy, this.w + dx * 2, this.h + dy * 2);
  }
}
