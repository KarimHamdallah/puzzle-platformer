import Phaser from 'phaser';
import { DEBUG_ENABLED } from '../core/Debug';
import { Action, InputActions } from '../core/InputActions';
import { createAnimations, loadAssets } from './Assets';
import { Blackout } from './Blackout';
import { CameraRig } from './CameraRig';
import { ART_SCALE, TILE } from './constants';
import { Dialogue } from './Dialogue';
import { FATHER_LETTER, Letter, SOLDIER_NEWSPAPER } from './Letter';
import { KeyColor, LEVELS, LevelProgress, type LevelData } from './Levels';
import { KEY_TINTS, Locks } from './Locks';
import { MolotovQuest } from './Molotov';
import { NoiseKind, NoiseMeter, NoiseSystem } from './Noise';
import { Player } from './Player';
import { SmokeQuest } from './Smoke';
import { Sniper } from './Sniper';
import { Throwables } from './Throwing';
import { Zombie, ZombieDebug, ZombieKind } from './Zombie';

// ---------------------------------------------------------------- the current level
// One level scene plays any LevelData (Levels.ts). The helpers below read the level being played,
// like a C++ static: set in create(), one level at a time.
let LEVEL: LevelData = LEVELS[0];
let MAP: string[] = LEVEL.map;
let MAP_W = MAP[0].length;
let MAP_H = MAP.length;
const EXTRA_SCAFFOLD = new Set<number>(); // y * MAP_W + x: scaffolding that appeared while playing

const RESTART_DELAY = 700; // ms between being caught and the level restarting
const STOMP_DEPTH = 22; // px: how far into a Runner's head the feet may be and still count as a stomp
const SUMMON_MARGIN = 2; // tiles past the screen edge where summoned Runners appear
const SUMMON_SPACING = 2; // tiles between them
const SUMMON_SEARCH = 30; // tiles searched outward for a floor on the player's level
const SUMMON_MAX = 4; // summoned Runners alive at once
const LISTEN_UNLOCK_KEY = 'upgrade:listen'; // localStorage: Listen Mode earned (Hard finished)
const SUMMON_MIN_DISTANCE = 6; // tiles: when nothing off-screen is on your level, they appear at least this far
const STOMP_NOISE = 4; // tiles
const CHECKPOINT_OFF = 0x8a8a7a;
const CHECKPOINT_ON = 0xffa640;

const CRATE_HP = 2; // shots a wooden crate takes before it breaks (M2 Medium)

interface BreakableCrate {
  rect: Phaser.Geom.Rectangle; // its cover rectangle (removed from covers when it breaks)
  img: Phaser.GameObjects.Image;
  hp: number;
}

interface Checkpoint {
  x: number; // feet position
  y: number;
  flag: Phaser.GameObjects.Graphics;
}

/** Passed to scene.start() / restart(): which level, where to respawn and with how many bottles. */
export interface RestartData {
  level?: number; // index into LEVELS
  checkpoint?: number; // index into checkpoints, -1 = level start
  bottles?: number;
  progress?: LevelProgress; // what a death must not undo (coloured keys, the Molotov story)
}

// Tileset (Exclusion Zone, 9 columns of 32 px tiles): a framed stone panel.
const PANEL_ROW_FIRST = [0, 9, 18]; // top, middle, bottom rows of the panel
const PANEL_COLUMN_1WIDE = [8, 17, 26]; // 1-tile-wide column pieces (top, middle, bottom)
const GRASS = [4, 5, 6, 7];

// Parallax layers (CraftPix Postapocalypse 2, 1920x1080): texture key + horizontal scroll factor.
const PARALLAX: [string, number][] = [
  ['bg_sky', 0],
  ['bg_far', 0.1],
  ['bg_mid', 0.25],
  ['bg_near', 0.45],
];

/** Solid to walk on / collide with: stone and scaffolding. */
function isSolid(x: number, y: number): boolean {
  if (x < 0 || x >= MAP_W || y < 0 || y >= MAP_H) return true; // outside the map counts as wall
  const c = MAP[y][x];
  return c === '#' || c === 'Z' || EXTRA_SCAFFOLD.has(y * MAP_W + x);
}

/** Stone only: what the tileset draws and what stops a sniper's line of fire (scaffolding doesn't). */
function isStone(x: number, y: number): boolean {
  if (x < 0 || x >= MAP_W || y < 0 || y >= MAP_H) return true;
  return MAP[y][x] === '#';
}

/** Keys the door at tile (x, y) takes. */
function doorKeys(x: number, y: number): number {
  const t = LEVEL.doorKeys;
  for (let i = 0; i < t.length; i++) if (t[i][0] === x && t[i][1] === y) return t[i][2];
  return 1;
}

function listenUnlocked(): boolean {
  try {
    return localStorage.getItem(LISTEN_UNLOCK_KEY) === '1';
  } catch {
    return false; // storage blocked: the upgrade only exists in the Hard level
  }
}

function unlockListen(): void {
  try {
    localStorage.setItem(LISTEN_UNLOCK_KEY, '1');
  } catch {
    // storage blocked: nothing to remember
  }
}

/** First floor row at or below fromRow in column x with 2 free tiles above it, or -1. */
function floorUnder(x: number, fromRow: number): number {
  for (let y = Math.max(2, fromRow); y < MAP_H; y++) {
    if (isSolid(x, y) && !isSolid(x, y - 1) && !isSolid(x, y - 2)) return y;
  }
  return -1;
}

