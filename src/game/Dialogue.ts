import Phaser from 'phaser';
import { Action, type InputActions } from '../core/InputActions';

/**
 * The survivor's thoughts: a box at the bottom of the screen, one line at a time (Arabic, Noto Naskh).
 * The game pauses while it is open. ↑ / Space / X shows the next line; after the last one it closes
 * and calls `onDone`. HTML over the canvas (Phaser DOM) for real Arabic shaping and wrapping.
 */
export class Dialogue {
  open = false;

  private readonly scene: Phaser.Scene;
  private readonly input: InputActions;
  private readonly element: Phaser.GameObjects.DOMElement;
  private readonly textEl: HTMLDivElement;
  private lines: string[] = [];
  private index = 0;
  private onDone: (() => void) | null = null;

  constructor(scene: Phaser.Scene, input: InputActions) {
    this.scene = scene;
    this.input = input;
    const root = document.createElement('div');
    root.className = 'dialogue';
    root.innerHTML = '<div class="dialogue-text"></div><div class="dialogue-next">↑ / Space</div>';
    this.textEl = root.querySelector('.dialogue-text') as HTMLDivElement;
    this.element = scene.add.dom(scene.scale.width / 2, scene.scale.height - 150, root).setScrollFactor(0).setDepth(100).setVisible(false);
  }

  show(lines: string[], onDone: (() => void) | null = null): void {
    this.lines = lines;
    this.index = 0;
    this.onDone = onDone;
    this.open = true;
    this.scene.physics.pause();
    this.element.setVisible(true);
    this.render();
  }

  /** Once per frame while open. */
  update(): void {
    if (!this.open) return;
    const i = this.input;
    if (!i.pressed(Action.Up) && !i.pressed(Action.Jump) && !i.pressed(Action.Attack) && !i.pressed(Action.Back)) return;
    this.index++;
    if (this.index < this.lines.length) {
      this.render();
      return;
    }
    this.open = false;
    this.element.setVisible(false);
    // Keys used to read must not leak into gameplay (a buffered jump, a crouch toggle, a throw).
    i.consume(Action.Jump);
    i.consume(Action.Down);
    i.consume(Action.Attack);
    i.consume(Action.Throw);
    this.scene.physics.resume();
    const done = this.onDone;
    this.onDone = null;
    if (done) done();
  }

  private render(): void {
    this.textEl.textContent = this.lines[this.index];
    this.textEl.classList.remove('dialogue-in');
    void this.textEl.offsetWidth; // restart the fade-in
    this.textEl.classList.add('dialogue-in');
  }
}
