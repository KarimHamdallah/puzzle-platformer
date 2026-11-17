import type GUI from 'lil-gui';
import {
  BodyType, Rect, TuningFolder, Vec2, debugPanel,
  type Animator, type Body, type Engine, type Shape, type Sprite, type Text,
} from '../../engine';
import { ART_SCALE, Serif, TILE } from '../constants';
import { NoiseKind, type Noise, type NoiseSystem } from '../systems/Noise';
import type { Player } from './Player';

/**
 * The three infected types (CraftPix "3 Zombies" sprites). A player crouched behind a cover crate is
 * invisible AND untouchable for all of them: hiding is how you break a chase.
 *
 *  - Clicker  (Zombie Man)   : BLIND. Senses you within a short radius all around (even sneaking) and
 *                              hears your footsteps; then it HUNTS you and keeps following your noise.
 *                              A thrown bottle (or a scream) DISTRACTS it: it walks there and listens.
 *                              Only while it is distracted can you sneak up and take it down from
 *                              behind. Punch it any other time and it grabs you.
 *  - Runner   (Wild Zombie)  : sees (line of sight), chases your last seen position, jumps after you.
 *                              Jump on its head (Mario stomp) or hit it with a bottle: it gets DIZZY.
 *                              Punch it while dizzy, several times, until it dies.
 *  - Screamer (Zombie Woman) : lookout turning around on a fixed rhythm ("?" warns before each turn),
 *                              turns toward noises, sees through line of sight only. If she sees you, a
 *                              bottle hits her or you punch her from the front, she screams: Clickers
 *                              come to her, Runners start chasing, and her FIRST scream of each alert
 *                              brings SCREAM_SUMMONS fresh Runners sprinting in from off-screen (the level
 *                              spawns them). Silent takedown from behind only.
 *
 * Horde Clickers (`feeding`) eat at the corpses: they hear the player only within HORDE_HEARING tiles,
 * still follow bottles, and return to the pile. Ignite() burns any zombie (Molotov).
 *
 * Icons over heads: "?" = searching / suspicious, red "!!" = it found you, pulsing gold "!" = a Clicker
 * busy with a distraction: the only moment it can be taken down (from behind).
 *
 * Physics: each zombie applies its own gravity at the end of FixedUpdate (like the player), the
 * physics step then moves it and stops it on floors and walls.
 */
export enum ZombieKind {
  Clicker,
  Runner,
  Screamer,
}

export enum ZombieState {
  Post, // standing at its post (Screamer: looking around)
  Patrol, // walking back and forth, turning at walls and ledges
  Investigate, // Clicker: walking to a distraction (bottle / scream)
  Search, // Clicker: listening at the spot (distracted) or looking for you after a hunt
  Hunt, // Clicker: following the player's noise
  Return, // walking back to its post
  Chase, // Runner: after the player's last seen position
  Stunned, // Runner: dizzy (stomp / bottle); harmless, punch it
  Distracted, // Screamer: staring at a noise
  Alert, // Screamer: sees the player, screaming
  Grab, // caught the player
  Burning, // set on fire (Molotov): harmless, flailing, then dead
  Dead,
}

export enum MeleeResult {
  None,
  Hit,
  Takedown,
  Grab,
}

class ZombieTuning {
  clickerSpeed = 1.2; // tiles/s (patrol / return)
  investigateSpeed = 2.6; // tiles/s walking to a distraction
  huntSpeed = 4.6; // tiles/s following you (faster than walking, slower than sprinting)
  clickerSense = 2; // tiles all around: senses you even sneaking (not when hidden or when distracted)
  huntLoseTime = 2.5; // s without hearing you before it stops hunting
  searchTime = 5; // s listening at a spot: the takedown window (sneak speed 2.2 -> ~11 tiles of approach)
  clickerPause = 1.5; // s idle after turning around on patrol
  runnerSpeed = 9; // faster than the player's sprint (8.5): you can't outrun it, stomp it or hide
  runnerPatrolSpeed = 2.5;
  runnerPause = 0.5;
  runnerJump = 3.3; // tiles: follows you onto 3-tile ledges
  runnerSight = 10; // tiles
  runnerLoseTime = 5; // s without seeing you before it gives up
  runnerHealth = 3; // punches while dizzy
  stunTime = 3; // s dizzy after a stomp / bottle
  screamerSight = 8; // tiles in front of the Screamer
  screamerSightHeight = 1.5; // tiles of vertical tolerance
  screamerLookTime = 4; // s facing one way before turning around
  screamerDistractTime = 3; // s staring at a noise she heard
  screamNoise = 14; // tiles the scream carries
  screamInterval = 2.5; // s between screams while she keeps seeing you
  gravity = 40; // tiles/s²
}