/**
 * A level (any LevelData). Frame order (like a C++ main loop):
 *   1. physics steps at 60 Hz -> fixedUpdate(dt): noise, player, bottles, zombies, contacts
 *   2. update(): input, visuals, camera, parallax, HUD (once per rendered frame)
 *   3. render
 */
export class LevelScene extends Phaser.Scene {
  private controls!: InputActions;
  private player!: Player;
  private cameraRig!: CameraRig;
  private noise!: NoiseSystem;
  private throwables!: Throwables;
  private locks!: Locks;
  private solids!: Phaser.Physics.Arcade.StaticGroup;
  private letter: Letter | null = null;
  private dialogue: Dialogue | null = null;
  private quest: MolotovQuest | null = null;
  private progress = new LevelProgress();
  private groupZombies: Zombie[][] = []; // per LEVEL.keyGroups entry: the zombies that carry its key
  private hudColourKeys: Phaser.GameObjects.Image[] = [];
  private hudMolotov: Phaser.GameObjects.Image | null = null;
  private noiseMeter!: NoiseMeter;
  private blackout!: Blackout;
  private snipers: Sniper[] = [];
  private smokeQuest: SmokeQuest | null = null;
  private crates: BreakableCrate[] = []; // M2 Medium: wooden crates that break under fire
  private hudSmoke: Phaser.GameObjects.Image | null = null;
  private hudSmokeCount: Phaser.GameObjects.Text | null = null;
  private groundLayer!: Phaser.Tilemaps.TilemapLayer;
  private grassLayer!: Phaser.Tilemaps.TilemapLayer;
  private revealedShown = false;
  private cheating = false; // Hard's cheat key: unlimited bottles + invisible + every door open
  private bottlesBeforeCheat = 0;
  private smokesBeforeCheat = 0;
  private cheatText: Phaser.GameObjects.Text | null = null;
  private summoned: Zombie[] = []; // Runners called in by Screamers
  private world!: Phaser.Physics.Arcade.World;
  private hudCount!: Phaser.GameObjects.Text;
  private hudKeys!: Phaser.GameObjects.Text;
  private zombies: Zombie[] = [];
  private covers: Phaser.Geom.Rectangle[] = [];
  private zombieDebug: ZombieDebug | null = null;
  private parallax: Phaser.GameObjects.TileSprite[] = [];
  private checkpoints: Checkpoint[] = [];
  private exit: Phaser.Math.Vector2 | null = null;
  private restarting = false;
  private deathHandled = false;
  private finished = false;
  private levelIndex = 0; // from RestartData
  private startCheckpoint = -1;
  private startBottles = 0;
  private checkpoint = -1; // last activated checkpoint
  private bottlesAtCheckpoint = 0;

  constructor() {
    super('Level');
  }

  init(data: RestartData): void {
    this.levelIndex = data.level ?? 0;
    LEVEL = LEVELS[this.levelIndex];
    MAP = LEVEL.map;
    MAP_W = MAP[0].length;
    MAP_H = MAP.length;
    EXTRA_SCAFFOLD.clear();
    this.startCheckpoint = data.checkpoint ?? -1;
    this.startBottles = data.bottles ?? 0;
    this.progress = data.progress ?? new LevelProgress();
  }

  preload(): void {
    loadAssets(this);
  }

