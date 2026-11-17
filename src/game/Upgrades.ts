import Phaser from 'phaser';
import { Action, type InputActions } from '../core/InputActions';
import { ART_SCALE, TILE } from './constants';
import type { LevelProgress } from './Levels';
import type { Player } from './Player';

/**
 * Mechanic 3: scavenge and upgrade.
 *  - Parts lie around the level (map: 'O' spring, 'U' strap, 'I' steel wire, 'M' tyre rubber).
 *    Walking over one picks it up. Picked-up parts survive a death (LevelProgress).
 *  - At the workbench ('T'), Up opens it (Up again closes it): the upgrades it can build, the parts
 *    each one needs, the parts you have. Left / Right choose, Space builds: the parts are used up.
 *    The world is paused while the bench is open.
 *  - Medium's bench offers two upgrades that both need the level's ONE strap: you build one of them,
 *    and it decides your route.
 *  - A built upgrade is saved (localStorage): it stays built in every Mechanic 3 level.
 */

export enum Part {
  Spring,
  Strap,
  Wire,
  Rubber,
  Count, // number of part kinds, keep last
}

export enum Upgrade {
  DoubleJump,
  Dash,
  SilentSoles,
  Count, // number of upgrades, keep last
}

interface Recipe {
  name: string;
  what: string; // what it lets you do
  icon: string; // texture
  needs: number[]; // parts needed, indexed by Part
  storageKey: string; // localStorage: '1' once built
}

const PART_NAMES = ['Spring', 'Leather strap', 'Steel wire', 'Tyre rubber']; // indexed by Part
const PART_TEXTURES = ['spring', 'strap', 'wire', 'rubber'];

const RECIPES: Recipe[] = [ // indexed by Upgrade
  {
    name: 'SPRING BOOTS',
    what: 'Double jump: press Jump again in the air.',
    icon: 'spring_boots',
    needs: [2, 1, 0, 0],
    storageKey: 'upgrade:doubleJump',
  },
  {
    name: 'BRACE BOOTS',
    what: 'Dash: press X in the air.',
    icon: 'brace_boots',
    needs: [0, 1, 2, 0],
    storageKey: 'upgrade:dash',
  },
  {
    name: 'RUBBER SOLES',
    what: 'Walking and landings make no noise. Sprinting still does.',
    icon: 'rubber_soles',
    needs: [0, 1, 0, 2],
    storageKey: 'upgrade:silentSoles',
  },
];

const PICKUP_RADIUS = 0.7; // tiles
const BENCH_RANGE_X = 1.6 * TILE; // how close you must stand to use the bench
const BENCH_RANGE_Y = 0.8 * TILE;
const COLUMN_W = 560; // px: one upgrade's column in the bench panel
const GOOD = '#8fd16a'; // enough of a part / built
const MISSING = '#d98a6a';
const GOLD = '#ffd24a';

/** Built before (this or another visit)? Storage blocked: never built. */
export function upgradeBuilt(u: Upgrade): boolean {
  try {
    return localStorage.getItem(RECIPES[u].storageKey) === '1';
  } catch {
    return false;
  }
}

function saveUpgrade(u: Upgrade): void {
  try {
    localStorage.setItem(RECIPES[u].storageKey, '1');
  } catch {
    // storage blocked: built for this visit only
  }
}

/** Dev shortcut (cheat key 2): forget every built upgrade, to play the levels from scratch. */
export function forgetUpgrades(): void {
  for (let u = 0; u < Upgrade.Count; u++) {
    try {
      localStorage.removeItem(RECIPES[u].storageKey);
    } catch {
      // storage blocked: nothing saved
    }
  }
}

interface PartPickup {
  part: Part;
  index: number; // spawn order: remembered in progress.partsTaken
  x: number; // px, centre of the feet
  y: number;
  sprite: Phaser.GameObjects.Image;
}

/** One upgrade in the bench panel. */
interface Column {
  upgrade: Upgrade;
  frame: Phaser.GameObjects.Graphics; // gold when chosen
  partLines: Phaser.GameObjects.Text[]; // one per part the recipe needs
  linePart: Part[]; // which part each line shows
  status: Phaser.GameObjects.Text;
}

export class Scavenge {
  open = false; // the bench is open (the scene skips gameplay)
  onBuilt: (u: Upgrade) => void = () => {}; // the scene turns the upgrade on

