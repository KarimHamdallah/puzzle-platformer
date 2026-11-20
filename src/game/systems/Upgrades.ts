import { MathUtil, type Engine, type Group, type Shape, type Sprite, type Text, type TextStyle } from '../../engine';
import { Action } from '../Actions';
import { ART_SCALE, CREAM, GOLD, Serif, TILE } from '../constants';
import type { Player } from '../entities/Player';
import type { LevelProgress } from '../levels/Levels';

/**
 * Mechanic 3: scavenge and upgrade.
 *  - Parts lie around the level (map: 'O' spring, 'U' strap, 'I' steel wire, 'h' herbs, 'g' gas).
 *    Walking over one picks it up. Picked-up parts survive a death (LevelProgress).
 *  - At the workbench ('T'), Up opens it (Up again closes it): the upgrades it can build, the parts
 *    each one needs, the parts you have. Left / Right choose, Space builds: the parts are used up.
 *    The world is paused while the bench is open.
 *  - Medium's bench offers two upgrades that both need the level's ONE gas canister: you build one
 *    of them, and it decides your route across the sea.
 *  - A built upgrade lasts for this visit of the level (LevelProgress.built, kept over a death).
 *    Upgrades from an earlier level are given by LevelData.grants, not saved.
 */

export enum Part {
  Spring,
  Strap,
  Wire,
  Herb,
  Gas,
  Count, // number of part kinds, keep last
}

export enum Upgrade {
  DoubleJump,
  Dash,
  Pills,
  Count, // number of upgrades, keep last
}

interface Recipe {
  name: string;
  what: string; // what it lets you do (and the key)
  icon: string; // texture
  needs: number[]; // parts needed, indexed by Part
}

const PART_NAMES = ['Spring', 'Leather strap', 'Steel wire', 'Medicinal herbs', 'Gas canister']; // indexed by Part
const PART_TEXTURES = ['spring', 'strap', 'wire', 'herb', 'gas'];

const RECIPES: Recipe[] = [ // indexed by Upgrade
  {
    name: 'SPRING BOOTS',
    what: 'Double jump: press Space again in the air.',
    icon: 'spring_boots',
    needs: [2, 1, 0, 0, 0],
  },
  {
    name: 'BRACE BOOTS',
    what: 'Dash: press X in the air. Jump island to island across the sea.',
    icon: 'brace_boots',
    needs: [0, 0, 2, 0, 1],
  },
  {
    name: 'BREATH PILLS',
    what: 'Breathe under water while the BREATH bar lasts.', // two lines: a longer text runs into the parts list
    icon: 'pills',
    needs: [0, 0, 0, 2, 1],
  },
];

/** Shown on the HUD while you have it: the skill and its key. */
export const SKILL_HINTS = ['Double jump: Space in the air', 'Dash: X in the air', 'Breathe under water (BREATH bar)']; // indexed by Upgrade

const PICKUP_RADIUS = 0.7; // tiles
const BENCH_RANGE_X = 1.6 * TILE; // how close you must stand to use the bench
const BENCH_RANGE_Y = 0.8 * TILE;
const COLUMN_W = 560; // px: one upgrade's column in the bench panel
const GOOD = '#8fd16a'; // enough of a part / built
const MISSING = '#d98a6a';
const PALE = '#c9bfa2';

/** Panel text: plain Georgia, no outline (it sits on a dark panel). */
function PanelText(size: number, color: string = CREAM, style: string = ''): TextStyle {
  return { family: 'Georgia, serif', size: size, color: color, style: style };
}

interface PartPickup {
  part: Part;
  index: number; // spawn order: remembered in progress.partsTaken
  x: number; // px, centre of the feet
  y: number;
  sprite: Sprite;
}

/** One upgrade in the bench panel. */
interface Column {
  upgrade: Upgrade;
  frame: Shape; // gold when chosen
  partLines: Text[]; // one per part the recipe needs
  linePart: Part[]; // which part each line shows
  status: Text;
}

export class Scavenge {
  open = false; // the bench is open (the level skips gameplay)
  onBuilt: (u: Upgrade) => void = () => {}; // the level turns the upgrade on

  private readonly engine: Engine;
  private readonly progress: LevelProgress;
  private readonly upgrades: Upgrade[]; // what this level's bench builds
  private readonly banner: (text: string, seconds: number) => void;
  private readonly pickups: PartPickup[] = [];
  private benchX = 0;
  private benchY = 0;
  private hasBench = false;
  private benchMarker: Text | null = null;
  private benchPrompt: Text | null = null;
  // HUD: one icon + count per part the bench's recipes use
  private readonly hudParts: Part[] = [];
  private readonly hudIcons: Sprite[] = [];
  private readonly hudCounts: Text[] = [];
  // the bench panel
  private readonly shade: Shape;
  private readonly panel: Group;
  private readonly columns: Column[] = [];
  private choice = 0; // index into columns
  private readonly warning: Text; // 'you can build only one' (when the level is that short of a part)