const T = new ZombieTuning();

interface KindInfo {
  w: number; // hitbox, tiles
  h: number;
  idle: string; // animation clips (see Assets.ts)
  walk: string;
  fast: string;
  alert: string;
  grab: string;
  hurt: string;
  dead: string;
  jump: string;
}

const KINDS: KindInfo[] = [
  { w: 0.5, h: 1.85, idle: 'zombie_man_idle', walk: 'zombie_man_walk', fast: 'zombie_man_run', alert: 'zombie_man_idle',
    grab: 'zombie_man_attack', hurt: 'zombie_man_idle', dead: 'zombie_man_dead', jump: 'zombie_man_idle' },
  { w: 0.9, h: 1.0, idle: 'wild_zombie_idle', walk: 'wild_zombie_run', fast: 'wild_zombie_run', alert: 'wild_zombie_run',
    grab: 'wild_zombie_attack', hurt: 'wild_zombie_hurt', dead: 'wild_zombie_dead', jump: 'wild_zombie_jump' },
  { w: 0.5, h: 1.85, idle: 'zombie_woman_idle', walk: 'zombie_woman_idle', fast: 'zombie_woman_idle', alert: 'zombie_woman_scream',
    grab: 'zombie_woman_scream', hurt: 'zombie_woman_idle', dead: 'zombie_woman_dead', jump: 'zombie_woman_idle' },
];

const MAX_FALL = 30; // tiles/s: above any jump speed (a 3.3-tile Runner jump needs 16.2)
const PROBE = 2; // px size of the wall / ledge probes
const ARRIVE = 0.25; // tiles: close enough to a target x
const CONTACT_INSET = 6; // px: contact needs real overlap, not a grazing touch
const TURN_WARNING = 0.7; // s before a Screamer turns around: "?" telegraph
const FEED_ANIM = 'zombie_man_feed'; // the attack frames, looped slowly: hunched over a corpse, eating
const PUNCH_KEEPS_DIZZY = 0.6; // s: a punch never lets the dizzy window end right after it
export const SCREAM_SUMMONS = 2; // Runners called in by each alert's first scream
const HORDE_HEARING = 3; // tiles: a feeding horde Clicker only hears the player this close
const BURN_TIME = 1.4; // s on fire before falling dead
const FIRE_SCALE = 2.4;
const ICON_ALERT = '!!'; // found you
const ICON_COLOR = '#f0e6c8';
const ICON_ALERT_COLOR = '#ff5a48';
const ICON_TAKEDOWN_COLOR = '#ffd24a';

export class Zombie {
  readonly kind: ZombieKind;
  readonly body: Body;
  state: ZombieState;
  dir: number; // +1 right, -1 left
  targetX = 0; // Investigate / Hunt / Chase / Return destination
  health: number;
  distracted = false; // Clicker: busy with a bottle / scream (the only time it can be taken down)
  hasKey = false; // guardian: drops the key of a locked door when it dies (the level drops it)
  patrolRange = 0; // tiles either side of home it paces (0: walks until a wall or a ledge)
  summons = 0; // Screamer: Runners her scream just called in (the level spawns them and resets this)
  feeding = false; // horde Clicker: eats at its post, hears the player only up close

  private readonly engine: Engine;
  private fire: Sprite | null = null; // while burning
  private burnDelay = 0; // s before the flames reach it
  private burnTime = 0;
  private suppressed = 0; // s left pinned down by machine-gun fire: frozen, flinching, harmless
  private readonly sprite: Sprite;
  private readonly anim: Animator;
  private readonly icon: Text;
  private readonly fx: Shape; // dizzy stars
  private readonly info: KindInfo;
  private readonly patrols: boolean;
  private readonly homeX: number;
  private readonly homeDir: number;
  private timer = 0; // meaning depends on the state
  private lookTimer = 0; // Screamer look cycle / Clicker search turns
  private alertTimer = 0;
  private iconTimer = 0;
  private iconText = '';
  private summoned = false; // Screamer: this alert already called its Runners
  private restartAnim = false;

