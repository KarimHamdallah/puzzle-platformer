import Phaser from 'phaser';
import { Action, type InputActions } from '../core/InputActions';
import { ART_SCALE, TILE } from './constants';
import type { Dialogue } from './Dialogue';
import type { LevelProgress } from './Levels';
import type { Player } from './Player';
import type { Throwables } from './Throwing';

/**
 * Mechanic 2 Medium: the smoke grenades.
 *  1. Area 2: the machine gun covers open ground and nothing can draw its fire. He thinks of the army
 *     ammo crate he saw under the tower (the overlook trigger).
 *  2. Back through area 1 (crates already cracked), up the scaffolding to the ledge under the tower:
 *     the crate holds SMOKE_PER_CACHE smoke grenades (opened before step 1, it is "nothing I need").
 *  3. A smoke grenade is thrown like a bottle. Its cloud is cover: the laser and the bullets stop at it
 *     for SMOKE_TIME, so the gunner can't see you cross.
 */

const CACHE_EARLY = [
  'صندوق ذخيرةٍ للجيش... رصاصٌ لا يناسب أي سلاحٍ معي، وحصص طعامٍ فاسدة.',
  'لا شيء أحتاجه هنا.',
];
const GUNNER_SEEN = [
  'رشّاشٌ فوق البيت الأخير... والأرض أمامه مكشوفةٌ تمامًا.',
  'لا صناديق، ولا شيء يشغله عني. لن أصل إلى منتصفها حيًّا.',
  'لو أعميته لحظة... كان هناك صندوق ذخيرةٍ للجيش تحت البرج، فوق السقالات. ربما فيه ما يفيد.',
];
const CACHE_LOOT = [
  'قنابل دخان!',
  'لا يستطيع أن يصيب ما لا يراه.',
];

const SMOKE_PER_CACHE = 2;
const SMOKE_TIME = 5; // s the cloud blocks fire
const SMOKE_W = 7; // tiles
const SMOKE_H = 4.6;
const PUFFS = 12;
const READ_RANGE_X = 1.6 * TILE;
const READ_RANGE_Y = 0.8 * TILE;

interface Cloud {
  rect: Phaser.Geom.Rectangle;
  puffs: Phaser.GameObjects.Image[];
  age: number;
}

export class SmokeQuest {
  private readonly scene: Phaser.Scene;
  private readonly input: InputActions;
  private readonly dialogue: Dialogue;
  private readonly progress: LevelProgress;
  private readonly throwables: Throwables;
  private readonly covers: Phaser.Geom.Rectangle[];
  private readonly banner: (text: string, ms: number) => void;
  private readonly clouds: Cloud[] = [];
  quietLoot = false; // the crate just gives the grenades (a banner, no dialogue): smoke is nothing new here
  private gunnerSeenX = Infinity; // px: walking past this, he sees the machine gun's ground
  private cache: Phaser.GameObjects.Image | null = null;
  private cacheX = 0;
  private cacheY = 0;
  private marker: Phaser.GameObjects.Text | null = null;
  private prompt: Phaser.GameObjects.Text | null = null;

  constructor(scene: Phaser.Scene, input: InputActions, dialogue: Dialogue, progress: LevelProgress, throwables: Throwables,
    covers: Phaser.Geom.Rectangle[], banner: (text: string, ms: number) => void) {
    this.scene = scene;
    this.input = input;
    this.dialogue = dialogue;
    this.progress = progress;
    this.throwables = throwables;
    this.covers = covers;
    this.banner = banner;
    throwables.smokes = progress.smokes; // carried over a death
    throwables.onSmoke = (x, y) => this.cloud(x, y);
    if (!scene.textures.exists('smoke_puff')) makePuffTexture(scene);
  }

  /** tileX <= 0: no such moment in this level (the threat is obvious from the start): the crate opens. */
  setGunnerSeenAt(tileX: number): void {
    if (tileX <= 0) {
      this.progress.sawGunner = true;
      return;
    }
    this.gunnerSeenX = tileX * TILE;
  }

