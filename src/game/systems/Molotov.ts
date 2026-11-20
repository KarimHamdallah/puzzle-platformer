import { DEBUG_ENABLED, Ease, Rect, type Engine, type Sprite, type Text } from '../../engine';
import { Action } from '../Actions';
import { ART_SCALE, GOLD, Serif, TILE } from '../constants';
import type { Player } from '../entities/Player';
import type { Zombie } from '../entities/Zombie';
import { KeyColor, type LevelProgress } from '../levels/Levels';
import type { Dialogue } from '../ui/Dialogue';
import type { Locks } from './Locks';
import type { Throwables } from './Throwing';

/**
 * Medium level: the horde and the Molotov.
 *  1. The car ("!"): he notices the leaking gasoline but wants to see what's ahead first.
 *  2. The overlook: the horde. Too many. He remembers the car.
 *  3. The car again: bottle + gasoline, but no rag. The trunk is chained with three padlocks.
 *  4. Red key (tunnel Clicker), green (both yard Runners), blue (both rooftop Screamers).
 *  5. The car: the trunk opens, the rag, a Molotov (new skill). One throw into the horde burns them all
 *     (on purpose: a Molotov that lands among them always works; one that lands elsewhere goes out and
 *     comes back to you). The gate behind them opens.
 * Dev shortcut (debug builds): 2 = the next coloured key, then the rag (1 is the cheat toggle).
 */

const CAR_FIRST = [
  'سيارةٌ محطّمة... وخزّانها ما زال ينزف بنزينًا.',
  'البنزين يشتعل. ربما أستطيع أن أصنع منه شيئًا...',
  'لا. لأرَ أولًا ما الذي ينتظرني في الأمام.',
];
const CAR_WAIT = ['لأرَ ما في الأمام أولًا.'];
const HORDE_SEEN = [
  'يا إلهي... كم عددهم؟',
  'عشرات، متجمّعون حول الجثث يأكلون. لن أعبر من بينهم أبدًا، ولن تكفيني كل زجاجات المدينة.',
  '...تلك السيارة. البنزين! نارٌ واحدة في وسطهم وينتهي كل شيء.',
  'يجب أن أعود إليها.',
];
const CAR_PLAN = [
  'زجاجة، وبنزين... ينقصني قماشٌ أحشو به عنقها.',
  'صندوق السيارة مقيّدٌ بسلسلة، وعليها ثلاثة أقفال: أحمر، وأخضر، وأزرق.',
  'رأيتُ المفاتيح تلمع عليهم: الأحمر مع الكليكر في النفق، والأخضر مع الرانرز في الساحة، والأزرق مع السكريمرز فوق الأسطح.',
];
const KEY_NAMES = ['الأحمر', 'الأخضر', 'الأزرق'];
const CAR_OPEN = [
  'الأقفال الثلاثة... انفتحت.',
  'قطعة قماشٍ قديمة في الصندوق. تكفي.',
];
const CRAFT = [
  'زجاجة، وبنزين، وقماش... مولوتوف.',
  'واحدةٌ فقط. يجب أن تسقط في وسطهم تمامًا.',
];
const CAR_DONE = ['لم يبقَ فيها ما يفيد.'];
const MOLOTOV_MISS = ['انطفأت قبل أن تصل إليهم... ما زال البنزين معي، سأصنع غيرها.'];
const HORDE_BURNED = [
  'احترقوا... كلهم.',
  'الطريق مفتوح.',
];

const READ_RANGE_X = 2.6 * TILE; // from the car's centre: the whole car, and standing at the trunk
const READ_RANGE_Y = 0.6 * TILE;
const OVERLOOK_DISTANCE = 6; // tiles before the horde's first zombie: you see them from here
const FIRE_SPREAD = 0.08; // s per tile: how fast the flames run along the horde
const GROUND_FIRE_TIME = 3.5; // s

export class MolotovQuest {
  private readonly engine: Engine;
  private readonly dialogue: Dialogue;
  private readonly progress: LevelProgress;
  private readonly throwables: Throwables;
  private readonly locks: Locks;
  private readonly banner: (text: string, seconds: number) => void;
  private readonly horde: Zombie[] = [];
  private car: Sprite | null = null;
  private carX = 0;
  private carY = 0;
  private marker: Text | null = null;
  private prompt: Text | null = null;
  private readonly arena = new Rect(); // where a Molotov sets the horde on fire

