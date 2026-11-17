import type { Canvas, Engine, Shape, Sprite } from '../../engine';
import { Serif, TILE } from '../constants';
import type { Player } from '../entities/Player';
import { ZombieKind, type Zombie } from '../entities/Zombie';
import type { NoiseSystem } from './Noise';

/**
 * Hard level: night, and the Listen Mode upgrade.
 *  - Darkness: everything past ~3.5 tiles from the player is black (a screen-space canvas with a soft
 *    hole of light around him). HUD, aim arc and noise rings draw above it.
 *  - Clicks: every Clicker flashes a little light at its head every 2-3 s. In the dark, that is how
 *    you find them.
 *  - Lightning: every 12-20 s the whole level flashes white; the thunder follows a second later and
 *    masks footsteps and landings for THUNDER_MASK s (the HUD boot turns blue). Cross while it rolls.
 *  - Listen Mode (hold Q, any level once unlocked): frozen and crouched, the world goes grey and every
 *    infected within LISTEN_RANGE shows as a white silhouette, through walls and darkness. It runs on
 *    a charge (Player.listenEnergy): ~4 s of listening, then a full recharge before it works again.
 *    The HUD bar next to the boot shows it: blue = ready, red = recharging after running dry.
 */

const DARKNESS = 0.92; // alpha of the night
const LIGHT_RADIUS = 3.5; // tiles
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
const BAR_X = 290; // listen bar (HUD, screen px): right of the noise meter
const BAR_Y = 38;
const BAR_W = 150;
const BAR_H = 12;
const BAR_READY = 0x8fc8ff;
const BAR_EMPTY = 0xff6a58;
const DEPTH_NIGHT = 40; // above the world, below the HUD (50); rings / aim / silhouettes go above it
const LIGHT_PLAYER = 'light_player';
const LIGHT_CLICK = 'light_click';

// Lightning brightness over time (s after the strike): a double flash, then a fade back to night.
const FLASH_KEYS: [number, number][] = [[0, 1], [0.08, 0.35], [0.14, 1], [0.24, 0.7], [0.7, 0]];

interface Click {
  x: number;
  y: number;
  age: number;
}

export class Blackout {
  private readonly engine: Engine;
  private readonly player: Player;
  private readonly zombies: Zombie[];
  private readonly noise: NoiseSystem;
  private readonly night: boolean;
  private darkness: Canvas | null = null;
  private readonly clicks: Click[] = [];
  private readonly clickTimers = new Map<Zombie, number>();
  private strikeTimer = FIRST_STRIKE;
  private flashAge = -1; // s since the last lightning, -1 = none in progress
  private thunderTimer = -1; // s until the thunder, -1 = none pending
  private readonly ghosts: Sprite[] = []; // Listen Mode silhouettes
  private bar: Shape | null = null;

  constructor(engine: Engine, player: Player, zombies: Zombie[], noise: NoiseSystem, night: boolean) {
    this.engine = engine;
    this.player = player;
    this.zombies = zombies;
    this.noise = noise;
    this.night = night;
    const r = engine.renderer;
    if (player.canListen) {
      this.bar = r.CreateShape().SetFixed().SetDepth(50);
      r.CreateText(BAR_X, BAR_Y - 4, 'LISTEN  Q', Serif(16, 'bold', undefined, 4)).SetOrigin(0, 1).SetFixed().SetDepth(50);
    }
    if (!night) return;
    MakeLightTexture(engine, LIGHT_PLAYER, LIGHT_RADIUS * TILE);
    MakeLightTexture(engine, LIGHT_CLICK, CLICK_RADIUS * TILE);
    this.darkness = r.CreateCanvas(0, 0, engine.width, engine.height).SetFixed().SetDepth(DEPTH_NIGHT);
  }

