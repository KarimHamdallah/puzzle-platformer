import GUI from 'lil-gui';

/** Debug tools are in every build (the deployed one too): reviewers can tune, see hitboxes and enemy senses. */
export const DEBUG_ENABLED: boolean = true;

/**
 * The debug panel (lil-gui), one per page. Backtick ( ` ) shows / hides it.
 * Systems add their own folders to `debugPanel.gui`.
 */
class DebugPanel {
  readonly gui: GUI;
  private visible: boolean;
  private fpsSource: () => number = () => 0;

  constructor() {
    this.gui = new GUI({ title: 'Debug   ( ` toggles )' });
    this.gui.add(this, 'fps').listen().disable();
    this.visible = DEBUG_ENABLED;
    this.gui.show(this.visible);
    window.addEventListener('keydown', this); // calls this.handleEvent
  }

  get fps(): number {
    return Math.round(this.fpsSource());
  }

  SetFpsSource(source: () => number): void {
    this.fpsSource = source;
  }

  handleEvent(e: KeyboardEvent): void {
    if (!DEBUG_ENABLED || e.code !== 'Backquote') return;
    this.visible = !this.visible;
    this.gui.show(this.visible);
  }
}

export const debugPanel = new DebugPanel();

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
    this.Load();

    this.folder = debugPanel.gui.addFolder(name).close();
    this.folder.add(this, 'Reset').name('reset to defaults');
    this.folder.add(this, 'CopyJson').name('copy as JSON');
    this.UpdateTitle();
  }

  /** Add one slider. `key` is checked at compile time against T. */
  Add(key: keyof T & string, min: number, max: number, step: number): void {
    this.folder.add(this.values, key, min, max, step).onChange(() => this.Save());
  }

  Destroy(): void {
    this.folder.destroy();
  }

  Reset(): void {
    for (const key in this.defaults) this.values[key] = this.defaults[key];
    this.Save();
    const controllers = this.folder.controllersRecursive();
    for (let i = 0; i < controllers.length; i++) controllers[i].updateDisplay();
  }

  CopyJson(): void {
    navigator.clipboard.writeText(JSON.stringify(this.values, null, 2)).catch(() => {});
  }

  private IsModified(): boolean {
    for (const key in this.defaults) {
      if (this.values[key] !== this.defaults[key]) return true;
    }
    return false;
  }

  private Load(): void {
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

  private Save(): void {
    try {
      if (this.IsModified()) localStorage.setItem('tuning:' + this.name, JSON.stringify(this.values));
      else localStorage.removeItem('tuning:' + this.name);
    } catch {
      // storage blocked: values still apply for this session
    }
    this.UpdateTitle();
  }

  private UpdateTitle(): void {
    this.folder.title(this.IsModified() ? this.name + '  *' : this.name);
  }
}
