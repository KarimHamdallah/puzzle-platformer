import Phaser from 'phaser';
import type { Vec2 } from './math/Vec2';

/**
 * Everything that draws. The game creates visuals through the Renderer and gets back small handles
 * (Sprite, Text, Shape, Group...). Only this file knows they are Phaser game objects underneath.
 *
 *  - Depth: higher draws on top. The game picks the numbers (see its constants).
 *  - SetFixed(): the visual ignores the camera (HUD, menus, overlays).
 *  - Every visual created while a state runs is destroyed when that state ends (DestroyAll), so a
 *    level never has to clean up its own drawings.
 *  - x, y, alpha, scale, scaleX, scaleY, rotation are plain properties, so the TweenSystem can animate them.
 */

/** The Phaser surface every handle needs (each Phaser object type has these). */
interface Native {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  alpha: number;
  visible: boolean;
  depth: number;
  setDepth(value: number): unknown;
  setScrollFactor(x: number, y?: number): unknown;
  destroy(): void;
}

export interface TextStyle {
  family?: string; // CSS font family
  size: number; // px
  style?: string; // '', 'bold', 'italic', 'bold italic'
  color?: string; // CSS colour
  stroke?: string; // outline colour
  strokeThickness?: number;
  wrapWidth?: number; // px: wrap lines longer than this
  lineSpacing?: number;
  align?: string; // 'left' | 'center' | 'right'
  background?: string;
  padX?: number;
  padY?: number;
}

export interface BurstDef {
  speedMin: number; // px/s
  speedMax: number;
  angleMin: number; // degrees (0 = right, 90 = down)
  angleMax: number;
  lifespan: number; // s
  gravityY: number; // px/s²
  scale: number;
  depth: number;
}

function ToPhaserStyle(s: TextStyle): Phaser.Types.GameObjects.Text.TextStyle {
  const out: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: s.family ?? 'Georgia, serif',
    fontSize: s.size + 'px',
    fontStyle: s.style ?? '',
    color: s.color ?? '#ffffff',
  };
  if (s.stroke) {
    out.stroke = s.stroke;
    out.strokeThickness = s.strokeThickness ?? 4;
  }
  if (s.wrapWidth) out.wordWrap = { width: s.wrapWidth };
  if (s.lineSpacing) out.lineSpacing = s.lineSpacing;
  if (s.align) out.align = s.align;
  if (s.background) out.backgroundColor = s.background;
  if (s.padX || s.padY) out.padding = { x: s.padX ?? 0, y: s.padY ?? 0 };
  return out;
}

// ---------------------------------------------------------------- handles

/** Base of every handle: position, rotation, scale, alpha, depth, visibility. */
export class Visual {
  protected readonly native: Native;
  private dead = false;

  constructor(native: Native) {
    this.native = native;
  }

  get x(): number { return this.native.x; }
  set x(v: number) { this.native.x = v; }
  get y(): number { return this.native.y; }
  set y(v: number) { this.native.y = v; }
  get rotation(): number { return this.native.rotation; }
  set rotation(v: number) { this.native.rotation = v; }
  get alpha(): number { return this.native.alpha; }
  set alpha(v: number) { this.native.alpha = v; }
  get scaleX(): number { return this.native.scaleX; }
  set scaleX(v: number) { this.native.scaleX = v; }
  get scaleY(): number { return this.native.scaleY; }
  set scaleY(v: number) { this.native.scaleY = v; }
  /** Uniform scale (reads scaleX). */
  get scale(): number { return this.native.scaleX; }
  set scale(v: number) { this.native.scaleX = v; this.native.scaleY = v; }
  get visible(): boolean { return this.native.visible; }
  get depth(): number { return this.native.depth; }
  get destroyed(): boolean { return this.dead; }

  SetPosition(x: number, y: number): this {
    this.native.x = x;
    this.native.y = y;
    return this;
  }

  SetDepth(depth: number): this {
    this.native.setDepth(depth);
    return this;
  }

  SetAlpha(alpha: number): this {
    this.native.alpha = alpha;
    return this;
  }

  SetScale(sx: number, sy: number = sx): this {
    this.native.scaleX = sx;
    this.native.scaleY = sy;
    return this;
  }