  constructor(engine: Engine, kind: ZombieKind, feetX: number, feetY: number, dir: number, patrols: boolean) {
    this.engine = engine;
    this.kind = kind;
    this.info = KINDS[kind];
    this.dir = dir;
    this.homeDir = dir;
    this.homeX = feetX;
    this.patrols = patrols;
    this.health = kind === ZombieKind.Runner ? T.runnerHealth : 1;
    this.state = patrols ? ZombieState.Patrol : ZombieState.Post;
    this.lookTimer = T.screamerLookTime;

    const w = this.info.w * TILE;
    const h = this.info.h * TILE;
    this.body = engine.physics.CreateBody({ type: BodyType.Dynamic, x: feetX - w / 2, y: feetY - h, w: w, h: h, gravityScale: 0, userData: this });

    const r = engine.renderer;
    this.sprite = r.CreateSprite(feetX, feetY, this.info.idle).SetOrigin(0.5, 1).SetScale(ART_SCALE).SetDepth(8);
    this.anim = engine.animations.Create(this.sprite);
    this.anim.Play(this.info.idle);
    this.icon = r.CreateText(feetX, feetY, '', Serif(44, 'bold', '#ffe066', 7)).SetOrigin(0.5, 1).SetDepth(25);
    this.fx = r.CreateShape().SetDepth(25);
  }

  get feetX(): number {
    return this.body.centerX;
  }

  get feetY(): number {
    return this.body.bottom;
  }

  /** The sprite, for effects that copy its look (Listen Mode silhouettes). */
  get view(): Sprite {
    return this.sprite;
  }

  get stateName(): string {
    let s = ZombieState[this.state];
    if (this.distracted) s += '*';
    if (this.kind === ZombieKind.Runner && this.alive) s += ' hp' + this.health;
    return s;
  }

  get alive(): boolean {
    return this.state !== ZombieState.Dead;
  }

  /** Clicker busy with a bottle / scream: the only time it can be taken down (from behind). */
  get takedownWindow(): boolean {
    return this.kind === ZombieKind.Clicker && this.distracted
      && (this.state === ZombieState.Investigate || this.state === ZombieState.Search);
  }

  /** Can catch the player right now. */
  get dangerous(): boolean {
    return this.alive && this.state !== ZombieState.Stunned && this.state !== ZombieState.Grab && this.state !== ZombieState.Burning
      && this.suppressed <= 0;
  }

  /** Where it hears and sees from: 80% up its body. */
  Head(): Vec2 {
    return new Vec2(this.feetX, this.feetY - this.body.height * 0.8);
  }

  /** Real overlap with the player's body (a few px of grace on every side). */
  Touches(p: Body): boolean {
    const b = this.body;
    return p.right - CONTACT_INSET > b.left && p.left + CONTACT_INSET < b.right
      && p.bottom - CONTACT_INSET > b.top && p.top + CONTACT_INSET < b.bottom;
  }

  Grab(): void {
    this.SetState(ZombieState.Grab);
    this.body.velocity.x = 0;
    this.ShowIcon('', 0);
  }

  /** The player landed on this zombie's head. Runner: dizzy. Returns true if it was a valid stomp. */
  Stomped(): boolean {
    if (this.kind !== ZombieKind.Runner || !this.alive) return false;
    this.Stun();
    return true;
  }

  /** A thrown bottle hit this zombie (the bottle also shatters and makes its noise). */
  HitByBottle(): void {
    if (!this.alive) return;
    if (this.kind === ZombieKind.Runner) this.Stun();
    else if (this.kind === ZombieKind.Screamer) this.StartScreaming();
  }

  /** The player's punch connected. `fromX` = attacker's x, to know "from behind". */
  MeleeHit(fromX: number): MeleeResult {
    if (!this.alive) return MeleeResult.None;
    const fromBehind = (fromX - this.feetX) * this.dir < 0;

    if (this.kind === ZombieKind.Runner) {
      if (this.state !== ZombieState.Stunned) return MeleeResult.None;
      this.health--;
      this.body.velocity.x = Math.sign(this.feetX - fromX) * TILE;
      this.timer = Math.max(this.timer, PUNCH_KEEPS_DIZZY);
      if (this.health <= 0) this.Die();
      return MeleeResult.Hit;
    }
    if (this.kind === ZombieKind.Clicker) {
      if (this.takedownWindow && fromBehind) {
        this.Die();
        return MeleeResult.Takedown;
      }
      return MeleeResult.Grab; // not busy, or from the front: it gets you
    }
    // Screamer
    if (this.state !== ZombieState.Alert && fromBehind) {
      this.Die();
      return MeleeResult.Takedown;
    }
    this.StartScreaming();
    return MeleeResult.None;
  }

  /** Behaviour, at the physics rate, then gravity (the physics step moves the body after this). */
  FixedUpdate(dt: number, player: Player, noise: NoiseSystem): void {
    this.Behave(dt, player, noise);
    const v = this.body.velocity;
    v.y = Math.min(v.y + T.gravity * TILE * dt, MAX_FALL * TILE); // T is read every step: the slider applies live
  }

