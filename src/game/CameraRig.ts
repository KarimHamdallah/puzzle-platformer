import Phaser from 'phaser';
import type GUI from 'lil-gui';
import { DEBUG_ENABLED, TuningFolder, debug } from '../core/Debug';
import { TILE } from './constants';
import type { Player } from './Player';

/**
 * Cinemachine "Framing Transposer" style settings. Zones are FRACTIONS OF THE SCREEN (0..1).
 *
 *   +-------------------------------+   red   = hard limit: the target can never go here
 *   |   +-----------------------+   |   blue  = soft zone: camera catches up with damping
 *   |   |      +---------+      |   |   clear = dead zone: target moves, camera stays still
 *   |   |      |    *    |      |   |   *     = screenX / screenY (where the target rests)
 *   |   |      +---------+      |   |
 *   |   +-----------------------+   |
 *   +-------------------------------+
 */
class CameraTuning {
  screenX = 0.5; // where the target sits on screen (0 = left, 1 = right)
  screenY = 0.5; // (0 = top, 1 = bottom)
  deadZoneWidth = 0.57;
  deadZoneHeight = 0.78; // must stay > ~0.4 so a full jump from rest never moves the camera
  softZoneWidth = 0.6;
  softZoneHeight = 0.75; // smaller than deadZoneHeight -> treated as equal: no vertical soft zone
  dampingX = 0.25; // s to catch up inside the soft zone (0 = instant)
  dampingY = 0.35;
  targetOffsetX = 0; // tiles from the player's feet to the tracked point
  targetOffsetY = -1;
  lookAheadTime = 0.5; // s: tracked point is pushed ahead by velocity * this
  lookAheadSmoothing = 0.4; // s: how smoothly the look-ahead changes (turning around)
}

const T = new CameraTuning();

/** Exponential smoothing factor for this frame: frame-rate independent, tau = time constant. */
function smoothing(dt: number, tau: number): number {
  return tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
}

/**
 * One axis of the dead zone / soft zone follow.
 * `delta` = tracked point - framing point (px). Returns how far the camera moves this frame.
 */
function followAxis(delta: number, deadHalf: number, softHalf: number, damping: number, dt: number): number {
  if (Math.abs(delta) <= deadHalf) return 0; // inside the dead zone: don't move

  const outside = delta - Math.sign(delta) * deadHalf; // the part of delta past the dead zone edge
  let move = outside * smoothing(dt, damping); // soft zone: close that gap with damping

  const remaining = delta - move; // hard limit: never let the target leave the soft zone
  if (Math.abs(remaining) > softHalf) move = delta - Math.sign(delta) * softHalf;
  return move;
}

export class CameraRig {
  private readonly cam: Phaser.Cameras.Scene2D.Camera;
  private readonly player: Player;
  private readonly worldW: number;
  private readonly worldH: number;
  private x = 0; // camera centre we steer (world px)
  private y = 0;
  private lookAheadX = 0; // current smoothed look-ahead (px)
  private targetX = 0; // tracked point this frame (world px)
  private targetY = 0;
  private debugView: CameraDebug | null = null;

  constructor(scene: Phaser.Scene, player: Player, worldW: number, worldH: number) {
    this.cam = scene.cameras.main;
    this.player = player;
    this.worldW = worldW;
    this.worldH = worldH;
    this.cam.setBounds(0, 0, worldW, worldH);
    if (DEBUG_ENABLED) this.debugView = new CameraDebug(scene);
    this.snap();
  }

  destroy(): void {
    if (this.debugView) this.debugView.destroy();
  }

  /** Put the target exactly on the framing point (level start, respawn). */
  snap(): void {
    this.lookAheadX = 0;
    this.updateTarget();
    this.x = this.clampX(this.targetX - (T.screenX - 0.5) * this.cam.width);
    this.y = this.clampY(this.targetY - (T.screenY - 0.5) * this.cam.height);
    this.cam.centerOn(this.x, this.y);
  }

  /** Call once per frame, after the player's visuals are updated. */
  update(deltaMs: number): void {
    const dt = deltaMs / 1000;
    const w = this.cam.width;
    const h = this.cam.height;

    const lookTarget = this.player.body.velocity.x * T.lookAheadTime;
    this.lookAheadX += (lookTarget - this.lookAheadX) * smoothing(dt, T.lookAheadSmoothing);
    this.updateTarget();

    // Framing point = where the target should appear, expressed in world px.
    const framingX = this.x + (T.screenX - 0.5) * w;
    const framingY = this.y + (T.screenY - 0.5) * h;
    const deadHalfW = (T.deadZoneWidth * w) / 2;
    const deadHalfH = (T.deadZoneHeight * h) / 2;
    const softHalfW = (Math.max(T.softZoneWidth, T.deadZoneWidth) * w) / 2;
    const softHalfH = (Math.max(T.softZoneHeight, T.deadZoneHeight) * h) / 2;

    this.x += followAxis(this.targetX - framingX, deadHalfW, softHalfW, T.dampingX, dt);
    this.y += followAxis(this.targetY - framingY, deadHalfH, softHalfH, T.dampingY, dt);
    this.x = this.clampX(this.x);
    this.y = this.clampY(this.y);
    this.cam.centerOn(this.x, this.y);

    if (this.debugView) this.debugView.draw(this.cam, this.targetX, this.targetY);
  }