  addCache(feetX: number, feetY: number): void {
    this.cacheX = feetX;
    this.cacheY = feetY;
    this.cache = this.scene.add.image(feetX, feetY + 2, this.progress.cacheLooted ? 'ammo_crate_open' : 'ammo_crate')
      .setOrigin(0.5, 1).setScale(ART_SCALE).setDepth(11.5);
    this.marker = this.scene.add.text(feetX, feetY - TILE * 1.3, '!', {
      fontFamily: 'Georgia, serif', fontSize: '56px', fontStyle: 'bold', color: '#ffd24a', stroke: '#000000', strokeThickness: 8,
    }).setOrigin(0.5, 1).setDepth(25).setVisible(false);
    this.prompt = this.scene.add.text(feetX, feetY - TILE * 1.35, '↑  Open', {
      fontFamily: 'Georgia, serif', fontSize: '26px', fontStyle: 'bold', color: '#f0e6c8', stroke: '#000000', strokeThickness: 5,
    }).setOrigin(0.5, 1).setDepth(25).setVisible(false);
  }

  /** Once per frame, after input. May open a dialogue (the scene pauses while it is open). */
  update(timeMs: number, player: Player): void {
    const p = this.progress;
    p.smokes = this.throwables.smokes;
    if (!p.sawGunner && !player.dead && player.feetX > this.gunnerSeenX) {
      p.sawGunner = true;
      this.dialogue.show(GUNNER_SEEN);
      return;
    }
    if (!this.cache || !this.marker || !this.prompt) return;
    const near = !player.dead && Math.abs(player.feetX - this.cacheX) < READ_RANGE_X && Math.abs(player.feetY - this.cacheY) < READ_RANGE_Y;
    this.prompt.setVisible(near && !p.cacheLooted);
    this.marker.setVisible(!near && p.sawGunner && !p.cacheLooted);
    this.marker.y = this.cacheY - TILE * 1.3 + Math.sin(timeMs / 220) * 8;
    if (!near || p.cacheLooted || !this.input.pressed(Action.Up) || this.input.held(Action.Throw)) return;
    if (!p.sawGunner) {
      this.dialogue.show(CACHE_EARLY);
      return;
    }
    p.cacheLooted = true;
    this.throwables.smokes += SMOKE_PER_CACHE;
    p.smokes = this.throwables.smokes;
    this.cache.setTexture('ammo_crate_open');
    if (this.quietLoot) this.banner('+' + SMOKE_PER_CACHE + ' SMOKE GRENADES', 1600);
    else this.dialogue.show(CACHE_LOOT, () => this.banner('NEW SKILL: SMOKE GRENADE  (throw with E)', 2800));
  }

  /** Smoke lifetimes, at the physics rate: a cloud stops being cover when it thins out. */
  fixedUpdate(dt: number): void {
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.age += dt;
      if (c.age < SMOKE_TIME) continue;
      const idx = this.covers.indexOf(c.rect);
      if (idx >= 0) this.covers.splice(idx, 1);
      for (let j = 0; j < c.puffs.length; j++) {
        const puff = c.puffs[j];
        this.scene.tweens.add({ targets: puff, alpha: 0, duration: 800, onComplete: () => puff.destroy() });
      }
      this.clouds.splice(i, 1);
    }
  }

  /** The grenade landed: a cloud grows there, a cover rectangle the soldiers can't see through. */
  private cloud(x: number, y: number): void {
    const w = SMOKE_W * TILE;
    const h = SMOKE_H * TILE;
    const rect = new Phaser.Geom.Rectangle(x - w / 2, y - h + TILE * 0.3, w, h);
    this.covers.push(rect);
    const puffs: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < PUFFS; i++) {
      const px = rect.x + TILE * 0.6 + Math.random() * (w - TILE * 1.2);
      const py = rect.y + TILE * 0.8 + Math.random() * (h - TILE * 1.4);
      const puff = this.scene.add.image(x, y - TILE * 0.3, 'smoke_puff').setDepth(20).setAlpha(0.9).setScale(0.2);
      this.scene.tweens.add({ targets: puff, x: px, y: py, scale: 1.4 + Math.random() * 0.8, duration: 450 + Math.random() * 350, ease: 'Quad.easeOut' });
      this.scene.tweens.add({ targets: puff, x: px + (Math.random() - 0.5) * 40, y: py - 20, duration: SMOKE_TIME * 1000, delay: 800, ease: 'Sine.easeInOut' });
      puffs.push(puff);
    }
    this.clouds.push({ rect: rect, puffs: puffs, age: 0 });
  }
}

/** A soft grey puff (radial gradient), 128 px. */
function makePuffTexture(scene: Phaser.Scene): void {
  const size = 128;
  const tex = scene.textures.createCanvas('smoke_puff', size, size);
  if (!tex) return;
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(206,204,196,0.95)');
  g.addColorStop(0.55, 'rgba(176,174,166,0.75)');
  g.addColorStop(1, 'rgba(150,148,140,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.refresh();
}