  create(): void {
    createAnimations(this);
    this.zombies = [];
    this.covers = [];
    this.parallax = [];
    this.checkpoints = [];
    this.exit = null;
    this.zombieDebug = null;
    this.letter = null;
    this.snipers = [];
    this.smokeQuest = null;
    this.crates = [];
    this.hudSmoke = null;
    this.hudSmokeCount = null;
    this.revealedShown = false;
    this.cheating = false; // a fresh level starts without cheats (the scene object is reused)
    this.dialogue = null;
    this.quest = null;
    this.groupZombies = [];
    this.hudColourKeys = [];
    this.hudMolotov = null;
    this.summoned = [];
    this.restarting = false;
    this.deathHandled = false;
    this.finished = false;
    this.checkpoint = this.startCheckpoint;
    this.bottlesAtCheckpoint = this.startBottles;

    const worldW = MAP_W * TILE;
    const worldH = MAP_H * TILE;
    this.world = this.physics.world;
    this.world.setBounds(0, 0, worldW, worldH);
    this.cameras.main.setRoundPixels(true); // pixel art: no half-pixel shimmer while scrolling
    this.cameras.main.fadeIn(200);

    this.createParallax();
    const solids = this.createLevel();
    this.solids = solids;
    this.controls = new InputActions();
    this.noise = new NoiseSystem(this);
    this.throwables = new Throwables(this, this.startBottles);
    this.locks = new Locks(this, solids);
    this.locks.onColouredKey = (c) => { this.progress.keyHeld[c] = true; };
    this.throwables.stashOverride = LEVEL.stashSize;
    const molotovLevel = MAP.some(row => row.includes('V'));
    const smokeLevel = MAP.some(row => row.includes('Y'));
    if (molotovLevel || smokeLevel || LEVEL.intro.length > 0) this.dialogue = new Dialogue(this, this.controls);
    if (smokeLevel && this.dialogue) {
      this.smokeQuest = new SmokeQuest(this, this.controls, this.dialogue, this.progress, this.throwables, this.covers,
        (text, ms) => this.banner(text, ms));
      this.smokeQuest.setGunnerSeenAt(LEVEL.gunnerSeenAt);
    }
    if (molotovLevel && this.dialogue) { // the Molotov level
      this.quest = new MolotovQuest(this, this.controls, this.dialogue, this.progress, this.throwables, this.locks,
        (text, ms) => this.banner(text, ms));
    }
    this.spawnEntities();
    this.player.covers = this.covers;
    this.player.zombies = this.zombies;
    this.throwables.zombies = this.zombies;

    this.physics.add.collider(this.player.body, solids);
    for (let i = 0; i < this.zombies.length; i++) this.physics.add.collider(this.zombies[i].body, solids);

    this.cameraRig = new CameraRig(this, this.player, worldW, worldH);
    if (this.progress.sawGunner) this.showRevealed(false); // seen before a death: already there
    for (let i = 0; i < LEVEL.snipers.length; i++) {
      this.snipers.push(new Sniper(this, LEVEL.snipers[i], this.player, this.zombies, this.covers,
        (x, y) => isStone(Math.floor(x / TILE), Math.floor(y / TILE)), (x, y) => this.crateHit(x, y)));
    }
    this.player.canListen = LEVEL.grantsListen || listenUnlocked();
    this.blackout = new Blackout(this, this.player, this.zombies, this.noise, LEVEL.night);
    for (let i = 0; i < LEVEL.hints.length; i++) {
      const h = LEVEL.hints[i];
      this.add.text(h[0] * TILE, h[1] * TILE, h[2], { // above the night: hints stay readable
        fontFamily: 'Georgia, serif', fontSize: '26px', fontStyle: 'italic', color: '#f0e6c8', stroke: '#000000', strokeThickness: 5,
      }).setOrigin(0.5).setDepth(41);
    }
    this.createHud();
    if (this.dialogue && LEVEL.intro.length > 0 && !this.progress.introSeen) { // the level's opening thoughts
      this.progress.introSeen = true;
      const dialogue = this.dialogue;
      this.time.delayedCall(450, () => dialogue.show(LEVEL.intro, () => { if (LEVEL.introBanner) this.banner(LEVEL.introBanner, 3200); }));
    }
    if (DEBUG_ENABLED) this.zombieDebug = new ZombieDebug(this, this.zombies);

    this.world.on(Phaser.Physics.Arcade.Events.WORLD_STEP, this.fixedUpdate, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
  }

  update(time: number, deltaMs: number): void {
    this.controls.update();
    if (this.letter) {
      const reading = this.letter.open;
      this.letter.update(time, this.player);
      if (reading || this.letter.open) return; // reading: the world is paused (Letter pauses physics)
    }
    if (this.dialogue) {
      const talking = this.dialogue.open;
      this.dialogue.update();
      if (talking || this.dialogue.open) return; // thinking: the world is paused (Dialogue pauses physics)
    }
    if (this.quest) {
      this.quest.update(time, this.player);
      if (this.dialogue && this.dialogue.open) return;
    }
    if (this.smokeQuest) {
      this.smokeQuest.update(time, this.player);
      if (this.progress.sawGunner) this.showRevealed(true);
      if (this.dialogue && this.dialogue.open) return;
    }
    if (this.controls.pressed(Action.Back)) {
      this.toMenu();
      return;
    }
    if (this.controls.pressed(Action.Reset)) this.restartLevel();
    if (LEVEL.cheats) this.cheats();

    this.player.update(deltaMs);
    for (let i = 0; i < this.zombies.length; i++) this.zombies[i].update(time);
    this.throwables.update(time);
    this.noise.update(deltaMs);
    this.cameraRig.update(deltaMs);
    this.blackout.update(deltaMs);
    for (let i = 0; i < this.snipers.length; i++) this.snipers[i].update(time);

    const scrollX = this.cameras.main.scrollX;
    for (let i = 0; i < this.parallax.length; i++) this.parallax[i].tilePositionX = scrollX * PARALLAX[i][1];
    this.hudCount.setText('x ' + this.throwables.count);
    this.hudKeys.setText('x ' + this.locks.keys);
    for (let c = 0; c < this.hudColourKeys.length; c++) {
      this.hudColourKeys[c].setAlpha(this.progress.keyHeld[c] ? 1 : 0.22).setVisible(!this.progress.keysUsed);
    }
    if (this.hudMolotov) this.hudMolotov.setVisible(this.throwables.molotovs > 0);
    if (this.hudSmoke && this.hudSmokeCount) {
      const n = this.throwables.smokes;
      this.hudSmoke.setVisible(n > 0);
      this.hudSmokeCount.setVisible(n > 0).setText('x ' + n);
    }
    this.noiseMeter.update(deltaMs, this.player.noiseLevel, this.player.stepCount, this.player.landCount, this.noise.masked);
    if (this.zombieDebug) this.zombieDebug.draw(this.player);
  }

  private fixedUpdate(dt: number): void {
    this.noise.beginStep(); // noises emitted last step become audible now
    this.player.fixedUpdate(dt);
    this.throwables.fixedUpdate(dt, this.noise, this.player.body);
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      z.fixedUpdate(dt, this.player, this.noise);
      if (z.hasKey && !z.alive) { // a guardian died: its key drops
        z.hasKey = false;
        this.locks.dropKey(z.feetX, z.feetY);
      }
      if (z.summons > 0) { // a Screamer's first scream
        this.summonRunners(z, z.summons);
        z.summons = 0;
      }
    }
    for (let i = 0; i < this.snipers.length; i++) this.snipers[i].fixedUpdate(dt);
    this.dropGroupKeys();
    this.locks.fixedUpdate(dt, this.player.body);
    if (this.quest) this.quest.fixedUpdate();
    if (this.smokeQuest) this.smokeQuest.fixedUpdate(dt);

    if (this.finished) return;
    if (!this.player.dead) {
      this.updateCheckpoints();
      this.stompsAndContacts();
    }
    if (this.player.dead && !this.restarting && !this.deathHandled) { // caught: by contact or by a bad punch
      this.deathHandled = true;
      this.cameras.main.shake(200, 0.006);
      this.time.delayedCall(RESTART_DELAY, () => this.restartLevel());
    }
  }

