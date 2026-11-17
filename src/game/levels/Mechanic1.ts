import type { Engine, Sprite } from '../../engine';
import { ART_SCALE } from '../constants';
import { ZombieKind } from '../entities/Zombie';
import { MolotovQuest } from '../systems/Molotov';
import { BaseLevel } from './BaseLevel';
import { LEVELS } from './Levels';

/**
 * Mechanic 1: noise and distraction. Clickers hear but cannot see.
 * Easy and Hard are the base level with their data (Hard's night and Listen Mode are flags the base
 * reads); Medium adds the horde and the Molotov story.
 */

/** Easy: tunnel, yard, a three-floor building, the rooftops. The father's letter is the guide. */
export class M1Easy extends BaseLevel {
  constructor(engine: Engine) {
    super(engine, LEVELS[0]);
  }
}

/** Medium: too many to sneak past. A car leaks gasoline, three coloured keys open its trunk. */
export class M1Medium extends BaseLevel {
  private quest!: MolotovQuest;
  private hudMolotov: Sprite | null = null;

  constructor(engine: Engine) {
    super(engine, LEVELS[1]);
  }

  protected OnLevelCreate(): void {
    this.quest = new MolotovQuest(this.engine, this.EnsureDialogue(), this.progress, this.throwables, this.locks,
      (text, seconds) => this.Banner(text, seconds));
  }

  protected SpawnTile(c: string, tx: number, _ty: number, feetX: number, feetY: number): boolean {
    if (c === 'V') {
      this.quest.AddCar(feetX, feetY);
      return true;
    }
    if (c === 'H') { // the horde, feeding at the corpses (burned before a death: stays burned)
      if (!this.progress.hordeBurned) {
        const dir = (tx * 7) % 3 === 0 ? 1 : -1; // mixed facings: a crowd, not a row
        this.quest.AddHorde(this.AddZombie(ZombieKind.Clicker, feetX, feetY, dir, false));
      }
      return true;
    }
    return false;
  }

  protected OnLevelStart(): void {
    this.quest.FinishSetup();
  }

  protected CreateLevelHud(): void {
    this.hudMolotov = this.engine.renderer.CreateSprite(48, 168, 'molotov').SetScale(ART_SCALE * 2.2).SetFixed().SetDepth(50).SetVisible(false);
  }

  protected OnLevelInput(timeMs: number): boolean {
    this.quest.Update(timeMs, this.player);
    return this.dialogue !== null && this.dialogue.open;
  }

  protected OnLevelFixedUpdate(): void {
    this.quest.FixedUpdate();
  }

  protected OnLevelUpdate(): void {
    if (this.hudMolotov) this.hudMolotov.SetVisible(this.throwables.molotovs > 0);
  }
}

/** Hard: night, one bottle at a time, Listen Mode (finishing it unlocks Listen everywhere). */
export class M1Hard extends BaseLevel {
  constructor(engine: Engine) {
    super(engine, LEVELS[2]);
  }
}
