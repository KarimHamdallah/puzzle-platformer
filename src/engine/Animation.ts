import type { Assets } from './Assets';
import type { Sprite } from './Renderer';

/**
 * Sprite-sheet animation. A clip = a texture (sheet) + frames per second + loop or play once.
 * An Animator belongs to one Sprite and shows the frame of its current clip; the engine advances every
 * Animator once per frame (AnimationSystem.Update).
 */

export interface AnimClip {
  key: string; // name to Play() it by
  texture: string; // the sheet
  fps: number;
  loop: boolean;
  yoyo?: boolean; // forward then backward (0..n-1..1)
}

interface ClipData {
  clip: AnimClip;
  frames: number[] | null; // built on first use: the sheet's frame count is known once it is loaded
}

export class Animator {
  timeScale = 1; // 2 = twice as fast (legs follow running speed)

  private readonly sprite: Sprite;
  private readonly system: AnimationSystem;
  private current: ClipData | null = null;
  private index = 0; // into current.frames
  private time = 0; // s on the current frame
  private playing = false;

  constructor(sprite: Sprite, system: AnimationSystem) {
    this.sprite = sprite;
    this.system = system;
  }

  get key(): string { return this.current ? this.current.clip.key : ''; }
  get isPlaying(): boolean { return this.playing; }

  /**
   * Start a clip from `startFrame`. ignoreIfPlaying: if this clip is already PLAYING, keep going
   * (call it every frame with the clip you want). A one-shot clip that has finished is not playing,
   * so it starts again.
   */
  Play(key: string, ignoreIfPlaying: boolean = false, startFrame: number = 0): void {
    const data = this.system.Clip(key);
    if (!data) return;
    if (ignoreIfPlaying && this.playing && this.current === data) return;
    this.current = data;
    const frames = this.system.Frames(data);
    this.index = Math.min(startFrame, frames.length - 1);
    this.time = 0;
    this.playing = true;
    this.sprite.SetTexture(data.clip.texture, frames[this.index]);
  }

  /** Engine only (via AnimationSystem.Update). */
  Update(dt: number): void {
    if (!this.playing || !this.current || this.sprite.destroyed) return;
    const frames = this.system.Frames(this.current);
    const frameTime = 1 / this.current.clip.fps;
    this.time += dt * this.timeScale;
    let changed = false;
    while (this.time >= frameTime) {
      this.time -= frameTime;
      if (this.index + 1 < frames.length) {
        this.index++;
      } else if (this.current.clip.loop) {
        this.index = 0;
      } else { // a one-shot ends on its last frame
        this.playing = false;
        break;
      }
      changed = true;
    }
    if (changed) this.sprite.SetFrame(frames[this.index]);
  }
}

export class AnimationSystem {
  private readonly assets: Assets;
  private readonly clips = new Map<string, ClipData>();
  private animators: Animator[] = [];

  constructor(assets: Assets) {
    this.assets = assets;
  }

  /** Register a clip (clips are global: they survive state changes). */
  AddClip(clip: AnimClip): void {
    this.clips.set(clip.key, { clip: clip, frames: null });
  }

  /** An Animator driving this sprite. It is updated by the engine until the state ends. */
  Create(sprite: Sprite): Animator {
    const a = new Animator(sprite, this);
    this.animators.push(a);
    return a;
  }

  /** Engine only: once per frame. */
  Update(dt: number): void {
    for (let i = 0; i < this.animators.length; i++) this.animators[i].Update(dt);
  }

  /** Engine only: a state ended (its sprites are gone). */
  Clear(): void {
    this.animators = [];
  }

  /** Animator only. */
  Clip(key: string): ClipData | null {
    return this.clips.get(key) ?? null;
  }

  /** Animator only: the frame sequence of a clip. */
  Frames(data: ClipData): number[] {
    if (data.frames) return data.frames;
    const n = this.assets.FrameCount(data.clip.texture);
    const frames: number[] = [];
    for (let i = 0; i < n; i++) frames.push(i);
    if (data.clip.yoyo) for (let i = n - 2; i >= 1; i--) frames.push(i);
    data.frames = frames;
    return frames;
  }
}
