import type { Engine, HtmlNode } from '../../engine';
import { Action } from '../Actions';

/**
 * The survivor's thoughts: a box at the bottom of the screen, one line at a time (Arabic, Noto Naskh).
 * The world pauses while it is open. ↑ / Space / X shows the next line; after the last one it closes
 * and calls `onDone`. An HTML element over the canvas, for real Arabic shaping and wrapping.
 */
export class Dialogue {
  open = false;

  private readonly engine: Engine;
  private readonly element: HtmlNode;
  private readonly textEl: HTMLDivElement;
  private lines: string[] = [];
  private index = 0;
  private onDone: (() => void) | null = null;

  constructor(engine: Engine) {
    this.engine = engine;
    const root = document.createElement('div');
    root.className = 'dialogue';
    root.innerHTML = '<div class="dialogue-text"></div><div class="dialogue-next">↑ / Space</div>';
    this.textEl = root.querySelector('.dialogue-text') as HTMLDivElement;
    this.element = engine.renderer.CreateHtml(engine.width / 2, engine.height - 150, root).SetDepth(100).SetVisible(false);
  }

  Show(lines: string[], onDone: (() => void) | null = null): void {
    this.lines = lines;
    this.index = 0;
    this.onDone = onDone;
    this.open = true;
    this.engine.physics.paused = true;
    this.element.SetVisible(true);
    this.Render();
  }

  /** Once per frame while open. */
  Update(): void {
    if (!this.open) return;
    const i = this.engine.input;
    if (!i.Pressed(Action.Up) && !i.Pressed(Action.Jump) && !i.Pressed(Action.Attack) && !i.Pressed(Action.Back)) return;
    this.index++;
    if (this.index < this.lines.length) {
      this.Render();
      return;
    }
    this.open = false;
    this.element.SetVisible(false);
    // Keys used to read must not leak into gameplay (a buffered jump, a crouch toggle, a throw).
    i.Consume(Action.Jump);
    i.Consume(Action.Down);
    i.Consume(Action.Attack);
    i.Consume(Action.Throw);
    this.engine.physics.paused = false;
    const done = this.onDone;
    this.onDone = null;
    if (done) done();
  }

  private Render(): void {
    this.textEl.textContent = this.lines[this.index];
    this.textEl.classList.remove('dialogue-in');
    void this.textEl.offsetWidth; // restart the fade-in
    this.textEl.classList.add('dialogue-in');
  }
}
