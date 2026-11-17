import Phaser from 'phaser';
import { Rect } from '../math/Rect';
import { Vec2 } from '../math/Vec2';

const DEPTH = 1000; // above everything in the world
const TEXT_DEPTH = 1001;
const ARROW_SIZE = 12; // px: a ray's arrow head
const TEXT_STYLE = { fontFamily: 'Consolas, monospace', fontSize: '18px', color: '#ffffff', backgroundColor: '#00000088' };

/**
 * Immediate-mode debug drawing in WORLD space (like Unity's Debug.DrawLine or Box2D's debug draw):
 *  - Call Line / Ray / Box / Circle / Point / Text every frame you want something shown.
 *  - The engine calls BeginFrame() at the start of every frame: last frame's drawings are wiped.
 *  - Nothing to create or destroy, so it is safe to call from anywhere: an AI's line of sight, a hitbox,
 *    a sweep test.
 */
export class DebugDraw {
  private gfx: Phaser.GameObjects.Graphics | null = null;
  private scene: Phaser.Scene | null = null;
  private readonly texts: Phaser.GameObjects.Text[] = []; // reused labels
  private textsUsed = 0;

  /** Engine only: the host scene is ready. */
  Attach(scene: Phaser.Scene): void {
    this.scene = scene;
    this.gfx = scene.add.graphics().setDepth(DEPTH);
  }

  /** Engine only: wipe the previous frame. */
  BeginFrame(): void {
    if (this.gfx) this.gfx.clear();
    for (let i = 0; i < this.textsUsed; i++) this.texts[i].setVisible(false);
    this.textsUsed = 0;
  }

  Line(a: Vec2, b: Vec2, color: number, alpha: number = 0.9, width: number = 2): void {
    if (!this.gfx) return;
    this.gfx.lineStyle(width, color, alpha).lineBetween(a.x, a.y, b.x, b.y);
  }

  /** From origin along dir (any length: it is normalized) for `length` px, with an arrow head. */
  Ray(origin: Vec2, dir: Vec2, length: number, color: number, alpha: number = 0.9): void {
    const d = dir.Normalized();
    const end = origin.Add(d.Scale(length));
    this.Line(origin, end, color, alpha);
    const side = new Vec2(-d.y, d.x); // perpendicular
    const back = end.Sub(d.Scale(ARROW_SIZE));
    this.Line(end, back.Add(side.Scale(ARROW_SIZE * 0.5)), color, alpha);
    this.Line(end, back.Sub(side.Scale(ARROW_SIZE * 0.5)), color, alpha);
  }

  Box(box: Rect, color: number, filled: boolean = false, alpha: number = 0.8): void {
    if (!this.gfx) return;
    if (filled) this.gfx.fillStyle(color, alpha).fillRect(box.x, box.y, box.w, box.h);
    else this.gfx.lineStyle(2, color, alpha).strokeRect(box.x, box.y, box.w, box.h);
  }

  Circle(center: Vec2, radius: number, color: number, filled: boolean = false, alpha: number = 0.6): void {
    if (!this.gfx) return;
    if (filled) this.gfx.fillStyle(color, alpha).fillCircle(center.x, center.y, radius);
    else this.gfx.lineStyle(2, color, alpha).strokeCircle(center.x, center.y, radius);
  }

  Point(p: Vec2, color: number, size: number = 6): void {
    if (!this.gfx) return;
    this.gfx.fillStyle(color, 1).fillCircle(p.x, p.y, size);
  }

  /** A label centred on x, its top at y. */
  Text(p: Vec2, text: string): void {
    if (!this.scene) return;
    if (this.textsUsed === this.texts.length) {
      this.texts.push(this.scene.add.text(0, 0, '', TEXT_STYLE).setOrigin(0.5, 0).setDepth(TEXT_DEPTH));
    }
    const t = this.texts[this.textsUsed++];
    t.setText(text).setPosition(p.x, p.y).setVisible(true);
  }
}