  constructor(engine: Engine, dialogue: Dialogue, progress: LevelProgress,
    throwables: Throwables, locks: Locks, banner: (text: string, seconds: number) => void) {
    this.engine = engine;
    this.dialogue = dialogue;
    this.progress = progress;
    this.throwables = throwables;
    this.locks = locks;
    this.banner = banner;
    if (progress.molotov) throwables.molotovs = 1; // crafted before a death: still in hand
    throwables.onMolotov = (x, y) => this.MolotovLanded(x, y);
  }

  AddCar(feetX: number, feetY: number): void {
    const r = this.engine.renderer;
    this.carX = feetX;
    this.carY = feetY;
    const open = this.progress.carStage >= 3;
    this.car = r.CreateSprite(feetX, feetY, open ? 'car_open' : 'car_chained').SetOrigin(0.5, 1).SetScale(ART_SCALE).SetDepth(4);
    // gasoline dripping from the tank into the puddle
    const drop = r.CreateShape(feetX - 34, feetY - 30).FillStyle(0x2a2633, 1).FillRect(-1.5, -2.5, 3, 5).SetDepth(5);
    this.engine.tweens.To(drop, { y: feetY - 2 }, 0.52, { ease: Ease.QuadIn, repeat: -1, repeatDelay: 0.38 });
    this.marker = r.CreateText(feetX, feetY - TILE * 1.7, '!', Serif(56, 'bold', GOLD, 8)).SetOrigin(0.5, 1).SetDepth(25);
    this.prompt = r.CreateText(feetX, feetY - TILE * 1.75, '↑  Look', Serif(26)).SetOrigin(0.5, 1).SetDepth(25).SetVisible(false);
  }

  /** A feeding horde Clicker. Call FinishSetup() after the last one. */
  AddHorde(z: Zombie): void {
    z.feeding = true;
    this.horde.push(z);
  }

  /** After spawning: the fire zone around the horde; a horde already burned (before a death) = open gate. */
  FinishSetup(): void {
    if (this.progress.hordeBurned) {
      this.locks.OpenGates();
      return;
    }
    if (this.horde.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < this.horde.length; i++) {
      minX = Math.min(minX, this.horde[i].feetX);
      maxX = Math.max(maxX, this.horde[i].feetX);
    }
    const floor = this.horde[0].feetY;
    this.arena.Set(minX - 3 * TILE, floor - 9 * TILE, maxX - minX + 6 * TILE, 9.5 * TILE);
  }

  /** Once per frame, after input. Opens dialogues (the world pauses while one is open). */
  Update(timeMs: number, player: Player): void {
    const p = this.progress;
    const input = this.engine.input;
    if (DEBUG_ENABLED) this.DevShortcuts();

    // The overlook: first sight of the horde.
    if (!p.sawHorde && this.horde.length > 0 && !player.dead
      && player.feetX > this.arena.x + (3 - OVERLOOK_DISTANCE) * TILE && player.feetY < this.arena.bottom - 4 * TILE) {
      p.sawHorde = true;
      this.dialogue.Show(HORDE_SEEN);
      return;
    }

    if (!this.car || !this.marker || !this.prompt) return;
    const near = !player.dead && Math.abs(player.feetX - this.carX) < READ_RANGE_X && Math.abs(player.feetY - this.carY) < READ_RANGE_Y;
    this.prompt.SetVisible(near);
    this.marker.SetVisible(!near && this.CarHasNews());
    this.marker.y = this.carY - TILE * 1.7 + Math.sin(timeMs / 220) * 8;
    this.marker.SetScale(1 + Math.sin(timeMs / 140) * 0.08);
    if (near && input.Pressed(Action.Up) && !input.Held(Action.Throw)) this.LookAtCar();
  }

  /** At the physics rate: the moment the last horde zombie dies, the gate opens. */
  FixedUpdate(): void {
    const p = this.progress;
    if (p.hordeBurned || this.horde.length === 0) return;
    for (let i = 0; i < this.horde.length; i++) if (this.horde[i].alive) return;
    p.hordeBurned = true;
    this.locks.OpenGates();
    this.engine.clock.After(0.9, () => this.dialogue.Show(HORDE_BURNED));
  }

  /** "!" over the car: there is something new to think about there. */
  private CarHasNews(): boolean {
    const p = this.progress;
    if (p.molotov) return false;
    if (p.carStage === 0 || p.rag) return true;
    if (!p.sawHorde) return false;
    return p.carStage < 2 || this.AllKeys();
  }

