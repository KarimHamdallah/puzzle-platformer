import Phaser from 'phaser';

// Temporary scene: proves Phaser boots, renders and runs the update loop.
// Replaced by Boot -> Preload -> Menu -> LevelSelect -> Level in later steps.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const { width, height } = this.scale;

    this.add
      .text(width / 2, height / 2 - 30, 'Phaser 3 running', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#e0e0ff',
      })
      .setOrigin(0.5);

    const box = this.add.rectangle(width / 2, height / 2 + 20, 16, 16, 0xffcc00);

    // Squash & stretch bounce: a tiny preview of the "feel" layer.
    this.tweens.add({
      targets: box,
      y: height / 2 + 40,
      scaleX: 1.3,
      scaleY: 0.7,
      duration: 350,
      ease: 'Quad.easeIn',
      yoyo: true,
      repeat: -1,
    });
  }
}
