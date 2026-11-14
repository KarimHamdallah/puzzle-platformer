import Phaser from 'phaser';
import { TILE } from './constants';
import type { NoiseSystem } from './Noise';
import type { Player } from './Player';
import { ZombieKind, type Zombie } from './Zombie';

/**
 * Hard level: night, and the Listen Mode upgrade.
 *  - Darkness: everything past ~5 tiles from the player is black (a screen-space layer with a soft
 *    hole of light around him). HUD, aim arc and noise rings draw above it.
 *  - Clicks: every Clicker flashes a little light at its head every 2-3 s. In the dark, that is how
 *    you find them.
 *  - Lightning: every 12-20 s the whole level flashes white; the thunder follows a second later and
 *    masks footsteps and landings for THUNDER_MASK s (the HUD boot turns blue). Cross while it rolls.
 *  - Listen Mode (hold Q, any level once unlocked): frozen and crouched, the world goes grey and every
 *    infected within LISTEN_RANGE shows as a white silhouette, through walls and darkness.
 */

const DARKNESS = 0.92; // alpha of the night
const LIGHT_RADIUS = 5.5; // tiles
const CLICK_RADIUS = 1.4; // tiles of light a click shows
const CLICK_TIME = 0.35; // s
const CLICK_MIN = 1.8; // s between clicks
const CLICK_MAX = 3.2;
const FIRST_STRIKE = 7; // s
const STRIKE_MIN = 12;
const STRIKE_MAX = 20;
const THUNDER_DELAY = 1; // s from the lightning to the thunder
const THUNDER_MASK = 2; // s of masked footsteps
const LISTEN_RANGE = 20; // tiles
const DEPTH_NIGHT = 40; // above the world, below the HUD (50); rings / aim / silhouettes go above it

// Lightning brightness over time (s after the strike): a double flash, then a fade back to night.
const FLASH_KEYS: [number, number][] = [[0, 1], [0.08, 0.35], [0.14, 1], [0.24, 0.7], [0.7, 0]];

interface Click {
  x: number;
  y: number;
  age: number;
}

export class Blackout {
  private readonly scene: Phaser.Scene;
  private readonly player: Player;
  private readonly zombies: Zombie[];
  private readonly noise: NoiseSystem;
  private readonly night: boolean;
  private darkness: Phaser.GameObjects.RenderTexture | null = null;
  private lightImg: Phaser.GameObjects.Image | null = null;
  private clickImg: Phaser.GameObjects.Image | null = null;
  private readonly clicks: Click[] = [];
  private readonly clickTimers = new Map<Zombie, number>();
  private strikeTimer = FIRST_STRIKE;
  private flashAge = -1; // s since the last lightning, -1 = none in progress
  private thunderTimer = -1; // s until the thunder, -1 = none pending
  private grey: Phaser.FX.ColorMatrix | null = null;
  private readonly ghosts: Phaser.GameObjects.Sprite[] = []; // Listen Mode silhouettes

