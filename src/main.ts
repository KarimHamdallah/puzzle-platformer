import Phaser from 'phaser';
import './style.css';
import { BootScene } from './game/scenes/BootScene';

// Internal resolution: 480x270 (16:9). Scales x4 to 1920x1080 with crisp pixels.
export const GAME_WIDTH = 480;
export const GAME_HEIGHT = 270;

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#1a1a2e',
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 }, // gravity is applied per-body by the player controller (Day 1)
      debug: false,
    },
  },
  scene: [BootScene],
};

new Phaser.Game(config);
