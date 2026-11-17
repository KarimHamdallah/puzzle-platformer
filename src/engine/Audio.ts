import type Phaser from 'phaser';

/** Sound effects. Every play gets a small random pitch / volume change so repeats don't sound copy-pasted. */
export class Audio {
  private scene: Phaser.Scene | null = null;

  /** Engine only. */
  Attach(scene: Phaser.Scene): void {
    this.scene = scene;
  }

  /** volume 0..1; detune = the most the pitch may drift, in cents (100 = a semitone). Missing sounds are skipped. */
  Play(key: string, volume: number = 1, detune: number = 0): void {
    if (!this.scene || !this.scene.cache.audio.exists(key)) return;
    this.scene.sound.play(key, {
      volume: volume * (0.9 + Math.random() * 0.1),
      detune: (Math.random() * 2 - 1) * detune,
    });
  }
}