  constructor(engine: Engine, progress: LevelProgress, upgrades: Upgrade[], banner: (text: string, seconds: number) => void) {
    this.engine = engine;
    this.progress = progress;
    this.upgrades = upgrades;
    this.banner = banner;
    const r = engine.renderer;

    // HUD, under the bottle counter: every part any of the recipes needs
    let hx = 30;
    for (let p = 0; p < Part.Count; p++) {
      if (this.MostNeeded(p) === 0) continue;
      const icon = r.CreateSprite(hx, 108, PART_TEXTURES[p]).SetOrigin(0, 0.5).SetScale(ART_SCALE * 1.6).SetFixed().SetDepth(50);
      this.hudParts.push(p);
      this.hudIcons.push(icon);
      this.hudCounts.push(r.CreateText(hx + icon.displayWidth + 10, 108, '', Serif(34, 'bold', CREAM, 6)).SetOrigin(0, 0.5).SetFixed().SetDepth(50));
      hx += icon.displayWidth + 110;
    }

    // The bench panel: one column per upgrade, built hidden, shown by OpenBench()
    const w = engine.width;
    const h = engine.height;
    const n = upgrades.length;
    const panelW = n * COLUMN_W + 80;
    this.shade = r.CreateShape().FillStyle(0x0b0a08, 0.72).FillRect(0, 0, w, h).SetFixed().SetDepth(90).SetVisible(false);
    this.panel = r.CreateGroup(w / 2, h / 2).SetFixed().SetDepth(91).SetVisible(false);
    const bg = r.CreateShape();
    bg.FillStyle(0x1c1812, 0.96).FillRoundedRect(-panelW / 2, -250, panelW, 510, 14);
    bg.LineStyle(3, 0xffd24a, 0.8).StrokeRoundedRect(-panelW / 2, -250, panelW, 510, 14);
    this.panel.Add(bg);
    this.panel.Add(r.CreateText(0, -225, 'WORKBENCH', PanelText(24, PALE)).SetOrigin(0.5, 0));
    this.warning = r.CreateText(0, 238, '', PanelText(22, MISSING, 'italic')).SetOrigin(0.5, 1);
    this.panel.Add(this.warning);
    for (let i = 0; i < n; i++) {
      const cx = (i - (n - 1) / 2) * COLUMN_W; // column centre
      const recipe = RECIPES[upgrades[i]];
      const frame = r.CreateShape();
      this.panel.Add(frame);
      this.panel.Add(r.CreateSprite(cx - 190, -60, recipe.icon).SetScale(ART_SCALE * 3.2));
      this.panel.Add(r.CreateText(cx - 110, -170, recipe.name, PanelText(40, GOLD, 'bold')));
      const what = PanelText(22);
      what.wrapWidth = 360;
      this.panel.Add(r.CreateText(cx - 110, -118, recipe.what, what));
      const partLines: Text[] = [];
      const linePart: Part[] = [];
      let ly = -30;
      for (let p = 0; p < Part.Count; p++) {
        if (recipe.needs[p] === 0) continue;
        this.panel.Add(r.CreateSprite(cx - 90, ly + 18, PART_TEXTURES[p]).SetScale(ART_SCALE * 1.3));
        const line = r.CreateText(cx - 50, ly, '', PanelText(28));
        this.panel.Add(line);
        partLines.push(line);
        linePart.push(p);
        ly += 56;
      }
      const statusStyle = PanelText(28, CREAM, 'bold');
      statusStyle.align = 'center';
      const status = r.CreateText(cx, 110, '', statusStyle).SetOrigin(0.5, 0);
      this.panel.Add(status);
      this.columns.push({ upgrade: upgrades[i], frame: frame, partLines: partLines, linePart: linePart, status: status });
    }
    const keys = n > 1 ? '← →  choose      Space  build      ↑  close' : 'Space  build      ↑  close';
    this.panel.Add(r.CreateText(0, 190, keys, PanelText(22, PALE)).SetOrigin(0.5, 0));
  }

  /** Map 'O' / 'U' / 'I' / 'h' / 'g': a part lying on the floor (unless taken before a death). */
  AddPart(part: Part, feetX: number, feetY: number): void {
    const index = this.pickups.length;
    const sprite = this.engine.renderer.CreateSprite(feetX, feetY, PART_TEXTURES[part]).SetOrigin(0.5, 1).SetScale(ART_SCALE).SetDepth(14);
    if (this.progress.partsTaken.includes(index)) sprite.SetVisible(false);
    this.pickups.push({ part: part, index: index, x: feetX, y: feetY, sprite: sprite });
  }

