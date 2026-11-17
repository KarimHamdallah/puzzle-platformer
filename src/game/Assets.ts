import type { Engine } from '../engine';

/**
 * Every texture, sound and animation clip the game uses, in one place (data only: the engine loads it).
 *  - assets/player/*  : our own survivor sprites and props (tools/draw_player.py), 96x96 frames
 *  - assets/craftpix/* : CraftPix freebies (zombies 96x96 frames, backgrounds, tileset, props)
 *  - assets/thumbs/*  : level-select pictures (optional: a background crop replaces a missing one)
 */

const FRAME = 96;

interface SheetAnim {
  key: string; // texture + clip key
  path: string;
  fps: number;
  loop: boolean;
}

const SHEETS: SheetAnim[] = [
  { key: 'player_idle', path: 'assets/player/player_idle.png', fps: 4, loop: true },
  { key: 'player_walk', path: 'assets/player/player_walk.png', fps: 10, loop: true },
  { key: 'player_run', path: 'assets/player/player_run.png', fps: 14, loop: true },
  { key: 'player_jump', path: 'assets/player/player_jump.png', fps: 6, loop: true },
  { key: 'player_fall', path: 'assets/player/player_fall.png', fps: 6, loop: true },
  { key: 'player_land', path: 'assets/player/player_land.png', fps: 14, loop: false },
  { key: 'player_crouch', path: 'assets/player/player_crouch.png', fps: 2.5, loop: true },
  { key: 'player_sneak', path: 'assets/player/player_sneak.png', fps: 8, loop: true },
  { key: 'player_aim', path: 'assets/player/player_aim.png', fps: 3, loop: true },
  { key: 'player_throw', path: 'assets/player/player_throw.png', fps: 14, loop: false },
  { key: 'player_attack', path: 'assets/player/player_attack.png', fps: 16, loop: false },

  { key: 'zombie_man_idle', path: 'assets/craftpix/zombies/zombie_man/idle.png', fps: 6, loop: true },
  { key: 'zombie_man_walk', path: 'assets/craftpix/zombies/zombie_man/walk.png', fps: 7, loop: true },
  { key: 'zombie_man_run', path: 'assets/craftpix/zombies/zombie_man/run.png', fps: 10, loop: true },
  { key: 'zombie_man_attack', path: 'assets/craftpix/zombies/zombie_man/attack_1.png', fps: 10, loop: false },
  { key: 'zombie_man_dead', path: 'assets/craftpix/zombies/zombie_man/dead.png', fps: 10, loop: false },
  { key: 'wild_zombie_idle', path: 'assets/craftpix/zombies/wild_zombie/idle.png', fps: 8, loop: true },
  { key: 'wild_zombie_run', path: 'assets/craftpix/zombies/wild_zombie/run.png', fps: 14, loop: true },
  { key: 'wild_zombie_attack', path: 'assets/craftpix/zombies/wild_zombie/attack_1.png', fps: 10, loop: false },
  { key: 'wild_zombie_jump', path: 'assets/craftpix/zombies/wild_zombie/jump.png', fps: 10, loop: false },
  { key: 'wild_zombie_hurt', path: 'assets/craftpix/zombies/wild_zombie/hurt.png', fps: 6, loop: true },
  { key: 'wild_zombie_dead', path: 'assets/craftpix/zombies/wild_zombie/dead.png', fps: 10, loop: false },
  { key: 'zombie_woman_dead', path: 'assets/craftpix/zombies/zombie_woman/dead.png', fps: 10, loop: false },
  { key: 'zombie_woman_idle', path: 'assets/craftpix/zombies/zombie_woman/idle.png', fps: 5, loop: true },
  { key: 'zombie_woman_scream', path: 'assets/craftpix/zombies/zombie_woman/scream.png', fps: 9, loop: true },
];

