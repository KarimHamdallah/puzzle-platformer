import type GUI from 'lil-gui';
import type { Camera } from './Camera';
import { DEBUG_ENABLED, TuningFolder, debugPanel } from './debug/DebugPanel';
import * as MathUtil from './math/MathUtil';
import { Rect } from './math/Rect';
import type { Body } from './physics/Body';
import type { Renderer, Shape } from './Renderer';

/**
 * Cinemachine "Framing Transposer" style settings. Zones are FRACTIONS OF THE SCREEN (0..1);
 * offsets are in world units of `unit` px (the game passes its tile size).
 *
 *   +-------------------------------+   red   = hard limit: the target can never go here
 *   |   +-----------------------+   |   blue  = soft zone: camera catches up with damping
 *   |   |      +---------+      |   |   clear = dead zone: target moves, camera stays still
 *   |   |      |    *    |      |   |   *     = screenX / screenY (where the target rests)
 *   |   |      +---------+      |   |
 *   |   +-----------------------+   |
 *   +-------------------------------+
 */
class FollowTuning {
  screenX = 0.5; // where the target sits on screen (0 = left, 1 = right)
  screenY = 0.5; // (0 = top, 1 = bottom)
  deadZoneWidth = 0.3;
  deadZoneHeight = 0.06; // thin: the camera follows height changes, through the vertical soft zone
  softZoneWidth = 0.95;
  softZoneHeight = 0.83;
  dampingX = 0; // s to catch up inside the soft zone (0 = instant)
  dampingY = 0.35; // jumps lift the camera smoothly, not instantly
  targetOffsetX = -0.4; // units from the body's feet to the tracked point
  targetOffsetY = -2.3; // above the head: more room to see what's below / ahead
  lookAheadTime = 0.5; // s: tracked point is pushed ahead by velocity * this
  lookAheadSmoothing = 0.4; // s: how smoothly the look-ahead changes (turning around)
}

const T = new FollowTuning();

/**
 * One axis of the dead zone / soft zone follow.
 * `delta` = tracked point - framing point (px). Returns how far the camera moves this frame.
 */
function FollowAxis(delta: number, deadHalf: number, softHalf: number, damping: number, dt: number): number {
  if (Math.abs(delta) <= deadHalf) return 0; // inside the dead zone: don't move

  const outside = delta - Math.sign(delta) * deadHalf; // the part of delta past the dead zone edge
  let move = outside * MathUtil.Smoothing(dt, damping); // soft zone: close that gap with damping

  const remaining = delta - move; // hard limit: never let the target leave the soft zone
  if (Math.abs(remaining) > softHalf) move = delta - Math.sign(delta) * softHalf;
  return move;
}

/**
 * Follows a physics body's feet (bottom centre) with a dead zone, a soft zone and look-ahead,
 * inside the world rectangle. Create one per state; call Update(dt) every frame after the body moved.
 */
export class CameraFollow {
  private readonly camera: Camera;
  private readonly target: Body;
  private readonly world: Rect;
  private readonly unit: number;
  private x = 0; // camera centre we steer (world px)
  private y = 0;
  private lookAheadX = 0; // current smoothed look-ahead (px)
  private targetX = 0; // tracked point this frame (world px)
  private targetY = 0;
  private debugView: FollowDebug | null = null;

  constructor(camera: Camera, renderer: Renderer, target: Body, world: Rect, unit: number) {
    this.camera = camera;
    this.target = target;
    this.world = world.Clone();
    this.unit = unit;
    camera.SetBounds(world);
    if (DEBUG_ENABLED) this.debugView = new FollowDebug(renderer);
    this.Snap();
  }

  Destroy(): void {
    if (this.debugView) this.debugView.Destroy();
  }

  /** Put the target exactly on the framing point (level start, respawn). */
  Snap(): void {
    this.lookAheadX = 0;
    this.UpdateTarget();
    this.x = this.ClampX(this.targetX - (T.screenX - 0.5) * this.camera.width);
    this.y = this.ClampY(this.targetY - (T.screenY - 0.5) * this.camera.height);
    this.camera.CenterOn(this.x, this.y);
  }

  Update(dt: number): void {
    const w = this.camera.width;
    const h = this.camera.height;

    const lookTarget = this.target.velocity.x * T.lookAheadTime;
    this.lookAheadX += (lookTarget - this.lookAheadX) * MathUtil.Smoothing(dt, T.lookAheadSmoothing);
    this.UpdateTarget();

    // Framing point = where the target should appear, expressed in world px.
    const framingX = this.x + (T.screenX - 0.5) * w;
    const framingY = this.y + (T.screenY - 0.5) * h;
    const deadHalfW = (T.deadZoneWidth * w) / 2;
    const deadHalfH = (T.deadZoneHeight * h) / 2;
    const softHalfW = (Math.max(T.softZoneWidth, T.deadZoneWidth) * w) / 2;
    const softHalfH = (Math.max(T.softZoneHeight, T.deadZoneHeight) * h) / 2;

    this.x += FollowAxis(this.targetX - framingX, deadHalfW, softHalfW, T.dampingX, dt);
    this.y += FollowAxis(this.targetY - framingY, deadHalfH, softHalfH, T.dampingY, dt);
    this.x = this.ClampX(this.x);
    this.y = this.ClampY(this.y);
    this.camera.CenterOn(this.x, this.y);

    if (this.debugView) this.debugView.Draw(w, h, this.targetX - this.camera.scrollX, this.targetY - this.camera.scrollY);
  }

