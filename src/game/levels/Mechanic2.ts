import { Rect, type Engine, type Sprite, type Text } from '../../engine';
import { Action } from '../Actions';
import { ART_SCALE, CREAM, Serif, TILE } from '../constants';
import { Helicopter } from '../entities/Helicopter';
import { SmokeQuest } from '../systems/Smoke';
import { BaseLevel } from './BaseLevel';
import { LEVELS } from './Levels';

/**
 * Mechanic 2: snipers. The army shoots anything that moves: read the laser, move between shots, let
 * the infected draw the fire. Medium and Hard add smoke grenades (SmokeLevel).
 */

const HUD_UNSELECTED_ALPHA = 0.35; // HUD: the throwable the next throw won't use

/** Easy: a sniper tower, then a machine gun. The dead soldier's newspaper is the guide. */
export class M2Easy extends BaseLevel {
  constructor(engine: Engine) {
    super(engine, LEVELS[3]);
  }

  protected OnLevelStart(): void {
    this.CreateSnipers();
  }
}

/**
 * A level with smoke grenades: the ammo crate ('Y'), the smoke HUD, Tab to choose bottle or smoke,
 * and the cheat refills smoke too.
 */
abstract class SmokeLevel extends BaseLevel {
  protected smokeQuest!: SmokeQuest;
  private hudSmoke!: Sprite;
  private hudSmokeCount!: Text;
  private smokesBeforeCheat = 0;

  protected OnLevelCreate(): void {
    const lv = this.level;
    if (lv.startSmokes > 0 && !this.progress.introSeen) this.progress.smokes = lv.startSmokes; // first start only
    this.cheatSmoke = true;
    this.smokeQuest = new SmokeQuest(this.engine, this.EnsureDialogue(), this.progress, this.throwables, this.covers,
      (text, seconds) => this.Banner(text, seconds));
    this.smokeQuest.SetGunnerSeenAt(lv.gunnerSeenAt);
  }

  protected SpawnTile(c: string, _tx: number, _ty: number, feetX: number, feetY: number): boolean {
    if (c !== 'Y') return false;
    this.smokeQuest.AddCache(feetX, feetY);
    return true;
  }

  protected CreateLevelHud(): void {
    const r = this.engine.renderer;
    this.hudSmoke = r.CreateSprite(48, 168, 'smoke_grenade').SetScale(ART_SCALE * 2.2).SetFixed().SetDepth(50).SetVisible(false);
    this.hudSmokeCount = r.CreateText(80, 168, '', Serif(40, 'bold', CREAM, 6)).SetOrigin(0, 0.5).SetFixed().SetDepth(50).SetVisible(false);
  }

  protected OnLevelInput(timeMs: number): boolean {
    this.smokeQuest.Update(timeMs, this.player);
    this.AfterSmokeQuest();
    return this.dialogue !== null && this.dialogue.open;
  }

  /** Right after the smoke quest's frame (it may have just seen the machine gun). */
  protected AfterSmokeQuest(): void {}

  protected OnLevelFixedUpdate(dt: number): void {
    this.smokeQuest.FixedUpdate(dt);
  }

  protected OnLevelUpdate(_dt: number, _timeMs: number): void {
    const t = this.throwables;
    if (this.engine.input.Pressed(Action.Swap)) t.preferSmoke = !t.preferSmoke;
    if (this.cheating && t.smokes < 9) t.smokes = 9;
    const n = t.smokes;
    this.hudSmoke.SetVisible(n > 0);
    this.hudSmokeCount.SetVisible(n > 0).SetText('x ' + n);
    // holding both: the one the next throw uses is lit, the other dim
    const both = n > 0 && t.count > 0;
    const smokeNext = t.smokeNext;
    this.hudSmoke.SetAlpha(both && !smokeNext ? HUD_UNSELECTED_ALPHA : 1);
    this.hudSmokeCount.SetAlpha(both && !smokeNext ? HUD_UNSELECTED_ALPHA : 1);
    this.hudBottle.SetAlpha(both && smokeNext ? HUD_UNSELECTED_ALPHA : 1);
    this.hudCount.SetAlpha(both && smokeNext ? HUD_UNSELECTED_ALPHA : 1);
  }