  private Behave(dt: number, player: Player, noise: NoiseSystem): void {
    const v = this.body.velocity;
    this.iconTimer = Math.max(0, this.iconTimer - dt);
    if (this.state === ZombieState.Dead || this.state === ZombieState.Grab) {
      if (this.OnGround()) v.x = 0;
      return;
    }
    if (this.suppressed > 0) { // under fire: it can't move, hear or grab anyone; you can run past it
      this.suppressed -= dt;
      v.x = 0;
      return;
    }
    if (this.state === ZombieState.Burning) {
      v.x = 0;
      if (this.burnDelay > 0) { // the fire is still spreading toward it
        this.burnDelay -= dt;
        if (this.burnDelay <= 0) this.CatchFire();
        return;
      }
      this.burnTime -= dt;
      if (this.burnTime <= 0) this.Die();
      return;
    }
    if (this.kind === ZombieKind.Clicker) this.Clicker(dt, player, noise);
    else if (this.kind === ZombieKind.Runner) this.Runner(dt, player, noise);
    else this.Screamer(dt, player, noise);
  }

  /** Set on fire after `delay` s (the flames spread from the Molotov's impact). */
  Ignite(delay: number): void {
    if (!this.alive || this.state === ZombieState.Burning) return;
    this.state = ZombieState.Burning;
    this.burnDelay = delay;
    this.burnTime = BURN_TIME;
    this.distracted = false;
    this.body.velocity.x = 0;
    this.ShowIcon('', 0);
    if (delay <= 0) this.CatchFire();
  }

  private CatchFire(): void {
    this.fire = this.engine.renderer.CreateSprite(this.feetX, this.feetY + 6, 'fire').SetOrigin(0.5, 1).SetScale(FIRE_SCALE).SetDepth(9);
    this.engine.animations.Create(this.fire).Play('fire', false, Math.floor(Math.random() * 8));
    this.restartAnim = true;
  }

  /** Visuals, once per rendered frame. */
  Update(timeMs: number): void {
    this.sprite.SetPosition(this.feetX, this.feetY);
    this.sprite.SetFlipX(this.dir < 0);
    if (this.fire) {
      this.fire.SetPosition(this.feetX, this.feetY + 6);
      if (this.state === ZombieState.Burning) this.sprite.SetTint((Math.floor(timeMs / 70) % 2) === 0 ? 0xff9a60 : 0xffc890); // flicker
    }
    const headY = this.feetY - this.body.height;
    // The takedown window overrides the timed icons with a pulsing gold "!".
    const takedown = this.takedownWindow;
    const text = takedown ? '!' : this.iconText;
    if (this.icon.text !== text) this.icon.SetText(text).SetColor(text === '!' ? ICON_TAKEDOWN_COLOR : text === ICON_ALERT ? ICON_ALERT_COLOR : ICON_COLOR);
    this.icon.SetPosition(this.feetX, headY - 6 + (takedown ? Math.sin(timeMs / 200) * 6 : 0));
    this.icon.SetScale(takedown ? 1 + Math.sin(timeMs / 140) * 0.1 : 1);
    this.icon.SetVisible(this.alive && (takedown || this.iconTimer > 0));

    this.fx.Clear();
    if (this.state === ZombieState.Stunned) { // three stars orbiting the head
      this.fx.FillStyle(0xffe066, 1);
      for (let i = 0; i < 3; i++) {
        const a = timeMs / 180 + (i * Math.PI * 2) / 3;
        this.fx.FillCircle(this.feetX + Math.cos(a) * 26, headY - 10 + Math.sin(a) * 8, 6);
      }
    }

    let anim = this.info.idle;
    const moving = Math.abs(this.body.velocity.x) > 1;
    if (this.suppressed > 0 && this.alive) this.sprite.SetTint((Math.floor(timeMs / 50) % 2) === 0 ? 0xffffff : 0xffb0a0);
    else if (this.alive && this.state !== ZombieState.Burning) this.sprite.ClearTint();
    switch (this.state) {
      case ZombieState.Dead: anim = this.info.dead; break;
      case ZombieState.Burning: anim = this.fire ? this.info.hurt : this.feeding ? FEED_ANIM : this.info.idle; break;
      case ZombieState.Post: anim = this.feeding ? FEED_ANIM : this.info.idle; break;
      case ZombieState.Grab: anim = this.info.grab; break;
      case ZombieState.Stunned: anim = this.info.hurt; break;
      case ZombieState.Alert: anim = this.info.alert; break;
      case ZombieState.Investigate:
      case ZombieState.Hunt:
      case ZombieState.Chase: anim = moving ? this.info.fast : this.info.idle; break;
      default: anim = moving ? this.info.walk : this.info.idle;
    }
    if (this.kind === ZombieKind.Runner && !this.OnGround() && this.state === ZombieState.Chase) anim = this.info.jump;
    if (this.restartAnim) {
      this.anim.Play(anim);
      this.restartAnim = false;
    } else if (this.state !== ZombieState.Dead && this.state !== ZombieState.Grab) {
      // Play(anim, true) only skips a clip that is still PLAYING: a finished one-shot (death, grab)
      // would restart every frame. Those are started once by SetState() and then left alone.
      this.anim.Play(anim, true);
    }
  }

