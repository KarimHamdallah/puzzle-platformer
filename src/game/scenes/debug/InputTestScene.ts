import Phaser from 'phaser';
import { ACTIONS, type Action } from '../../../core/input/Actions';
import { InputActions } from '../../../core/input/InputActions';
import { createTuning } from '../../../core/tuning/Tuning';

const TEST = createTuning(
  'test: input',
  { bufferWindowMs: 120, bigJumpSpeed: 360, smallHopSpeed: 150, gravity: 900, moveSpeed: 140 },
  {
    bufferWindowMs: { min: 0, max: 400, step: 10 },
    bigJumpSpeed: { min: 100, max: 600, step: 10 },
    smallHopSpeed: { min: 50, max: 400, step: 10 },
    gravity: { min: 200, max: 2000, step: 50 },
    moveSpeed: { min: 0, max: 400, step: 10 },
  },
);

const GROUND_Y = 205;
const LAMP_OFF = 0x2a2a44;
const LAMP_ON = 0x66ccff;
const BOX_IDLE = 0x9999bb;
const BOX_BUFFERED = 0x66ff99;
const TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '9px',
  color: '#e0e0ff',
  resolution: 4, // crisp text under the 4x camera zoom
};

/**
 * Debug scene for Day 1 Step 1 (input).
 *  - Lamps: one per action. Lit while held, pulse on every press (even sub-frame taps).
 *  - moveX bar: shows the resolved horizontal axis (try holding left+right: the newest press wins).
 *  - Buffer demo: the box hops by itself. Press jump while it's in the air; if the press is within
 *    `bufferWindowMs` of landing, the box does a big green jump. Feedback text shows how early you were.
 *  - R restarts the scene: checks that input + debug panels clean up without duplicates.
 */
export class InputTestScene extends Phaser.Scene {
  private actions!: InputActions;
  private readonly lamps = new Map<Action, Phaser.GameObjects.Rectangle>();
  private moveBar!: Phaser.GameObjects.Rectangle;
  private box!: Phaser.GameObjects.Rectangle;
  private feedback!: Phaser.GameObjects.Text;
  private velocityY = 0;

  constructor() {
    super('InputTest');
  }

  create(): void {
    this.lamps.clear();
    this.velocityY = 0;
    this.actions = new InputActions(this);
    // This scene was laid out for 480x270: zoom the camera to fill the 1920x1080 canvas.
    const width = 480;
    const height = 270;
    this.cameras.main.setZoom(this.scale.width / width).centerOn(width / 2, height / 2);
    this.cameras.main.setBackgroundColor(0x1a1a2e);
    const cx = width / 2;

    this.add.text(cx, 14, 'INPUT TEST', { ...TEXT_STYLE, fontSize: '11px' }).setOrigin(0.5);

    // Action lamps
    const lampW = 50;
    const gap = 6;
    const startX = (width - (ACTIONS.length * lampW + (ACTIONS.length - 1) * gap)) / 2 + lampW / 2;
    ACTIONS.forEach((action, i) => {
      const x = startX + i * (lampW + gap);
      const lamp = this.add.rectangle(x, 40, lampW, 18, LAMP_OFF).setStrokeStyle(1, 0x5a5a8a);
      this.add.text(x, 40, action, TEXT_STYLE).setOrigin(0.5);
      this.lamps.set(action, lamp);
    });

    // moveX bar: origin at the centre line, scaleX = moveX (negative scale grows to the left)
    this.add.text(cx - 130, 70, 'moveX', TEXT_STYLE).setOrigin(0, 0.5);
    this.add.rectangle(cx, 70, 200, 8, 0x22223a).setStrokeStyle(1, 0x5a5a8a);
    this.moveBar = this.add.rectangle(cx, 70, 100, 6, LAMP_ON).setOrigin(0, 0.5).setScale(0, 1);
    this.add.rectangle(cx, 70, 1, 12, 0xaaaacc);

    // Buffer demo
    this.add.text(cx, 100, 'buffer demo: press JUMP while the box is in the air', TEXT_STYLE).setOrigin(0.5);
    this.feedback = this.add.text(cx, 116, '', { ...TEXT_STYLE, fontSize: '10px' }).setOrigin(0.5);
    this.add.rectangle(20, GROUND_Y, width - 40, 2, 0x5a5a8a).setOrigin(0, 0);
    this.box = this.add.rectangle(cx, GROUND_Y, 14, 14, BOX_IDLE).setOrigin(0.5, 1);

    this.add
      .text(
        cx,
        height - 14,
        'move: arrows/AD   jump: Space Z K   attack: X J   interact: E C   R: restart scene   ` : debug',
        { ...TEXT_STYLE, fontSize: '8px', color: '#8888aa' },
      )
      .setOrigin(0.5);
  }

  update(_time: number, deltaMs: number): void {
    const input = this.actions;
    const dt = Math.min(deltaMs, 50) / 1000; // clamp: a long hitch must not teleport things

    if (input.pressed('reset')) {
      this.scene.restart();
      return;
    }

    for (const [action, lamp] of this.lamps) {
      lamp.setFillStyle(input.held(action) ? LAMP_ON : LAMP_OFF);
      if (input.pressed(action)) this.pulse(lamp);
    }

    this.moveBar.setScale(input.moveX, 1);

    this.box.x = Phaser.Math.Clamp(this.box.x + input.moveX * TEST.moveSpeed * dt, 30, 450);
    this.velocityY += TEST.gravity * dt;
    this.box.y += this.velocityY * dt;
    if (this.box.y >= GROUND_Y) {
      this.box.y = GROUND_Y;
      this.land();
    }
  }

  private land(): void {
    const input = this.actions;
    const age = Math.round(input.pressAgeMs('jump'));
    const alreadyUsed = input.state('jump').consumed;

    if (input.consumeBuffered('jump', TEST.bufferWindowMs)) {
      this.velocityY = -TEST.bigJumpSpeed;
      this.box.setFillStyle(BOX_BUFFERED);
      this.showFeedback(`BUFFERED  - pressed ${age} ms before landing`, '#66ff99');
    } else {
      this.velocityY = -TEST.smallHopSpeed;
      this.box.setFillStyle(BOX_IDLE);
      if (!alreadyUsed && age < 1000) {
        input.consume('jump');
        this.showFeedback(`too early - ${age} ms (window ${TEST.bufferWindowMs} ms)`, '#ff7777');
      }
    }

    // Landing squash: a first taste of the feel layer (Step 5 makes this a reusable system).
    this.tweens.killTweensOf(this.box);
    this.box.setScale(1.4, 0.6);
    this.tweens.add({ targets: this.box, scaleX: 1, scaleY: 1, duration: 140, ease: 'Back.easeOut' });
  }

  private pulse(lamp: Phaser.GameObjects.Rectangle): void {
    this.tweens.killTweensOf(lamp);
    lamp.setScale(1.25);
    this.tweens.add({ targets: lamp, scale: 1, duration: 140, ease: 'Back.easeOut' });
  }

  private showFeedback(message: string, color: string): void {
    this.tweens.killTweensOf(this.feedback);
    this.feedback.setText(message).setColor(color).setAlpha(1);
    this.tweens.add({ targets: this.feedback, alpha: 0.35, delay: 800, duration: 600 });
  }
}
