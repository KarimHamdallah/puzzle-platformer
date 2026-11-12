import Phaser from 'phaser';
import { DEBUG_ENABLED } from '../core/Debug';
import { Action, InputActions } from '../core/InputActions';
import { createAnimations, loadAssets } from './Assets';
import { CameraRig } from './CameraRig';
import { ART_SCALE, TILE } from './constants';
import { Player } from './Player';
import { Zombie, ZombieDebug, ZombieKind } from './Zombie';

// ---------------------------------------------------------------- level (1 char = 1 tile)
//   #  solid ground          P  player spawn
//   C  Clicker               R  Runner          S  Screamer (faces left)
//   b  box (decor)           o  stone (decor)
const MAP: string[] = [
  '#..............................................................................#',
  '#..............................................................................#',
  '#..............................................................................#',
  '#..............................................................................#',
  '#..............................................................................#',
  '#..............................................................................#',
  '#..............................................................................#',
  '#..............................................................................#',
  '#.......................................................................b..S...#',
  '#.....................................................................##########',
  '#.....................................................................##########',
  '#...............................................................###...##########',
  '#.....................................................................##########',
  '#......................b......######..................................##########',
  '#...................#######................................###........##########',
  '#...........................................####......................##########',
  '#..P...b....bo...............C...o..........####..o....R..............##########',
  '######################################....######################################',
  '######################################....######################################',
  '################################################################################',
];

const MAP_W = MAP[0].length;
const MAP_H = MAP.length;

// Tileset (Exclusion Zone, 9 columns of 32 px tiles): a framed stone panel.
const PANEL_ROW_FIRST = [0, 9, 18]; // top, middle, bottom rows of the panel
const PANEL_COLUMN_1WIDE = [8, 17, 26]; // 1-tile-wide column pieces (top, middle, bottom)
const GRASS = [4, 5, 6, 7];

// Parallax layers (CraftPix Postapocalypse 2, 1920x1080): texture key + horizontal scroll factor.
const PARALLAX: [string, number][] = [
  ['bg_sky', 0],
  ['bg_far', 0.1],
  ['bg_mid', 0.25],
  ['bg_near', 0.45],
];

function isSolid(x: number, y: number): boolean {
  if (x < 0 || x >= MAP_W || y < 0 || y >= MAP_H) return true; // outside the map counts as wall
  return MAP[y][x] === '#';
}

/**
 * Demo level. Frame order (like a C++ main loop):
 *   1. physics steps at 60 Hz -> fixedUpdate(dt): player + zombies gameplay
 *   2. update(): input, visuals, camera, parallax (once per rendered frame)
 *   3. render
 */
export class DemoScene extends Phaser.Scene {
  private controls!: InputActions;
  private player!: Player;
  private cameraRig!: CameraRig;
  private world!: Phaser.Physics.Arcade.World;
  private zombies: Zombie[] = [];
  private zombieDebug: ZombieDebug | null = null;
  private parallax: Phaser.GameObjects.TileSprite[] = [];

  constructor() {
    super('Demo');
  }

  preload(): void {
    loadAssets(this);
  }

