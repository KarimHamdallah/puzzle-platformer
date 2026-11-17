/**
 * Tweens: animate numeric properties of any object over time (a sprite's alpha, a camera's scrollY...).
 *
 *   tweens.To(sprite, { alpha: 0, y: sprite.y - 30 }, 0.4, { ease: Ease.QuadOut, onDone: () => sprite.Destroy() });
 *
 * Each tween remembers the start values when it starts (after its delay), then every frame sets
 *   value = start + (end - start) * ease(t),   t = elapsed / duration in 0..1.
 * yoyo: after reaching the end it plays backwards to the start. repeat: how many extra cycles (-1 = forever).
 */

export enum Ease {
  Linear,
  QuadIn,
  QuadOut,
  QuadInOut,
  SineInOut,
  BackOut, // overshoots a little, then settles (squash & stretch)
}

const BACK_OVERSHOOT = 1.70158;

function Apply(ease: Ease, t: number): number {
  switch (ease) {
    case Ease.QuadIn: return t * t;
    case Ease.QuadOut: return t * (2 - t);
    case Ease.QuadInOut: return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    case Ease.SineInOut: return -0.5 * (Math.cos(Math.PI * t) - 1);
    case Ease.BackOut: {
      const s = BACK_OVERSHOOT;
      const u = t - 1;
      return u * u * ((s + 1) * u + s) + 1;
    }
    default: return t;
  }
}

export interface TweenOptions {
  ease?: Ease;
  delay?: number; // s before it starts
  yoyo?: boolean;
  repeat?: number; // extra cycles; -1 = forever
  repeatDelay?: number; // s between cycles
  onDone?: () => void;
}

type Target = Record<string, number>;

class Tween {
  readonly target: object;
  readonly keys: string[];
  readonly to: number[];
  readonly from: number[] = [];
  readonly duration: number;
  readonly ease: Ease;
  readonly yoyo: boolean;
  readonly repeatDelay: number;
  readonly onDone: (() => void) | null;
  repeat: number;
  wait: number; // s left before the next cycle starts
  started = false;
  elapsed = 0;
  dead = false;

  constructor(target: object, props: Record<string, number>, seconds: number, opts: TweenOptions) {
    this.target = target;
    this.keys = Object.keys(props);
    this.to = this.keys.map(k => props[k]);
    this.duration = Math.max(seconds, 0.0001);
    this.ease = opts.ease ?? Ease.Linear;
    this.yoyo = opts.yoyo ?? false;
    this.repeat = opts.repeat ?? 0;
    this.repeatDelay = opts.repeatDelay ?? 0;
    this.onDone = opts.onDone ?? null;
    this.wait = opts.delay ?? 0;
  }

  /** Returns true when finished. */
  Update(dt: number): boolean {
    if (this.wait > 0) {
      this.wait -= dt;
      if (this.wait > 0) return false;
      dt = -this.wait; // the part of this frame after the delay
    }
    const t = this.target as Target;
    if (!this.started) { // the start values are read now, not when the tween was made
      this.started = true;
      for (let i = 0; i < this.keys.length; i++) this.from[i] = t[this.keys[i]];
    }
    this.elapsed += dt;
    const cycle = this.yoyo ? this.duration * 2 : this.duration;
    if (this.elapsed >= cycle) {
      this.Write(this.yoyo ? 0 : 1); // the exact end of the cycle
      if (this.repeat === 0) return true;
      if (this.repeat > 0) this.repeat--;
      this.elapsed = 0;
      this.wait = this.repeatDelay;
      return false;
    }
    const phase = this.elapsed <= this.duration ? this.elapsed / this.duration : 2 - this.elapsed / this.duration;
    this.Write(Apply(this.ease, phase));
    return false;
  }

  private Write(k: number): void {
    const t = this.target as Target;
    for (let i = 0; i < this.keys.length; i++) t[this.keys[i]] = this.from[i] + (this.to[i] - this.from[i]) * k;
  }
}

export class TweenSystem {
  private tweens: Tween[] = [];

  /** Animate target's properties to the values in `props` over `seconds`. */
  To(target: object, props: Record<string, number>, seconds: number, opts: TweenOptions = {}): void {
    this.tweens.push(new Tween(target, props, seconds, opts));
  }

  /** Stop every tween on `target`, leaving its properties where they are now. */
  Kill(target: object): void {
    for (let i = 0; i < this.tweens.length; i++) if (this.tweens[i].target === target) this.tweens[i].dead = true;
  }

  /** Engine only: once per frame. */
  Update(dt: number): void {
    const list = this.tweens;
    for (let i = 0; i < list.length; i++) {
      const tw = list[i];
      if (tw.dead) continue;
      if (tw.Update(dt)) {
        tw.dead = true;
        if (tw.onDone) tw.onDone(); // may add new tweens: they go to the end of the list
      }
    }
    this.tweens = this.tweens.filter(tw => !tw.dead);
  }

  /** Engine only: a state ended. */
  Clear(): void {
    this.tweens = [];
  }
}