  /** Map 'T': the workbench. */
  AddBench(feetX: number, feetY: number): void {
    const r = this.engine.renderer;
    this.hasBench = true;
    this.benchX = feetX;
    this.benchY = feetY;
    r.CreateSprite(feetX, feetY + 2, 'workbench').SetOrigin(0.5, 1).SetScale(ART_SCALE).SetDepth(11.5);
    this.benchMarker = r.CreateText(feetX, feetY - TILE * 1.6, '!', Serif(56, 'bold', GOLD, 8)).SetOrigin(0.5, 1).SetDepth(25).SetVisible(false);
    this.benchPrompt = r.CreateText(feetX, feetY - TILE * 1.6, '↑  Workbench', Serif(26)).SetOrigin(0.5, 1).SetDepth(25).SetVisible(false);
  }

  /** Once per frame, after input. While the bench is open the level skips gameplay. */
  Update(timeMs: number, player: Player): void {
    const input = this.engine.input;
    if (this.open) {
      if (input.Pressed(Action.Left)) this.Choose(this.choice - 1);
      else if (input.Pressed(Action.Right)) this.Choose(this.choice + 1);
      else if (input.Pressed(Action.Jump)) this.Build(this.columns[this.choice].upgrade);
      else if (input.Pressed(Action.Up) || input.Pressed(Action.Back) || input.Pressed(Action.Attack)) this.CloseBench();
      return;
    }

    // Parts: walk over one to pick it up. Bob gently so they read as "take me".
    const r = PICKUP_RADIUS * TILE;
    for (let i = 0; i < this.pickups.length; i++) {
      const k = this.pickups[i];
      if (!k.sprite.visible) continue;
      k.sprite.y = k.y - 6 + Math.sin(timeMs / 260 + i) * 5;
      if (player.dead || Math.abs(player.feetX - k.x) > r || Math.abs(player.feetY - k.y) > r * 1.5) continue;
      k.sprite.SetVisible(false);
      this.progress.partsTaken.push(k.index);
      this.progress.parts[k.part]++;
      this.banner('+1 ' + PART_NAMES[k.part].toUpperCase(), 1.1);
    }

    this.UpdateHud();
    if (!this.hasBench || !this.benchMarker || !this.benchPrompt) return;
    const near = !player.dead && Math.abs(player.feetX - this.benchX) < BENCH_RANGE_X && Math.abs(player.feetY - this.benchY) < BENCH_RANGE_Y;
    this.benchPrompt.SetVisible(near);
    this.benchMarker.SetVisible(!near && this.AnyReady()); // parts for something: come back and build
    this.benchMarker.y = this.benchY - TILE * 1.6 + Math.sin(timeMs / 220) * 8;
    if (near && input.Pressed(Action.Up) && !input.Held(Action.Throw)) this.OpenBench();
  }

  private Built(u: Upgrade): boolean {
    return this.progress.built[u];
  }

  /** A part every one of this bench's recipes needs (Part.Count: none, or a single recipe). */
  private SharedPart(): Part {
    if (this.upgrades.length < 2) return Part.Count;
    for (let p = 0; p < Part.Count; p++) {
      let all = true;
      for (let i = 0; i < this.upgrades.length; i++) if (RECIPES[this.upgrades[i]].needs[p] === 0) all = false;
      if (all) return p;
    }
    return Part.Count;
  }

  /** The most of part p any one recipe of this bench needs (0: not used here). */
  private MostNeeded(p: Part): number {
    let most = 0;
    for (let i = 0; i < this.upgrades.length; i++) most = Math.max(most, RECIPES[this.upgrades[i]].needs[p]);
    return most;
  }

  /** How many of part p this level asks you to find: enough for every recipe, but no more than it holds. */
  private NeededHere(p: Part): number {
    let all = 0;
    for (let i = 0; i < this.upgrades.length; i++) all += RECIPES[this.upgrades[i]].needs[p];
    let inLevel = 0;
    for (let k = 0; k < this.pickups.length; k++) if (this.pickups[k].part === p) inLevel++;
    return Math.min(all, inLevel);
  }

  private HasParts(u: Upgrade): boolean {
    const needs = RECIPES[u].needs;
    for (let p = 0; p < Part.Count; p++) if (this.progress.parts[p] < needs[p]) return false;
    return true;
  }

