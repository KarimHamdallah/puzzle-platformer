import Phaser from 'phaser';
import { Action, type InputActions } from '../core/InputActions';
import { ART_SCALE, TILE } from './constants';
import type { LevelProgress } from './Levels';
import type { Player } from './Player';

/**
 * Mechanic 3: scavenge and upgrade.
 *  - Parts lie around the level (map: 'O' spring, 'U' strap). Walking over one picks it up.
 *  - At the workbench ('T'), Up opens it: the upgrade, the parts it needs, the parts you have.
 *    With every part in hand, Jump builds it. The world is paused while the bench is open.
 *  - A built upgrade is saved (localStorage): it stays built in every Mechanic 3 level, and
 *    replaying a level you already finished, you have it from the start.
 *  - Picked-up parts survive a death (LevelProgress), like the keys of Mechanic 1.
 */

export enum Part {
  Spring,
  Strap,
  Count, // number of part kinds, keep last
}

export enum Upgrade {
  DoubleJump,
  Count, // number of upgrades, keep last
}

interface Recipe {
  name: string;
  what: string; // one line: what it lets you do
  icon: string; // texture
  needs: number[]; // parts needed, indexed by Part
  storageKey: string; // localStorage: '1' once built
}

const PART_NAMES = ['Spring', 'Leather strap']; // indexed by Part
const PART_TEXTURES = ['spring', 'strap'];

const RECIPES: Recipe[] = [ // indexed by Upgrade
  {
    name: 'SPRING BOOTS',
    what: 'Double jump: press Jump again in the air.',
    icon: 'spring_boots',
    needs: [2, 1],
    storageKey: 'upgrade:doubleJump',
  },
];

const PICKUP_RADIUS = 0.7; // tiles
const BENCH_RANGE_X = 1.6 * TILE; // how close you must stand to use the bench
const BENCH_RANGE_Y = 0.8 * TILE;
const GOOD = '#8fd16a'; // a part you have enough of
const MISSING = '#d98a6a';

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

export class Scavenge {
  open = false; // the bench is open (the scene skips gameplay)
  onBuilt: (u: Upgrade) => void = () => {}; // the scene turns the upgrade on

