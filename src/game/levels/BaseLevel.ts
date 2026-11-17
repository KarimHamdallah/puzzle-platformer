import {
  CameraFollow, DEBUG_ENABLED, GameState, Rect,
  type Engine, type Shape, type Sprite, type Text, type TilingImage,
} from '../../engine';
import { Action } from '../Actions';
import { ART_SCALE, CREAM, Serif, TILE } from '../constants';
import { Player } from '../entities/Player';
import { Sniper } from '../entities/Sniper';
import { Zombie, ZombieDebug, ZombieKind } from '../entities/Zombie';
import { StateId } from '../states/StateId';
import { Blackout } from '../systems/Blackout';
import { KEY_TINTS, Locks } from '../systems/Locks';
import { NoiseKind, NoiseMeter, NoiseSystem } from '../systems/Noise';
import { Throwables } from '../systems/Throwing';
import { Dialogue } from '../ui/Dialogue';
import { FATHER_LETTER, Letter, SOLDIER_NEWSPAPER } from '../ui/Letter';
import { LevelMap } from './LevelMap';
import { KeyColor, LevelProgress, type LevelData } from './Levels';

const RESTART_DELAY = 0.7; // s between being caught and the level restarting
const STOMP_DEPTH = 22; // px: how far into a Runner's head the feet may be and still count as a stomp
const SUMMON_MARGIN = 2; // tiles past the screen edge where summoned Runners appear
const SUMMON_SPACING = 2; // tiles between them
const SUMMON_SEARCH = 30; // tiles searched outward for a floor on the player's level
const SUMMON_MAX = 4; // summoned Runners alive at once
const SUMMON_MIN_DISTANCE = 6; // tiles: when nothing off-screen is on your level, they appear at least this far
const LISTEN_UNLOCK_KEY = 'upgrade:listen'; // localStorage: Listen Mode earned (Hard finished)
const STOMP_NOISE = 4; // tiles
const CHECKPOINT_OFF = 0x8a8a7a;
const CHECKPOINT_ON = 0xffa640;
const CRATE_HP = 2; // shots a wooden crate takes before it breaks (M2 Medium)

// Parallax layers (CraftPix Postapocalypse 2, 1920x1080): texture key + horizontal scroll factor.
const PARALLAX: [string, number][] = [
  ['bg_sky', 0],
  ['bg_far', 0.1],
  ['bg_mid', 0.25],
  ['bg_near', 0.45],
];

interface BreakableCrate {
  rect: Rect; // its cover rectangle (removed from covers when it breaks)
  img: Sprite;
  hp: number;
}

interface Checkpoint {
  x: number; // feet position
  y: number;
  flag: Shape;
}

/** Passed to Restart(): where to respawn, with how many bottles, and what a death must not undo. */
export interface RestartData {
  checkpoint?: number; // index into checkpoints, -1 = level start
  bottles?: number;
  progress?: LevelProgress;
}

function ListenUnlocked(): boolean {
  try {
    return localStorage.getItem(LISTEN_UNLOCK_KEY) === '1';
  } catch {
    return false; // storage blocked: the upgrade only exists in the Hard level
  }
}

function UnlockListen(): void {
  try {
    localStorage.setItem(LISTEN_UNLOCK_KEY, '1');
  } catch {
    // storage blocked: nothing to remember
  }
}

/**
 * What every level has: the map, the player, the infected, bottles, noise, doors and keys,
 * checkpoints, the exit, the HUD, cheats, death and restart. Each level class (Mechanic1/2/3.ts)
 * adds only its own mechanic through the hooks below.
 *
 * Fixed step (OnFixedUpdate, 60 Hz):  noise -> player -> bottles -> zombies -> keys / doors ->
 *   OnLevelFixedUpdate -> checkpoints, stomps, contacts -> death.  (The engine then steps the physics.)
 * Frame (OnUpdate):  letter / dialogue (they pause the world) -> OnLevelInput -> keys -> visuals ->
 *   camera -> OnLevelUpdate -> HUD.
 */
