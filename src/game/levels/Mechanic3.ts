import type { Engine, Shape, Text } from '../../engine';
import { Serif, TILE } from '../constants';
import { ZombieKind } from '../entities/Zombie';
import { Part, Scavenge, SKILL_HINTS, Upgrade } from '../systems/Upgrades';
import { BaseLevel } from './BaseLevel';
import { LEVELS } from './Levels';

/**
 * Mechanic 3: scavenge and upgrade. Search the ruins for parts, build upgrades at the workbench,
 * reach what you could not before. The three levels share ScavengeLevel; their data says what the
 * bench builds (upgrades), what you already have (grants) and how long a breath pill lasts (pillTime).
 */

const PATROL_RANGE = 3; // tiles: a patrolling Clicker paces this far either side of its spot
const BREATH_RECHARGE = 2.5; // s from an empty breath bar to full, standing in an air pocket
const BREATH_LOW = 0.3; // the bar turns red under this
const BREATH_BAR_X = 470; // HUD px: right of where Listen's bar sits
const BREATH_BAR_Y = 38;
const BREATH_BAR_W = 150;
const BREATH_BAR_H = 12;
const BREATH_READY = 0x8fc8ff; // the same colours as Listen's bar
const BREATH_EMPTY = 0xff6a58;

/** Parts on the map: 'O' spring, 'U' strap, 'I' steel wire, 'h' herbs, 'g' gas. */
const PART_CHARS = 'OUIhg';
const PART_OF_CHAR = [Part.Spring, Part.Strap, Part.Wire, Part.Herb, Part.Gas];

abstract class ScavengeLevel extends BaseLevel {
  private scavenge!: Scavenge;
  private breathesUnderwater = false; // breath pills working (without them, water drowns you at once)
  private breath = 0; // 0..1: what is left of the pill's effect (drains from the moment it is taken)
  private breathBar: Shape | null = null; // HUD, drawn like the Listen bar
  private skillsText: Text | null = null; // HUD: the upgrades you have, and their keys

  protected OnLevelCreate(): void {
    this.cheatUpgrades = true;
    this.scavenge = new Scavenge(this.engine, this.progress, this.level.upgrades, (text, seconds) => this.Banner(text, seconds));
    this.scavenge.onBuilt = (u) => {
      if (u === Upgrade.Pills) this.breath = 1; // swallowed now: the effect starts running out
      this.ApplyUpgrades();
    };
    if (this.progress.built[Upgrade.Pills]) this.breath = 1; // after a death: another pill
  }

  protected SpawnTile(c: string, _tx: number, _ty: number, feetX: number, feetY: number): boolean {
    const part = PART_CHARS.indexOf(c);
    if (part >= 0) {
      this.scavenge.AddPart(PART_OF_CHAR[part], feetX, feetY);
      return true;
    }
    if (c === 'T') {
      this.scavenge.AddBench(feetX, feetY);
      return true;
    }
    if (c === 'c') { // open ground: a patrolling Clicker paces around its spot
      this.AddZombie(ZombieKind.Clicker, feetX, feetY, 1, true).patrolRange = PATROL_RANGE;
      return true;
    }
    return false;
  }

  protected OnLevelStart(): void {
    this.ApplyUpgrades();
  }

  protected CreateLevelHud(): void {
    const r = this.engine.renderer;
    if (this.level.pillTime > 0) { // the breath bar, like Listen's: label above, a bar under it (drawn each frame)
      this.breathBar = r.CreateShape().SetFixed().SetDepth(50);
      r.CreateText(BREATH_BAR_X, BREATH_BAR_Y - 4, 'BREATH', Serif(16, 'bold', undefined, 4)).SetOrigin(0, 1).SetFixed().SetDepth(50);
    }
    const style = Serif(22, 'bold', '#ffd24a', 4);
    style.lineSpacing = 4;
    this.skillsText = r.CreateText(24, 172, '', style).SetFixed().SetDepth(50);
    this.ApplyUpgrades(); // again, now that the skills line exists
  }

