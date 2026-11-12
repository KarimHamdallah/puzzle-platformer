import Phaser from 'phaser';
import './style.css';
import { debug } from './core/debug/Debug';
import { BootScene } from './game/scenes/BootScene';
import { InputTestScene } from './game/scenes/debug/InputTestScene';

// Internal resolution: 480x270 (16:9). Scales x4 to 1920x1080 with crisp pixels.
export const GAME_WIDTH = 480;
export const GAME_HEIGHT = 270;

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#1a1a2e',
  pixelArt: false,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: {
    gamepad: true,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 }, // gravity is applied per-body by the player controller (Day 1)
      debug: false,
    },
  },
  // The first scene starts automatically. InputTest is the Day 1 Step 1 test bed.
  scene: [InputTestScene, BootScene],
};

const game = new Phaser.Game(config);
debug.attach(game);
