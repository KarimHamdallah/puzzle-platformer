import type GUI from 'lil-gui';
import { debug } from '../debug/Debug';

export interface NumberRange {
  min: number;
  max: number;
  step?: number;
}

export type TuningValues = Record<string, number | boolean>;

/** Every number field must get a slider range; booleans become checkboxes. */
export type TuningRanges<T extends TuningValues> = {
  [K in keyof T as T[K] extends number ? K : never]: NumberRange;
};

interface Entry {
  values: TuningValues;
  reset: () => void;
}

const STORAGE_PREFIX = 'tuning:';
const registry = new Map<string, Entry>();
let rootFolder: GUI | null = null;

/**
 * Creates (once) a live, editable set of numbers for one system.
 *
 *   export const PLAYER_TUNING = createTuning('player', { jumpHeight: 3.5 }, { jumpHeight: { min: 1, max: 8 } });
 *
 * - Game code just reads PLAYER_TUNING.jumpHeight every frame, so slider changes apply instantly.
 * - Changes are saved to localStorage and survive a page reload.
 * - "copy as JSON" puts the values on the clipboard so good values can be pasted back as code defaults.
 * - Calling it again with the same name returns the same object (safe across scene restarts).
 */
export function createTuning<T extends TuningValues>(name: string, defaults: T, ranges: TuningRanges<T>): T {
  const existing = registry.get(name);
  if (existing) return existing.values as T;

  const values = { ...defaults, ...loadOverrides(name, defaults) } as T;
  const folder = getRootFolder().addFolder(name).close();
  const refreshTitle = (): void => {
    folder.title(isModified(values, defaults) ? `${name}  *` : name);
  };

  const rangeMap = ranges as Record<string, NumberRange | undefined>;
  for (const key of Object.keys(defaults)) {
    const range = rangeMap[key];
    const controller =
      typeof defaults[key] === 'number' && range
        ? folder.add(values, key, range.min, range.max, range.step)
        : folder.add(values, key);
    controller.onChange(() => {
      save(name, values, defaults);
      refreshTitle();
    });
  }

  const reset = (): void => {
    Object.assign(values, defaults);
    save(name, values, defaults);
    for (const c of folder.controllersRecursive()) c.updateDisplay();
    refreshTitle();
  };

  folder.add({ reset }, 'reset').name('reset to defaults');
  folder.add({ copy: () => copyJson({ [name]: values }) }, 'copy').name('copy as JSON');

  registry.set(name, { values, reset });
  refreshTitle();
  return values;
}

function getRootFolder(): GUI {
  if (rootFolder) return rootFolder;
  rootFolder = debug.gui.addFolder('Tuning');
  rootFolder
    .add(
      {
        copyAll: () => {
          const all: Record<string, TuningValues> = {};
          for (const [name, entry] of registry) all[name] = entry.values;
          copyJson(all);
        },
      },
      'copyAll',
    )
    .name('copy ALL as JSON');
  rootFolder
    .add(
      {
        resetAll: () => {
          for (const entry of registry.values()) entry.reset();
        },
      },
      'resetAll',
    )
    .name('reset ALL to defaults');
  return rootFolder;
}

function isModified(values: TuningValues, defaults: TuningValues): boolean {
  return Object.keys(defaults).some((k) => values[k] !== defaults[k]);
}

function loadOverrides(name: string, defaults: TuningValues): Partial<TuningValues> {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + name);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const result: Partial<TuningValues> = {};
    for (const [k, v] of Object.entries(parsed)) {
      // Ignore keys that no longer exist in code, or whose type changed.
      if (k in defaults && typeof v === typeof defaults[k]) result[k] = v as number | boolean;
    }
    return result;
  } catch {
    return {};
  }
}

function save(name: string, values: TuningValues, defaults: TuningValues): void {
  try {
    if (isModified(values, defaults)) localStorage.setItem(STORAGE_PREFIX + name, JSON.stringify(values));
    else localStorage.removeItem(STORAGE_PREFIX + name);
  } catch {
    // storage blocked (private mode etc.) - tuning still works for this session
  }
}

function copyJson(data: unknown): void {
  const json = JSON.stringify(data, null, 2);
  console.info('[tuning]\n' + json);
  navigator.clipboard?.writeText(json).catch(() => {
    // clipboard blocked - the console line above still has it
  });
}