  // ---------------------------------------------------------------- Clicker

  private Clicker(dt: number, player: Player, noise: NoiseSystem): void {
    const v = this.body.velocity;
    const lure = this.LastHeard(noise, true);
    const steps = this.LastHeard(noise, false, false, this.feeding ? HORDE_HEARING : Infinity);
    const sensed = !this.distracted && this.Senses(player);

    if (lure) { // bottle / scream: go and listen there
      this.targetX = lure.x;
      this.state = ZombieState.Investigate;
      this.distracted = true;
      this.ShowIcon('', 0); // the takedown "!" takes over
    } else if (steps || sensed) { // your footsteps, or you are right next to it: hunt you
      if (this.state !== ZombieState.Hunt) this.ShowIcon(ICON_ALERT, 0.8);
      this.state = ZombieState.Hunt;
      this.distracted = false;
      this.targetX = steps ? steps.x : player.feetX;
      this.timer = T.huntLoseTime;
    }

    switch (this.state) {
      case ZombieState.Post:
        v.x = 0;
        break;
      case ZombieState.Patrol:
        this.Patrol(dt, T.clickerSpeed, T.clickerPause);
        break;
      case ZombieState.Investigate:
        if (this.WalkTo(this.targetX, T.investigateSpeed)) this.StartSearch();
        break;
      case ZombieState.Hunt:
        this.WalkTo(this.targetX, T.huntSpeed);
        this.timer -= dt;
        if (this.timer <= 0) {
          this.distracted = false;
          this.StartSearch();
        }
        break;
      case ZombieState.Search:
        v.x = 0;
        this.timer -= dt;
        if (!this.distracted) { // looking for you: turns around; listening to a lure: keeps facing it
          this.lookTimer -= dt;
          if (this.lookTimer <= 0) {
            this.dir = -this.dir;
            this.lookTimer = 0.9;
          }
        }
        if (this.timer <= 0) {
          this.distracted = false;
          this.state = ZombieState.Return;
        }
        break;
      case ZombieState.Return:
        if (this.WalkTo(this.homeX, T.clickerSpeed)) {
          this.dir = this.homeDir;
          this.state = this.patrols ? ZombieState.Patrol : ZombieState.Post;
        }
        break;
    }
  }

  private StartSearch(): void {
    this.state = ZombieState.Search;
    this.timer = T.searchTime;
    this.lookTimer = 0.9;
    this.ShowIcon('?', T.searchTime);
  }

  /** Clicker's close-range sense: all around, works on a sneaking player, not on a hidden one. */
  private Senses(player: Player): boolean {
    if (player.hidden || player.dead) return false;
    const me = new Vec2(this.feetX, this.feetY - this.body.height * 0.5);
    const you = new Vec2(player.feetX, player.feetY - player.body.height * 0.5);
    return me.DistanceTo(you) <= T.clickerSense * TILE;
  }

  // ---------------------------------------------------------------- Runner

  private Runner(dt: number, player: Player, noise: NoiseSystem): void {
    const v = this.body.velocity;
    if (this.state === ZombieState.Stunned) {
      if (this.OnGround()) v.x *= 0.8;
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = ZombieState.Chase;
        this.targetX = player.feetX;
        this.timer = T.runnerLoseTime;
        this.ShowIcon(ICON_ALERT, 0.8);
      }
      return;
    }

    const scream = this.LastHeard(noise, true, true);
    if (scream && this.state !== ZombieState.Chase) {
      this.Chase(scream.x);
    } else if (this.state !== ZombieState.Chase && this.RunnerSees(player, true)) {
      this.Chase(player.feetX);
    }