  SetRotation(radians: number): this {
    this.native.rotation = radians;
    return this;
  }

  SetVisible(visible: boolean): this {
    this.native.visible = visible;
    return this;
  }

  /** Drawn in screen space: the camera does not move it (HUD, menus, overlays). */
  SetFixed(): this {
    this.native.setScrollFactor(0, 0);
    return this;
  }

  Destroy(): void {
    if (this.dead) return;
    this.dead = true;
    this.native.destroy();
  }

  /** Engine only: the Phaser object underneath (a Group needs it to adopt children). */
  NativeObject(): Phaser.GameObjects.GameObject {
    return this.native as unknown as Phaser.GameObjects.GameObject;
  }

  /** Engine only: marks the handle dead without touching Phaser (its parent destroyed it). */
  MarkDead(): void {
    this.dead = true;
  }
}

/** An image, or one frame of a sprite sheet. Animate it with an Animator (Animation.ts). */
export class Sprite extends Visual {
  private readonly img: Phaser.GameObjects.Image;

  constructor(img: Phaser.GameObjects.Image) {
    super(img);
    this.img = img;
  }

  get textureKey(): string { return this.img.texture.key; }
  get frame(): number { return Number(this.img.frame.name) || 0; }
  get flipX(): boolean { return this.img.flipX; }
  /** Drawn size: frame size x scale. */
  get displayWidth(): number { return this.img.displayWidth; }
  get displayHeight(): number { return this.img.displayHeight; }
  /** Frame size in texture pixels. */
  get width(): number { return this.img.width; }
  get height(): number { return this.img.height; }

  /** (0, 0) = top-left is at (x, y); (0.5, 1) = bottom centre (feet). */
  SetOrigin(ox: number, oy: number = ox): this {
    this.img.setOrigin(ox, oy);
    return this;
  }

  SetTexture(key: string, frame: number = 0): this {
    this.img.setTexture(key, frame);
    return this;
  }

  SetFrame(frame: number): this {
    this.img.setFrame(frame);
    return this;
  }

  SetFlipX(flip: boolean): this {
    this.img.setFlipX(flip);
    return this;
  }

  /** Multiply the colours by `color` (0xffffff = unchanged). */
  SetTint(color: number): this {
    this.img.setTint(color);
    return this;
  }

  /** Paint every opaque pixel `color` (a silhouette). */
  SetTintFill(color: number): this {
    this.img.setTintFill(color);
    return this;
  }

  ClearTint(): this {
    this.img.clearTint();
    return this;
  }

  /** Show only this part of the frame (texture pixels). */
  SetCrop(x: number, y: number, w: number, h: number): this {
    this.img.setCrop(x, y, w, h);
    return this;
  }
}

export class Text extends Visual {
  private readonly txt: Phaser.GameObjects.Text;

  constructor(txt: Phaser.GameObjects.Text) {
    super(txt);
    this.txt = txt;
  }

  get text(): string { return this.txt.text; }
  get width(): number { return this.txt.width; }
  get height(): number { return this.txt.height; }

  SetText(text: string): this {
    if (this.txt.text !== text) this.txt.setText(text);
    return this;
  }

  SetColor(color: string): this {
    this.txt.setColor(color);
    return this;
  }

  SetOrigin(ox: number, oy: number = ox): this {
    this.txt.setOrigin(ox, oy);
    return this;
  }
}

/** Vector drawing (Phaser Graphics). Draw calls add to what is there; Clear() wipes it. */
export class Shape extends Visual {
  private readonly g: Phaser.GameObjects.Graphics;

  constructor(g: Phaser.GameObjects.Graphics) {
    super(g);
    this.g = g;
  }