  constructor(scene: Phaser.Scene, player: Player, zombies: Zombie[], noise: NoiseSystem, night: boolean) {
    this.scene = scene;
    this.player = player;
    this.zombies = zombies;
    this.noise = noise;
    this.night = night;
    const cam = scene.cameras.main;
    if (cam.postFX) {
      this.grey = cam.postFX.addColorMatrix();
      this.grey.active = false;
    }
    if (!night) return;
    makeLightTexture(scene, 'light_player', LIGHT_RADIUS * TILE);
    makeLightTexture(scene, 'light_click', CLICK_RADIUS * TILE);
    this.darkness = scene.add.renderTexture(0, 0, scene.scale.width, scene.scale.height)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH_NIGHT);
    this.lightImg = scene.make.image({ key: 'light_player' }, false);
    this.clickImg = scene.make.image({ key: 'light_click' }, false);
  }

  destroy(): void {
    if (this.lightImg) this.lightImg.destroy();
    if (this.clickImg) this.clickImg.destroy();
  }

  /** Once per frame, after the camera moved. */
  update(deltaMs: number): void {
    const dt = deltaMs / 1000;
    this.updateListen();
    if (!this.night || !this.darkness || !this.lightImg || !this.clickImg) return;
    this.updateClicks(dt);
    this.updateWeather(dt);

    const cam = this.scene.cameras.main;
    const flash = this.flashAge >= 0 ? flashAt(this.flashAge) : 0;
    const rt = this.darkness;
    rt.clear();
    rt.fill(0x04050a, DARKNESS * (1 - flash));
    rt.erase(this.lightImg, this.player.feetX - cam.scrollX, this.player.feetY - TILE * 0.9 - cam.scrollY);
    for (let i = 0; i < this.clicks.length; i++) {
      const c = this.clicks[i];
      this.clickImg.setAlpha(1 - c.age / CLICK_TIME);
      rt.erase(this.clickImg, c.x - cam.scrollX, c.y - cam.scrollY);
    }
  }

  private updateClicks(dt: number): void {
    for (let i = this.clicks.length - 1; i >= 0; i--) {
      this.clicks[i].age += dt;
      if (this.clicks[i].age >= CLICK_TIME) this.clicks.splice(i, 1);
    }
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      if (z.kind !== ZombieKind.Clicker || !z.alive) continue;
      const t = (this.clickTimers.get(z) ?? Math.random() * CLICK_MAX) - dt;
      if (t > 0) {
        this.clickTimers.set(z, t);
        continue;
      }
      this.clickTimers.set(z, CLICK_MIN + Math.random() * (CLICK_MAX - CLICK_MIN));
      this.clicks.push({ x: z.feetX, y: z.feetY - z.body.height * 0.85, age: 0 });
    }
  }

  private updateWeather(dt: number): void {
    if (this.flashAge >= 0) {
      this.flashAge += dt;
      if (this.flashAge > FLASH_KEYS[FLASH_KEYS.length - 1][0]) this.flashAge = -1;
    }
    if (this.thunderTimer >= 0) {
      this.thunderTimer -= dt;
      if (this.thunderTimer < 0) { // the thunder: footsteps are drowned out for a moment
        this.scene.cameras.main.shake(500, 0.004);
        this.noise.maskTimer = THUNDER_MASK;
      }
    }
    this.strikeTimer -= dt;
    if (this.strikeTimer <= 0) {
      this.strikeTimer = STRIKE_MIN + Math.random() * (STRIKE_MAX - STRIKE_MIN);
      this.flashAge = 0;
      this.thunderTimer = THUNDER_DELAY;
    }
  }

  /** Listen Mode: grey world + white silhouettes of every infected in range, above walls and night. */
  private updateListen(): void {
    const on = this.player.listening;
    if (this.grey) {
      if (on && !this.grey.active) {
        this.grey.active = true;
        this.grey.grayscale(1);
      } else if (!on && this.grey.active) {
        this.grey.active = false;
      }
    }
    let used = 0;
    if (on) {
      const range = LISTEN_RANGE * TILE;
      const pulse = 0.75 + Math.sin(this.scene.time.now / 160) * 0.2;
      for (let i = 0; i < this.zombies.length; i++) {
        const z = this.zombies[i];
        if (!z.alive || Math.abs(z.feetX - this.player.feetX) > range || Math.abs(z.feetY - this.player.feetY) > range) continue;
        if (used === this.ghosts.length) {
          this.ghosts.push(this.scene.add.sprite(0, 0, z.view.texture.key).setOrigin(0.5, 1).setDepth(45).setTintFill(0xffffff));
        }
        const g = this.ghosts[used++];
        const v = z.view;
        g.setTexture(v.texture.key, v.frame.name).setPosition(v.x, v.y).setFlipX(v.flipX).setScale(v.scaleX, v.scaleY)
          .setAlpha(pulse).setVisible(true);
      }
    }
    for (let i = used; i < this.ghosts.length; i++) this.ghosts[i].setVisible(false);
  }
}

/** Brightness of the lightning `age` s after the strike (piecewise linear between FLASH_KEYS). */
function flashAt(age: number): number {
  for (let i = 1; i < FLASH_KEYS.length; i++) {
    const a = FLASH_KEYS[i - 1];
    const b = FLASH_KEYS[i];
    if (age <= b[0]) return a[1] + (b[1] - a[1]) * ((age - a[0]) / (b[0] - a[0]));
  }
  return 0;
}

/** A white disc that fades to transparent at its edge: erasing it from the night makes a soft light. */
function makeLightTexture(scene: Phaser.Scene, key: string, radius: number): void {
  if (scene.textures.exists(key)) return;
  const size = Math.ceil(radius * 2);
  const tex = scene.textures.createCanvas(key, size, size);
  if (!tex) return;
  const ctx = tex.getContext();
  const grad = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  tex.refresh();
}
