import Phaser from 'phaser';

interface ImageEntry {
  key: string;
  path: string;
  nearest: boolean; // pixel art: nearest-neighbour filtering (no blur when scaled up)
}

interface SheetEntry extends ImageEntry {
  frameW: number;
  frameH: number;
}

/**
 * Textures and sounds. The game queues everything before Engine.Run(); the engine loads the queue
 * before the first state starts (a loading screen would go here).
 */
export class Assets {
  private readonly images: ImageEntry[] = [];
  private readonly sheets: SheetEntry[] = [];
  private readonly sounds: [string, string][] = [];
  private scene: Phaser.Scene | null = null;

  Image(key: string, path: string, nearest: boolean = true): void {
    this.images.push({ key: key, path: path, nearest: nearest });
  }

  /** A sprite sheet: a strip / grid of equal frames, numbered from 0. */
  Sheet(key: string, path: string, frameW: number, frameH: number, nearest: boolean = true): void {
    this.sheets.push({ key: key, path: path, nearest: nearest, frameW: frameW, frameH: frameH });
  }

  Sound(key: string, path: string): void {
    this.sounds.push([key, path]);
  }

  /** Engine only (host preload): start loading the queue. A missing file is skipped, not fatal. */
  Load(scene: Phaser.Scene): void {
    this.scene = scene;
    for (let i = 0; i < this.images.length; i++) scene.load.image(this.images[i].key, this.images[i].path);
    for (let i = 0; i < this.sheets.length; i++) {
      const s = this.sheets[i];
      scene.load.spritesheet(s.key, s.path, { frameWidth: s.frameW, frameHeight: s.frameH });
    }
    for (let i = 0; i < this.sounds.length; i++) scene.load.audio(this.sounds[i][0], this.sounds[i][1]);
  }

  /** Engine only (host create): everything is loaded. */
  AfterLoad(): void {
    const all: ImageEntry[] = [...this.images, ...this.sheets];
    for (let i = 0; i < all.length; i++) {
      if (all[i].nearest && this.Exists(all[i].key)) this.Texture(all[i].key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
  }

  Exists(key: string): boolean {
    return this.scene !== null && this.scene.textures.exists(key);
  }

  SoundExists(key: string): boolean {
    return this.scene !== null && this.scene.cache.audio.exists(key);
  }

  /** Frames in a sheet (1 for a plain image). */
  FrameCount(key: string): number {
    if (!this.Exists(key)) return 1;
    return Math.max(1, this.Texture(key).frameTotal - 1); // Phaser counts the whole texture as a frame too
  }

  /** Source image size in pixels. */
  Width(key: string): number {
    return this.Exists(key) ? this.Texture(key).getSourceImage().width : 0;
  }

  Height(key: string): number {
    return this.Exists(key) ? this.Texture(key).getSourceImage().height : 0;
  }

  /** A texture drawn by code (gradients, particles). Made once: later calls with the same key do nothing. */
  CreateCanvasTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): void {
    if (!this.scene || this.Exists(key)) return;
    const tex = this.scene.textures.createCanvas(key, w, h);
    if (!tex) return;
    draw(tex.getContext());
    tex.refresh();
  }

  private Texture(key: string): Phaser.Textures.Texture {
    return (this.scene as Phaser.Scene).textures.get(key);
  }
}