  private readonly scene: Phaser.Scene;
  private readonly input: InputActions;
  private readonly progress: LevelProgress;
  private readonly upgrades: Upgrade[]; // what this level's bench builds
  private readonly banner: (text: string, ms: number) => void;
  private readonly pickups: PartPickup[] = [];
  private benchX = 0;
  private benchY = 0;
  private hasBench = false;
  private benchMarker: Phaser.GameObjects.Text | null = null;
  private benchPrompt: Phaser.GameObjects.Text | null = null;
  // HUD: one icon + count per part the bench's recipes use
  private readonly hudParts: Part[] = [];
  private readonly hudIcons: Phaser.GameObjects.Image[] = [];
  private readonly hudCounts: Phaser.GameObjects.Text[] = [];
  // the bench panel
  private readonly shade: Phaser.GameObjects.Rectangle;
  private readonly panel: Phaser.GameObjects.Container;
  private readonly columns: Column[] = [];
  private choice = 0; // index into columns

  constructor(scene: Phaser.Scene, input: InputActions, progress: LevelProgress, upgrades: Upgrade[],
    banner: (text: string, ms: number) => void) {
    this.scene = scene;
    this.input = input;
    this.progress = progress;
    this.upgrades = upgrades;
    this.banner = banner;

    // HUD, under the bottle counter: every part any of the recipes needs
    let hx = 30;
    for (let p = 0; p < Part.Count; p++) {
      if (this.mostNeeded(p) === 0) continue;
      const icon = scene.add.image(hx, 108, PART_TEXTURES[p]).setOrigin(0, 0.5).setScale(ART_SCALE * 1.6).setScrollFactor(0).setDepth(50);
      this.hudParts.push(p);
      this.hudIcons.push(icon);
      this.hudCounts.push(scene.add.text(hx + icon.displayWidth + 10, 108, '', {
        fontFamily: 'Georgia, serif', fontSize: '34px', fontStyle: 'bold', color: '#f0e6c8', stroke: '#000000', strokeThickness: 6,
      }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(50));
      hx += icon.displayWidth + 110;
    }

    // The bench panel: one column per upgrade, built hidden, shown by openBench()
    const w = scene.scale.width;
    const h = scene.scale.height;
    const n = upgrades.length;
    const panelW = n * COLUMN_W + 80;
    this.shade = scene.add.rectangle(0, 0, w, h, 0x0b0a08, 0.72).setOrigin(0, 0).setScrollFactor(0).setDepth(90).setVisible(false);
    this.panel = scene.add.container(w / 2, h / 2).setScrollFactor(0).setDepth(91).setVisible(false);
    const bg = scene.add.graphics();
    bg.fillStyle(0x1c1812, 0.96).fillRoundedRect(-panelW / 2, -250, panelW, 510, 14);
    bg.lineStyle(3, 0xffd24a, 0.8).strokeRoundedRect(-panelW / 2, -250, panelW, 510, 14);
    this.panel.add(bg);
    const style = { fontFamily: 'Georgia, serif', color: '#f0e6c8' };
    this.panel.add(scene.add.text(0, -225, 'WORKBENCH', { ...style, fontSize: '24px', color: '#c9bfa2' }).setOrigin(0.5, 0));
    const shared = this.sharedPart();
    if (shared !== Part.Count) { // a part every recipe here needs, one of each in the level: you build ONE of them
      this.panel.add(scene.add.text(0, 238, 'They all need the ' + PART_NAMES[shared].toLowerCase() + ': you can build only one.', {
        ...style, fontSize: '22px', fontStyle: 'italic', color: MISSING,
      }).setOrigin(0.5, 1));
    }
    for (let i = 0; i < n; i++) {
      const cx = (i - (n - 1) / 2) * COLUMN_W; // column centre
      const recipe = RECIPES[upgrades[i]];
      const frame = scene.add.graphics();
      this.panel.add(frame);
      this.panel.add(scene.add.image(cx - 190, -60, recipe.icon).setScale(ART_SCALE * 3.2));
      this.panel.add(scene.add.text(cx - 110, -170, recipe.name, { ...style, fontSize: '40px', fontStyle: 'bold', color: GOLD }));
      this.panel.add(scene.add.text(cx - 110, -118, recipe.what, { ...style, fontSize: '22px', wordWrap: { width: 360 } }));
      const partLines: Phaser.GameObjects.Text[] = [];
      const linePart: Part[] = [];
      let ly = -30;
      for (let p = 0; p < Part.Count; p++) {
        if (recipe.needs[p] === 0) continue;
        this.panel.add(scene.add.image(cx - 90, ly + 18, PART_TEXTURES[p]).setScale(ART_SCALE * 1.3));
        const line = scene.add.text(cx - 50, ly, '', { ...style, fontSize: '28px' });
        this.panel.add(line);
        partLines.push(line);
        linePart.push(p);
        ly += 56;
      }
      const status = scene.add.text(cx, 110, '', { ...style, fontSize: '28px', fontStyle: 'bold', align: 'center' }).setOrigin(0.5, 0);
      this.panel.add(status);
      this.columns.push({ upgrade: upgrades[i], frame: frame, partLines: partLines, linePart: linePart, status: status });
    }
    const keys = n > 1 ? '← →  choose      Space  build      ↑  close' : 'Space  build      ↑  close';
    this.panel.add(scene.add.text(0, 190, keys, { ...style, fontSize: '22px', color: '#c9bfa2' }).setOrigin(0.5, 0));
  }

  /** Map 'O' / 'U' / 'I' / 'M': a part lying on the floor (unless taken before a death). */
  addPart(part: Part, feetX: number, feetY: number): void {
    const index = this.pickups.length;
    const sprite = this.scene.add.image(feetX, feetY, PART_TEXTURES[part]).setOrigin(0.5, 1).setScale(ART_SCALE).setDepth(14);
    if (this.progress.partsTaken.includes(index)) sprite.setVisible(false);
    this.pickups.push({ part: part, index: index, x: feetX, y: feetY, sprite: sprite });
  }

  /** Map 'T': the workbench. */
  addBench(feetX: number, feetY: number): void {
    this.hasBench = true;
    this.benchX = feetX;
    this.benchY = feetY;
    this.scene.add.image(feetX, feetY + 2, 'workbench').setOrigin(0.5, 1).setScale(ART_SCALE).setDepth(11.5);
    this.benchMarker = this.scene.add.text(feetX, feetY - TILE * 1.6, '!', {
      fontFamily: 'Georgia, serif', fontSize: '56px', fontStyle: 'bold', color: GOLD, stroke: '#000000', strokeThickness: 8,
    }).setOrigin(0.5, 1).setDepth(25).setVisible(false);
    this.benchPrompt = this.scene.add.text(feetX, feetY - TILE * 1.6, '↑  Workbench', {
      fontFamily: 'Georgia, serif', fontSize: '26px', fontStyle: 'bold', color: '#f0e6c8', stroke: '#000000', strokeThickness: 5,
    }).setOrigin(0.5, 1).setDepth(25).setVisible(false);
  }

  /** Once per frame, after input. While the bench is open the scene skips gameplay. */
  update(timeMs: number, player: Player): void {
    if (this.open) {
      if (this.input.pressed(Action.Left)) this.choose(this.choice - 1);
      else if (this.input.pressed(Action.Right)) this.choose(this.choice + 1);
      else if (this.input.pressed(Action.Jump)) this.build(this.columns[this.choice].upgrade);
      else if (this.input.pressed(Action.Up) || this.input.pressed(Action.Back) || this.input.pressed(Action.Attack)) this.closeBench();
      return;
    }

    // Parts: walk over one to pick it up. Bob gently so they read as "take me".
    const r = PICKUP_RADIUS * TILE;
    for (let i = 0; i < this.pickups.length; i++) {
      const k = this.pickups[i];
      if (!k.sprite.visible) continue;
      k.sprite.y = k.y - 6 + Math.sin(timeMs / 260 + i) * 5;
      if (player.dead || Math.abs(player.feetX - k.x) > r || Math.abs(player.feetY - k.y) > r * 1.5) continue;
      k.sprite.setVisible(false);
      this.progress.partsTaken.push(k.index);
      this.progress.parts[k.part]++;
      this.banner('+1 ' + PART_NAMES[k.part].toUpperCase(), 1100);
    }

    this.updateHud();
    if (!this.hasBench || !this.benchMarker || !this.benchPrompt) return;
    const near = !player.dead && Math.abs(player.feetX - this.benchX) < BENCH_RANGE_X && Math.abs(player.feetY - this.benchY) < BENCH_RANGE_Y;
    this.benchPrompt.setVisible(near);
    this.benchMarker.setVisible(!near && this.anyReady()); // parts for something: come back and build
    this.benchMarker.y = this.benchY - TILE * 1.6 + Math.sin(timeMs / 220) * 8;
    if (near && this.input.pressed(Action.Up) && !this.input.held(Action.Throw)) this.openBench();
  }

  /** A part every one of this bench's recipes needs (Part.Count: none, or a single recipe). */
  private sharedPart(): Part {
    if (this.upgrades.length < 2) return Part.Count;
    for (let p = 0; p < Part.Count; p++) {
      let all = true;
      for (let i = 0; i < this.upgrades.length; i++) if (RECIPES[this.upgrades[i]].needs[p] === 0) all = false;
      if (all) return p;
    }
    return Part.Count;
  }

  /** The most of part p any one recipe of this bench needs (0: not used here). */
  private mostNeeded(p: Part): number {
    let most = 0;
    for (let i = 0; i < this.upgrades.length; i++) most = Math.max(most, RECIPES[this.upgrades[i]].needs[p]);
    return most;
  }

  private hasParts(u: Upgrade): boolean {
    const needs = RECIPES[u].needs;
    for (let p = 0; p < Part.Count; p++) if (this.progress.parts[p] < needs[p]) return false;
    return true;
  }

  private anyReady(): boolean {
    for (let i = 0; i < this.upgrades.length; i++) {
      if (!upgradeBuilt(this.upgrades[i]) && this.hasParts(this.upgrades[i])) return true;
    }
    return false;
  }

  private allBuilt(): boolean {
    for (let i = 0; i < this.upgrades.length; i++) if (!upgradeBuilt(this.upgrades[i])) return false;
    return true;
  }

  private updateHud(): void {
    const done = this.allBuilt();
    for (let i = 0; i < this.hudParts.length; i++) {
      const p = this.hudParts[i];
      const need = this.mostNeeded(p);
      const have = this.progress.parts[p];
      this.hudIcons[i].setVisible(!done);
      this.hudCounts[i].setVisible(!done).setText(have + '/' + need).setColor(have >= need ? GOOD : '#f0e6c8');
    }
  }

  private openBench(): void {
    this.open = true;
    this.scene.physics.pause(); // the world stops while you work
    this.shade.setVisible(true);
    this.panel.setVisible(true);
    if (this.benchPrompt) this.benchPrompt.setVisible(false);
    this.choose(this.choice);
  }

  private closeBench(): void {
    this.open = false;
    this.shade.setVisible(false);
    this.panel.setVisible(false);
    // Keys used at the bench must not leak into gameplay (a buffered jump, a crouch toggle, a dash).
    this.input.consume(Action.Jump);
    this.input.consume(Action.Down);
    this.input.consume(Action.Attack);
    this.input.consume(Action.Throw);
    this.scene.physics.resume();
  }

  /** Select column i (clamped) and redraw the panel. */
  private choose(i: number): void {
    this.choice = Phaser.Math.Clamp(i, 0, this.columns.length - 1);
    for (let c = 0; c < this.columns.length; c++) {
      const col = this.columns[c];
      const recipe = RECIPES[col.upgrade];
      const cx = (c - (this.columns.length - 1) / 2) * COLUMN_W;
      col.frame.clear();
      if (this.columns.length > 1) { // with one upgrade there is nothing to choose
        const on = c === this.choice;
        col.frame.lineStyle(on ? 4 : 2, on ? 0xffd24a : 0xf0e6c8, on ? 1 : 0.2).strokeRoundedRect(cx - COLUMN_W / 2 + 14, -200, COLUMN_W - 28, 380, 10);
      }
      for (let l = 0; l < col.partLines.length; l++) {
        const p = col.linePart[l];
        const have = Math.min(this.progress.parts[p], recipe.needs[p]);
        col.partLines[l].setText(PART_NAMES[p] + '   ' + have + ' / ' + recipe.needs[p]).setColor(have >= recipe.needs[p] ? GOOD : MISSING);
      }
      if (upgradeBuilt(col.upgrade)) col.status.setText('Built.').setColor(GOOD);
      else if (this.hasParts(col.upgrade)) col.status.setText('Ready: Space builds it').setColor(GOLD);
      else col.status.setText('Missing parts').setColor(MISSING);
    }
  }

  private build(u: Upgrade): void {
    if (upgradeBuilt(u) || !this.hasParts(u)) return;
    const needs = RECIPES[u].needs;
    for (let p = 0; p < Part.Count; p++) this.progress.parts[p] -= needs[p]; // the parts go into it
    saveUpgrade(u);
    this.closeBench();
    this.onBuilt(u);
    this.banner('NEW SKILL: ' + RECIPES[u].name, 3000);
  }
}