  Clear(): this { this.g.clear(); return this; }
  FillStyle(color: number, alpha: number = 1): this { this.g.fillStyle(color, alpha); return this; }
  LineStyle(width: number, color: number, alpha: number = 1): this { this.g.lineStyle(width, color, alpha); return this; }
  FillRect(x: number, y: number, w: number, h: number): this { this.g.fillRect(x, y, w, h); return this; }
  StrokeRect(x: number, y: number, w: number, h: number): this { this.g.strokeRect(x, y, w, h); return this; }
  FillCircle(x: number, y: number, r: number): this { this.g.fillCircle(x, y, r); return this; }
  StrokeCircle(x: number, y: number, r: number): this { this.g.strokeCircle(x, y, r); return this; }
  FillRoundedRect(x: number, y: number, w: number, h: number, r: number): this { this.g.fillRoundedRect(x, y, w, h, r); return this; }
  StrokeRoundedRect(x: number, y: number, w: number, h: number, r: number): this { this.g.strokeRoundedRect(x, y, w, h, r); return this; }
  FillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): this {
    this.g.fillTriangle(x0, y0, x1, y1, x2, y2);
    return this;
  }
  Line(x0: number, y0: number, x1: number, y1: number): this { this.g.lineBetween(x0, y0, x1, y1); return this; }

  /** A connected line through the points. */
  StrokePoints(points: Vec2[]): this {
    if (points.length >= 2) this.g.strokePoints(points, false);
    return this;
  }

  /** An arc of a circle, from angle a0 to a1 (radians, clockwise from +x). */
  StrokeArc(x: number, y: number, r: number, a0: number, a1: number): this {
    this.g.beginPath();
    this.g.arc(x, y, r, a0, a1);
    this.g.strokePath();
    return this;
  }
}

/** A container: children are drawn relative to it, and move / scale / fade with it. */
export class Group extends Visual {
  private readonly c: Phaser.GameObjects.Container;
  private readonly children: Visual[] = [];

  constructor(c: Phaser.GameObjects.Container) {
    super(c);
    this.c = c;
  }

  Add(...visuals: Visual[]): this {
    for (let i = 0; i < visuals.length; i++) {
      this.c.add(visuals[i].NativeObject());
      this.children.push(visuals[i]);
    }
    return this;
  }

  Destroy(): void {
    for (let i = 0; i < this.children.length; i++) this.children[i].MarkDead(); // the container destroys them
    super.Destroy();
  }
}

/** A grid of tiles from a tileset image (square tiles, numbered left to right, top to bottom). */
export class TileLayer extends Visual {
  private readonly layer: Phaser.Tilemaps.TilemapLayer;
  private readonly map: Phaser.Tilemaps.Tilemap;

  constructor(layer: Phaser.Tilemaps.TilemapLayer, map: Phaser.Tilemaps.Tilemap) {
    super(layer);
    this.layer = layer;
    this.map = map;
  }

  PutTile(index: number, tx: number, ty: number): this {
    this.layer.putTileAt(index, tx, ty);
    return this;
  }

  Destroy(): void {
    super.Destroy();
    this.map.destroy();
  }
}

/** An image repeated to fill a rectangle; tileX scrolls the pattern (parallax backgrounds). */
export class TilingImage extends Visual {
  private readonly ts: Phaser.GameObjects.TileSprite;

  constructor(ts: Phaser.GameObjects.TileSprite) {
    super(ts);
    this.ts = ts;
  }

  get tileX(): number { return this.ts.tilePositionX; }
  set tileX(v: number) { this.ts.tilePositionX = v; }
}

/** An HTML element over the canvas, scaled with it (real text shaping: Arabic). Fixed to the screen. */
export class HtmlNode extends Visual {}

/**
 * A screen-sized drawing surface (Phaser RenderTexture): fill it, then erase soft holes into it with
 * a texture. The Hard level's night is one.
 */
export class Canvas extends Visual {
  private readonly rt: Phaser.GameObjects.RenderTexture;
  private readonly scene: Phaser.Scene;
  private readonly stamps = new Map<string, Phaser.GameObjects.Image>(); // one off-screen image per texture

  constructor(rt: Phaser.GameObjects.RenderTexture, scene: Phaser.Scene) {
    super(rt);
    this.rt = rt;
    this.scene = scene;
  }

  Clear(): this {
    this.rt.clear();
    return this;
  }

  Fill(color: number, alpha: number): this {
    this.rt.fill(color, alpha);
    return this;
  }

  /** Cut the texture's alpha out of the canvas, centred on (x, y) (canvas pixels). */
  Erase(texture: string, x: number, y: number, alpha: number = 1): this {
    let stamp = this.stamps.get(texture);
    if (!stamp) {
      stamp = this.scene.make.image({ key: texture }, false);
      this.stamps.set(texture, stamp);
    }
    stamp.setAlpha(alpha);
    this.rt.erase(stamp, x, y);
    return this;
  }

