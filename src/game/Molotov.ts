import Phaser from 'phaser';
import { DEBUG_ENABLED } from '../core/Debug';
import { Action, type InputActions } from '../core/InputActions';
import { ART_SCALE, TILE } from './constants';
import type { Dialogue } from './Dialogue';
import { KeyColor, type LevelProgress } from './Levels';
import type { Locks } from './Locks';
import type { Player } from './Player';
import type { Throwables } from './Throwing';
import type { Zombie } from './Zombie';

/**
 * Medium level: the horde and the Molotov.
 *  1. The car ("!"): he notices the leaking gasoline but wants to see what's ahead first.
 *  2. The overlook: the horde. Too many. He remembers the car.
 *  3. The car again: bottle + gasoline, but no rag. The trunk is chained with three padlocks.
 *  4. Red key (tunnel Clicker), green (both yard Runners), blue (both rooftop Screamers).
 *  5. The car: the trunk opens, the rag, a Molotov (new skill). One throw into the horde burns them all
 *     (on purpose: a Molotov that lands among them always works; one that lands elsewhere goes out and
 *     comes back to you). The gate behind them opens.
 * Dev shortcuts (debug builds): 1 = next coloured key, 2 = the rag.
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
  private readonly scene: Phaser.Scene;
  private readonly input: InputActions;
  private readonly dialogue: Dialogue;
  private readonly progress: LevelProgress;
  private readonly throwables: Throwables;
  private readonly locks: Locks;
  private readonly banner: (text: string, ms: number) => void;
  private readonly horde: Zombie[] = [];
  private car: Phaser.GameObjects.Image | null = null;
  private carX = 0;
  private carY = 0;
  private marker: Phaser.GameObjects.Text | null = null;
  private prompt: Phaser.GameObjects.Text | null = null;
  private arena = new Phaser.Geom.Rectangle(0, 0, 0, 0); // where a Molotov sets the horde on fire

  constructor(scene: Phaser.Scene, input: InputActions, dialogue: Dialogue, progress: LevelProgress,
    throwables: Throwables, locks: Locks, banner: (text: string, ms: number) => void) {
    this.scene = scene;
    this.input = input;
    this.dialogue = dialogue;
    this.progress = progress;
    this.throwables = throwables;
    this.locks = locks;
    this.banner = banner;
    if (progress.molotov) throwables.molotovs = 1; // crafted before a death: still in hand
    throwables.onMolotov = (x, y) => this.molotovLanded(x, y);
  }

  addCar(feetX: number, feetY: number): void {
    this.carX = feetX;
    this.carY = feetY;
    const open = this.progress.carStage >= 3;
    this.car = this.scene.add.image(feetX, feetY, open ? 'car_open' : 'car_chained').setOrigin(0.5, 1).setScale(ART_SCALE).setDepth(4);
    // gasoline dripping from the tank into the puddle
    const drop = this.scene.add.rectangle(feetX - 34, feetY - 30, 3, 5, 0x2a2633).setDepth(5);
    this.scene.tweens.add({ targets: drop, y: feetY - 2, duration: 520, ease: 'Quad.easeIn', repeat: -1, repeatDelay: 380 });
    this.marker = this.scene.add.text(feetX, feetY - TILE * 1.7, '!', {
      fontFamily: 'Georgia, serif', fontSize: '56px', fontStyle: 'bold', color: '#ffd24a', stroke: '#000000', strokeThickness: 8,
    }).setOrigin(0.5, 1).setDepth(25);
    this.prompt = this.scene.add.text(feetX, feetY - TILE * 1.75, '↑  Look', {
      fontFamily: 'Georgia, serif', fontSize: '26px', fontStyle: 'bold', color: '#f0e6c8', stroke: '#000000', strokeThickness: 5,
    }).setOrigin(0.5, 1).setDepth(25).setVisible(false);
  }

  /** A feeding horde Clicker. Call finishSetup() after the last one. */
  addHorde(z: Zombie): void {
    z.feeding = true;
    this.horde.push(z);
  }

  /** After spawning: the fire zone around the horde; a horde already burned (before a death) = open gate. */
  finishSetup(): void {
    if (this.progress.hordeBurned) {
      this.locks.openGates();
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
    this.arena.setTo(minX - 3 * TILE, floor - 9 * TILE, maxX - minX + 6 * TILE, 9.5 * TILE);
  }

  /** Once per frame, after input. Opens dialogues (the scene pauses while one is open). */
  update(timeMs: number, player: Player): void {
    const p = this.progress;
    if (DEBUG_ENABLED) this.devShortcuts();

    // The overlook: first sight of the horde.
    if (!p.sawHorde && this.horde.length > 0 && !player.dead
      && player.feetX > this.arena.x + (3 - OVERLOOK_DISTANCE) * TILE && player.feetY < this.arena.bottom - 4 * TILE) {
      p.sawHorde = true;
      this.dialogue.show(HORDE_SEEN);
      return;
    }

    if (!this.car || !this.marker || !this.prompt) return;
    const near = !player.dead && Math.abs(player.feetX - this.carX) < READ_RANGE_X && Math.abs(player.feetY - this.carY) < READ_RANGE_Y;
    this.prompt.setVisible(near);
    this.marker.setVisible(!near && this.carHasNews());
    this.marker.y = this.carY - TILE * 1.7 + Math.sin(timeMs / 220) * 8;
    this.marker.setScale(1 + Math.sin(timeMs / 140) * 0.08);
    if (near && this.input.pressed(Action.Up) && !this.input.held(Action.Throw)) this.lookAtCar();
  }

  /** At the physics rate: the moment the last horde zombie dies, the gate opens. */
  fixedUpdate(): void {
    const p = this.progress;
    if (p.hordeBurned || this.horde.length === 0) return;
    for (let i = 0; i < this.horde.length; i++) if (this.horde[i].alive) return;
    p.hordeBurned = true;
    this.locks.openGates();
    this.scene.time.delayedCall(900, () => this.dialogue.show(HORDE_BURNED));
  }

  /** "!" over the car: there is something new to think about there. */
  private carHasNews(): boolean {
    const p = this.progress;
    if (p.molotov) return false;
    if (p.carStage === 0 || p.rag) return true;
    if (!p.sawHorde) return false;
    return p.carStage < 2 || this.allKeys();
  }

  private allKeys(): boolean {
    const held = this.progress.keyHeld;
    return held[KeyColor.Red] && held[KeyColor.Green] && held[KeyColor.Blue];
  }

  private lookAtCar(): void {
    const p = this.progress;
    if (p.molotov) {
      this.dialogue.show(CAR_DONE);
    } else if (p.rag) {
      this.dialogue.show(CRAFT, () => this.craft());
    } else if (!p.sawHorde) {
      if (p.carStage === 0) {
        p.carStage = 1;
        this.dialogue.show(CAR_FIRST);
      } else {
        this.dialogue.show(CAR_WAIT);
      }
    } else if (this.allKeys()) {
      this.dialogue.show(CAR_OPEN.concat(CRAFT), () => {
        p.keysUsed = true;
        p.keyHeld = [false, false, false];
        p.carStage = 3;
        if (this.car) this.car.setTexture('car_open');
        this.craft();
      });
    } else if (p.carStage < 2) {
      p.carStage = 2;
      this.dialogue.show(CAR_PLAN);
    } else {
      const missing: string[] = [];
      for (let c = 0; c < KeyColor.Count; c++) if (!p.keyHeld[c]) missing.push(KEY_NAMES[c]);
      this.dialogue.show(['ما زال ينقصني: المفتاح ' + missing.join('، والمفتاح ') + '.']);
    }
  }

  private craft(): void {
    const p = this.progress;
    p.rag = false;
    p.molotov = true;
    this.throwables.molotovs = 1;
    this.banner('NEW SKILL: MOLOTOV', 2600);
  }

  /** Where the Molotov broke. Among the horde: everything burns, the flames running out from the impact. */
  private molotovLanded(x: number, y: number): void {
    if (!this.arena.contains(x, y) || this.progress.hordeBurned) {
      this.throwables.molotovs = 1; // the rag went out: you still have it
      this.scene.time.delayedCall(500, () => this.dialogue.show(MOLOTOV_MISS));
      return;
    }
    const cam = this.scene.cameras.main;
    cam.flash(260, 255, 150, 60);
    cam.shake(380, 0.008);
    for (let i = 0; i < this.horde.length; i++) {
      const z = this.horde[i];
      z.ignite(Math.abs(z.feetX - x) / TILE * FIRE_SPREAD);
    }
    // flames on the ground along the whole pile, lit in the same outward order
    const floor = this.horde.length > 0 ? this.horde[0].feetY : y;
    for (let fx = this.arena.x + 2 * TILE; fx < this.arena.right - 2 * TILE; fx += TILE * 1.2) {
      const delay = (Math.abs(fx - x) / TILE) * FIRE_SPREAD * 1000;
      this.scene.time.delayedCall(delay, () => this.groundFire(fx + (Math.random() - 0.5) * 20, floor));
    }
  }

  private groundFire(x: number, floorY: number): void {
    const f = this.scene.add.sprite(x, floorY + 4, 'fire').setOrigin(0.5, 1).setScale(1.6 + Math.random() * 0.8).setDepth(7);
    f.play({ key: 'fire', startFrame: Math.floor(Math.random() * 8) });
    this.scene.tweens.add({ targets: f, alpha: 0, delay: GROUND_FIRE_TIME * 1000, duration: 1500, onComplete: () => f.destroy() });
  }

  /** 1 = next coloured key, 2 = the rag (skips the trunk: the car then crafts the Molotov). */
  private devShortcuts(): void {
    const p = this.progress;
    if (this.input.pressed(Action.DevKey)) {
      for (let c = 0; c < KeyColor.Count; c++) {
        if (p.keyHeld[c] || p.keysUsed) continue;
        p.keyHeld[c] = true;
        p.keyDropped[c] = true; // its guardians won't drop a second one
        this.banner('DEV: ' + ['RED', 'GREEN', 'BLUE'][c] + ' KEY', 900);
        break;
      }
    }
    if (this.input.pressed(Action.DevRag) && !p.molotov) {
      p.rag = true;
      p.sawHorde = true;
      p.carStage = Math.max(p.carStage, 2);
      this.banner('DEV: RAG', 900);
    }
  }
}
