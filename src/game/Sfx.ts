import Phaser from 'phaser';

/**
 * Sound effects: real recordings cut by tools/cut_sfx.py (sources and licences in the asset list).
 *  - rifleShot: a Mosin Nagant shot with its tail (the tower sniper)
 *  - gunBurst: one short SKS shot, played per machine-gun burst
 *  - boltAction: a rifle reload: you hear the window to run
 * Every play gets a small random pitch / volume change so repeats don't sound copy-pasted.
 */

export const SFX_FILES: [string, string][] = [
  ['sfx_sniper', 'assets/sfx/sniper_shot.wav'],
  ['sfx_gun', 'assets/sfx/gun_shot.wav'],
  ['sfx_bolt', 'assets/sfx/bolt.wav'],
];

function play(scene: Phaser.Scene, key: string, volume: number, detune: number): void {
  if (!scene.cache.audio.exists(key)) return;
  scene.sound.play(key, {
    volume: volume * (0.9 + Math.random() * 0.1),
    detune: (Math.random() * 2 - 1) * detune,
  });
}

export function rifleShot(scene: Phaser.Scene): void {
  play(scene, 'sfx_sniper', 1, 120);
}

export function gunBurst(scene: Phaser.Scene): void {
  play(scene, 'sfx_gun', 0.55, 250);
}

/** The reload, starting `delay` s from now (after the shot's echo). */
export function boltAction(scene: Phaser.Scene, delay: number): void {
  scene.time.delayedCall(delay * 1000, () => play(scene, 'sfx_bolt', 0.8, 60));
}