  private readonly scene: Phaser.Scene;
  private readonly input: InputActions;
  private readonly progress: LevelProgress;
  private readonly upgrade: Upgrade; // what this level's bench builds
  private readonly banner: (text: string, ms: number) => void;
  private readonly pickups: PartPickup[] = [];
  private benchX = 0;
  private benchY = 0;
  private hasBench = false;
  private benchMarker: Phaser.GameObjects.Text | null = null;
  private benchPrompt: Phaser.GameObjects.Text | null = null;
  // HUD: one icon + count per part the recipe needs
  private readonly hudIcons: Phaser.GameObjects.Image[] = [];
  private readonly hudCounts: Phaser.GameObjects.Text[] = [];
  // the bench panel
  private readonly shade: Phaser.GameObjects.Rectangle;
  private readonly panel: Phaser.GameObjects.Container;
  private readonly partLines: Phaser.GameObjects.Text[] = [];
  private readonly footer: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, input: InputActions, progress: LevelProgress, upgrade: Upgrade,
    banner: (text: string, ms: number) => void) {
    this.scene = scene;
    this.input = input;
    this.progress = progress;
    this.upgrade = upgrade;
    this.banner = banner;
    const recipe = RECIPES[upgrade];

    // HUD, under the bottle counter
    let hx = 30;
    for (let p = 0; p < Part.Count; p++) {
      if (recipe.needs[p] === 0) continue;
      const icon = scene.add.image(hx, 108, PART_TEXTURES[p]).setOrigin(0, 0.5).setScale(ART_SCALE * 1.6).setScrollFactor(0).setDepth(50);
      this.hudIcons.push(icon);
      this.hudCounts.push(scene.add.text(hx + icon.displayWidth + 10, 108, '', {
        fontFamily: 'Georgia, serif', fontSize: '34px', fontStyle: 'bold', color: '#f0e6c8', stroke: '#000000', strokeThickness: 6,
      }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(50));
      hx += icon.displayWidth + 110;
    }

    // The bench panel: built hidden, shown by openBench()
    const w = scene.scale.width;
    const h = scene.scale.height;
    this.shade = scene.add.rectangle(0, 0, w, h, 0x0b0a08, 0.72).setOrigin(0, 0).setScrollFactor(0).setDepth(90).setVisible(false);
    this.panel = scene.add.container(w / 2, h / 2).setScrollFactor(0).setDepth(91).setVisible(false);
    const bg = scene.add.graphics();
    bg.fillStyle(0x1c1812, 0.96).fillRoundedRect(-380, -230, 760, 460, 14);
    bg.lineStyle(3, 0xffd24a, 0.8).strokeRoundedRect(-380, -230, 760, 460, 14);
    this.panel.add(bg);
    const style = { fontFamily: 'Georgia, serif', color: '#f0e6c8' };
    this.panel.add(scene.add.text(0, -200, 'WORKBENCH', { ...style, fontSize: '24px', color: '#c9bfa2' }).setOrigin(0.5, 0));
    this.panel.add(scene.add.image(-260, -60, recipe.icon).setScale(ART_SCALE * 3.5));
    this.panel.add(scene.add.text(-170, -150, recipe.name, { ...style, fontSize: '44px', fontStyle: 'bold', color: '#ffd24a' }));
    this.panel.add(scene.add.text(-170, -90, recipe.what, { ...style, fontSize: '24px', wordWrap: { width: 520 } }));
    let ly = -20;
    for (let p = 0; p < Part.Count; p++) {
      if (recipe.needs[p] === 0) continue;
      this.panel.add(scene.add.image(-150, ly + 18, PART_TEXTURES[p]).setScale(ART_SCALE * 1.4));
      const line = scene.add.text(-110, ly, '', { ...style, fontSize: '30px' });
      this.partLines.push(line);
      this.panel.add(line);
      ly += 60;
    }
    this.footer = scene.add.text(0, 150, '', { ...style, fontSize: '28px', fontStyle: 'bold', align: 'center' }).setOrigin(0.5, 0);
    this.panel.add(this.footer);
    this.panel.add(scene.add.text(0, 200, '↑ / Esc  close', { ...style, fontSize: '20px', color: '#c9bfa2' }).setOrigin(0.5, 0));
  }

  /** Map 'O' / 'U': a part lying on the floor (unless taken before a death). */
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
      fontFamily: 'Georgia, serif', fontSize: '56px', fontStyle: 'bold', color: '#ffd24a', stroke: '#000000', strokeThickness: 8,
    }).setOrigin(0.5, 1).setDepth(25).setVisible(false);
    this.benchPrompt = this.scene.add.text(feetX, feetY - TILE * 1.6, '↑  Workbench', {
      fontFamily: 'Georgia, serif', fontSize: '26px', fontStyle: 'bold', color: '#f0e6c8', stroke: '#000000', strokeThickness: 5,
    }).setOrigin(0.5, 1).setDepth(25).setVisible(false);
  }

  /** Once per frame, after input. While the bench is open the scene skips gameplay. */
  update(timeMs: number, player: Player): void {
    if (this.open) {
      if (this.input.pressed(Action.Jump)) this.build();
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
    const built = upgradeBuilt(this.upgrade);
    const near = !player.dead && Math.abs(player.feetX - this.benchX) < BENCH_RANGE_X && Math.abs(player.feetY - this.benchY) < BENCH_RANGE_Y;
    this.benchPrompt.setVisible(near);
    this.benchMarker.setVisible(!near && !built && this.hasAllParts()); // everything found: come back and build
    this.benchMarker.y = this.benchY - TILE * 1.6 + Math.sin(timeMs / 220) * 8;
    if (near && this.input.pressed(Action.Up) && !this.input.held(Action.Throw)) this.openBench();
  }

  private hasAllParts(): boolean {
    const needs = RECIPES[this.upgrade].needs;
    for (let p = 0; p < Part.Count; p++) if (this.progress.parts[p] < needs[p]) return false;
    return true;
  }

  private updateHud(): void {
    const needs = RECIPES[this.upgrade].needs;
    const built = upgradeBuilt(this.upgrade);
    let i = 0;
    for (let p = 0; p < Part.Count; p++) {
      if (needs[p] === 0) continue;
      const have = Math.min(this.progress.parts[p], needs[p]);
      this.hudIcons[i].setVisible(!built);
      this.hudCounts[i].setVisible(!built).setText(have + '/' + needs[p]).setColor(have >= needs[p] ? GOOD : '#f0e6c8');
      i++;
    }
  }

  private openBench(): void {
    this.open = true;
    this.scene.physics.pause(); // the world stops while you work
    this.shade.setVisible(true);
    this.panel.setVisible(true);
    if (this.benchPrompt) this.benchPrompt.setVisible(false);
    this.renderPanel();
  }

  private closeBench(): void {
    this.open = false;
    this.shade.setVisible(false);
    this.panel.setVisible(false);
    // Keys used at the bench must not leak into gameplay (a buffered jump, a crouch toggle).
    this.input.consume(Action.Jump);
    this.input.consume(Action.Down);
    this.input.consume(Action.Attack);
    this.input.consume(Action.Throw);
    this.scene.physics.resume();
  }

  private renderPanel(): void {
    const needs = RECIPES[this.upgrade].needs;
    let i = 0;
    for (let p = 0; p < Part.Count; p++) {
      if (needs[p] === 0) continue;
      const have = Math.min(this.progress.parts[p], needs[p]);
      this.partLines[i].setText(PART_NAMES[p] + '   ' + have + ' / ' + needs[p]).setColor(have >= needs[p] ? GOOD : MISSING);
      i++;
    }
    if (upgradeBuilt(this.upgrade)) this.footer.setText('Built.').setColor(GOOD);
    else if (this.hasAllParts()) this.footer.setText('Space  build').setColor('#ffd24a');
    else this.footer.setText('Missing parts: look around the area').setColor(MISSING);
  }

  private build(): void {
    if (upgradeBuilt(this.upgrade) || !this.hasAllParts()) return;
    saveUpgrade(this.upgrade);
    this.closeBench();
    this.onBuilt(this.upgrade);
    this.banner('NEW SKILL: ' + RECIPES[this.upgrade].name, 3000);
  }
}