  protected OnCheat(): void {
    if (this.cheating) this.smokesBeforeCheat = this.throwables.smokes;
    else this.throwables.smokes = this.smokesBeforeCheat;
  }
}

/**
 * Medium: crates break under fire, the sniper reloads at random, and the machine gun covers open
 * ground. Steal smoke from the army's crate under the tower; seeing the gun reveals a way up to it.
 */
export class M2Medium extends SmokeLevel {
  private revealedShown = false;

  constructor(engine: Engine) {
    super(engine, LEVELS[4]);
  }

  protected OnLevelStart(): void {
    this.CreateSnipers();
    if (this.progress.sawGunner) this.ShowRevealed(false); // seen before a death: already there
  }

  protected AfterSmokeQuest(): void {
    if (this.progress.sawGunner) this.ShowRevealed(true);
  }

  /**
   * Once the machine gun has been seen, wooden platforms are there on the way back (level.revealed):
   * a way up to the scaffolding from the middle of area 1. Scaffolding like the rest: solid to stand
   * on, see-through for the sniper.
   */
  private ShowRevealed(withDust: boolean): void {
    const tiles = this.level.revealed;
    if (this.revealedShown || tiles.length === 0) return;
    this.revealedShown = true;
    const e = this.engine;
    for (let i = 0; i < tiles.length; i++) {
      const [x, y] = tiles[i];
      this.map.AddScaffold(x, y);
      e.renderer.CreateSprite(x * TILE, y * TILE, 'scaffold_block').SetOrigin(0, 0).SetScale(ART_SCALE).SetDepth(1);
      e.physics.CreateStaticBox(new Rect(x * TILE, y * TILE, TILE, TILE));
      if (withDust && e.assets.Exists('smoke_puff')) {
        const puff = e.renderer.CreateSprite((x + 0.5) * TILE, (y + 0.3) * TILE, 'smoke_puff').SetDepth(20).SetAlpha(0.7).SetScale(0.5);
        e.tweens.To(puff, { alpha: 0, scale: 1.2, y: puff.y - 30 }, 1.4, { onDone: () => puff.Destroy() });
      }
    }
  }
}

/** Hard: the escape. A helicopter hunts you down the valley; smoke and crates are what you have. */
export class M2Hard extends SmokeLevel {
  private heli!: Helicopter;

  constructor(engine: Engine) {
    super(engine, LEVELS[5]);
    this.helpExtra = '   Bottle / smoke Tab';
  }

  protected OnLevelCreate(): void {
    super.OnLevelCreate();
    this.smokeQuest.quietLoot = true; // smoke is nothing new by now: the crate just gives it
  }

  protected OnLevelStart(): void {
    const def = this.level.heli;
    if (!def) throw new Error('M2 Hard needs its helicopter (LevelData.heli)');
    this.heli = new Helicopter(this.engine, def, this.player, this.zombies, this.covers,
      (x, y) => this.map.StoneAtPixel(x, y), (x, y) => this.CrateHit(x, y));
    if (this.progress.introSeen) this.heli.Start(); // after a death: straight back to the chase
  }

  protected OnIntroDone(): void {
    this.heli.Start(); // the chase begins when he has understood
  }

  protected OnLevelFixedUpdate(dt: number): void {
    super.OnLevelFixedUpdate(dt);
    this.heli.FixedUpdate(dt, this.engine.clock.nowMs);
  }

  protected OnLevelUpdate(dt: number, timeMs: number): void {
    super.OnLevelUpdate(dt, timeMs);
    this.heli.Update(timeMs);
  }

  protected OnCheckpoint(): void {
    this.progress.smokesAtCheckpoint = this.throwables.smokes;
  }

  /** The escape is one run: crates and smoke come back as they were at the checkpoint. */
  protected OnRestart(): void {
    const p = this.progress;
    p.crateHp = [];
    p.cacheLooted = false;
    p.smokes = p.smokesAtCheckpoint >= 0 ? p.smokesAtCheckpoint : this.level.startSmokes;
  }
}