  private AnyReady(): boolean {
    for (let i = 0; i < this.upgrades.length; i++) {
      if (!this.Built(this.upgrades[i]) && this.HasParts(this.upgrades[i])) return true;
    }
    return false;
  }

  /** Nothing left to build here: every upgrade is built, or the parts still in the level can't make the rest. */
  private NothingLeft(): boolean {
    for (let i = 0; i < this.upgrades.length; i++) {
      const u = this.upgrades[i];
      if (!this.Built(u) && this.CouldStillBuild(u)) return false;
    }
    return true;
  }

  /** The parts in hand plus the ones still lying in the level are enough for u. */
  private CouldStillBuild(u: Upgrade): boolean {
    const needs = RECIPES[u].needs;
    for (let p = 0; p < Part.Count; p++) {
      let lying = 0;
      for (let k = 0; k < this.pickups.length; k++) if (this.pickups[k].part === p && this.pickups[k].sprite.visible) lying++;
      if (this.progress.parts[p] + lying < needs[p]) return false;
    }
    return true;
  }

  private UpdateHud(): void {
    const done = this.NothingLeft(); // the hunt is over: no counters
    for (let i = 0; i < this.hudParts.length; i++) {
      const p = this.hudParts[i];
      const need = this.NeededHere(p);
      const have = this.progress.parts[p];
      this.hudIcons[i].SetVisible(!done);
      this.hudCounts[i].SetVisible(!done).SetText(have + '/' + need).SetColor(have >= need ? GOOD : CREAM);
    }
  }

  private OpenBench(): void {
    this.open = true;
    this.engine.physics.paused = true; // the world stops while you work
    this.shade.SetVisible(true);
    this.panel.SetVisible(true);
    if (this.benchPrompt) this.benchPrompt.SetVisible(false);
    this.Choose(this.choice);
  }

  private CloseBench(): void {
    const input = this.engine.input;
    this.open = false;
    this.shade.SetVisible(false);
    this.panel.SetVisible(false);
    // Keys used at the bench must not leak into gameplay (a buffered jump, a crouch toggle, a dash).
    input.Consume(Action.Jump);
    input.Consume(Action.Down);
    input.Consume(Action.Attack);
    input.Consume(Action.Throw);
    this.engine.physics.paused = false;
  }

  /** Select column i (clamped) and redraw the panel. */
  private Choose(i: number): void {
    this.choice = MathUtil.Clamp(i, 0, this.columns.length - 1);
    // A part every recipe needs, and the level holds too few of it for all of them: you build ONE.
    const shared = this.SharedPart();
    let inLevel = 0;
    for (let k = 0; k < this.pickups.length; k++) if (this.pickups[k].part === shared) inLevel++;
    const short = shared !== Part.Count && inLevel < this.upgrades.length;
    this.warning.SetText(short ? 'They all need the ' + PART_NAMES[shared].toLowerCase() + ': you can build only one.' : '');
    for (let c = 0; c < this.columns.length; c++) {
      const col = this.columns[c];
      const recipe = RECIPES[col.upgrade];
      const cx = (c - (this.columns.length - 1) / 2) * COLUMN_W;
      col.frame.Clear();
      if (this.columns.length > 1) { // with one upgrade there is nothing to choose
        const on = c === this.choice;
        col.frame.LineStyle(on ? 4 : 2, on ? 0xffd24a : 0xf0e6c8, on ? 1 : 0.2).StrokeRoundedRect(cx - COLUMN_W / 2 + 14, -200, COLUMN_W - 28, 380, 10);
      }
      for (let l = 0; l < col.partLines.length; l++) {
        const p = col.linePart[l];
        const have = Math.min(this.progress.parts[p], recipe.needs[p]);
        col.partLines[l].SetText(PART_NAMES[p] + '   ' + have + ' / ' + recipe.needs[p]).SetColor(have >= recipe.needs[p] ? GOOD : MISSING);
      }
      if (this.Built(col.upgrade)) col.status.SetText('Built.').SetColor(GOOD);
      else if (this.HasParts(col.upgrade)) col.status.SetText('Ready: Space builds it').SetColor(GOLD);
      else col.status.SetText('Missing parts').SetColor(MISSING);
    }
  }

  private Build(u: Upgrade): void {
    if (this.Built(u) || !this.HasParts(u)) return;
    const needs = RECIPES[u].needs;
    for (let p = 0; p < Part.Count; p++) this.progress.parts[p] -= needs[p]; // the parts go into it
    this.progress.built[u] = true;
    this.CloseBench();
    this.onBuilt(u);
    this.banner('NEW SKILL: ' + RECIPES[u].name + '\n' + SKILL_HINTS[u], 3.6);
  }
}
