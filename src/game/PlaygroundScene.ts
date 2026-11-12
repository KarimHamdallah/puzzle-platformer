import Phaser from 'phaser';
import { Action, InputActions } from '../core/InputActions';
import { COLORS, TILE } from './constants';
import { Player } from './Player';

// ---------------------------------------------------------------- room data (tiles)
// Greybox room for tuning movement. Temporary: real levels will come from Tiled maps.

interface Solid {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ROOM_W = 60;
const ROOM_H = 24;
const SPAWN_X = 3.5; // feet position
const SPAWN_Y = 21;

const SOLIDS: Solid[] = [
  // frame
  { x: 0, y: 0, w: 60, h: 1 }, // ceiling
  { x: 0, y: 0, w: 1, h: 24 }, // left wall
  { x: 59, y: 0, w: 1, h: 24 }, // right wall
  // ground
  { x: 1, y: 21, w: 20, h: 3 }, // floor A
  { x: 21, y: 23, w: 6, h: 1 }, // pit bottom (2 deep): walk off the edge to test coyote time
  { x: 27, y: 21, w: 14, h: 3 }, // floor B
  { x: 41, y: 19, w: 18, h: 5 }, // floor C: 2-tile step up
  // left staircase: the first step is low enough to bump your head on
  { x: 5, y: 18, w: 4, h: 1 },
  { x: 10, y: 15, w: 4, h: 1 },
  { x: 15, y: 12, w: 4, h: 1 },
  // long platform over the pit: run-jump distance from the staircase
  { x: 21, y: 10, w: 8, h: 1 },
  // pillar exactly 3 tiles tall: a held jump clears it, a tapped jump does not
  { x: 33, y: 18, w: 2, h: 3 },
  // low tunnel: 1-tile gap, run under it
  { x: 47, y: 17, w: 3, h: 1 },
  // right climb: ledges with growing gaps
  { x: 43, y: 15, w: 3, h: 1 },
  { x: 51, y: 13, w: 3, h: 1 },
  { x: 55, y: 9, w: 3, h: 1 },
];

// ---------------------------------------------------------------- scene

/**
 * Movement test room. Frame order (like a C++ main loop):
 *   1. physics steps at 60 Hz -> fixedUpdate(dt) -> player.fixedUpdate(dt)   (gameplay)
 *   2. update()               -> controls.update(), player.update()          (once per rendered frame)
 *   3. render
 */
export class PlaygroundScene extends Phaser.Scene {
  private controls!: InputActions;
  private player!: Player;
  private world!: Phaser.Physics.Arcade.World;

  constructor() {
    super('Playground');
  }

  create(): void {
    const worldW = ROOM_W * TILE;
    const worldH = ROOM_H * TILE;
    this.world = this.physics.world;
    this.world.setBounds(0, 0, worldW, worldH);
    this.cameras.main.setBackgroundColor(COLORS.background);

    const solids = this.physics.add.staticGroup();
    for (let i = 0; i < SOLIDS.length; i++) {
      const s = SOLIDS[i];
      solids.add(this.add.rectangle((s.x + s.w / 2) * TILE, (s.y + s.h / 2) * TILE, s.w * TILE, s.h * TILE, COLORS.solid));
    }

    this.controls = new InputActions();
    this.player = new Player(this, this.controls, SPAWN_X * TILE, SPAWN_Y * TILE);
    this.physics.add.collider(this.player.body, solids);

    this.cameras.main.setBounds(0, 0, worldW, worldH);
    this.cameras.main.startFollow(this.player.view, false, 0.12, 0.12, 0, 0);

    // Arcade fires WORLD_STEP after each physics step's collisions are resolved.
    this.world.on(Phaser.Physics.Arcade.Events.WORLD_STEP, this.fixedUpdate, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
  }

  update(_time: number, deltaMs: number): void {
    this.controls.update();
    if (this.controls.pressed(Action.Reset)) this.player.respawn();
    this.player.update(deltaMs);
  }

  private fixedUpdate(dt: number): void {
    this.player.fixedUpdate(dt);
  }

  /** Our "destructor". Uses this.world: scene.physics.world is already null when SHUTDOWN fires. */
  private shutdown(): void {
    this.world.off(Phaser.Physics.Arcade.Events.WORLD_STEP, this.fixedUpdate, this);
    this.player.destroy();
    this.controls.destroy();
  }
}
