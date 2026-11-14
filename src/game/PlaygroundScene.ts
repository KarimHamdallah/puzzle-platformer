import Phaser from 'phaser';
import { Action, InputActions } from '../core/InputActions';
import { createAnimations, loadAssets } from './Assets';
import { CameraRig } from './CameraRig';
import { TILE } from './constants';
import { NoiseSystem } from './Noise';
import { Player } from './Player';
import { Throwables } from './Throwing';

// ---------------------------------------------------------------- room data (tiles)
// The Day 1 greybox room, exactly as it was when the controller was tuned (commit cd005fc), with
// today's player in it. Every piece tests one part of the movement.

interface Solid {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const ROOM_W = 60;
export const ROOM_H = 24;
const SPAWN_X = 3.5; // feet position
const SPAWN_Y = 21;
export const BACKGROUND = 0x4f9d6f; // Day 1 greybox palette: green room, red solids
export const SOLID = 0xff4646;

export const SOLIDS: Solid[] = [
  // frame
  { x: 0, y: 0, w: 60, h: 1 }, // ceiling
  { x: 0, y: 0, w: 1, h: 24 }, // left wall
  { x: 59, y: 0, w: 1, h: 24 }, // right wall
  // ground
  { x: 1, y: 21, w: 20, h: 3 }, // floor A
  { x: 21, y: 23, w: 6, h: 1 }, // pit bottom (2 deep): walk off the edge to test coyote time
  { x: 27, y: 21, w: 14, h: 3 }, // floor B
  // ceiling with a 1-tile hole above floor B: corner correction makes it jumpable without pixel precision
  { x: 27, y: 18, w: 3, h: 1 },
  { x: 31, y: 18, w: 2, h: 1 },
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
 *   2. update()               -> controls, player visuals, camera               (once per rendered frame)
 *   3. render
 */
export class PlaygroundScene extends Phaser.Scene {
  private controls!: InputActions;
  private player!: Player;
  private cameraRig!: CameraRig;
  private noise!: NoiseSystem;
  private throwables!: Throwables;
  private world!: Phaser.Physics.Arcade.World;

  constructor() {
    super('Playground');
  }

  preload(): void {
    loadAssets(this);
  }

  create(): void {
    createAnimations(this);
    const worldW = ROOM_W * TILE;
    const worldH = ROOM_H * TILE;
    this.world = this.physics.world;
    this.world.setBounds(0, 0, worldW, worldH);
    this.cameras.main.setBackgroundColor(BACKGROUND);
    this.cameras.main.fadeIn(200);

    const solids = this.physics.add.staticGroup();
    for (let i = 0; i < SOLIDS.length; i++) {
      const s = SOLIDS[i];
      solids.add(this.add.rectangle((s.x + s.w / 2) * TILE, (s.y + s.h / 2) * TILE, s.w * TILE, s.h * TILE, SOLID));
    }

    this.controls = new InputActions();
    this.noise = new NoiseSystem(this);
    this.throwables = new Throwables(this, 0); // nothing to throw here; the debug panel's infinite bottles still work
    this.player = new Player(this, this.controls, this.noise, this.throwables, SPAWN_X * TILE, SPAWN_Y * TILE);
    this.physics.add.collider(this.player.body, solids);
    this.cameraRig = new CameraRig(this, this.player, worldW, worldH);

    this.add.text(24, 20, 'DAY 1  -  MOVEMENT TEST ROOM', {
      fontFamily: 'Georgia, serif', fontSize: '34px', fontStyle: 'bold', color: '#ffffff', stroke: '#1d3a2a', strokeThickness: 6,
    }).setScrollFactor(0).setDepth(50);
    this.add.text(24, this.scale.height - 20,
      'Move ←→   Sprint Shift   Crouch ↓/C (toggle)   Jump Space (hold = higher)   Respawn R   Level select Esc', {
        fontFamily: 'Georgia, serif', fontSize: '22px', color: '#ffffff', stroke: '#1d3a2a', strokeThickness: 4,
      }).setOrigin(0, 1).setScrollFactor(0).setDepth(50);

    // Arcade fires WORLD_STEP after each physics step's collisions are resolved.
    this.world.on(Phaser.Physics.Arcade.Events.WORLD_STEP, this.fixedUpdate, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
  }

  update(time: number, deltaMs: number): void {
    this.controls.update();
    if (this.controls.pressed(Action.Back)) {
      this.scene.start('Menu');
      return;
    }
    if (this.controls.pressed(Action.Reset)) {
      this.player.respawn();
      this.cameraRig.snap();
    }
    this.player.update(deltaMs);
    this.throwables.update(time);
    this.noise.update(deltaMs);
    this.cameraRig.update(deltaMs);
  }

  private fixedUpdate(dt: number): void {
    this.noise.beginStep();
    this.player.fixedUpdate(dt);
    this.throwables.fixedUpdate(dt, this.noise, this.player.body);
  }

  /** Our "destructor". Uses this.world: scene.physics.world is already null when SHUTDOWN fires. */
  private shutdown(): void {
    this.world.off(Phaser.Physics.Arcade.Events.WORLD_STEP, this.fixedUpdate, this);
    this.throwables.destroy();
    this.cameraRig.destroy();
    this.player.destroy();
    this.controls.destroy();
  }
}
