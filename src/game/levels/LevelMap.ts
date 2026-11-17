import { Rect, type Engine } from '../../engine';
import { ART_SCALE, TILE } from '../constants';

/** A rectangle of solid tiles: x0..x1, y0..y1 (tiles, end exclusive). */
interface SolidRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

// Tileset (Exclusion Zone, 9 columns of 32 px tiles): a framed stone panel.
const TILESET_TILE = 32;
const PANEL_ROW_FIRST = [0, 9, 18]; // top, middle, bottom rows of the panel
const PANEL_COLUMN_1WIDE = [8, 17, 26]; // 1-tile-wide column pieces (top, middle, bottom)
const GRASS = [4, 5, 6, 7];
const WATER_COLOUR = 0x2f6f8f;
const WATER_ALPHA = 0.55;
const WATER_SURFACE = 0x9fd6e8;

/**
 * A level's ASCII map (1 char = 1 tile, see Levels.ts for the legend): the tile queries every system
 * asks ("is this solid?", "is this water?"), and Build(), which draws the tiles and makes the
 * physics bodies of the walls and floors.
 */
export class LevelMap {
  readonly rows: string[];
  readonly w: number; // tiles
  readonly h: number;
  private readonly extraScaffold = new Set<number>(); // y * w + x: scaffolding that appeared while playing

  constructor(rows: string[]) {
    this.rows = rows;
    this.w = rows[0].length;
    this.h = rows.length;
  }

  get pixelWidth(): number { return this.w * TILE; }
  get pixelHeight(): number { return this.h * TILE; }

  /** Is the character anywhere in the map? */
  Has(c: string): boolean {
    for (let y = 0; y < this.h; y++) if (this.rows[y].includes(c)) return true;
    return false;
  }

  /** Solid to walk on / collide with: stone and scaffolding. Outside the map counts as wall. */
  IsSolid(x: number, y: number): boolean {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return true;
    const c = this.rows[y][x];
    return c === '#' || c === 'Z' || this.extraScaffold.has(y * this.w + x);
  }

  /** Stone only: what the tileset draws and what stops a sniper's line of fire (scaffolding doesn't). */
  IsStone(x: number, y: number): boolean {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return true;
    return this.rows[y][x] === '#';
  }

  /** Stone at world pixel (px, py). */
  StoneAtPixel(px: number, py: number): boolean {
    return this.IsStone(Math.floor(px / TILE), Math.floor(py / TILE));
  }

  /** Map '~': water (Mechanic 3's seas). Not solid: you fall in, and drown unless you took the pills. */
  IsWater(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.rows[y][x] === '~';
  }

  /** Map 'a': an air pocket in the water (under a rock): breathing it refills the pills. */
  IsAir(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.rows[y][x] === 'a';
  }

  /** Scaffolding that appears while playing (M2 Medium): solid from now on. */
  AddScaffold(x: number, y: number): void {
    this.extraScaffold.add(y * this.w + x);
  }

  /** First floor row at or below fromRow in column x with 2 free tiles above it, or -1. */
  FloorUnder(x: number, fromRow: number): number {
    for (let y = Math.max(2, fromRow); y < this.h; y++) {
      if (this.IsSolid(x, y) && !this.IsSolid(x, y - 1) && !this.IsSolid(x, y - 2)) return y;
    }
    return -1;
  }

