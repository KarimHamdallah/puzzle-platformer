import Phaser from 'phaser';
import type GUI from 'lil-gui';
import { DEBUG_ENABLED, TuningFolder, debug } from '../core/Debug';
import { TILE } from './constants';
import type { Player } from './Player';

/** Camera tuning, in TILES and SECONDS. */
class CameraTuning {
  lookAhead = 3; // tiles ahead of the player at full run speed
  lookAheadTime = 0.45; // s for the look-ahead to settle (turning around pans smoothly, no snap)
  followTimeX = 0.1; // s smoothing time constant, horizontal
  followTimeY = 0.2; // s smoothing time constant, vertical
  heightOffset = 1.5; // tiles: the camera centre sits this far above the ground you stand on
  upMargin = 3.5; // tiles a player in the air can rise above the ground line before the camera follows (keep > jumpHeight)
  downMargin = 0.5; // tiles a player can drop below the ground line before the camera follows
  fallLookDown = 3; // extra tiles of look-down at max fall speed (only in real falls, not jumps)
}

const T = new CameraTuning();

/** Exponential smoothing factor for this frame: frame-rate independent, tau = time constant. */
function smoothing(dt: number, tau: number): number {
  return tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
}

/**
 * Platformer camera.
 *  - Horizontal: follows the player plus a look-ahead in the running direction.
 *  - Vertical: locked to the GROUND LINE (feet height when last grounded), so normal jumps don't
 *    move the screen. In the air it only follows past the up/down margins, and looks down in falls.
 *  - Clamped to the room so smoothing never drifts outside it.
 */
export class CameraRig {
  private readonly cam: Phaser.Cameras.Scene2D.Camera;
  private readonly player: Player;
  private readonly worldW: number;
  private readonly worldH: number;
  private x = 0; // camera centre we steer (world px)
  private y = 0;
  private lookOffset = 0; // current horizontal look-ahead (px)
  private groundY = 0; // the ground line the vertical framing is locked to (px)
  private falling = false; // the player dropped below the down margin: camera is chasing a fall
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

  /** Jump straight to the target (level start, respawn). */
  snap(): void {
    this.groundY = this.player.feetY;
    this.lookOffset = 0;
    this.falling = false;
    this.x = this.clampX(this.targetX());
    this.y = this.clampY(this.targetY());
    this.cam.centerOn(this.x, this.y);
  }

  /** Call once per frame, after the player's visuals are updated. */
  update(deltaMs: number): void {
    const dt = deltaMs / 1000;
    const p = this.player;

    // Look-ahead eases toward (run speed ratio * lookAhead).
    this.lookOffset += (p.runRatio * T.lookAhead * TILE - this.lookOffset) * smoothing(dt, T.lookAheadTime);

    // Ground line: snaps to the feet when grounded; in the air it is only dragged past the margins.
    this.falling = false;
    if (p.grounded) {
      this.groundY = p.feetY;
    } else if (p.feetY < this.groundY - T.upMargin * TILE) {
      this.groundY = p.feetY + T.upMargin * TILE;
    } else if (p.feetY > this.groundY + T.downMargin * TILE) {
      this.groundY = p.feetY - T.downMargin * TILE;
      this.falling = true;
    }

    this.x += (this.targetX() - this.x) * smoothing(dt, T.followTimeX);
    this.y += (this.targetY() - this.y) * smoothing(dt, T.followTimeY);
    this.x = this.clampX(this.x);
    this.y = this.clampY(this.y);
    this.cam.centerOn(this.x, this.y);

    if (this.debugView) this.debugView.draw(p, this.groundY, this.targetX(), this.targetY(), this.x, this.y);
  }

  private targetX(): number {
    return this.player.feetX + this.lookOffset;
  }

  private targetY(): number {
    const lookDown = this.falling ? this.player.fallRatio * T.fallLookDown * TILE : 0;
    return this.groundY - T.heightOffset * TILE + lookDown;
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
 * Debug view: "camera tuning" sliders + "camera" folder with guides:
 *  yellow line = ground line, translucent band = up/down margins,
 *  white cross = where the camera wants to be, cyan dot = where it is now.
 */
class CameraDebug {
  showGuides = false;

  private readonly tuning: TuningFolder<CameraTuning>;
  private readonly folder: GUI;
  private readonly guides: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    const t = new TuningFolder('camera tuning', T);
    t.add('lookAhead', 0, 8, 0.1);
    t.add('lookAheadTime', 0, 2, 0.01);
    t.add('followTimeX', 0, 1, 0.01);
    t.add('followTimeY', 0, 1, 0.01);
    t.add('heightOffset', -4, 6, 0.1);
    t.add('upMargin', 0, 8, 0.1);
    t.add('downMargin', 0, 8, 0.1);
    t.add('fallLookDown', 0, 8, 0.1);
    this.tuning = t;

    this.folder = debug.gui.addFolder('camera').close();
    this.folder.add(this, 'showGuides').name('show guides');

    this.guides = scene.add.graphics().setDepth(100);
  }

  destroy(): void {
    this.tuning.destroy();
    this.folder.destroy();
  }

  draw(player: Player, groundY: number, targetX: number, targetY: number, camX: number, camY: number): void {
    const g = this.guides;
    g.clear();
    if (!this.showGuides) return;

    const left = camX - 1000;
    const width = 2000;
    g.fillStyle(0xffffff, 0.08);
    g.fillRect(left, groundY - T.upMargin * TILE, width, (T.upMargin + T.downMargin) * TILE);
    g.lineStyle(3, 0xffff66, 0.9);
    g.lineBetween(left, groundY, left + width, groundY);

    g.lineStyle(2, 0xffffff, 0.6);
    g.lineBetween(player.feetX, player.feetY - TILE * 0.5, targetX, player.feetY - TILE * 0.5); // look-ahead
    g.lineStyle(3, 0xffffff, 1);
    g.lineBetween(targetX - 16, targetY, targetX + 16, targetY);
    g.lineBetween(targetX, targetY - 16, targetX, targetY + 16);
    g.fillStyle(0x66ffff, 1);
    g.fillCircle(camX, camY, 6);
  }
}