    switch (this.state) {
      case ZombieState.Patrol:
        this.Patrol(dt, T.runnerPatrolSpeed, T.runnerPause);
        break;
      case ZombieState.Return:
        if (this.WalkTo(this.homeX, T.runnerPatrolSpeed)) this.state = ZombieState.Patrol;
        break;
      case ZombieState.Chase: {
        if (this.RunnerSees(player, false)) {
          this.targetX = player.feetX; // only what it can SEE: hiding sends it to your last seen spot
          this.timer = T.runnerLoseTime;
        } else {
          this.timer -= dt;
        }
        if (this.timer <= 0) {
          this.state = ZombieState.Return;
          this.ShowIcon('?', 1);
          break;
        }
        // In the air: never push into a wall; rise straight up beside it and move on once the feet
        // clear the top.
        if (!this.OnGround()) {
          v.x = this.WallAhead() ? 0 : this.dir * T.runnerSpeed * TILE;
          break;
        }
        const dx = this.targetX - this.feetX;
        if (Math.abs(dx) <= ARRIVE * TILE) {
          v.x = 0;
          if (this.iconTimer <= 0) this.ShowIcon('?', 0.6); // lost you: looking around
          break;
        }
        this.dir = Math.sign(dx);
        const jumpSpeed = Math.sqrt(2 * T.gravity * TILE * T.runnerJump * TILE); // v² = 2·g·h
        if (this.WallAhead()) v.Set(0, -jumpSpeed); // straight up the wall
        else if (!this.GroundAhead()) v.Set(this.dir * T.runnerSpeed * TILE, -jumpSpeed); // across a gap
        else v.x = this.dir * T.runnerSpeed * TILE;
        break;
      }
    }
  }

  /** Runner: run after x (seen player, scream, or summoned by a Screamer). */
  Chase(x: number): void {
    this.ShowIcon(ICON_ALERT, 0.8);
    this.state = ZombieState.Chase;
    this.targetX = x;
    this.timer = T.runnerLoseTime;
  }

  private Stun(): void {
    this.SetState(ZombieState.Stunned);
    this.timer = T.stunTime;
    this.body.velocity.x = 0;
    this.ShowIcon('', 0);
  }

  private RunnerSees(player: Player, needFacing: boolean): boolean {
    if (player.hidden || player.dead) return false;
    const dx = player.feetX - this.feetX;
    if (needFacing && dx * this.dir <= 0) return false;
    if (Math.abs(dx) > T.runnerSight * TILE || Math.abs(player.feetY - this.feetY) > 4 * TILE) return false;
    return this.LineOfSight(player);
  }

  // ---------------------------------------------------------------- Screamer

  private Screamer(dt: number, player: Player, noise: NoiseSystem): void {
    this.body.velocity.x = 0;
    this.alertTimer -= dt;

    if (this.Sees(player) || this.alertTimer > 0) {
      if (this.state !== ZombieState.Alert) this.timer = 0; // first sight: scream immediately
      this.state = ZombieState.Alert;
      this.timer -= dt;
      if (this.timer <= 0) {
        const head = this.Head();
        noise.Emit(head.x, head.y, T.screamNoise, NoiseKind.Scream);
        this.timer = T.screamInterval;
        this.ShowIcon(ICON_ALERT, 0.8);
        if (!this.summoned) { // the first scream of this alert calls Runners in
          this.summoned = true;
          this.summons = SCREAM_SUMMONS;
        }
      }
      return;
    }
    if (this.state === ZombieState.Alert) {
      this.state = ZombieState.Post;
      this.summoned = false; // lost you: the next alert calls Runners again
      this.lookTimer = T.screamerLookTime;
    }

    const heard = this.LastHeard(noise, false) ?? this.LastHeard(noise, true);
    if (heard) { // turns toward the sound and stares at it
      this.dir = Math.sign(heard.x - this.feetX) || this.dir;
      this.state = ZombieState.Distracted;
      this.timer = T.screamerDistractTime;
      this.ShowIcon('?', 0.6);
    }
    if (this.state === ZombieState.Distracted) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = ZombieState.Post;
        this.lookTimer = T.screamerLookTime;
      }
      return;
    }

    // Look cycle: face one way for screamerLookTime, warn with "?", turn around.
    this.lookTimer -= dt;
    if (this.lookTimer <= TURN_WARNING && this.iconTimer <= 0) this.ShowIcon('?', TURN_WARNING);
    if (this.lookTimer <= 0) {
      this.dir = -this.dir;
      this.lookTimer = T.screamerLookTime;
    }
  }

  private StartScreaming(): void {
    if (!this.alive) return;
    this.state = ZombieState.Alert;
    this.alertTimer = 1.2;
    this.timer = 0; // scream right away
  }

  /** Screamer sight: in front, in range, not hidden behind cover, nothing solid in between. */
  Sees(player: Player): boolean {
    if (player.hidden || player.dead || !this.alive) return false;
    const dx = player.feetX - this.feetX;
    if (dx * this.dir <= 0 || Math.abs(dx) > T.screamerSight * TILE) return false;
    if (Math.abs(player.feetY - this.feetY) > T.screamerSightHeight * TILE) return false;
    return this.LineOfSight(player);
  }

  /** From its head to the player's chest: does the ray reach him before any wall? */
  LineOfSight(player: Player): boolean {
    return this.engine.physics.RayCast(this.Head(), SightTarget(player)) === null;
  }

  // ---------------------------------------------------------------- shared

  /**
   * Most recent noise whose ring reaches this zombie's head.
   *  lures = true  : bottles and screams (things to investigate)
   *  lures = false : the player's own noises (footsteps, landings, punches)
   * screamsOnly narrows lures to screams (Runners don't care about bottles).
   */
  private LastHeard(noise: NoiseSystem, lures: boolean, screamsOnly: boolean = false, maxTiles: number = Infinity): Noise | null {
    const head = this.Head();
    let found: Noise | null = null;
    for (let i = 0; i < noise.heard.length; i++) {
      const n = noise.heard[i];
      const isLure = n.kind === NoiseKind.Bottle || n.kind === NoiseKind.Scream;
      if (isLure !== lures) continue;
      if (screamsOnly && n.kind !== NoiseKind.Scream) continue;
      if (this.kind === ZombieKind.Screamer && n.kind === NoiseKind.Scream) continue; // her own voice
      if (head.DistanceTo(new Vec2(n.x, n.y)) <= Math.min(n.radius, maxTiles * TILE)) found = n;
    }
    return found;
  }

  private Patrol(dt: number, speedTiles: number, pause: number): void {
    const v = this.body.velocity;
    if (this.timer > 0) {
      this.timer -= dt;
      v.x = 0;
      return;
    }
    const tooFar = this.patrolRange > 0 && (this.feetX - this.homeX) * this.dir > this.patrolRange * TILE;
    if (tooFar || (this.OnGround() && (this.WallAhead() || !this.GroundAhead()))) {
      this.dir = -this.dir;
      this.timer = pause;
      v.x = 0;
      return;
    }
    v.x = this.dir * speedTiles * TILE;
  }

  /** Walk toward x on the current floor. True when arrived, or when a wall / ledge edge stops it. */
  private WalkTo(x: number, speedTiles: number): boolean {
    const v = this.body.velocity;
    const dx = x - this.feetX;
    if (Math.abs(dx) <= ARRIVE * TILE) {
      v.x = 0;
      return true;
    }
    this.dir = Math.sign(dx);
    if (this.OnGround() && (this.WallAhead() || !this.GroundAhead())) {
      v.x = 0;
      return true; // as close as it can get without leaving its floor
    }
    v.x = this.dir * speedTiles * TILE;
    return false;
  }

  /** A machine gun is on it: pinned down for a moment (called on every burst). */
  Suppress(): void {
    this.suppressed = 0.25;
  }

  /** Cut down by a soldier's gun (Mechanic 2): soldiers shoot anything that moves. */
  Shot(): void {
    if (this.alive) this.Die();
  }

  private Die(): void {
    this.SetState(ZombieState.Dead);
    this.distracted = false;
    this.ShowIcon('', 0);
    if (this.fire) { // burned: charred body, the flames die down
      this.sprite.SetTint(0x4a3c34);
      const f = this.fire;
      this.fire = null;
      this.engine.tweens.To(f, { alpha: 0, scale: FIRE_SCALE * 0.6 }, 1.8, { delay: 0.6, onDone: () => f.Destroy() });
    }
  }

  private SetState(s: ZombieState): void {
    this.state = s;
    this.restartAnim = true; // one-shot animations (grab, hurt, dead) play from the start
  }

  private ShowIcon(text: string, seconds: number): void {
    this.iconText = text;
    this.iconTimer = seconds;
  }

  /** Standing on something solid: a thin probe just under the feet. */
  private OnGround(): boolean {
    const b = this.body;
    if (b.velocity.y < 0) return false; // rising: not grounded
    return this.engine.physics.QueryBox(new Rect(b.left + 2, b.bottom + 1, b.width - 4, 2));
  }

  /** A wall right in front of it (a probe the height of its body, beside it). */
  private WallAhead(): boolean {
    const b = this.body;
    const x = this.dir > 0 ? b.right + 1 : b.left - 1 - PROBE;
    return this.engine.physics.QueryBox(new Rect(x, b.top + 4, PROBE, b.height - 8));
  }

  /** Floor in front of its feet (no floor = a ledge edge or a gap). */
  private GroundAhead(): boolean {
    const b = this.body;
    const x = this.dir > 0 ? b.right + 1 : b.left - 1 - PROBE;
    return this.engine.physics.QueryBox(new Rect(x, b.bottom + 2, PROBE, PROBE));
  }
}