  protected OnLevelInput(timeMs: number): boolean {
    const working = this.scavenge.open;
    this.scavenge.Update(timeMs, this.player);
    return working || this.scavenge.open; // at the bench: the world is paused
  }

  /**
   * The breath pill: its effect runs out over level.pillTime s from the moment it is taken, in the
   * water or not. An air pocket refills it while you stand in it. Empty: the pills wore off. In the
   * water without them, up to the chest: he drowns at once.
   */
  protected OnLevelFixedUpdate(dt: number): void {
    if (this.finished || this.player.dead) return;
    const b = this.player.body;
    const cx = Math.floor(b.centerX / TILE);
    const cy = Math.floor(b.centerY / TILE);
    if (this.breath > 0 && !this.cheating) {
      if (this.map.IsAir(cx, cy)) this.breath = Math.min(1, this.breath + dt / BREATH_RECHARGE);
      else this.breath -= dt / this.level.pillTime;
      if (this.breath <= 0) {
        this.breath = 0;
        this.ApplyUpgrades(); // no more breathing under water
        this.Banner('THE PILLS WORE OFF', 1.5);
      }
    }
    if (this.map.IsWater(cx, cy) && !this.breathesUnderwater) this.player.Kill();
  }

  protected OnLevelUpdate(): void {
    this.DrawBreathBar();
  }

  protected OnCheat(): void {
    this.ApplyUpgrades(); // the cheat lends every upgrade
  }

  /** What the player can do here: upgrades built (this visit), given by the level, or lent by the cheat. */
  private ApplyUpgrades(): void {
    const p = this.player;
    p.canDoubleJump = this.HasUpgrade(Upgrade.DoubleJump);
    p.canDash = this.HasUpgrade(Upgrade.Dash);
    this.breathesUnderwater = this.cheating || (this.HasUpgrade(Upgrade.Pills) && this.breath > 0);
    if (!this.skillsText) return;
    const lines: string[] = []; // what you can do now, and the key
    for (let u = 0; u < Upgrade.Count; u++) {
      if (u === Upgrade.Pills && !this.breathesUnderwater) continue; // worn off
      if (this.HasUpgrade(u)) lines.push(SKILL_HINTS[u]);
    }
    this.skillsText.SetText(lines.join('\n'));
  }

  private HasUpgrade(u: Upgrade): boolean {
    return this.cheating || this.progress.built[u] || this.level.grants.includes(u);
  }

  /** The breath bar: shown while a pill works. Blue, red when it runs low; brighter under water. */
  private DrawBreathBar(): void {
    const g = this.breathBar;
    if (!g) return;
    g.Clear();
    if (this.breath <= 0) return;
    const b = this.player.body;
    const underwater = this.map.IsWater(Math.floor(b.centerX / TILE), Math.floor(b.centerY / TILE));
    g.FillStyle(0x000000, 0.65).FillRect(BREATH_BAR_X - 3, BREATH_BAR_Y - 3, BREATH_BAR_W + 6, BREATH_BAR_H + 6);
    g.FillStyle(this.breath < BREATH_LOW ? BREATH_EMPTY : BREATH_READY, underwater ? 1 : 0.85);
    g.FillRect(BREATH_BAR_X, BREATH_BAR_Y, BREATH_BAR_W * this.breath, BREATH_BAR_H);
  }
}

/** Easy: a cliff too high. Find two springs and a strap, build the spring boots (double jump). */
export class M3Easy extends ScavengeLevel {
  constructor(engine: Engine) {
    super(engine, LEVELS[6]);
  }
}

/** Medium: the sea. One gas canister: build the brace boots (dash) or the breath pills. */
export class M3Medium extends ScavengeLevel {
  constructor(engine: Engine) {
    super(engine, LEVELS[7]);
  }
}

/** Hard: everything in sequence. Pills through a flooded tunnel, then dash across the sea. */
export class M3Hard extends ScavengeLevel {
  constructor(engine: Engine) {
    super(engine, LEVELS[8]);
  }
}
