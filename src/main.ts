import Phaser from 'phaser';
import './style.css';
import { debug } from './core/debug/Debug';
import { GAME_HEIGHT, GAME_WIDTH } from './game/constants';
import { PlaygroundScene } from './game/scenes/PlaygroundScene';
import { InputTestScene } from './game/scenes/debug/InputTestScene';

// Vector look: render at 1920x1080 with antialiasing, scaled to fit the window.
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
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
  // The first scene starts automatically. Other scenes can be opened from the debug panel.
  scene: [PlaygroundScene, InputTestScene],
};

const game = new Phaser.Game(config);
debug.attach(game);