/** Where sighted enemies look at the player: 60% up his body. */
function SightTarget(player: Player): Vec2 {
  return new Vec2(player.feetX, player.feetY - player.body.height * 0.6);
}

/**
 * Debug view for all zombies: "zombie tuning" sliders + "zombies" folder with an overlay (DebugDraw):
 * state under each zombie ("*" = distracted, Runner health), Clicker sense radius and destination,
 * Screamer sight area (red while alert) and her line of sight to the player.
 */
export class ZombieDebug {
  showSenses = true;

  private readonly engine: Engine;
  private readonly zombies: Zombie[];
  private readonly tuning: TuningFolder<ZombieTuning>;
  private readonly folder: GUI;

  constructor(engine: Engine, zombies: Zombie[]) {
    this.engine = engine;
    this.zombies = zombies;
    const t = new TuningFolder('zombie tuning', T);
    t.Add('clickerSpeed', 0, 6, 0.1);
    t.Add('investigateSpeed', 0, 8, 0.1);
    t.Add('huntSpeed', 0, 10, 0.1);
    t.Add('clickerSense', 0, 6, 0.1);
    t.Add('huntLoseTime', 0, 10, 0.1);
    t.Add('searchTime', 0, 10, 0.1);
    t.Add('clickerPause', 0, 5, 0.1);
    t.Add('runnerSpeed', 0, 14, 0.1);
    t.Add('runnerPatrolSpeed', 0, 8, 0.1);
    t.Add('runnerPause', 0, 5, 0.1);
    t.Add('runnerJump', 0, 6, 0.1);
    t.Add('runnerSight', 0, 20, 0.5);
    t.Add('runnerLoseTime', 0, 15, 0.1);
    t.Add('runnerHealth', 1, 10, 1);
    t.Add('stunTime', 0.2, 8, 0.1);
    t.Add('screamerSight', 0, 20, 0.5);
    t.Add('screamerSightHeight', 0, 5, 0.1);
    t.Add('screamerLookTime', 0.5, 10, 0.1);
    t.Add('screamerDistractTime', 0, 10, 0.1);
    t.Add('screamNoise', 0, 30, 0.5);
    t.Add('screamInterval', 0.5, 10, 0.1);
    t.Add('gravity', 5, 80, 1);
    this.tuning = t;

    this.folder = debugPanel.gui.addFolder('zombies').close();
    this.folder.add(this, 'showSenses').name('show senses + states');
  }

