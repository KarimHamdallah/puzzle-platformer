import { Ease, MathUtil, Rect, type Engine, type Sprite, type Text } from '../../engine';
import { Action } from '../Actions';
import { ART_SCALE, GOLD, Serif, TILE } from '../constants';
import type { Player } from '../entities/Player';
import type { LevelProgress } from '../levels/Levels';
import type { Dialogue } from '../ui/Dialogue';
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
  rect: Rect;
  puffs: Sprite[];
  age: number;
}

export class SmokeQuest {
  quietLoot = false; // the crate just gives the grenades (a banner, no dialogue): smoke is nothing new here

  private readonly engine: Engine;
  private readonly dialogue: Dialogue;
  private readonly progress: LevelProgress;
  private readonly throwables: Throwables;
  private readonly covers: Rect[];
  private readonly banner: (text: string, seconds: number) => void;
  private readonly clouds: Cloud[] = [];
  private gunnerSeenX = Infinity; // px: walking past this, he sees the machine gun's ground
  private cache: Sprite | null = null;
  private cacheX = 0;
  private cacheY = 0;
  private marker: Text | null = null;
  private prompt: Text | null = null;

  constructor(engine: Engine, dialogue: Dialogue, progress: LevelProgress, throwables: Throwables,
    covers: Rect[], banner: (text: string, seconds: number) => void) {
    this.engine = engine;
    this.dialogue = dialogue;
    this.progress = progress;
    this.throwables = throwables;
    this.covers = covers;
    this.banner = banner;
    throwables.smokes = progress.smokes; // carried over a death
    throwables.onSmoke = (x, y) => this.Cloud(x, y);
    engine.assets.CreateCanvasTexture('smoke_puff', 128, 128, DrawPuff);
  }

  /** tileX <= 0: no such moment in this level (the threat is obvious from the start): the crate opens. */
  SetGunnerSeenAt(tileX: number): void {
    if (tileX <= 0) {
      this.progress.sawGunner = true;
      return;
    }
    this.gunnerSeenX = tileX * TILE;
  }

  AddCache(feetX: number, feetY: number): void {
    const r = this.engine.renderer;
    this.cacheX = feetX;
    this.cacheY = feetY;
    this.cache = r.CreateSprite(feetX, feetY + 2, this.progress.cacheLooted ? 'ammo_crate_open' : 'ammo_crate')
      .SetOrigin(0.5, 1).SetScale(ART_SCALE).SetDepth(11.5);
    this.marker = r.CreateText(feetX, feetY - TILE * 1.3, '!', Serif(56, 'bold', GOLD, 8)).SetOrigin(0.5, 1).SetDepth(25).SetVisible(false);
    this.prompt = r.CreateText(feetX, feetY - TILE * 1.35, '↑  Open', Serif(26)).SetOrigin(0.5, 1).SetDepth(25).SetVisible(false);
  }

  /** Once per frame, after input. May open a dialogue (the world pauses while it is open). */
  Update(timeMs: number, player: Player): void {
    const p = this.progress;
    const input = this.engine.input;
    p.smokes = this.throwables.smokes;
    if (!p.sawGunner && !player.dead && player.feetX > this.gunnerSeenX) {
      p.sawGunner = true;
      this.dialogue.Show(GUNNER_SEEN);
      return;
    }
    if (!this.cache || !this.marker || !this.prompt) return;
    const near = !player.dead && Math.abs(player.feetX - this.cacheX) < READ_RANGE_X && Math.abs(player.feetY - this.cacheY) < READ_RANGE_Y;
    this.prompt.SetVisible(near && !p.cacheLooted);
    this.marker.SetVisible(!near && p.sawGunner && !p.cacheLooted);
    this.marker.y = this.cacheY - TILE * 1.3 + Math.sin(timeMs / 220) * 8;
    if (!near || p.cacheLooted || !input.Pressed(Action.Up) || input.Held(Action.Throw)) return;
    if (!p.sawGunner) {
      this.dialogue.Show(CACHE_EARLY);
      return;
    }
    p.cacheLooted = true;
    this.throwables.smokes += SMOKE_PER_CACHE;
    p.smokes = this.throwables.smokes;
    this.cache.SetTexture('ammo_crate_open');
    if (this.quietLoot) this.banner('+' + SMOKE_PER_CACHE + ' SMOKE GRENADES', 1.6);
    else this.dialogue.Show(CACHE_LOOT, () => this.banner('NEW SKILL: SMOKE GRENADE  (throw with E)', 2.8));
  }

  /** Smoke lifetimes, at the physics rate: a cloud stops being cover when it thins out. */
  FixedUpdate(dt: number): void {
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.age += dt;
      if (c.age < SMOKE_TIME) continue;
      const idx = this.covers.indexOf(c.rect);
      if (idx >= 0) this.covers.splice(idx, 1);
      for (let j = 0; j < c.puffs.length; j++) {
        const puff = c.puffs[j];
        this.engine.tweens.Kill(puff);
        this.engine.tweens.To(puff, { alpha: 0 }, 0.8, { onDone: () => puff.Destroy() });
      }
      this.clouds.splice(i, 1);
    }
  }

  /** The grenade landed: a cloud grows there, a cover rectangle the soldiers can't see through. */
  private Cloud(x: number, y: number): void {
    const w = SMOKE_W * TILE;
    const h = SMOKE_H * TILE;
    const rect = new Rect(x - w / 2, y - h + TILE * 0.3, w, h);
    this.covers.push(rect);
    const puffs: Sprite[] = [];
    const tw = this.engine.tweens;
    for (let i = 0; i < PUFFS; i++) {
      const px = rect.x + TILE * 0.6 + Math.random() * (w - TILE * 1.2);
      const py = rect.y + TILE * 0.8 + Math.random() * (h - TILE * 1.4);
      const puff = this.engine.renderer.CreateSprite(x, y - TILE * 0.3, 'smoke_puff').SetDepth(20).SetAlpha(0.9).SetScale(0.2);
      // grows out of the impact, then drifts for as long as it lasts
      tw.To(puff, { x: px, y: py, scale: MathUtil.RandomRange(1.4, 2.2) }, MathUtil.RandomRange(0.45, 0.8), { ease: Ease.QuadOut });
      tw.To(puff, { x: px + (Math.random() - 0.5) * 40, y: py - 20 }, SMOKE_TIME, { delay: 0.8, ease: Ease.SineInOut });
      puffs.push(puff);
    }
    this.clouds.push({ rect: rect, puffs: puffs, age: 0 });
  }
}

/** A soft grey puff (radial gradient), 128 px. */
function DrawPuff(ctx: CanvasRenderingContext2D): void {
  const size = 128;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(206,204,196,0.95)');
  g.addColorStop(0.55, 'rgba(176,174,166,0.75)');
  g.addColorStop(1, 'rgba(150,148,140,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}
