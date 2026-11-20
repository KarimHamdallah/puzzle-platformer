import type { Input } from '../engine';

/** Logical actions. Game code asks for actions, never for keys. */
export enum Action {
  Left,
  Right,
  Up, // aim: raise the throw arc
  Down, // ground: crouch / sneak. air: fast fall. aim: lower the arc
  Jump, // also confirms in menus
  Sprint,
  Throw, // hold to aim, release to throw
  Attack, // melee: stunned Runners, takedowns from behind
  Reset,
  Back, // leave the level for the level select
  Listen, // hold: Listen Mode (Hard level's upgrade)
  Swap, // smoke levels: switch the next throw between bottle and smoke grenade
  Num1, // the cheat toggle (every level)
  Num2, // dev shortcut (Mechanic 1 Medium, debug builds): next coloured key, then the rag
  Count, // number of actions, keep last
}

/** Key -> action. Keys are KeyboardEvent.code = PHYSICAL keys, so they still work with an Arabic layout. */
const KEY_BINDINGS: [string, Action][] = [
  ['ArrowLeft', Action.Left],
  ['KeyA', Action.Left],
  ['ArrowRight', Action.Right],
  ['KeyD', Action.Right],
  ['ArrowUp', Action.Up],
  ['KeyW', Action.Up],
  ['ArrowDown', Action.Down],
  ['KeyS', Action.Down],
  ['KeyC', Action.Down],
  ['Space', Action.Jump],
  ['KeyZ', Action.Jump],
  ['KeyK', Action.Jump],
  ['Enter', Action.Jump],
  ['NumpadEnter', Action.Jump],
  ['ShiftLeft', Action.Sprint],
  ['ShiftRight', Action.Sprint],
  ['KeyE', Action.Throw],
  ['KeyF', Action.Throw],
  ['KeyX', Action.Attack],
  ['KeyJ', Action.Attack],
  ['KeyR', Action.Reset],
  ['Escape', Action.Back],
  ['KeyQ', Action.Listen],
  ['Tab', Action.Swap],
  ['Digit1', Action.Num1],
  ['Digit2', Action.Num2],
];

/** Once, before the engine runs. */
export function BindKeys(input: Input): void {
  input.Init(Action.Count);
  for (let i = 0; i < KEY_BINDINGS.length; i++) input.Bind(KEY_BINDINGS[i][0], KEY_BINDINGS[i][1]);
}

/** Action names for the debug panel. */
export function ActionNames(): string[] {
  const names: string[] = [];
  for (let a = 0; a < Action.Count; a++) names.push(Action[a]);
  return names;
}

/** -1, 0 or +1: left / right, the most recent press wins. */
export function MoveX(input: Input): number {
  return input.Axis(Action.Left, Action.Right);
}