  /**
   * Visuals: a tile layer, auto-tiled from the map (top / middle / bottom row and left / right caps),
   * plus grass on exposed tops, scaffolding images and water.
   * Physics: one static body per rectangle of solid tiles (see BuildSolids).
   */
  Build(engine: Engine): void {
    const r = engine.renderer;
    const ground = r.CreateTileLayer('tileset', TILESET_TILE, this.w, this.h).SetScale(ART_SCALE).SetDepth(0);
    const grass = r.CreateTileLayer('tileset', TILESET_TILE, this.w, this.h).SetScale(ART_SCALE).SetDepth(11); // grass in front of the feet
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.rows[y][x] === 'Z') { // scaffolding: planks, drawn as an image
          r.CreateSprite(x * TILE, y * TILE, 'scaffold').SetOrigin(0, 0).SetScale(ART_SCALE).SetDepth(1);
          continue;
        }
        if (!this.IsStone(x, y)) continue;
        // Auto-tile one cell from its stone neighbours + grass on top.
        const top = !this.IsStone(x, y - 1);
        const bottom = !this.IsStone(x, y + 1);
        const left = !this.IsStone(x - 1, y);
        const right = !this.IsStone(x + 1, y);
        const row = top ? 0 : bottom ? 2 : 1;
        let index: number;
        if (left && right) index = PANEL_COLUMN_1WIDE[row];
        else if (left) index = PANEL_ROW_FIRST[row];
        else if (right) index = PANEL_ROW_FIRST[row] + 3;
        else index = PANEL_ROW_FIRST[row] + 1 + (x % 2);
        ground.PutTile(index, x, y);
        if (top && y > 0) grass.PutTile(GRASS[(x * 7 + y * 3) % 4], x, y - 1);
      }
    }
    this.DrawWater(engine);
    this.BuildSolids(engine);
  }

  /** Water: a translucent blue in front of the player (he is IN it), a light line on its surface. */
  private DrawWater(engine: Engine): void {
    if (!this.Has('~') && !this.Has('a')) return;
    const g = engine.renderer.CreateShape().SetDepth(13);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.IsAir(x, y)) { // an air pocket: a few bubbles, so it reads as "breathe here"
          g.FillStyle(WATER_SURFACE, 0.5).FillCircle((x + 0.3) * TILE, (y + 0.4) * TILE, 6).FillCircle((x + 0.7) * TILE, (y + 0.75) * TILE, 4);
          continue;
        }
        if (!this.IsWater(x, y)) continue;
        g.FillStyle(WATER_COLOUR, WATER_ALPHA).FillRect(x * TILE, y * TILE, TILE, TILE);
        if (!this.IsWater(x, y - 1) && !this.IsAir(x, y - 1)) g.FillStyle(WATER_SURFACE, 0.8).FillRect(x * TILE, y * TILE, TILE, 6);
      }
    }
  }

  /**
   * Solid bodies: each row's runs of solid tiles, and a run continues down while the rows below have
   * the exact same run. A straight wall is then ONE body, and a floor one body per run: few bodies to
   * test, and nothing to catch on between stacked tiles.
   */
  private BuildSolids(engine: Engine): void {
    let open: SolidRect[] = []; // rects still growing down (they reached the previous row)
    for (let y = 0; y < this.h; y++) {
      const next: SolidRect[] = [];
      let x = 0;
      while (x < this.w) {
        if (!this.IsSolid(x, y)) {
          x++;
          continue;
        }
        const start = x;
        while (x < this.w && this.IsSolid(x, y)) x++;
        let rect: SolidRect | null = null;
        for (let i = 0; i < open.length; i++) {
          if (open[i].x0 === start && open[i].x1 === x) {
            rect = open[i];
            open.splice(i, 1);
            break;
          }
        }
        if (rect) rect.y1 = y + 1; // same run as the row above: grow down
        else rect = { x0: start, x1: x, y0: y, y1: y + 1 };
        next.push(rect);
      }
      for (let i = 0; i < open.length; i++) this.AddSolid(engine, open[i]); // ended on the row above
      open = next;
    }
    for (let i = 0; i < open.length; i++) this.AddSolid(engine, open[i]);
  }

  private AddSolid(engine: Engine, s: SolidRect): void {
    engine.physics.CreateStaticBox(new Rect(s.x0 * TILE, s.y0 * TILE, (s.x1 - s.x0) * TILE, (s.y1 - s.y0) * TILE));
  }
}
