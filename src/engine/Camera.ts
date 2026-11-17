import Phaser from 'phaser';
import { Rect } from './math/Rect';
import { Vec2 } from './math/Vec2';
import * as MathUtil from './math/MathUtil';

const FADE_DEPTH = 10000; // over everything
const FLASH_DEPTH = 9999;

/**
 * The view into the world. `scrollX / scrollY` = the world point at the screen's top-left.
 * Shake, fade and flash are our own effects, run by the engine loop (Update):
 *  - Shake: a random offset on top of the scroll for a while (the scroll itself is not changed).
 *  - Fade: a black screen-sized rectangle whose alpha goes to 1 (out) or 0 (in). It survives a state
 *    change, so "fade out, switch level, fade in" stays black in between.
 *  - Flash: a coloured rectangle that starts opaque and fades out.
 */
export class Camera {
  private cam: Phaser.Cameras.Scene2D.Camera | null = null;
  private baseX = 0; // scroll without the shake
  private baseY = 0;
  private bounds: Rect | null = null;
  private shakeTime = 0;
  private shakeIntensity = 0; // fraction of the screen size
  private fadeRect: Phaser.GameObjects.Rectangle | null = null;
  private fadeFrom = 0;
  private fadeTo = 0;
  private fadeDuration = 0;
  private fadeElapsed = 0;
  private fadeDone: (() => void) | null = null;
  private flashRect: Phaser.GameObjects.Rectangle | null = null;
  private flashDuration = 0;
  private flashElapsed = 0;
  private grey: Phaser.FX.ColorMatrix | null = null;
  private greyOn = false;

  /** Engine only. */
  Attach(scene: Phaser.Scene): void {
    this.cam = scene.cameras.main;
    const w = scene.scale.width;
    const h = scene.scale.height;
    this.fadeRect = scene.add.rectangle(0, 0, w, h, 0x000000, 1).setOrigin(0, 0).setScrollFactor(0).setDepth(FADE_DEPTH).setAlpha(0);
    this.flashRect = scene.add.rectangle(0, 0, w, h, 0xffffff, 1).setOrigin(0, 0).setScrollFactor(0).setDepth(FLASH_DEPTH).setAlpha(0);
    if (this.cam.postFX) this.grey = this.cam.postFX.addColorMatrix(); // identity until SetGrayscale(true)
  }

  get width(): number { return this.Cam().width; }
  get height(): number { return this.Cam().height; }

  get scrollX(): number { return this.baseX; }
  set scrollX(v: number) { this.baseX = v; }
  get scrollY(): number { return this.baseY; }
  set scrollY(v: number) { this.baseY = v; }

  /** The world rectangle on screen right now. */
  get view(): Rect {
    return new Rect(this.baseX, this.baseY, this.width, this.height);
  }

  /** Put world point (x, y) at the centre of the screen (kept inside the bounds, if any). */
  CenterOn(x: number, y: number): void {
    let sx = x - this.width / 2;
    let sy = y - this.height / 2;
    const b = this.bounds;
    if (b) {
      sx = MathUtil.Clamp(sx, b.x, Math.max(b.x, b.right - this.width));
      sy = MathUtil.Clamp(sy, b.y, Math.max(b.y, b.bottom - this.height));
    }
    this.baseX = sx;
    this.baseY = sy;
  }

  SetBounds(box: Rect): void {
    this.bounds = box.Clone();
  }

  SetBackground(color: number): void {
    this.Cam().setBackgroundColor(color);
  }

  /** Snap the scroll to whole pixels (pixel art doesn't shimmer while scrolling). */
  SetRoundPixels(on: boolean): void {
    this.Cam().setRoundPixels(on);
  }

  WorldToScreen(p: Vec2): Vec2 {
    return new Vec2(p.x - this.baseX, p.y - this.baseY);
  }

  ScreenToWorld(p: Vec2): Vec2 {
    return new Vec2(p.x + this.baseX, p.y + this.baseY);
  }

  /** intensity: fraction of the screen size the view jumps around by (0.004 = a light bump). */
  Shake(seconds: number, intensity: number): void {
    if (seconds <= this.shakeTime && intensity <= this.shakeIntensity) return; // a stronger shake is running
    this.shakeTime = seconds;
    this.shakeIntensity = intensity;
  }

  /** From black to the picture. */
  FadeIn(seconds: number): void {
    this.StartFade(1, 0, seconds, null);
  }

  /** From the picture to black, then onDone (typically: change state). */
  FadeOut(seconds: number, onDone: (() => void) | null = null): void {
    this.StartFade(this.fadeRect ? this.fadeRect.alpha : 0, 1, seconds, onDone);
  }

  /** A full-screen flash of `color` that fades out over `seconds`. */
  Flash(seconds: number, color: number): void {
    if (!this.flashRect) return;
    this.flashRect.setFillStyle(color, 1);
    this.flashDuration = seconds;
    this.flashElapsed = 0;
  }

  /** The whole picture in shades of grey (Listen Mode). */
  SetGrayscale(on: boolean): void {
    if (!this.grey || on === this.greyOn) return;
    this.greyOn = on;
    if (on) this.grey.grayscale(1);
    else this.grey.reset();
  }

  /** Engine only: once per frame, after the state moved the camera. */
  Update(dt: number): void {
    const cam = this.Cam();
    let ox = 0;
    let oy = 0;
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      ox = (Math.random() * 2 - 1) * this.shakeIntensity * cam.width;
      oy = (Math.random() * 2 - 1) * this.shakeIntensity * cam.height;
      if (this.shakeTime <= 0) this.shakeIntensity = 0;
    }
    cam.scrollX = this.baseX + ox;
    cam.scrollY = this.baseY + oy;

    if (this.fadeRect && this.fadeDuration > 0) {
      this.fadeElapsed += dt;
      const t = Math.min(1, this.fadeElapsed / this.fadeDuration);
      this.fadeRect.setAlpha(MathUtil.Lerp(this.fadeFrom, this.fadeTo, t));
      if (t >= 1) {
        this.fadeDuration = 0;
        const done = this.fadeDone;
        this.fadeDone = null;
        if (done) done();
      }
    }
    if (this.flashRect && this.flashDuration > 0) {
      this.flashElapsed += dt;
      const t = Math.min(1, this.flashElapsed / this.flashDuration);
      this.flashRect.setAlpha(1 - t);
      if (t >= 1) this.flashDuration = 0;
    }
  }

  /** Engine only: a state ended. The fade stays (a fade-out leads into the next state's fade-in). */
  Reset(): void {
    this.baseX = 0;
    this.baseY = 0;
    this.bounds = null;
    this.shakeTime = 0;
    this.shakeIntensity = 0;
    this.flashDuration = 0;
    if (this.flashRect) this.flashRect.setAlpha(0);
    this.SetGrayscale(false);
    this.SetRoundPixels(false);
  }

  private StartFade(from: number, to: number, seconds: number, onDone: (() => void) | null): void {
    this.fadeFrom = from;
    this.fadeTo = to;
    this.fadeElapsed = 0;
    this.fadeDone = onDone;
    this.fadeDuration = Math.max(seconds, 0.0001);
  }

  private Cam(): Phaser.Cameras.Scene2D.Camera {
    if (!this.cam) throw new Error('Camera used before Engine.Run()');
    return this.cam;
  }
}
