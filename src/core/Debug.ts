import Phaser from 'phaser';
import GUI from 'lil-gui';

/** Debug tools exist in dev builds, or in any build opened with ?debug in the URL. */
export const DEBUG_ENABLED: boolean = import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug');

/**
 * The debug panel (lil-gui), one per page. Backtick ( ` ) shows / hides it.
 * Systems add their own folders to `debug.gui`.
 */
class DebugPanel {
  readonly gui: GUI;
  private game: Phaser.Game | null = null;
  private visible: boolean;

  constructor() {
    this.gui = new GUI({ title: 'Debug   ( ` toggles )' });
    this.gui.add(this, 'fps').listen().disable();
    this.visible = DEBUG_ENABLED;
    this.gui.show(this.visible);
    window.addEventListener('keydown', this); // calls this.handleEvent
  }

  get fps(): number {
    return this.game ? Math.round(this.game.loop.actualFps) : 0;
  }

  attach(game: Phaser.Game): void {
    this.game = game;
    // Console access while debugging: __game.scene.getScene('Playground')
    if (DEBUG_ENABLED) (window as unknown as { __game: Phaser.Game }).__game = game;
  }

  handleEvent(e: KeyboardEvent): void {
    if (!DEBUG_ENABLED || e.code !== 'Backquote') return;
    this.visible = !this.visible;
    this.gui.show(this.visible);
  }
}

export const debug = new DebugPanel();

/**
 * A folder of sliders bound to an object of numbers (e.g. `new PlayerTuning()`).
 *  - Game code reads the object directly every frame, so a slider change applies instantly.
 *  - Changed values are saved in localStorage and survive a reload; "*" in the title = differs from code.
 *  - "copy as JSON" puts the values on the clipboard, to paste good values back into the code.
 */
export class TuningFolder<T extends object> {
  private readonly folder: GUI;
  private readonly name: string;
  private readonly values: Record<string, number>;
  private readonly defaults: Record<string, number>;

  constructor(name: string, values: T) {
    this.name = name;
    this.values = values as unknown as Record<string, number>;
    this.defaults = { ...this.values };
    this.load();

    this.folder = debug.gui.addFolder(name).close();
    this.folder.add(this, 'reset').name('reset to defaults');
    this.folder.add(this, 'copyJson').name('copy as JSON');
    this.updateTitle();
  }

  /** Add one slider. `key` is checked at compile time against T. */
  add(key: keyof T & string, min: number, max: number, step: number): void {
    this.folder.add(this.values, key, min, max, step).onChange(() => this.save());
  }

  destroy(): void {
    this.folder.destroy();
  }

  reset(): void {
    for (const key in this.defaults) this.values[key] = this.defaults[key];
    this.save();
    const controllers = this.folder.controllersRecursive();
    for (let i = 0; i < controllers.length; i++) controllers[i].updateDisplay();
  }

  copyJson(): void {
    navigator.clipboard.writeText(JSON.stringify(this.values, null, 2)).catch(() => {});
  }

  private isModified(): boolean {
    for (const key in this.defaults) {
      if (this.values[key] !== this.defaults[key]) return true;
    }
    return false;
  }

  private load(): void {
    try {
      const raw = localStorage.getItem('tuning:' + this.name);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, unknown>;
      for (const key in this.defaults) {
        const value = saved[key];
        if (typeof value === 'number') this.values[key] = value; // ignore removed / renamed keys
      }
    } catch {
      // storage blocked or corrupt: keep code defaults
    }
  }

  private save(): void {
    try {
      if (this.isModified()) localStorage.setItem('tuning:' + this.name, JSON.stringify(this.values));
      else localStorage.removeItem('tuning:' + this.name);
    } catch {
      // storage blocked: values still apply for this session
    }
    this.updateTitle();
  }

  private updateTitle(): void {
    this.folder.title(this.isModified() ? this.name + '  *' : this.name);
  }
}