  Destroy(): void {
    for (const stamp of this.stamps.values()) stamp.destroy();
    this.stamps.clear();
    super.Destroy();
  }
}

// ---------------------------------------------------------------- the renderer

export class Renderer {
  private scene: Phaser.Scene | null = null;
  private readonly visuals: Visual[] = []; // everything made in the current state
  private layerCount = 0;

  /** Engine only. */
  Attach(scene: Phaser.Scene): void {
    this.scene = scene;
  }

  /** Screen size in pixels (the game's resolution, not the window's). */
  get width(): number { return this.Scene().scale.width; }
  get height(): number { return this.Scene().scale.height; }

  CreateSprite(x: number, y: number, texture: string, frame: number = 0): Sprite {
    return this.Track(new Sprite(this.Scene().add.image(x, y, texture, frame)));
  }

  CreateText(x: number, y: number, text: string, style: TextStyle): Text {
    return this.Track(new Text(this.Scene().add.text(x, y, text, ToPhaserStyle(style))));
  }

  CreateShape(x: number = 0, y: number = 0): Shape {
    return this.Track(new Shape(this.Scene().add.graphics({ x: x, y: y })));
  }

  CreateGroup(x: number, y: number): Group {
    return this.Track(new Group(this.Scene().add.container(x, y)));
  }

  /** An empty tile grid: mapW x mapH tiles of tileSize texture pixels from `tileset`. */
  CreateTileLayer(tileset: string, tileSize: number, mapW: number, mapH: number): TileLayer {
    const scene = this.Scene();
    const map = scene.make.tilemap({ tileWidth: tileSize, tileHeight: tileSize, width: mapW, height: mapH });
    const ts = map.addTilesetImage(tileset, tileset, tileSize, tileSize, 0, 0);
    const layer = ts ? map.createBlankLayer('layer' + this.layerCount++, ts, 0, 0) : null;
    if (!layer) throw new Error('tile layer: tileset "' + tileset + '" is not loaded');
    return this.Track(new TileLayer(layer, map));
  }

  /** Top-left at (x, y), w x h pixels of the texture repeated. */
  CreateTiling(x: number, y: number, w: number, h: number, texture: string): TilingImage {
    return this.Track(new TilingImage(this.Scene().add.tileSprite(x, y, w, h, texture).setOrigin(0, 0)));
  }

  /** An HTML element centred on screen point (x, y). */
  CreateHtml(x: number, y: number, element: HTMLElement): HtmlNode {
    return this.Track(new HtmlNode(this.Scene().add.dom(x, y, element).setScrollFactor(0)));
  }

  /** A w x h canvas with its top-left at (x, y). */
  CreateCanvas(x: number, y: number, w: number, h: number): Canvas {
    const scene = this.Scene();
    return this.Track(new Canvas(scene.add.renderTexture(x, y, w, h).setOrigin(0, 0), scene));
  }

  /** `count` particles fly out of (x, y) at once and fade; they clean themselves up. */
  Burst(x: number, y: number, texture: string, count: number, def: BurstDef): void {
    const scene = this.Scene();
    const emitter = scene.add.particles(x, y, texture, {
      speed: { min: def.speedMin, max: def.speedMax },
      angle: { min: def.angleMin, max: def.angleMax },
      lifespan: def.lifespan * 1000,
      gravityY: def.gravityY,
      scale: def.scale,
      emitting: false,
    });
    emitter.setDepth(def.depth);
    emitter.explode(count);
    const handle = this.Track(new Visual(emitter));
    scene.time.delayedCall(def.lifespan * 1000 + 250, () => handle.Destroy());
  }

  /** Engine only: the state ended, every visual it made goes. */
  DestroyAll(): void {
    for (let i = this.visuals.length - 1; i >= 0; i--) this.visuals[i].Destroy();
    this.visuals.length = 0;
  }

  private Track<T extends Visual>(v: T): T {
    this.visuals.push(v);
    return v;
  }

  private Scene(): Phaser.Scene {
    if (!this.scene) throw new Error('Renderer used before Engine.Run()');
    return this.scene;
  }
}