export abstract class BaseLevel extends GameState {
  protected readonly level: LevelData;
  protected map!: LevelMap;
  protected progress = new LevelProgress();
  protected player!: Player;
  protected noise!: NoiseSystem;
  protected throwables!: Throwables;
  protected locks!: Locks;
  protected blackout!: Blackout;
  protected dialogue: Dialogue | null = null;
  protected zombies: Zombie[] = [];
  protected covers: Rect[] = [];
  protected snipers: Sniper[] = [];
  protected cheating = false; // the cheat key: unlimited bottles + invisible + every door open
  protected finished = false;
  protected hudBottle!: Sprite;
  protected hudCount!: Text;
  /** Set by a level in OnLevelCreate: what the cheat key also lends, and extra keys on the help line. */
  protected cheatSmoke = false;
  protected cheatUpgrades = false;
  protected helpExtra = '';

  private cameraRig!: CameraFollow;
  private letter: Letter | null = null;
  private groupZombies: Zombie[][] = []; // per level.keyGroups entry: the zombies that carry its key
  private hudColourKeys: Sprite[] = [];
  private hudKeys!: Text;
  private noiseMeter!: NoiseMeter;
  private crates: BreakableCrate[] = []; // M2 Medium: wooden crates that break under fire
  private bottlesBeforeCheat = 0;
  private cheatText: Text | null = null;
  private summoned: Zombie[] = []; // Runners called in by Screamers
  private zombieDebug: ZombieDebug | null = null;
  private parallax: TilingImage[] = [];
  private checkpoints: Checkpoint[] = [];
  private exitX = 0;
  private exitY = 0;
  private hasExit = false;
  private restarting = false;
  private deathHandled = false;
  private checkpoint = -1; // last activated checkpoint
  private bottlesAtCheckpoint = 0;

  constructor(engine: Engine, level: LevelData) {
    super(engine);
    this.level = level;
  }

  // ---------------------------------------------------------------- hooks (a level overrides what it needs)

  /** Before the map is spawned: create the level's own systems (they receive map characters). */
  protected OnLevelCreate(): void {}
  /** A map character the base does not know (or wants handled differently). true = handled. */
  protected SpawnTile(_c: string, _tx: number, _ty: number, _feetX: number, _feetY: number): boolean { return false; }
  /** After the player, the zombies and the camera exist. */
  protected OnLevelStart(): void {}
  /** After the base HUD: the level's own HUD. */
  protected CreateLevelHud(): void {}
  /** The opening thoughts were read. */
  protected OnIntroDone(): void {}
  /** Every frame, before gameplay input. true = a modal is open (bench, dialogue): skip the rest of the frame. */
  protected OnLevelInput(_timeMs: number): boolean { return false; }
  /** Every fixed step, after the core systems. */
  protected OnLevelFixedUpdate(_dt: number): void {}
  /** Every frame, after the core visuals and the camera. */
  protected OnLevelUpdate(_dt: number, _timeMs: number): void {}
  /** A checkpoint was just passed. */
  protected OnCheckpoint(): void {}
  /** Just before the level restarts (death, R). */
  protected OnRestart(): void {}
  /** The cheat key was toggled (this.cheating is the new state). */
  protected OnCheat(): void {}
  protected OnLevelDestroy(): void {}

  // ---------------------------------------------------------------- state

  OnStart(data: unknown): void {
    const d = (data ?? {}) as RestartData;
    this.checkpoint = d.checkpoint ?? -1;
    this.bottlesAtCheckpoint = d.bottles ?? 0;
    this.progress = d.progress ?? new LevelProgress();
    const e = this.engine;
    const lv = this.level;

    this.map = new LevelMap(lv.map);
    e.camera.SetRoundPixels(true); // pixel art: no half-pixel shimmer while scrolling
    e.camera.FadeIn(0.2);
    this.CreateParallax();
    this.map.Build(e);

    this.noise = new NoiseSystem(e);
    this.throwables = new Throwables(e, this.bottlesAtCheckpoint);
    this.throwables.stashOverride = lv.stashSize;
    this.locks = new Locks(e);
    this.locks.onColouredKey = (c) => { this.progress.keyHeld[c] = true; };
    if (lv.intro.length > 0) this.EnsureDialogue();
    this.OnLevelCreate();
    this.SpawnEntities();
    this.player.covers = this.covers;
    this.player.zombies = this.zombies;
    this.throwables.zombies = this.zombies;

    this.cameraRig = new CameraFollow(e.camera, e.renderer, this.player.body, new Rect(0, 0, this.map.pixelWidth, this.map.pixelHeight), TILE);
    this.player.canListen = lv.grantsListen || ListenUnlocked();
    this.blackout = new Blackout(e, this.player, this.zombies, this.noise, lv.night);
    for (let i = 0; i < lv.hints.length; i++) {
      const h = lv.hints[i];
      e.renderer.CreateText(h[0] * TILE, h[1] * TILE, h[2], Serif(26, 'italic')).SetOrigin(0.5).SetDepth(41); // above the night
    }
    this.OnLevelStart();
    this.CreateHud();
    this.CreateLevelHud();
    if (this.dialogue && lv.intro.length > 0 && !this.progress.introSeen) { // the level's opening thoughts
      this.progress.introSeen = true;
      const dialogue = this.dialogue;
      e.clock.After(0.45, () => dialogue.Show(lv.intro, () => {
        if (lv.introBanner) this.Banner(lv.introBanner, 3.2);
        this.OnIntroDone(); // e.g. the helicopter chase begins when he has understood
      }));
    }
    if (DEBUG_ENABLED) this.zombieDebug = new ZombieDebug(e, this.zombies);
  }