  /** Once per frame, after the camera moved. */
  Update(dt: number): void {
    this.UpdateListen();
    this.DrawBar();
    if (!this.night || !this.darkness) return;
    this.UpdateClicks(dt);
    this.UpdateWeather(dt);

    const cam = this.engine.camera;
    const flash = this.flashAge >= 0 ? FlashAt(this.flashAge) : 0;
    const night = this.darkness;
    night.Clear();
    night.Fill(0x04050a, DARKNESS * (1 - flash));
    night.Erase(LIGHT_PLAYER, this.player.feetX - cam.scrollX, this.player.feetY - TILE * 0.9 - cam.scrollY);
    for (let i = 0; i < this.clicks.length; i++) {
      const c = this.clicks[i];
      night.Erase(LIGHT_CLICK, c.x - cam.scrollX, c.y - cam.scrollY, 1 - c.age / CLICK_TIME);
    }
  }

  private UpdateClicks(dt: number): void {
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

  private UpdateWeather(dt: number): void {
    if (this.flashAge >= 0) {
      this.flashAge += dt;
      if (this.flashAge > FLASH_KEYS[FLASH_KEYS.length - 1][0]) this.flashAge = -1;
    }
    if (this.thunderTimer >= 0) {
      this.thunderTimer -= dt;
      if (this.thunderTimer < 0) { // the thunder: footsteps are drowned out for a moment
        this.engine.camera.Shake(0.5, 0.004);
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
  private UpdateListen(): void {
    const on = this.player.listening;
    this.engine.camera.SetGrayscale(on);
    let used = 0;
    if (on) {
      const range = LISTEN_RANGE * TILE;
      const pulse = 0.75 + Math.sin(this.engine.clock.nowMs / 160) * 0.2;
      for (let i = 0; i < this.zombies.length; i++) {
        const z = this.zombies[i];
        if (!z.alive || Math.abs(z.feetX - this.player.feetX) > range || Math.abs(z.feetY - this.player.feetY) > range) continue;
        const v = z.view;
        if (used === this.ghosts.length) {
          this.ghosts.push(this.engine.renderer.CreateSprite(0, 0, v.textureKey).SetOrigin(0.5, 1).SetDepth(45).SetTintFill(0xffffff));
        }
        const g = this.ghosts[used++];
        g.SetTexture(v.textureKey, v.frame).SetPosition(v.x, v.y).SetFlipX(v.flipX).SetScale(v.scaleX, v.scaleY)
          .SetAlpha(pulse).SetVisible(true);
      }
    }
    for (let i = used; i < this.ghosts.length; i++) this.ghosts[i].SetVisible(false);
  }

  /** Listen charge: blue while usable, red while recharging after running dry. */
  private DrawBar(): void {
    if (!this.bar) return;
    const p = this.player;
    const g = this.bar;
    g.Clear();
    g.FillStyle(0x000000, 0.65).FillRect(BAR_X - 3, BAR_Y - 3, BAR_W + 6, BAR_H + 6);
    g.FillStyle(p.listenExhausted ? BAR_EMPTY : BAR_READY, p.listening ? 1 : 0.85);
    g.FillRect(BAR_X, BAR_Y, BAR_W * p.listenEnergy, BAR_H);
  }
}

/** Brightness of the lightning `age` s after the strike (piecewise linear between FLASH_KEYS). */
function FlashAt(age: number): number {
  for (let i = 1; i < FLASH_KEYS.length; i++) {
    const a = FLASH_KEYS[i - 1];
    const b = FLASH_KEYS[i];
    if (age <= b[0]) return a[1] + (b[1] - a[1]) * ((age - a[0]) / (b[0] - a[0]));
  }
  return 0;
}

/** A white disc that fades to transparent at its edge: erasing it from the night makes a soft light. */
function MakeLightTexture(engine: Engine, key: string, radius: number): void {
  const size = Math.ceil(radius * 2);
  engine.assets.CreateCanvasTexture(key, size, size, (ctx) => {
    const grad = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  });
}