const IMAGES: [string, string][] = [
  ['bottle', 'assets/player/bottle.png'],
  ['stash', 'assets/player/stash.png'],
  ['key', 'assets/player/key.png'],
  ['door', 'assets/player/door.png'],
  ['corpse', 'assets/player/corpse.png'],
  ['car_chained', 'assets/player/car_chained.png'],
  ['car_open', 'assets/player/car_open.png'],
  ['molotov', 'assets/player/molotov.png'],
  ['rag', 'assets/player/rag.png'],
  ['boot', 'assets/player/boot.png'],
  ['big_crate', 'assets/player/big_crate.png'],
  ['sniper_nest', 'assets/player/sniper_nest.png'],
  ['gunner_nest', 'assets/player/gunner_nest.png'],
  ['tent', 'assets/player/tent.png'],
  ['campfire', 'assets/player/campfire.png'],
  ['dead_soldier', 'assets/player/dead_soldier.png'],
  ['newspaper', 'assets/player/newspaper.png'],
  ['scaffold', 'assets/player/scaffold.png'],
  ['scaffold_block', 'assets/player/scaffold_block.png'],
  ['helicopter', 'assets/player/helicopter.png'],
  ['spring', 'assets/player/spring.png'],
  ['strap', 'assets/player/strap.png'],
  ['spring_boots', 'assets/player/spring_boots.png'],
  ['workbench', 'assets/player/workbench.png'],
  ['wire', 'assets/player/wire.png'],
  ['herb', 'assets/player/herb.png'],
  ['gas', 'assets/player/gas.png'],
  ['brace_boots', 'assets/player/brace_boots.png'],
  ['pills', 'assets/player/pills.png'],
  ['big_crate_cracked', 'assets/player/big_crate_cracked.png'],
  ['big_crate_broken', 'assets/player/big_crate_broken.png'],
  ['concrete', 'assets/player/concrete.png'],
  ['ammo_crate', 'assets/player/ammo_crate.png'],
  ['ammo_crate_open', 'assets/player/ammo_crate_open.png'],
  ['smoke_grenade', 'assets/player/smoke_grenade.png'],
  ['bg_sky', 'assets/craftpix/bg/sky.png'],
  ['bg_far', 'assets/craftpix/bg/far.png'],
  ['bg_mid', 'assets/craftpix/bg/mid.png'],
  ['bg_near', 'assets/craftpix/bg/near.png'],
  ['box1', 'assets/craftpix/tiles/box1.png'],
  ['box2', 'assets/craftpix/tiles/box2.png'],
  ['box3', 'assets/craftpix/tiles/box3.png'],
  ['stone1', 'assets/craftpix/tiles/stone1.png'],
  ['stone2', 'assets/craftpix/tiles/stone2.png'],
  // Exclusion Zone tileset recoloured from blue-purple to olive stone / dark earth to match the
  // Postapocalypse backgrounds (colour-for-colour swap of its 8-colour palette).
  ['tileset', 'assets/craftpix/tiles/tileset_olive.png'],
];

/** Level-select pictures: photos, smooth filtering. */
const THUMBS: [string, string][] = [
  ['thumb_m1_easy', 'assets/thumbs/mechanic1_easy.png'],
  ['thumb_m1_medium', 'assets/thumbs/mechanic1_medium.png'],
  ['thumb_m1_hard', 'assets/thumbs/mechanic1_hard.png'],
  ['thumb_m2_easy', 'assets/thumbs/mechanic2_easy.webp'],
  ['thumb_m2_medium', 'assets/thumbs/mechanic2_medium.png'],
  ['thumb_m2_hard', 'assets/thumbs/mechanic2_hard.png'],
  ['thumb_m3_easy', 'assets/thumbs/mechanic3_easy.jpg'],
  ['thumb_m3_medium', 'assets/thumbs/mechanic3_medium.jpg'],
  ['thumb_m3_hard', 'assets/thumbs/mechanic3_hard.png'],
];

/**
 * Sound effects: real recordings cut by tools/cut_sfx.py (sources and licences in the asset list).
 *  - sfx_sniper: a Mosin Nagant shot with its tail (the tower sniper)
 *  - sfx_gun: one short SKS shot, played per machine-gun burst
 *  - sfx_bolt: a rifle reload: you hear the window to run
 */
const SOUNDS: [string, string][] = [
  ['sfx_sniper', 'assets/sfx/sniper_shot.wav'],
  ['sfx_gun', 'assets/sfx/gun_shot.wav'],
  ['sfx_bolt', 'assets/sfx/bolt.wav'],
];

/** Queue everything and register the animation clips. Once, before Engine.Run(). */
export function LoadAssets(engine: Engine): void {
  const a = engine.assets;
  for (let i = 0; i < SHEETS.length; i++) {
    const s = SHEETS[i];
    a.Sheet(s.key, s.path, FRAME, FRAME);
    engine.animations.AddClip({ key: s.key, texture: s.key, fps: s.fps, loop: s.loop });
  }
  for (let i = 0; i < IMAGES.length; i++) a.Image(IMAGES[i][0], IMAGES[i][1]);
  for (let i = 0; i < THUMBS.length; i++) a.Image(THUMBS[i][0], THUMBS[i][1], false);
  for (let i = 0; i < SOUNDS.length; i++) a.Sound(SOUNDS[i][0], SOUNDS[i][1]);
  a.Sheet('fire', 'assets/player/fire.png', 32, 48); // drawn flames, 8 frames
  engine.animations.AddClip({ key: 'fire', texture: 'fire', fps: 14, loop: true });
  // horde: the attack frames, slow and back and forth = tearing at a corpse
  engine.animations.AddClip({ key: 'zombie_man_feed', texture: 'zombie_man_attack', fps: 5, loop: true, yoyo: true });
}

// ---------------------------------------------------------------- sound effects

export function RifleShot(engine: Engine): void {
  engine.audio.Play('sfx_sniper', 1, 120);
}

export function GunBurst(engine: Engine): void {
  engine.audio.Play('sfx_gun', 0.55, 250);
}

/** The reload, starting `delay` s from now (after the shot's echo). */
export function BoltAction(engine: Engine, delay: number): void {
  engine.clock.After(delay, () => engine.audio.Play('sfx_bolt', 0.8, 60));
}