  OnDestroy(): void {
    this.OnLevelDestroy();
    if (this.zombieDebug) this.zombieDebug.Destroy();
    this.throwables.Destroy();
    this.cameraRig.Destroy();
    this.player.Destroy();
  }

  OnUpdate(dt: number): void {
    const e = this.engine;
    const input = e.input;
    const timeMs = e.clock.nowMs;
    if (this.letter) {
      const reading = this.letter.open;
      this.letter.Update(timeMs, this.player);
      if (reading || this.letter.open) return; // reading: the world is paused
    }
    if (this.dialogue) {
      const talking = this.dialogue.open;
      this.dialogue.Update();
      if (talking || this.dialogue.open) return; // thinking: the world is paused
    }
    if (this.OnLevelInput(timeMs)) return;
    if (input.Pressed(Action.Back)) {
      this.ToMenu();
      return;
    }
    if (input.Pressed(Action.Reset)) this.RestartLevel();
    if (this.level.cheats) this.Cheats();

    this.player.Update(dt);
    for (let i = 0; i < this.zombies.length; i++) this.zombies[i].Update(timeMs);
    this.throwables.Update(timeMs);
    this.noise.Update(dt);
    this.cameraRig.Update(dt);
    this.blackout.Update(dt);
    for (let i = 0; i < this.snipers.length; i++) this.snipers[i].Update(timeMs);
    this.OnLevelUpdate(dt, timeMs);

    const scrollX = e.camera.scrollX;
    for (let i = 0; i < this.parallax.length; i++) this.parallax[i].tileX = scrollX * PARALLAX[i][1];
    this.hudCount.SetText('x ' + this.throwables.count);
    this.hudKeys.SetText('x ' + this.locks.keys);
    for (let c = 0; c < this.hudColourKeys.length; c++) {
      this.hudColourKeys[c].SetAlpha(this.progress.keyHeld[c] ? 1 : 0.22).SetVisible(!this.progress.keysUsed);
    }
    const p = this.player;
    this.noiseMeter.Update(dt, p.noiseLevel, p.stepCount, p.landCount, this.noise.masked);
    if (this.zombieDebug) this.zombieDebug.Draw(p);
  }

  OnFixedUpdate(dt: number): void {
    this.noise.BeginStep(); // noises emitted last step become audible now
    this.player.FixedUpdate(dt);
    this.throwables.FixedUpdate(dt, this.noise, this.player.body);
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      z.FixedUpdate(dt, this.player, this.noise);
      if (z.hasKey && !z.alive) { // a guardian died: its key drops
        z.hasKey = false;
        this.locks.DropKey(z.feetX, z.feetY);
      }
      if (z.summons > 0) { // a Screamer's first scream
        this.SummonRunners(z, z.summons);
        z.summons = 0;
      }
    }
    for (let i = 0; i < this.snipers.length; i++) this.snipers[i].FixedUpdate(dt);
    this.DropGroupKeys();
    this.locks.FixedUpdate(dt, this.player.body);
    this.OnLevelFixedUpdate(dt);

