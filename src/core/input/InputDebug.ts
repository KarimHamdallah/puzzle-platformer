import Phaser from 'phaser';
import { debug } from '../debug/Debug';
import { ACTIONS } from './Actions';
import type { InputActions } from './InputActions';

/**
 * Debug view for an InputActions instance:
 *  - lil-gui folder "Input": live moveX / moveY, gamepad name, console logging, clear history.
 *  - overlay table: per-action held / press age / consumed / count / source, plus the last events.
 * Returns a cleanup function (called automatically when the scene shuts down).
 */
export function attachInputDebug(input: InputActions): () => void {
  const view = { moveX: 0, moveY: 0, gamepad: 'none', logToConsole: input.logToConsole };

  const folder = debug.gui.addFolder('Input');
  folder.add(view, 'moveX', -1, 1).listen().disable();
  folder.add(view, 'moveY', -1, 1).listen().disable();
  folder.add(view, 'gamepad').listen().disable();
  folder
    .add(view, 'logToConsole')
    .name('log events to console')
    .onChange((value: boolean) => {
      input.logToConsole = value;
    });
  folder.add({ clear: () => input.clearHistory() }, 'clear').name('clear history');

  const sync = (): void => {
    view.moveX = input.moveX;
    view.moveY = input.moveY;
    view.gamepad = input.gamepadId ?? 'none';
  };
  input.scene.events.on(Phaser.Scenes.Events.POST_UPDATE, sync);

  const removeSection = debug.addSection('Input', () => formatInput(input));

  return () => {
    input.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, sync);
    removeSection();
    folder.destroy();
  };
}

function formatInput(input: InputActions): string {
  const now = performance.now();
  const lines: string[] = [
    `moveX ${signed(input.moveX)}   moveY ${signed(input.moveY)}   pad: ${input.gamepadId ?? 'none'}`,
    '',
    'action     held   age ms   presses  source',
  ];

  for (const action of ACTIONS) {
    const s = input.state(action);
    const age = Number.isFinite(s.pressTime) ? String(Math.min(99999, Math.round(now - s.pressTime))) : '-';
    lines.push(
      `${action.padEnd(10)} ${s.held ? ' ##' : ' --'}   ${age.padStart(6)}${s.consumed ? '*' : ' '}  ${String(s.pressCount).padStart(7)}  ${s.lastSource}`,
    );
  }

  lines.push('* = press already consumed by a buffer', '', 'history (newest first)');
  for (const e of input.events) {
    const ago = `${Math.round(now - e.time)}ms ago`.padStart(10);
    lines.push(`f${String(e.frame).padEnd(6)} ${ago}  ${e.action.padEnd(9)} ${e.kind.padEnd(4)} ${e.source}`);
  }
  return lines.join('\n');
}

function signed(value: number): string {
  return (value >= 0 ? '+' : '') + value.toFixed(2);
}