  /**
   * Falling onto a Runner's head = stomp (it gets dizzy, you bounce). Otherwise touching a dangerous
   * zombie = caught. A player hidden behind a crate is never caught: they pass by without finding you.
   */
  private stompsAndContacts(): void {
    const p = this.player;
    const pb = p.body;
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      if (!z.alive) continue;
      const zb = z.body;
      const overlapX = pb.right - 6 > zb.left && pb.left + 6 < zb.right;
      const onHead = pb.velocity.y > 0 && pb.bottom >= zb.top && pb.bottom <= zb.top + STOMP_DEPTH;
      if (overlapX && onHead && z.stomped()) {
        p.bounce();
        this.noise.emit(z.feetX, zb.top, STOMP_NOISE, NoiseKind.Combat);
        continue;
      }
      if (p.hidden || !z.dangerous || !z.touches(pb)) continue;
      z.grab();
      p.kill();
      return;
    }
  }

  /**
   * A Screamer's scream calls Runners: they come sprinting in from beyond the screen edge, on the
   * player's level, already chasing. Hide or fight.
   */
  private summonRunners(screamer: Zombie, count: number): void {
    const p = this.player;
    const behind = p.feetX < screamer.feetX ? -1 : 1;
    const floorRow = Math.round(p.feetY / TILE); // the row the player stands on: Runners arrive on the same level
    const view = this.cameras.main.worldView;
    const playerTile = Math.floor(p.feetX / TILE);
    let alive = 0;
    for (let i = 0; i < this.summoned.length; i++) if (this.summoned[i].alive) alive++;
    count = Math.min(count, SUMMON_MAX - alive);
    let spawned = 0;
    // Behind the player first (the way you came, so running back is no escape), then the other side.
    for (let pass = 0; pass < 2 && spawned < count; pass++) {
      const side = pass === 0 ? behind : -behind;
      const edgeTile = Math.floor((side < 0 ? view.left : view.right) / TILE);
      // just past the screen edge, outward
      for (let tx = edgeTile + side * SUMMON_MARGIN, tries = 0; spawned < count && tries < SUMMON_SEARCH; tries++, tx += side) {
        if (tx < 1 || tx > MAP_W - 2 || floorUnder(tx, floorRow - 3) !== floorRow) continue; // gaps, walls, other floors
        if (Math.abs(tx - playerTile) < SUMMON_MIN_DISTANCE) continue; // the camera can lag behind a fast player
        this.spawnSummoned(tx, floorRow, side);
        spawned++;
        tx += side * (SUMMON_SPACING - 1);
      }
      // nothing off-screen on your level (a rooftop narrower than the screen): they climb up onto it,
      // as far from you as the floor allows, never closer than SUMMON_MIN_DISTANCE
      for (let tx = edgeTile; spawned < count && Math.abs(tx - playerTile) >= SUMMON_MIN_DISTANCE; tx -= side) {
        if (tx < 1 || tx > MAP_W - 2 || floorUnder(tx, floorRow - 3) !== floorRow) continue;
        this.spawnSummoned(tx, floorRow, side);
        spawned++;
        tx -= side * (SUMMON_SPACING - 1);
      }
    }
  }

  private spawnSummoned(tx: number, floorRow: number, side: number): void {
    const z = new Zombie(this, ZombieKind.Runner, (tx + 0.5) * TILE, floorRow * TILE, -side, true);
    this.physics.add.collider(z.body, this.solids);
    z.chase(this.player.feetX);
    this.zombies.push(z); // the same array the player, the bottles and the debug view read
    this.summoned.push(z);
  }

  /** Coloured keys: a group's key drops where its last zombie died, once all of them are dead. */
  private dropGroupKeys(): void {
    const groups = LEVEL.keyGroups;
    for (let g = 0; g < groups.length; g++) {
      const c = groups[g].color;
      if (this.progress.keyDropped[c]) continue;
      const zs = this.groupZombies[g];
      let last: Zombie | null = null;
      let allDead = zs.length > 0;
      for (let i = 0; i < zs.length; i++) {
        if (zs[i].alive) allDead = false;
        else last = zs[i];
      }
      if (!allDead || !last) continue;
      this.progress.keyDropped[c] = true;
      this.progress.keyX[c] = last.feetX;
      this.progress.keyY[c] = last.feetY;
      this.locks.dropKey(last.feetX, last.feetY, c);
    }
  }

  /** Passing a checkpoint flag (left to right) makes it the respawn point and remembers your bottles. */
  private updateCheckpoints(): void {
    const p = this.player;
    for (let i = this.checkpoint + 1; i < this.checkpoints.length; i++) {
      const c = this.checkpoints[i];
      if (p.feetX < c.x - TILE * 0.5 || Math.abs(p.feetY - c.y) > TILE * 2) continue;
      this.checkpoint = i;
      this.bottlesAtCheckpoint = this.throwables.count;
      this.drawFlag(c, true);
      this.banner('CHECKPOINT', 1200);
    }
    if (this.exit && Math.abs(p.feetX - this.exit.x) < TILE * 0.6 && Math.abs(p.feetY - this.exit.y) < TILE * 2) {
      this.finished = true;
      this.banner('YOU MADE IT', 2500);
      if (LEVEL.grantsListen) unlockListen(); // the upgrade now works in every level
      this.time.delayedCall(2600, () => this.toMenu());
    }
  }

  /** Reliable reset: zombies, stashes and bottles go back to their state at the last checkpoint (or the level start). */
  private restartLevel(): void {
    if (this.restarting) return;
    this.restarting = true;
    const data: RestartData = {
      level: this.levelIndex, checkpoint: this.checkpoint, bottles: this.bottlesAtCheckpoint, progress: this.progress,
    };
    this.cameras.main.fadeOut(180, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.restart(data));
  }

  /**
   * Hard's cheat key (1), a toggle: ON = unlimited bottles + invisible (nothing sees, senses or catches
   * you) + every locked door open. OFF = your bottles as they were, visible, and the doors the cheat
   * opened lock again.
   */
  private cheats(): void {
    if (this.controls.pressed(Action.Num1)) {
      this.cheating = !this.cheating;
      this.player.invisible = this.cheating;
      if (this.cheating) {
        this.bottlesBeforeCheat = this.throwables.count;
        this.smokesBeforeCheat = this.throwables.smokes;
        this.locks.cheatOpenDoors();
      } else {
        this.throwables.count = this.bottlesBeforeCheat;
        if (this.smokeQuest) this.throwables.smokes = this.smokesBeforeCheat;
        this.locks.cheatCloseDoors(this.player.body);
      }
      this.banner(this.cheating ? 'CHEATS ON' : 'CHEATS OFF', 1200);
      if (this.cheatText) this.cheatText.setText(this.cheating ? 'CHEATS: UNLIMITED BOTTLES  INVISIBLE  DOORS OPEN' : '');
    }
    if (this.cheating && this.throwables.count < 9) this.throwables.count = 9;
    if (this.cheating && this.smokeQuest && this.throwables.smokes < 9) this.throwables.smokes = 9; // smoke too
  }

  /** Back to the level select (Esc, or after finishing the level). */
  private toMenu(): void {
    if (this.restarting) return;
    this.restarting = true;
    this.physics.resume(); // in case the letter paused it
    this.cameras.main.fadeOut(180, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('Menu'));
  }

  private banner(text: string, ms: number): void {
    const t = this.add.text(this.scale.width / 2, this.scale.height * 0.3, text, {
      fontFamily: 'Georgia, serif', fontSize: '64px', fontStyle: 'bold', color: '#f0e6c8', stroke: '#000000', strokeThickness: 8,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(60);
    this.tweens.add({ targets: t, alpha: 0, delay: ms * 0.6, duration: ms * 0.4, onComplete: () => t.destroy() });
  }

  private drawFlag(c: Checkpoint, on: boolean): void {
    const g = c.flag;
    g.clear();
    g.fillStyle(0x2a241c, 1).fillRect(c.x - 3, c.y - TILE * 1.6, 6, TILE * 1.6); // pole
    g.fillStyle(on ? CHECKPOINT_ON : CHECKPOINT_OFF, 1);
    g.fillTriangle(c.x + 3, c.y - TILE * 1.6, c.x + 3, c.y - TILE * 1.1, c.x + TILE * 0.7, c.y - TILE * 1.35);
  }

  /** Our "destructor". Uses this.world: scene.physics.world is already null when SHUTDOWN fires. */
  private shutdown(): void {
    this.world.off(Phaser.Physics.Arcade.Events.WORLD_STEP, this.fixedUpdate, this);
    if (this.zombieDebug) this.zombieDebug.destroy();
    this.blackout.destroy();
    this.throwables.destroy();
    this.cameraRig.destroy();
    this.player.destroy();
    this.controls.destroy();
  }

  // ---------------------------------------------------------------- building

  /** Screen-sized tiling layers fixed to the camera; update() scrolls each at its own speed. */
  private createParallax(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    for (let i = 0; i < PARALLAX.length; i++) {
      const layer = this.add.tileSprite(0, 0, w, h, PARALLAX[i][0]).setOrigin(0, 0).setScrollFactor(0).setDepth(-100 + i);
      this.parallax.push(layer);
    }
  }

  private createHud(): void {
    this.add.image(48, 44, 'bottle').setScale(ART_SCALE * 2).setScrollFactor(0).setDepth(50);
    this.noiseMeter = new NoiseMeter(this, 196, 44); // right of the bottle counter
    this.hudCount = this.add.text(80, 44, '', {
      fontFamily: 'Georgia, serif', fontSize: '40px', fontStyle: 'bold', color: '#f0e6c8', stroke: '#000000', strokeThickness: 6,
    }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(50);
    const plainKeys = LEVEL.guardians.length > 0;
    this.add.image(48, 104, 'key').setScale(ART_SCALE * 2).setScrollFactor(0).setDepth(50).setVisible(plainKeys);
    this.hudKeys = this.add.text(80, 104, '', {
      fontFamily: 'Georgia, serif', fontSize: '40px', fontStyle: 'bold', color: '#f0e6c8', stroke: '#000000', strokeThickness: 6,
    }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(50).setVisible(plainKeys);
    if (LEVEL.keyGroups.length > 0) { // the trunk's three padlock keys: dim until you hold them
      for (let c = 0; c < KeyColor.Count; c++) {
        this.hudColourKeys.push(this.add.image(48 + c * 56, 104, 'key').setScale(ART_SCALE * 2).setTint(KEY_TINTS[c])
          .setScrollFactor(0).setDepth(50));
      }
    }
    if (LEVEL.cheats) {
      this.cheatText = this.add.text(24, 140, '', {
        fontFamily: 'Georgia, serif', fontSize: '20px', fontStyle: 'bold', color: '#ff9a40', stroke: '#000000', strokeThickness: 4,
      }).setScrollFactor(0).setDepth(50);
    }
    if (this.smokeQuest) {
      this.hudSmoke = this.add.image(48, 168, 'smoke_grenade').setScale(ART_SCALE * 2.2).setScrollFactor(0).setDepth(50).setVisible(false);
      this.hudSmokeCount = this.add.text(80, 168, '', {
        fontFamily: 'Georgia, serif', fontSize: '40px', fontStyle: 'bold', color: '#f0e6c8', stroke: '#000000', strokeThickness: 6,
      }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(50).setVisible(false);
    }
    if (this.quest) {
      this.hudMolotov = this.add.image(48, 168, 'molotov').setScale(ART_SCALE * 2.2).setScrollFactor(0).setDepth(50).setVisible(false);
    }
    this.add.text(24, this.scale.height - 20,
      'Move ←→   Sprint Shift   Crouch ↓/C (toggle)   Jump Space   Throw: hold E, aim ←→ ↑↓, release   Punch X   Read / look ↑'
      + (this.player.canListen ? '   Listen Q (hold)' : '') + '   Checkpoint R   Levels Esc'
      + (LEVEL.cheats ? '\nCheats   1 (toggle): unlimited bottles + invisible + every door open' : ''), {
        fontFamily: 'Georgia, serif', fontSize: '22px', color: '#f0e6c8', stroke: '#000000', strokeThickness: 4,
      }).setOrigin(0, 1).setScrollFactor(0).setDepth(50);
  }

  /**
   * Visuals: a tilemap layer, auto-tiled from MAP (top / middle / bottom row and left / right caps),
   * plus grass on exposed tops. Physics: one invisible static body per horizontal run of '#'
   * (the player's corner correction queries static bodies, which a tilemap layer would not provide).
   */
  private createLevel(): Phaser.Physics.Arcade.StaticGroup {
    const map = this.make.tilemap({ tileWidth: 32, tileHeight: 32, width: MAP_W, height: MAP_H });
    const tileset = map.addTilesetImage('tileset', 'tileset', 32, 32, 0, 0);
    if (!tileset) throw new Error('tileset failed to load');
    const ground = map.createBlankLayer('ground', tileset, 0, 0);
    const grass = map.createBlankLayer('grass', tileset, 0, 0);
    if (!ground || !grass) throw new Error('could not create tilemap layers');

    this.groundLayer = ground;
    this.grassLayer = grass;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (MAP[y][x] === 'Z') { // scaffolding: planks, drawn as an image
          this.add.image(x * TILE, y * TILE, 'scaffold').setOrigin(0, 0).setScale(ART_SCALE).setDepth(1);
          continue;
        }
        this.drawStone(x, y);
      }
    }
    ground.setScale(ART_SCALE).setDepth(0);
    grass.setScale(ART_SCALE).setDepth(11); // grass in front of the feet

    const solids = this.physics.add.staticGroup();
    for (let y = 0; y < MAP_H; y++) {
      let x = 0;
      while (x < MAP_W) {
        if (!isSolid(x, y)) {
          x++;
          continue;
        }
        const start = x;
        while (x < MAP_W && isSolid(x, y)) x++;
        const w = (x - start) * TILE;
        solids.add(this.add.zone(start * TILE + w / 2, y * TILE + TILE / 2, w, TILE));
      }
    }
    return solids;
  }

  /** Auto-tile one map cell from its stone neighbours (top / middle / bottom row, left / right caps) + grass on top. */
  private drawStone(x: number, y: number): void {
    if (!isStone(x, y)) return;
    const top = !isStone(x, y - 1);
    const bottom = !isStone(x, y + 1);
    const left = !isStone(x - 1, y);
    const right = !isStone(x + 1, y);
    const row = top ? 0 : bottom ? 2 : 1;
    let index: number;
    if (left && right) index = PANEL_COLUMN_1WIDE[row];
    else if (left) index = PANEL_ROW_FIRST[row];
    else if (right) index = PANEL_ROW_FIRST[row] + 3;
    else index = PANEL_ROW_FIRST[row] + 1 + (x % 2);
    this.groundLayer.putTileAt(index, x, y);
    if (top && y > 0) this.grassLayer.putTileAt(GRASS[(x * 7 + y * 3) % 4], x, y - 1);
  }

  /**
   * M2 Medium: once the machine gun has been seen, wooden platforms are there on the way back
   * (LevelData.revealed): a way up to the scaffolding from the middle of area 1. Scaffolding like the
   * rest: solid to stand on, see-through for the sniper.
   */
  private showRevealed(withDust: boolean): void {
    if (this.revealedShown || LEVEL.revealed.length === 0) return;
    this.revealedShown = true;
    const tiles = LEVEL.revealed;
    for (let i = 0; i < tiles.length; i++) {
      const [x, y] = tiles[i];
      EXTRA_SCAFFOLD.add(y * MAP_W + x);
      this.add.image(x * TILE, y * TILE, 'scaffold_block').setOrigin(0, 0).setScale(ART_SCALE).setDepth(1);
      this.solids.add(this.add.zone((x + 0.5) * TILE, (y + 0.5) * TILE, TILE, TILE));
      if (withDust && this.textures.exists('smoke_puff')) {
        const puff = this.add.image((x + 0.5) * TILE, (y + 0.3) * TILE, 'smoke_puff').setDepth(20).setAlpha(0.7).setScale(0.5);
        this.tweens.add({ targets: puff, alpha: 0, scale: 1.2, y: puff.y - 30, duration: 1400, onComplete: () => puff.destroy() });
      }
    }
  }

  private spawnEntities(): void {
    let spawnX = 0;
    let spawnY = 0;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const feetX = (x + 0.5) * TILE;
        const feetY = (y + 1) * TILE;
        switch (MAP[y][x]) {
          case 'P':
            spawnX = feetX;
            spawnY = feetY;
            break;
          case 'K': {
            const c: Checkpoint = { x: feetX, y: feetY, flag: this.add.graphics().setDepth(3) };
            this.checkpoints.push(c);
            break;
          }
          case 'E': {
            this.exit = new Phaser.Math.Vector2(feetX, feetY);
            const g = this.add.graphics().setDepth(3);
            g.fillStyle(0xf0e6c8, 0.25).fillRect(feetX - TILE * 0.5, feetY - TILE * 2.2, TILE, TILE * 2.2);
            g.lineStyle(4, 0xf0e6c8, 0.9).strokeRect(feetX - TILE * 0.5, feetY - TILE * 2.2, TILE, TILE * 2.2);
            this.add.text(feetX, feetY - TILE * 2.3, 'EXIT', {
              fontFamily: 'Georgia, serif', fontSize: '28px', fontStyle: 'bold', color: '#f0e6c8', stroke: '#000000', strokeThickness: 5,
            }).setOrigin(0.5, 1).setDepth(3);
            break;
          }
          case 'C':
            if (!this.keyAlreadyDropped(x, y)) this.zombies.push(new Zombie(this, ZombieKind.Clicker, feetX, feetY, -1, false));
            break;
          case 'N':
            if (!this.keyAlreadyDropped(x, y)) this.zombies.push(new Zombie(this, ZombieKind.Clicker, feetX, feetY, 1, false));
            break;
          case 'c':
            this.zombies.push(new Zombie(this, ZombieKind.Clicker, feetX, feetY, 1, true));
            break;
          case 'R':
            if (!this.keyAlreadyDropped(x, y)) this.zombies.push(new Zombie(this, ZombieKind.Runner, feetX, feetY, 1, true));
            break;
          case 'S':
            if (!this.keyAlreadyDropped(x, y)) this.zombies.push(new Zombie(this, ZombieKind.Screamer, feetX, feetY, -1, false));
            break;
          case 'H': // feeding horde (burned before a death: stays burned)
            if (this.quest && !this.progress.hordeBurned) {
              const z = new Zombie(this, ZombieKind.Clicker, feetX, feetY, (x * 7) % 3 === 0 ? 1 : -1, false);
              this.quest.addHorde(z);
              this.zombies.push(z);
            }
            break;
          case 'X': { // corpse: a dead zombie's last frame, dulled
            const key = x % 2 === 0 ? 'zombie_man_dead' : 'zombie_woman_dead';
            const last = this.textures.get(key).frameTotal - 2; // frameTotal counts the whole-texture frame too
            this.add.image(feetX, feetY + 4, key, last).setOrigin(0.5, 1).setScale(ART_SCALE).setDepth(4)
              .setFlipX(x % 3 === 0).setTint(0x8c7f72);
            break;
          }
          case 'V':
            if (this.quest) this.quest.addCar(feetX, feetY);
            break;
          case 'G':
            this.locks.addGate(feetX, feetY);
            break;
          case 'x':
            this.throwables.addPickup(feetX, feetY);
            break;
          case 'D':
            this.locks.addDoor(feetX, feetY, doorKeys(x, y));
            break;
          case 'B':
            this.addCoverCrate(feetX, feetY);
            break;
          case 'L':
            this.letter = new Letter(this, this.controls, FATHER_LETTER, (x + 1) * TILE, feetY);
            break;
          case 'J':
            this.letter = new Letter(this, this.controls, SOLDIER_NEWSPAPER, feetX, feetY);
            break;
          case 'W':
            this.addBigCrate(feetX, feetY);
            break;
          case 'Q': { // concrete: cover that never breaks
            const img = this.add.image(feetX, feetY, 'concrete').setOrigin(0.5, 1).setScale(ART_SCALE).setDepth(12);
            this.covers.push(new Phaser.Geom.Rectangle(feetX - img.displayWidth / 2, feetY - img.displayHeight, img.displayWidth, img.displayHeight));
            break;
          }
          case 'Y':
            if (this.smokeQuest) this.smokeQuest.addCache(feetX, feetY);
            break;
          case 'A':
            this.add.image(feetX, feetY + 2, 'tent').setOrigin(0.5, 1).setScale(ART_SCALE).setDepth(1);
            break;
          case 'F': {
            this.add.image(feetX, feetY + 2, 'campfire').setOrigin(0.5, 1).setScale(ART_SCALE).setDepth(4);
            const flames = this.add.sprite(feetX, feetY - 6, 'fire').setOrigin(0.5, 1).setScale(1.3).setDepth(4);
            flames.play('fire');
            break;
          }
          case 'b':
            this.add.image(feetX, feetY, x % 2 === 0 ? 'box1' : 'box2').setOrigin(0.5, 1).setScale(ART_SCALE).setDepth(1);
            break;
          case 'o':
            this.add.image(feetX, feetY, x % 2 === 0 ? 'stone1' : 'stone2').setOrigin(0.5, 1).setScale(ART_SCALE).setDepth(1);
            break;
        }
      }
    }

    // The map is scanned row by row (top first), so rooftop flags would come before street-level ones.
    // Checkpoints activate in order along the level: sort them left to right.
    this.checkpoints.sort((a, b) => a.x - b.x);
    for (let i = 0; i < this.checkpoints.length; i++) this.drawFlag(this.checkpoints[i], i <= this.checkpoint);
    if (this.checkpoint >= 0) { // respawning at a checkpoint
      spawnX = this.checkpoints[this.checkpoint].x;
      spawnY = this.checkpoints[this.checkpoint].y;
    }
    this.player = new Player(this, this.controls, this.noise, this.throwables, spawnX, spawnY);

    const guardians = LEVEL.guardians;
    for (let i = 0; i < guardians.length; i++) {
      const gx = (guardians[i][0] + 0.5) * TILE;
      const gy = (guardians[i][1] + 1) * TILE;
      for (let j = 0; j < this.zombies.length; j++) {
        const z = this.zombies[j];
        if (Math.abs(z.feetX - gx) < TILE * 0.5 && Math.abs(z.feetY - gy) < TILE * 0.5) z.hasKey = true;
      }
    }

    // Coloured key groups: find their zombies; a key that dropped before a death lies where it fell.
    const groups = LEVEL.keyGroups;
    for (let g = 0; g < groups.length; g++) {
      const list: Zombie[] = [];
      for (let i = 0; i < groups[g].zombies.length; i++) {
        const z = this.zombieAtTile(groups[g].zombies[i][0], groups[g].zombies[i][1]);
        if (z) list.push(z);
      }
      this.groupZombies.push(list);
      const c = groups[g].color;
      const pr = this.progress;
      if (pr.keyDropped[c] && !pr.keyHeld[c] && !pr.keysUsed && pr.keyX[c] > 0) this.locks.dropKey(pr.keyX[c], pr.keyY[c], c);
    }
    if (this.quest) this.quest.finishSetup();
  }

  private zombieAtTile(tx: number, ty: number): Zombie | null {
    const x = (tx + 0.5) * TILE;
    const y = (ty + 1) * TILE;
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      if (Math.abs(z.feetX - x) < TILE * 0.5 && Math.abs(z.feetY - y) < TILE * 0.5) return z;
    }
    return null;
  }

  /** A coloured-key zombie whose key already dropped (before a death) is not spawned again. */
  private keyAlreadyDropped(tx: number, ty: number): boolean {
    const groups = LEVEL.keyGroups;
    for (let g = 0; g < groups.length; g++) {
      if (!this.progress.keyDropped[groups[g].color]) continue;
      for (let i = 0; i < groups[g].zombies.length; i++) {
        if (groups[g].zombies[i][0] === tx && groups[g].zombies[i][1] === ty) return true;
      }
    }
    return false;
  }

  /** Mechanic 2's big crate (~1.6 tiles): cover from soldiers' fire, and from zombies when crouched. */
  private addBigCrate(feetX: number, feetY: number): void {
    const img = this.add.image(feetX, feetY, 'big_crate').setOrigin(0.5, 1).setScale(ART_SCALE).setDepth(12);
    const rect = new Phaser.Geom.Rectangle(feetX - img.displayWidth / 2, feetY - img.displayHeight, img.displayWidth, img.displayHeight);
    this.covers.push(rect);
    if (!LEVEL.breakableCrates) return;
    const saved = this.progress.crateHp[this.crates.length];
    const crate: BreakableCrate = { rect: rect, img: img, hp: saved ?? CRATE_HP };
    this.crates.push(crate);
    if (crate.hp <= 0) { // broken before a death: stays broken
      img.setTexture('big_crate_broken').setDepth(4);
      this.covers.splice(this.covers.indexOf(rect), 1);
    } else if (crate.hp < CRATE_HP) {
      img.setTexture('big_crate_cracked');
    }
  }

  /** A soldier's bullet hit cover at (x, y): a wooden crate cracks, then breaks (no longer cover). */
  private crateHit(x: number, y: number): void {
    for (let i = 0; i < this.crates.length; i++) {
      const c = this.crates[i];
      if (c.hp <= 0 || !Phaser.Geom.Rectangle.Contains(Phaser.Geom.Rectangle.Inflate(Phaser.Geom.Rectangle.Clone(c.rect), 6, 6), x, y)) continue;
      c.hp--;
      this.progress.crateHp[i] = c.hp; // remembered over a death
      if (c.hp > 0) {
        c.img.setTexture('big_crate_cracked');
      } else {
        c.img.setTexture('big_crate_broken').setDepth(4);
        const idx = this.covers.indexOf(c.rect);
        if (idx >= 0) this.covers.splice(idx, 1);
        this.cameras.main.shake(120, 0.004);
      }
      return;
    }
  }

  /** Two stacked crates (1.5 tiles tall), drawn IN FRONT of the player; crouching inside the area hides you. */
  private addCoverCrate(feetX: number, feetY: number): void {
    const bottom = this.add.image(feetX, feetY, 'box3').setOrigin(0.5, 1).setScale(ART_SCALE).setDepth(12);
    this.add.image(feetX, feetY - bottom.displayHeight, 'box1').setOrigin(0.5, 1).setScale(ART_SCALE).setDepth(12);
    const w = bottom.displayWidth;
    const h = bottom.displayHeight * 2;
    this.covers.push(new Phaser.Geom.Rectangle(feetX - w / 2, feetY - h, w, h));
  }
}