    if (this.finished) return;
    if (!this.player.dead) {
      this.UpdateCheckpoints();
      this.StompsAndContacts();
    }
    if (this.player.dead && !this.restarting && !this.deathHandled) { // caught: by contact, a shot, a bad punch, water
      this.deathHandled = true;
      this.engine.camera.Shake(0.2, 0.006);
      this.engine.clock.After(RESTART_DELAY, () => this.RestartLevel());
    }
  }

  // ---------------------------------------------------------------- helpers for the level classes

  /** The thoughts box (made on first use: not every level has one). */
  protected EnsureDialogue(): Dialogue {
    if (!this.dialogue) this.dialogue = new Dialogue(this.engine);
    return this.dialogue;
  }

  /** A big message in the upper middle of the screen that fades out after `seconds`. */
  protected Banner(text: string, seconds: number): void {
    const e = this.engine;
    const t = e.renderer.CreateText(e.width / 2, e.height * 0.3, text, Serif(64, 'bold', CREAM, 8)).SetOrigin(0.5).SetFixed().SetDepth(60);
    e.tweens.To(t, { alpha: 0 }, seconds * 0.4, { delay: seconds * 0.6, onDone: () => t.Destroy() });
  }

  /** Mechanic 2: the soldiers in level.snipers. */
  protected CreateSnipers(): void {
    for (let i = 0; i < this.level.snipers.length; i++) {
      this.snipers.push(new Sniper(this.engine, this.level.snipers[i], this.player, this.zombies, this.covers,
        (x, y) => this.map.StoneAtPixel(x, y), (x, y) => this.CrateHit(x, y)));
    }
  }

  /** A zombie of `kind` with its feet at (feetX, feetY), added to the level's list. */
  protected AddZombie(kind: ZombieKind, feetX: number, feetY: number, dir: number, patrols: boolean): Zombie {
    const z = new Zombie(this.engine, kind, feetX, feetY, dir, patrols);
    this.zombies.push(z);
    return z;
  }

  /** A soldier's bullet hit cover at (x, y): a wooden crate cracks, then breaks (no longer cover). */
  protected CrateHit(x: number, y: number): void {
    for (let i = 0; i < this.crates.length; i++) {
      const c = this.crates[i];
      if (c.hp <= 0 || !c.rect.Inflated(6, 6).Contains(x, y)) continue;
      c.hp--;
      this.progress.crateHp[i] = c.hp; // remembered over a death
      if (c.hp > 0) {
        c.img.SetTexture('big_crate_cracked');
      } else {
        c.img.SetTexture('big_crate_broken').SetDepth(4);
        const idx = this.covers.indexOf(c.rect);
        if (idx >= 0) this.covers.splice(idx, 1);
        this.engine.camera.Shake(0.12, 0.004);
      }
      return;
    }
  }

  // ---------------------------------------------------------------- gameplay

  /**
   * Falling onto a Runner's head = stomp (it gets dizzy, you bounce). Otherwise touching a dangerous
   * zombie = caught. A player hidden behind a crate is never caught: they pass by without finding you.
   */
  private StompsAndContacts(): void {
    const p = this.player;
    const pb = p.body;
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      if (!z.alive) continue;
      const zb = z.body;
      const overlapX = pb.right - 6 > zb.left && pb.left + 6 < zb.right;
      const onHead = pb.velocity.y > 0 && pb.bottom >= zb.top && pb.bottom <= zb.top + STOMP_DEPTH;
      if (overlapX && onHead && z.Stomped()) {
        p.Bounce();
        this.noise.Emit(z.feetX, zb.top, STOMP_NOISE, NoiseKind.Combat);
        continue;
      }
      if (p.hidden || !z.dangerous || !z.Touches(pb)) continue;
      z.Grab();
      p.Kill();
      return;
    }
  }

  /**
   * A Screamer's scream calls Runners: they come sprinting in from beyond the screen edge, on the
   * player's level, already chasing. Hide or fight.
   */
  private SummonRunners(screamer: Zombie, count: number): void {
    const p = this.player;
    const behind = p.feetX < screamer.feetX ? -1 : 1;
    const floorRow = Math.round(p.feetY / TILE); // the row the player stands on: Runners arrive on the same level
    const view = this.engine.camera.view;
    const playerTile = Math.floor(p.feetX / TILE);
    const m = this.map;
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
        if (tx < 1 || tx > m.w - 2 || m.FloorUnder(tx, floorRow - 3) !== floorRow) continue; // gaps, walls, other floors
        if (Math.abs(tx - playerTile) < SUMMON_MIN_DISTANCE) continue; // the camera can lag behind a fast player
        this.SpawnSummoned(tx, floorRow, side);
        spawned++;
        tx += side * (SUMMON_SPACING - 1);
      }
      // nothing off-screen on your level (a rooftop narrower than the screen): they climb up onto it,
      // as far from you as the floor allows, never closer than SUMMON_MIN_DISTANCE
      for (let tx = edgeTile; spawned < count && Math.abs(tx - playerTile) >= SUMMON_MIN_DISTANCE; tx -= side) {
        if (tx < 1 || tx > m.w - 2 || m.FloorUnder(tx, floorRow - 3) !== floorRow) continue;
        this.SpawnSummoned(tx, floorRow, side);
        spawned++;
        tx -= side * (SUMMON_SPACING - 1);
      }
    }
  }

  private SpawnSummoned(tx: number, floorRow: number, side: number): void {
    const z = this.AddZombie(ZombieKind.Runner, (tx + 0.5) * TILE, floorRow * TILE, -side, true); // the same list the player, bottles and debug read
    z.Chase(this.player.feetX);
    this.summoned.push(z);
  }

  /** Coloured keys: a group's key drops where its last zombie died, once all of them are dead. */
  private DropGroupKeys(): void {
    const groups = this.level.keyGroups;
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
      this.locks.DropKey(last.feetX, last.feetY, c);
    }
  }

  /** Passing a checkpoint flag (left to right) makes it the respawn point and remembers your bottles. */
  private UpdateCheckpoints(): void {
    const p = this.player;
    for (let i = this.checkpoint + 1; i < this.checkpoints.length; i++) {
      const c = this.checkpoints[i];
      if (p.feetX < c.x - TILE * 0.5 || Math.abs(p.feetY - c.y) > TILE * 2) continue;
      this.checkpoint = i;
      this.bottlesAtCheckpoint = this.throwables.count;
      this.OnCheckpoint();
      this.DrawFlag(c, true);
      this.Banner('CHECKPOINT', 1.2);
    }
    if (this.hasExit && Math.abs(p.feetX - this.exitX) < TILE * 0.6 && Math.abs(p.feetY - this.exitY) < TILE * 2) {
      this.finished = true;
      this.Banner('YOU MADE IT', 2.5);
      if (this.level.grantsListen) UnlockListen(); // the upgrade now works in every level
      this.engine.clock.After(2.6, () => this.ToMenu());
    }
  }

  /** Reliable reset: zombies, stashes and bottles go back to their state at the last checkpoint (or the level start). */
  private RestartLevel(): void {
    if (this.restarting) return;
    this.restarting = true;
    this.OnRestart();
    const data: RestartData = { checkpoint: this.checkpoint, bottles: this.bottlesAtCheckpoint, progress: this.progress };
    this.engine.camera.FadeOut(0.18, () => this.engine.states.Restart(data));
  }

  /** Back to the level select (Esc, or after finishing the level). */
  private ToMenu(): void {
    if (this.restarting) return;
    this.restarting = true;
    this.engine.physics.paused = false; // in case a letter paused it
    this.engine.camera.FadeOut(0.18, () => this.engine.states.ChangeState(StateId.Menu));
  }

  /**
   * The cheat key (1), a toggle: ON = unlimited bottles + invisible (nothing sees, senses or catches
   * you) + every locked door open (+ what the level adds: smoke, every upgrade). OFF = your bottles as
   * they were, visible, and the doors the cheat opened lock again.
   */
  private Cheats(): void {
    if (this.engine.input.Pressed(Action.Num1)) {
      this.cheating = !this.cheating;
      this.player.invisible = this.cheating;
      if (this.cheating) {
        this.bottlesBeforeCheat = this.throwables.count;
        this.locks.CheatOpenDoors();
      } else {
        this.throwables.count = this.bottlesBeforeCheat;
        this.locks.CheatCloseDoors(this.player.body);
      }
      this.OnCheat();
      this.Banner(this.cheating ? 'CHEATS ON' : 'CHEATS OFF', 1.2);
      const unlimited = this.cheatSmoke ? 'UNLIMITED BOTTLES + SMOKE' : 'UNLIMITED BOTTLES';
      const extra = this.cheatUpgrades ? '  EVERY UPGRADE' : '';
      if (this.cheatText) this.cheatText.SetText(this.cheating ? 'CHEATS: ' + unlimited + '  INVISIBLE  DOORS OPEN' + extra : '');
    }
    if (this.cheating && this.throwables.count < 9) this.throwables.count = 9;
  }

  // ---------------------------------------------------------------- building

  /** Screen-sized tiling layers fixed to the camera; OnUpdate() scrolls each at its own speed. */
  private CreateParallax(): void {
    const e = this.engine;
    for (let i = 0; i < PARALLAX.length; i++) {
      this.parallax.push(e.renderer.CreateTiling(0, 0, e.width, e.height, PARALLAX[i][0]).SetFixed().SetDepth(-100 + i));
    }
  }

  private CreateHud(): void {
    const e = this.engine;
    const r = e.renderer;
    const lv = this.level;
    this.hudBottle = r.CreateSprite(48, 44, 'bottle').SetScale(ART_SCALE * 2).SetFixed().SetDepth(50);
    this.noiseMeter = new NoiseMeter(e, 196, 44); // right of the bottle counter
    this.hudCount = r.CreateText(80, 44, '', Serif(40, 'bold', CREAM, 6)).SetOrigin(0, 0.5).SetFixed().SetDepth(50);
    const plainKeys = lv.guardians.length > 0;
    r.CreateSprite(48, 104, 'key').SetScale(ART_SCALE * 2).SetFixed().SetDepth(50).SetVisible(plainKeys);
    this.hudKeys = r.CreateText(80, 104, '', Serif(40, 'bold', CREAM, 6)).SetOrigin(0, 0.5).SetFixed().SetDepth(50).SetVisible(plainKeys);
    if (lv.keyGroups.length > 0) { // the trunk's three padlock keys: dim until you hold them
      for (let c = 0; c < KeyColor.Count; c++) {
        this.hudColourKeys.push(r.CreateSprite(48 + c * 56, 104, 'key').SetScale(ART_SCALE * 2).SetTint(KEY_TINTS[c]).SetFixed().SetDepth(50));
      }
    }
    if (lv.cheats) this.cheatText = r.CreateText(24, 140, '', Serif(20, 'bold', '#ff9a40', 4)).SetFixed().SetDepth(50);
    const help = 'Move ←→   Sprint Shift   Crouch ↓/C (toggle)   Jump Space   Throw: hold E, aim ←→ ↑↓, release   Punch X   Read / look ↑'
      + (this.player.canListen ? '   Listen Q (hold)' : '') + this.helpExtra
      + '   Checkpoint R   Levels Esc'
      + (lv.cheats ? '\nCheats   1 (toggle): unlimited bottles' + (this.cheatSmoke ? ' / smoke' : '') + ' + invisible + every door open'
        + (this.cheatUpgrades ? ' + every upgrade' : '') : '');
    r.CreateText(24, e.height - 20, help, Serif(22, '', CREAM, 4)).SetOrigin(0, 1).SetFixed().SetDepth(50);
  }

  private DrawFlag(c: Checkpoint, on: boolean): void {
    const g = c.flag;
    g.Clear();
    g.FillStyle(0x2a241c, 1).FillRect(c.x - 3, c.y - TILE * 1.6, 6, TILE * 1.6); // pole
    g.FillStyle(on ? CHECKPOINT_ON : CHECKPOINT_OFF, 1);
    g.FillTriangle(c.x + 3, c.y - TILE * 1.6, c.x + 3, c.y - TILE * 1.1, c.x + TILE * 0.7, c.y - TILE * 1.35);
  }

  /** Every map character: the player's spawn, checkpoints, the exit, zombies, props, pickups. */
  private SpawnEntities(): void {
    const r = this.engine.renderer;
    const lv = this.level;
    const m = this.map;
    let spawnX = 0;
    let spawnY = 0;
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        const c = m.rows[y][x];
        const feetX = (x + 0.5) * TILE;
        const feetY = (y + 1) * TILE;
        if (c === '.' || c === '#') continue;
        if (this.SpawnTile(c, x, y, feetX, feetY)) continue; // the level's own characters first
        switch (c) {
          case 'P':
            spawnX = feetX;
            spawnY = feetY;
            break;
          case 'K':
            this.checkpoints.push({ x: feetX, y: feetY, flag: r.CreateShape().SetDepth(3) });
            break;
          case 'E': {
            this.hasExit = true;
            this.exitX = feetX;
            this.exitY = feetY;
            const g = r.CreateShape().SetDepth(3);
            g.FillStyle(0xf0e6c8, 0.25).FillRect(feetX - TILE * 0.5, feetY - TILE * 2.2, TILE, TILE * 2.2);
            g.LineStyle(4, 0xf0e6c8, 0.9).StrokeRect(feetX - TILE * 0.5, feetY - TILE * 2.2, TILE, TILE * 2.2);
            r.CreateText(feetX, feetY - TILE * 2.3, 'EXIT', Serif(28)).SetOrigin(0.5, 1).SetDepth(3);
            break;
          }
          case 'C':
            if (!this.KeyAlreadyDropped(x, y)) this.AddZombie(ZombieKind.Clicker, feetX, feetY, -1, false);
            break;
          case 'N':
            if (!this.KeyAlreadyDropped(x, y)) this.AddZombie(ZombieKind.Clicker, feetX, feetY, 1, false);
            break;
          case 'c':
            this.AddZombie(ZombieKind.Clicker, feetX, feetY, 1, true);
            break;
          case 'R':
            if (!this.KeyAlreadyDropped(x, y)) this.AddZombie(ZombieKind.Runner, feetX, feetY, 1, true);
            break;
          case 'S':
            if (!this.KeyAlreadyDropped(x, y)) this.AddZombie(ZombieKind.Screamer, feetX, feetY, -1, false);
            break;
          case 'H': // a Clicker eating at a corpse: it hears you only up close (a bottle still carries)
            this.AddZombie(ZombieKind.Clicker, feetX, feetY, -1, false).feeding = true;
            break;
          case 'X': { // corpse: a dead zombie's last frame, dulled
            const key = x % 2 === 0 ? 'zombie_man_dead' : 'zombie_woman_dead';
            const last = this.engine.assets.FrameCount(key) - 1;
            r.CreateSprite(feetX, feetY + 4, key, last).SetOrigin(0.5, 1).SetScale(ART_SCALE).SetDepth(4)
              .SetFlipX(x % 3 === 0).SetTint(0x8c7f72);
            break;
          }
          case 'G':
            this.locks.AddGate(feetX, feetY);
            break;
          case 'x':
            this.throwables.AddPickup(feetX, feetY);
            break;
          case 'D':
            this.locks.AddDoor(feetX, feetY, this.DoorKeys(x, y));
            break;
          case 'B':
            this.AddCoverCrate(feetX, feetY);
            break;
          case 'L':
            this.letter = new Letter(this.engine, FATHER_LETTER, (x + 1) * TILE, feetY);
            break;
          case 'J':
            this.letter = new Letter(this.engine, SOLDIER_NEWSPAPER, feetX, feetY);
            break;
          case 'W':
            this.AddBigCrate(feetX, feetY);
            break;
          case 'Q': { // concrete: cover that never breaks
            const img = r.CreateSprite(feetX, feetY, 'concrete').SetOrigin(0.5, 1).SetScale(ART_SCALE).SetDepth(12);
            this.covers.push(new Rect(feetX - img.displayWidth / 2, feetY - img.displayHeight, img.displayWidth, img.displayHeight));
            break;
          }
          case 'A':
            r.CreateSprite(feetX, feetY + 2, 'tent').SetOrigin(0.5, 1).SetScale(ART_SCALE).SetDepth(1);
            break;
          case 'F': {
            r.CreateSprite(feetX, feetY + 2, 'campfire').SetOrigin(0.5, 1).SetScale(ART_SCALE).SetDepth(4);
            const flames = r.CreateSprite(feetX, feetY - 6, 'fire').SetOrigin(0.5, 1).SetScale(1.3).SetDepth(4);
            this.engine.animations.Create(flames).Play('fire');
            break;
          }
          case 'b':
            r.CreateSprite(feetX, feetY, x % 2 === 0 ? 'box1' : 'box2').SetOrigin(0.5, 1).SetScale(ART_SCALE).SetDepth(1);
            break;
          case 'o':
            r.CreateSprite(feetX, feetY, x % 2 === 0 ? 'stone1' : 'stone2').SetOrigin(0.5, 1).SetScale(ART_SCALE).SetDepth(1);
            break;
        }
      }
    }

    // The map is scanned row by row (top first), so rooftop flags would come before street-level ones.
    // Checkpoints activate in order along the level: sort them left to right.
    this.checkpoints.sort((a, b) => a.x - b.x);
    for (let i = 0; i < this.checkpoints.length; i++) this.DrawFlag(this.checkpoints[i], i <= this.checkpoint);
    if (this.checkpoint >= 0) { // respawning at a checkpoint
      spawnX = this.checkpoints[this.checkpoint].x;
      spawnY = this.checkpoints[this.checkpoint].y;
    }
    this.player = new Player(this.engine, this.noise, this.throwables, spawnX, spawnY);

    const guardians = lv.guardians;
    for (let i = 0; i < guardians.length; i++) {
      const z = this.ZombieAtTile(guardians[i][0], guardians[i][1]);
      if (z) z.hasKey = true;
    }

    // Coloured key groups: find their zombies; a key that dropped before a death lies where it fell.
    const groups = lv.keyGroups;
    for (let g = 0; g < groups.length; g++) {
      const list: Zombie[] = [];
      for (let i = 0; i < groups[g].zombies.length; i++) {
        const z = this.ZombieAtTile(groups[g].zombies[i][0], groups[g].zombies[i][1]);
        if (z) list.push(z);
      }
      this.groupZombies.push(list);
      const c = groups[g].color;
      const pr = this.progress;
      if (pr.keyDropped[c] && !pr.keyHeld[c] && !pr.keysUsed && pr.keyX[c] > 0) this.locks.DropKey(pr.keyX[c], pr.keyY[c], c);
    }
  }

  /** Keys the door at tile (x, y) takes. */
  private DoorKeys(x: number, y: number): number {
    const t = this.level.doorKeys;
    for (let i = 0; i < t.length; i++) if (t[i][0] === x && t[i][1] === y) return t[i][2];
    return 1;
  }

  private ZombieAtTile(tx: number, ty: number): Zombie | null {
    const x = (tx + 0.5) * TILE;
    const y = (ty + 1) * TILE;
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      if (Math.abs(z.feetX - x) < TILE * 0.5 && Math.abs(z.feetY - y) < TILE * 0.5) return z;
    }
    return null;
  }

  /** A coloured-key zombie whose key already dropped (before a death) is not spawned again. */
  private KeyAlreadyDropped(tx: number, ty: number): boolean {
    const groups = this.level.keyGroups;
    for (let g = 0; g < groups.length; g++) {
      if (!this.progress.keyDropped[groups[g].color]) continue;
      for (let i = 0; i < groups[g].zombies.length; i++) {
        if (groups[g].zombies[i][0] === tx && groups[g].zombies[i][1] === ty) return true;
      }
    }
    return false;
  }

  /** Mechanic 2's big crate (~1.6 tiles): cover from soldiers' fire, and from zombies when crouched. */
  private AddBigCrate(feetX: number, feetY: number): void {
    const img = this.engine.renderer.CreateSprite(feetX, feetY, 'big_crate').SetOrigin(0.5, 1).SetScale(ART_SCALE).SetDepth(12);
    const rect = new Rect(feetX - img.displayWidth / 2, feetY - img.displayHeight, img.displayWidth, img.displayHeight);
    this.covers.push(rect);
    if (!this.level.breakableCrates) return;
    const saved = this.progress.crateHp[this.crates.length];
    const crate: BreakableCrate = { rect: rect, img: img, hp: saved ?? CRATE_HP };
    this.crates.push(crate);
    if (crate.hp <= 0) { // broken before a death: stays broken
      img.SetTexture('big_crate_broken').SetDepth(4);
      this.covers.splice(this.covers.indexOf(rect), 1);
    } else if (crate.hp < CRATE_HP) {
      img.SetTexture('big_crate_cracked');
    }
  }

  /** Two stacked crates (1.5 tiles tall), drawn IN FRONT of the player; crouching inside the area hides you. */
  private AddCoverCrate(feetX: number, feetY: number): void {
    const r = this.engine.renderer;
    const bottom = r.CreateSprite(feetX, feetY, 'box3').SetOrigin(0.5, 1).SetScale(ART_SCALE).SetDepth(12);
    r.CreateSprite(feetX, feetY - bottom.displayHeight, 'box1').SetOrigin(0.5, 1).SetScale(ART_SCALE).SetDepth(12);
    const w = bottom.displayWidth;
    const h = bottom.displayHeight * 2;
    this.covers.push(new Rect(feetX - w / 2, feetY - h, w, h));
  }
}