  create(): void {
    createAnimations(this);
    this.zombies = [];
    this.parallax = [];
    this.zombieDebug = null;

    const worldW = MAP_W * TILE;
    const worldH = MAP_H * TILE;
    this.world = this.physics.world;
    this.world.setBounds(0, 0, worldW, worldH);
    this.cameras.main.setRoundPixels(true); // pixel art: no half-pixel shimmer while scrolling

    this.createParallax();
    const solids = this.createLevel();
    this.controls = new InputActions();
    this.spawnEntities();

    this.physics.add.collider(this.player.body, solids);
    for (let i = 0; i < this.zombies.length; i++) this.physics.add.collider(this.zombies[i].body, solids);

    this.cameraRig = new CameraRig(this, this.player, worldW, worldH);
    if (DEBUG_ENABLED) this.zombieDebug = new ZombieDebug(this, this.zombies);

    this.world.on(Phaser.Physics.Arcade.Events.WORLD_STEP, this.fixedUpdate, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
  }

  update(_time: number, deltaMs: number): void {
    this.controls.update();
    if (this.controls.pressed(Action.Reset)) {
      this.player.respawn();
      this.cameraRig.snap();
    }
    this.player.update(deltaMs);
    for (let i = 0; i < this.zombies.length; i++) this.zombies[i].update();
    this.cameraRig.update(deltaMs);

    const scrollX = this.cameras.main.scrollX;
    for (let i = 0; i < this.parallax.length; i++) this.parallax[i].tilePositionX = scrollX * PARALLAX[i][1];
    if (this.zombieDebug) this.zombieDebug.draw();
  }

  private fixedUpdate(dt: number): void {
    this.player.fixedUpdate(dt);
    for (let i = 0; i < this.zombies.length; i++) this.zombies[i].fixedUpdate(dt, this.player);
  }

  /** Our "destructor". Uses this.world: scene.physics.world is already null when SHUTDOWN fires. */
  private shutdown(): void {
    this.world.off(Phaser.Physics.Arcade.Events.WORLD_STEP, this.fixedUpdate, this);
    if (this.zombieDebug) this.zombieDebug.destroy();
    this.cameraRig.destroy();
    this.player.destroy();
    this.controls.destroy();
  }

  // ---------------------------------------------------------------- building

  /** Screen-sized tiling layers fixed to the camera; update() scrolls each at its own speed. */
  private createParallax(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    for (let i = 0; i < PARALLAX.length; i++) {
      const layer = this.add.tileSprite(0, 0, w, h, PARALLAX[i][0]).setOrigin(0, 0).setScrollFactor(0).setDepth(-100 + i);
      this.parallax.push(layer);
    }
  }

  /**
   * Visuals: a tilemap layer, auto-tiled from MAP (top / middle / bottom row and left / right caps),
   * plus grass on exposed tops. Physics: one invisible static body per horizontal run of '#'
   * (the player's corner correction queries static bodies, which a tilemap layer would not provide).
   */
  private createLevel(): Phaser.Physics.Arcade.StaticGroup {
    const map = this.make.tilemap({ tileWidth: 32, tileHeight: 32, width: MAP_W, height: MAP_H });
    const tileset = map.addTilesetImage('tileset', 'tileset', 32, 32, 0, 0);
    if (!tileset) throw new Error('tileset failed to load');
    const ground = map.createBlankLayer('ground', tileset, 0, 0);
    const grass = map.createBlankLayer('grass', tileset, 0, 0);
    if (!ground || !grass) throw new Error('could not create tilemap layers');

    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (!isSolid(x, y)) continue;
        const top = !isSolid(x, y - 1);
        const bottom = !isSolid(x, y + 1);
        const left = !isSolid(x - 1, y);
        const right = !isSolid(x + 1, y);
        const row = top ? 0 : bottom ? 2 : 1;
        let index: number;
        if (left && right) index = PANEL_COLUMN_1WIDE[row];
        else if (left) index = PANEL_ROW_FIRST[row];
        else if (right) index = PANEL_ROW_FIRST[row] + 3;
        else index = PANEL_ROW_FIRST[row] + 1 + (x % 2);
        ground.putTileAt(index, x, y);
        if (top && y > 0) grass.putTileAt(GRASS[(x * 7 + y * 3) % 4], x, y - 1);
      }
    }
    ground.setScale(ART_SCALE).setDepth(0);
    grass.setScale(ART_SCALE).setDepth(11); // grass in front of the feet

    const solids = this.physics.add.staticGroup();
    for (let y = 0; y < MAP_H; y++) {
      let x = 0;
      while (x < MAP_W) {
        if (!isSolid(x, y)) {
          x++;
          continue;
        }
        const start = x;
        while (x < MAP_W && isSolid(x, y)) x++;
        const w = (x - start) * TILE;
        solids.add(this.add.zone(start * TILE + w / 2, y * TILE + TILE / 2, w, TILE));
      }
    }
    return solids;
  }

  private spawnEntities(): void {
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const feetX = (x + 0.5) * TILE;
        const feetY = (y + 1) * TILE;
        switch (MAP[y][x]) {
          case 'P':
            this.player = new Player(this, this.controls, feetX, feetY);
            break;
          case 'C':
            this.zombies.push(new Zombie(this, ZombieKind.Clicker, feetX, feetY, 1));
            break;
          case 'R':
            this.zombies.push(new Zombie(this, ZombieKind.Runner, feetX, feetY, 1));
            break;
          case 'S':
            this.zombies.push(new Zombie(this, ZombieKind.Screamer, feetX, feetY, -1));
            break;
          case 'b':
            this.add.image(feetX, feetY, x % 2 === 0 ? 'box1' : 'box2').setOrigin(0.5, 1).setScale(ART_SCALE).setDepth(1);
            break;
          case 'o':
            this.add.image(feetX, feetY, x % 2 === 0 ? 'stone1' : 'stone2').setOrigin(0.5, 1).setScale(ART_SCALE).setDepth(1);
            break;
        }
      }
    }
  }
}