  private AllKeys(): boolean {
    const held = this.progress.keyHeld;
    return held[KeyColor.Red] && held[KeyColor.Green] && held[KeyColor.Blue];
  }

  private LookAtCar(): void {
    const p = this.progress;
    if (p.molotov) {
      this.dialogue.Show(CAR_DONE);
    } else if (p.rag) {
      this.dialogue.Show(CRAFT, () => this.Craft());
    } else if (!p.sawHorde) {
      if (p.carStage === 0) {
        p.carStage = 1;
        this.dialogue.Show(CAR_FIRST);
      } else {
        this.dialogue.Show(CAR_WAIT);
      }
    } else if (this.AllKeys()) {
      this.dialogue.Show(CAR_OPEN.concat(CRAFT), () => {
        p.keysUsed = true;
        p.keyHeld = [false, false, false];
        p.carStage = 3;
        if (this.car) this.car.SetTexture('car_open');
        this.Craft();
      });
    } else if (p.carStage < 2) {
      p.carStage = 2;
      this.dialogue.Show(CAR_PLAN);
    } else {
      const missing: string[] = [];
      for (let c = 0; c < KeyColor.Count; c++) if (!p.keyHeld[c]) missing.push(KEY_NAMES[c]);
      this.dialogue.Show(['ما زال ينقصني: المفتاح ' + missing.join('، والمفتاح ') + '.']);
    }
  }

  private Craft(): void {
    const p = this.progress;
    p.rag = false;
    p.molotov = true;
    this.throwables.molotovs = 1;
    this.banner('NEW SKILL: MOLOTOV', 2.6);
  }

  /** Where the Molotov broke. Among the horde: everything burns, the flames running out from the impact. */
  private MolotovLanded(x: number, y: number): void {
    if (!this.arena.Contains(x, y) || this.progress.hordeBurned) {
      this.throwables.molotovs = 1; // the rag went out: you still have it
      this.engine.clock.After(0.5, () => this.dialogue.Show(MOLOTOV_MISS));
      return;
    }
    const cam = this.engine.camera;
    cam.Flash(0.26, 0xff963c);
    cam.Shake(0.38, 0.008);
    for (let i = 0; i < this.horde.length; i++) {
      const z = this.horde[i];
      z.Ignite(Math.abs(z.feetX - x) / TILE * FIRE_SPREAD);
    }
    // flames on the ground along the whole pile, lit in the same outward order
    const floor = this.horde.length > 0 ? this.horde[0].feetY : y;
    for (let fx = this.arena.x + 2 * TILE; fx < this.arena.right - 2 * TILE; fx += TILE * 1.2) {
      const delay = (Math.abs(fx - x) / TILE) * FIRE_SPREAD;
      this.engine.clock.After(delay, () => this.GroundFire(fx + (Math.random() - 0.5) * 20, floor));
    }
  }

  private GroundFire(x: number, floorY: number): void {
    const f = this.engine.renderer.CreateSprite(x, floorY + 4, 'fire').SetOrigin(0.5, 1).SetScale(1.6 + Math.random() * 0.8).SetDepth(7);
    this.engine.animations.Create(f).Play('fire', false, Math.floor(Math.random() * 8));
    this.engine.tweens.To(f, { alpha: 0 }, 1.5, { delay: GROUND_FIRE_TIME, onDone: () => f.Destroy() });
  }

  /**
   * Key 2 (key 1 is the cheat toggle): the next coloured key; once all three are held (or used), the rag
   * (it skips the trunk: the car then crafts the Molotov).
   */
  private DevShortcuts(): void {
    const p = this.progress;
    if (!this.engine.input.Pressed(Action.Num2)) return;
    for (let c = 0; c < KeyColor.Count; c++) {
      if (p.keyHeld[c] || p.keysUsed) continue;
      p.keyHeld[c] = true;
      p.keyDropped[c] = true; // its guardians won't drop a second one
      this.banner('DEV: ' + ['RED', 'GREEN', 'BLUE'][c] + ' KEY', 0.9);
      return;
    }
    if (p.molotov) return;
    p.rag = true;
    p.sawHorde = true;
    p.carStage = Math.max(p.carStage, 2);
    this.banner('DEV: RAG', 0.9);
  }
}