  Destroy(): void {
    this.tuning.Destroy();
    this.folder.destroy();
  }

  /** Every frame (immediate mode). */
  Draw(player: Player): void {
    if (!this.showSenses) return;
    const d = this.engine.debug;
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      d.Text(new Vec2(z.feetX, z.feetY + 6), z.stateName);
      if (!z.alive) continue;

      if (z.kind === ZombieKind.Clicker) {
        if (!z.distracted) d.Circle(new Vec2(z.feetX, z.feetY - z.body.height * 0.5), T.clickerSense * TILE, 0x66ccff, false, 0.5); // the close-range sense
        if (z.state === ZombieState.Investigate || z.state === ZombieState.Hunt || z.state === ZombieState.Return) {
          const from = new Vec2(z.feetX, z.feetY - 10);
          const to = new Vec2(z.targetX, z.feetY - 10);
          if (Math.abs(to.x - from.x) > 1) d.Ray(from, to.Sub(from), Math.abs(to.x - from.x), 0xffe066, 0.8); // where it is going
          d.Point(to, 0xffe066);
        }
      } else if (z.kind === ZombieKind.Screamer) {
        const w = T.screamerSight * TILE;
        const band = T.screamerSightHeight * TILE;
        const alert = z.state === ZombieState.Alert;
        const area = new Rect(z.dir > 0 ? z.feetX : z.feetX - w, z.feetY - band, w, band * 2); // where the player's FEET must be
        d.Box(area, alert ? 0xff3030 : 0xffee55, true, alert ? 0.3 : 0.15);
        if (new Vec2(z.feetX, z.feetY).DistanceTo(new Vec2(player.feetX, player.feetY)) > w * 1.5) continue; // only near her
        d.Line(z.Head(), SightTarget(player), z.LineOfSight(player) ? 0x66ff66 : 0xff4444, 0.6);
      }
    }
  }
}
