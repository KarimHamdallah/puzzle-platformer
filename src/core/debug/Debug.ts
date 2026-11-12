import Phaser from 'phaser';
import GUI from 'lil-gui';

const urlParams = new URLSearchParams(window.location.search);

/** Debug tools are on in dev builds, or in any build opened with ?debug in the URL. */
export const DEBUG_ENABLED: boolean = import.meta.env.DEV || urlParams.has('debug');

/** Returns the text block shown in the overlay for one system. Called ~15 times per second. */
export type OverlaySection = () => string;

const OVERLAY_HZ = 15;

/**
 * Global debug hub (one per page):
 *  - `gui`: the lil-gui root panel. Every system adds its own folder.
 *  - text overlay: systems register sections with `addSection` (input table, player state...).
 *  - general tools: FPS, frame counter, simulated lag.
 * Toggle everything with the backtick key ( ` ).
 */
class DebugTools {
  readonly gui: GUI;
  readonly settings = { overlay: false, lagMs: 0 };

  private readonly stats = { fps: 0, frame: 0 };
  private readonly overlayEl: HTMLPreElement;
  private readonly sections = new Map<string, OverlaySection>();
  private game: Phaser.Game | null = null;
  private visible = DEBUG_ENABLED;
  private lastOverlayMs = 0;

  constructor() {
    this.gui = new GUI({ title: 'Debug   ( ` toggles )' });

    const general = this.gui.addFolder('General').close();
    general.add(this.stats, 'fps').listen().disable();
    general.add(this.stats, 'frame').listen().disable();
    general.add(this.settings, 'overlay').name('text overlay').onChange(() => this.applyVisibility());
    general.add(this.settings, 'lagMs', 0, 100, 1).name('simulated lag (ms)');

    this.overlayEl = document.createElement('pre');
    Object.assign(this.overlayEl.style, {
      position: 'fixed',
      left: '8px',
      top: '8px',
      margin: '0',
      padding: '6px 8px',
      font: '11px/1.35 Consolas, monospace',
      color: '#d8d8f0',
      background: 'rgba(10, 10, 20, 0.78)',
      borderRadius: '4px',
      pointerEvents: 'none',
      zIndex: '1000',
      whiteSpace: 'pre',
    });
    document.body.appendChild(this.overlayEl);

    window.addEventListener('keydown', (e) => {
      if (!DEBUG_ENABLED || e.code !== 'Backquote') return;
      this.visible = !this.visible;
      this.applyVisibility();
    });

    this.applyVisibility();
  }

  /** Hook into the game loop. Call once, right after `new Phaser.Game`. */
  attach(game: Phaser.Game): void {
    this.game = game;
    // Console access while debugging: __game.scene.getScenes(true), etc.
    if (DEBUG_ENABLED) (window as unknown as { __game: Phaser.Game }).__game = game;
    game.events.on(Phaser.Core.Events.PRE_STEP, this.onPreStep, this);
    game.events.on(Phaser.Core.Events.POST_RENDER, this.onPostRender, this);
    game.events.once(Phaser.Core.Events.READY, () => this.addSceneSwitcher(game));
  }

  /** "Scenes" folder: one button per registered scene; stops the running scenes and starts that one. */
  private addSceneSwitcher(game: Phaser.Game): void {
    const folder = this.gui.addFolder('Scenes').close();
    for (const scene of game.scene.getScenes(false)) {
      const key = scene.sys.settings.key;
      folder
        .add(
          {
            open: () => {
              for (const running of game.scene.getScenes(true)) running.scene.stop();
              game.scene.start(key);
            },
          },
          'open',
        )
        .name(key);
    }
  }

  /** Add a text block to the overlay. Returns a function that removes it. */
  addSection(name: string, fn: OverlaySection): () => void {
    this.sections.set(name, fn);
    return () => {
      this.sections.delete(name);
    };
  }

  private onPreStep(): void {
    if (this.settings.lagMs <= 0) return;
    // Busy-wait to fake a slow machine: lets us test that input/buffers survive low FPS.
    const end = performance.now() + this.settings.lagMs;
    while (performance.now() < end) {
      // intentionally empty
    }
  }

  private onPostRender(): void {
    if (!this.game) return;
    this.stats.fps = Math.round(this.game.loop.actualFps);
    this.stats.frame = this.game.loop.frame;

    if (!this.visible || !this.settings.overlay) return;
    const now = performance.now();
    if (now - this.lastOverlayMs < 1000 / OVERLAY_HZ) return;
    this.lastOverlayMs = now;

    const parts: string[] = [];
    for (const [name, fn] of this.sections) parts.push(`== ${name} ==\n${fn()}`);
    this.overlayEl.textContent = parts.join('\n\n');
  }

  private applyVisibility(): void {
    this.gui.show(this.visible);
    this.overlayEl.style.display = this.visible && this.settings.overlay ? 'block' : 'none';
  }
}

export const debug = new DebugTools();
