import Phaser from 'phaser';
import './style.css';
import { debug } from './core/Debug';
import { DemoScene } from './game/DemoScene';

// Render at 1920x1080, scaled to fit the window. Pixel-art textures switch themselves to
// nearest-neighbour filtering (Assets.ts); antialiasing stays on for debug drawing.
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  dom: { createContainer: true }, // HTML over the canvas, scaled with it (the father's letter)
  width: 1920,
  height: 1080,
  backgroundColor: '#3b3a2c',
  pixelArt: false,
  antialias: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 }, // the player applies its own gravity; zombies use per-body gravity
      debug: false,
    },
  },
  scene: [DemoScene],
};

const game = new Phaser.Game(config);
debug.attach(game);
