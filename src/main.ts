import Phaser from 'phaser';
import './style.css';
import { debug } from './core/Debug';
import { PlaygroundScene } from './game/PlaygroundScene';

// Vector look: render at 1920x1080 with antialiasing, scaled to fit the window.
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: 1920,
  height: 1080,
  backgroundColor: '#4f9d6f',
  pixelArt: false,
  antialias: true,
  roundPixels: false, // sub-pixel positions = smooth motion for vector shapes
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 }, // the player controller applies its own gravity
      debug: false,
    },
  },
  scene: [PlaygroundScene],
};

const game = new Phaser.Game(config);
debug.attach(game);
