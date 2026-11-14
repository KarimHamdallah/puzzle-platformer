import Phaser from 'phaser';

/**
 * Every texture and animation the game uses, in one place.
 *  - assets/player/*  : our own survivor sprites (art-src/draw_player.py), 96x96 frames
 *  - assets/craftpix/* : CraftPix freebies (zombies 96x96 frames, backgrounds, tileset, props)
 */

const FRAME = 96;

interface SheetAnim {
  key: string; // texture + animation key
  path: string;
  frameRate: number;
  loop: boolean;
}

const SHEETS: SheetAnim[] = [
  { key: 'player_idle', path: 'assets/player/player_idle.png', frameRate: 4, loop: true },
  { key: 'player_walk', path: 'assets/player/player_walk.png', frameRate: 10, loop: true },
  { key: 'player_run', path: 'assets/player/player_run.png', frameRate: 14, loop: true },
  { key: 'player_jump', path: 'assets/player/player_jump.png', frameRate: 6, loop: true },
  { key: 'player_fall', path: 'assets/player/player_fall.png', frameRate: 6, loop: true },
  { key: 'player_land', path: 'assets/player/player_land.png', frameRate: 14, loop: false },
  { key: 'player_crouch', path: 'assets/player/player_crouch.png', frameRate: 2.5, loop: true },
  { key: 'player_sneak', path: 'assets/player/player_sneak.png', frameRate: 8, loop: true },
  { key: 'player_aim', path: 'assets/player/player_aim.png', frameRate: 3, loop: true },
  { key: 'player_throw', path: 'assets/player/player_throw.png', frameRate: 14, loop: false },
  { key: 'player_attack', path: 'assets/player/player_attack.png', frameRate: 16, loop: false },

  { key: 'zombie_man_idle', path: 'assets/craftpix/zombies/zombie_man/idle.png', frameRate: 6, loop: true },
  { key: 'zombie_man_walk', path: 'assets/craftpix/zombies/zombie_man/walk.png', frameRate: 7, loop: true },
  { key: 'zombie_man_run', path: 'assets/craftpix/zombies/zombie_man/run.png', frameRate: 10, loop: true },
  { key: 'zombie_man_attack', path: 'assets/craftpix/zombies/zombie_man/attack_1.png', frameRate: 10, loop: false },
  { key: 'zombie_man_dead', path: 'assets/craftpix/zombies/zombie_man/dead.png', frameRate: 10, loop: false },
  { key: 'wild_zombie_idle', path: 'assets/craftpix/zombies/wild_zombie/idle.png', frameRate: 8, loop: true },
  { key: 'wild_zombie_run', path: 'assets/craftpix/zombies/wild_zombie/run.png', frameRate: 14, loop: true },
  { key: 'wild_zombie_attack', path: 'assets/craftpix/zombies/wild_zombie/attack_1.png', frameRate: 10, loop: false },
  { key: 'wild_zombie_jump', path: 'assets/craftpix/zombies/wild_zombie/jump.png', frameRate: 10, loop: false },
  { key: 'wild_zombie_hurt', path: 'assets/craftpix/zombies/wild_zombie/hurt.png', frameRate: 6, loop: true },
  { key: 'wild_zombie_dead', path: 'assets/craftpix/zombies/wild_zombie/dead.png', frameRate: 10, loop: false },
  { key: 'zombie_woman_dead', path: 'assets/craftpix/zombies/zombie_woman/dead.png', frameRate: 10, loop: false },
  { key: 'zombie_woman_idle', path: 'assets/craftpix/zombies/zombie_woman/idle.png', frameRate: 5, loop: true },
  { key: 'zombie_woman_scream', path: 'assets/craftpix/zombies/zombie_woman/scream.png', frameRate: 9, loop: true },
];

const IMAGES: [string, string][] = [
  ['bottle', 'assets/player/bottle.png'],
  ['stash', 'assets/player/stash.png'],
  ['key', 'assets/player/key.png'],
  ['door', 'assets/player/door.png'],
  ['bg_sky', 'assets/craftpix/bg/sky.png'],
  ['bg_far', 'assets/craftpix/bg/far.png'],
  ['bg_mid', 'assets/craftpix/bg/mid.png'],
  ['bg_near', 'assets/craftpix/bg/near.png'],
  ['box1', 'assets/craftpix/tiles/box1.png'],
  ['box2', 'assets/craftpix/tiles/box2.png'],
  ['box3', 'assets/craftpix/tiles/box3.png'],
  ['stone1', 'assets/craftpix/tiles/stone1.png'],
  ['stone2', 'assets/craftpix/tiles/stone2.png'],
];

/** Call from a scene's preload(). */
export function loadAssets(scene: Phaser.Scene): void {
  for (let i = 0; i < SHEETS.length; i++) {
    scene.load.spritesheet(SHEETS[i].key, SHEETS[i].path, { frameWidth: FRAME, frameHeight: FRAME });
  }
  for (let i = 0; i < IMAGES.length; i++) scene.load.image(IMAGES[i][0], IMAGES[i][1]);
  // Exclusion Zone tileset recoloured from blue-purple to olive stone / dark earth to match the
  // Postapocalypse backgrounds (colour-for-colour swap of its 8-colour palette).
  scene.load.image('tileset', 'assets/craftpix/tiles/tileset_olive.png');
}

/** Call from create(): nearest-neighbour filtering for pixel art + animation definitions (once per game). */
export function createAnimations(scene: Phaser.Scene): void {
  const textures = scene.textures;
  for (let i = 0; i < SHEETS.length; i++) textures.get(SHEETS[i].key).setFilter(Phaser.Textures.FilterMode.NEAREST);
  for (let i = 0; i < IMAGES.length; i++) textures.get(IMAGES[i][0]).setFilter(Phaser.Textures.FilterMode.NEAREST);
  textures.get('tileset').setFilter(Phaser.Textures.FilterMode.NEAREST);

  for (let i = 0; i < SHEETS.length; i++) {
    const s = SHEETS[i];
    if (scene.anims.exists(s.key)) continue; // animations are global: survive scene restarts
    scene.anims.create({
      key: s.key,
      frames: scene.anims.generateFrameNumbers(s.key, {}),
      frameRate: s.frameRate,
      repeat: s.loop ? -1 : 0,
    });
  }
}