  private updateTarget(): void {
    this.targetX = this.player.feetX + T.targetOffsetX * TILE + this.lookAheadX;
    this.targetY = this.player.feetY + T.targetOffsetY * TILE;
  }

  private clampX(x: number): number {
    const half = this.cam.width / 2;
    return Phaser.Math.Clamp(x, half, this.worldW - half);
  }

  private clampY(y: number): number {
    const half = this.cam.height / 2;
    return Phaser.Math.Clamp(y, half, this.worldH - half);
  }
}

/**
 * Debug view: "camera tuning" sliders + Cinemachine-like overlay drawn in SCREEN space:
 * red = hard limit, blue = soft zone, clear = dead zone, guide lines through the zone edges,
 * white cross = framing point (screenX/Y), yellow dot = tracked target point.
 */
class CameraDebug {
  showGuides = false;

  private readonly tuning: TuningFolder<CameraTuning>;
  private readonly folder: GUI;
  private readonly overlay: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    const t = new TuningFolder('camera tuning', T);
    t.add('screenX', 0, 1, 0.01);
    t.add('screenY', 0, 1, 0.01);
    t.add('deadZoneWidth', 0, 1, 0.01);
    t.add('deadZoneHeight', 0, 1, 0.01);
    t.add('softZoneWidth', 0, 1, 0.01);
    t.add('softZoneHeight', 0, 1, 0.01);
    t.add('dampingX', 0, 2, 0.01);
    t.add('dampingY', 0, 2, 0.01);
    t.add('targetOffsetX', -4, 4, 0.1);
    t.add('targetOffsetY', -4, 4, 0.1);
    t.add('lookAheadTime', 0, 1, 0.01);
    t.add('lookAheadSmoothing', 0, 2, 0.01);
    this.tuning = t;

    this.folder = debug.gui.addFolder('camera').close();
    this.folder.add(this, 'showGuides').name('show dead zone');

    this.overlay = scene.add.graphics().setScrollFactor(0).setDepth(100);
  }

  destroy(): void {
    this.tuning.destroy();
    this.folder.destroy();
  }

  draw(cam: Phaser.Cameras.Scene2D.Camera, targetX: number, targetY: number): void {
    const g = this.overlay;
    g.clear();
    if (!this.showGuides) return;

    const w = cam.width;
    const h = cam.height;
    const fx = T.screenX * w; // framing point, screen px
    const fy = T.screenY * h;
    const softW = Math.max(T.softZoneWidth, T.deadZoneWidth) * w;
    const softH = Math.max(T.softZoneHeight, T.deadZoneHeight) * h;
    const deadW = T.deadZoneWidth * w;
    const deadH = T.deadZoneHeight * h;
    const sx = fx - softW / 2;
    const sy = fy - softH / 2;
    const dx = fx - deadW / 2;
    const dy = fy - deadH / 2;

    g.fillStyle(0xff3030, 0.18); // hard limit = everything outside the soft zone
    fillFrame(g, 0, 0, w, h, sx, sy, softW, softH);
    g.fillStyle(0x3080ff, 0.18); // soft zone = between soft and dead rectangles
    fillFrame(g, sx, sy, softW, softH, dx, dy, deadW, deadH);

    g.lineStyle(1, 0xffffff, 0.25); // guide lines through the zone edges, across the whole screen
    g.lineBetween(sx, 0, sx, h);
    g.lineBetween(sx + softW, 0, sx + softW, h);
    g.lineBetween(0, sy, w, sy);
    g.lineBetween(0, sy + softH, w, sy + softH);
    g.lineStyle(2, 0xffffff, 0.6);
    g.strokeRect(dx, dy, deadW, deadH);

    g.lineStyle(2, 0xffffff, 0.9); // framing point
    g.lineBetween(fx - 10, fy, fx + 10, fy);
    g.lineBetween(fx, fy - 10, fx, fy + 10);
    g.fillStyle(0xffee33, 1); // tracked target point
    g.fillCircle(targetX - cam.scrollX, targetY - cam.scrollY, 7);
  }
}

/** Fill the area of the outer rect that is NOT inside the inner rect (4 bands). */
function fillFrame(
  g: Phaser.GameObjects.Graphics,
  ox: number, oy: number, ow: number, oh: number,
  ix: number, iy: number, iw: number, ih: number,
): void {
  g.fillRect(ox, oy, ow, iy - oy); // top
  g.fillRect(ox, iy + ih, ow, oy + oh - (iy + ih)); // bottom
  g.fillRect(ox, iy, ix - ox, ih); // left
  g.fillRect(ix + iw, iy, ox + ow - (ix + iw), ih); // right
}