  private UpdateTarget(): void {
    this.targetX = this.target.centerX + T.targetOffsetX * this.unit + this.lookAheadX;
    this.targetY = this.target.bottom + T.targetOffsetY * this.unit;
  }

  private ClampX(x: number): number {
    const half = this.camera.width / 2;
    return MathUtil.Clamp(x, this.world.x + half, this.world.right - half);
  }

  private ClampY(y: number): number {
    const half = this.camera.height / 2;
    return MathUtil.Clamp(y, this.world.y + half, this.world.bottom - half);
  }
}

/**
 * Debug view: "camera tuning" sliders + Cinemachine-like overlay drawn in SCREEN space:
 * red = hard limit, blue = soft zone, clear = dead zone, guide lines through the zone edges,
 * white cross = framing point (screenX/Y), yellow dot = tracked target point.
 */
class FollowDebug {
  showGuides = false;

  private readonly tuning: TuningFolder<FollowTuning>;
  private readonly folder: GUI;
  private readonly overlay: Shape;

  constructor(renderer: Renderer) {
    const t = new TuningFolder('camera tuning', T);
    t.Add('screenX', 0, 1, 0.01);
    t.Add('screenY', 0, 1, 0.01);
    t.Add('deadZoneWidth', 0, 1, 0.01);
    t.Add('deadZoneHeight', 0, 1, 0.01);
    t.Add('softZoneWidth', 0, 1, 0.01);
    t.Add('softZoneHeight', 0, 1, 0.01);
    t.Add('dampingX', 0, 2, 0.01);
    t.Add('dampingY', 0, 2, 0.01);
    t.Add('targetOffsetX', -4, 4, 0.1);
    t.Add('targetOffsetY', -4, 4, 0.1);
    t.Add('lookAheadTime', 0, 1, 0.01);
    t.Add('lookAheadSmoothing', 0, 2, 0.01);
    this.tuning = t;

    this.folder = debugPanel.gui.addFolder('camera').close();
    this.folder.add(this, 'showGuides').name('show dead zone');
    this.overlay = renderer.CreateShape().SetFixed().SetDepth(100);
  }

  Destroy(): void {
    this.tuning.Destroy();
    this.folder.destroy();
  }

  /** (tx, ty) = tracked point in screen px. */
  Draw(w: number, h: number, tx: number, ty: number): void {
    const g = this.overlay;
    g.Clear();
    if (!this.showGuides) return;

    const fx = T.screenX * w; // framing point, screen px
    const fy = T.screenY * h;
    const softW = Math.max(T.softZoneWidth, T.deadZoneWidth) * w;
    const softH = Math.max(T.softZoneHeight, T.deadZoneHeight) * h;
    const deadW = T.deadZoneWidth * w;
    const deadH = T.deadZoneHeight * h;
    const soft = new Rect(fx - softW / 2, fy - softH / 2, softW, softH);
    const dead = new Rect(fx - deadW / 2, fy - deadH / 2, deadW, deadH);

    g.FillStyle(0xff3030, 0.18); // hard limit = everything outside the soft zone
    FillFrame(g, new Rect(0, 0, w, h), soft);
    g.FillStyle(0x3080ff, 0.18); // soft zone = between soft and dead rectangles
    FillFrame(g, soft, dead);

    g.LineStyle(1, 0xffffff, 0.25); // guide lines through the zone edges, across the whole screen
    g.Line(soft.left, 0, soft.left, h).Line(soft.right, 0, soft.right, h);
    g.Line(0, soft.top, w, soft.top).Line(0, soft.bottom, w, soft.bottom);
    g.LineStyle(2, 0xffffff, 0.6).StrokeRect(dead.x, dead.y, dead.w, dead.h);

    g.LineStyle(2, 0xffffff, 0.9).Line(fx - 10, fy, fx + 10, fy).Line(fx, fy - 10, fx, fy + 10); // framing point
    g.FillStyle(0xffee33, 1).FillCircle(tx, ty, 7); // tracked target point
  }
}

/** Fill the area of `outer` that is NOT inside `inner` (4 bands). */
function FillFrame(g: Shape, outer: Rect, inner: Rect): void {
  g.FillRect(outer.x, outer.y, outer.w, inner.y - outer.y); // top
  g.FillRect(outer.x, inner.bottom, outer.w, outer.bottom - inner.bottom); // bottom
  g.FillRect(outer.x, inner.y, inner.x - outer.x, inner.h); // left
  g.FillRect(inner.right, inner.y, outer.right - inner.right, inner.h); // right
}
