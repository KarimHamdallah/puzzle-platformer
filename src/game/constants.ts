import type { TextStyle } from '../engine';

/** One tile in world pixels. All gameplay tuning is in tiles, so changing this rescales the game. */
export const TILE = 64;

/** Every pixel-art asset is drawn at 2x: 32 px tiles -> 64 px, 96 px character frames -> 192 px. */
export const ART_SCALE = 2;

export const CREAM = '#f0e6c8';
export const GOLD = '#ffd24a';

/** The game's text look: Georgia with a black outline. */
export function Serif(size: number, style: string = 'bold', color: string = CREAM, outline: number = 5): TextStyle {
  return { family: 'Georgia, serif', size: size, style: style, color: color, stroke: '#000000', strokeThickness: outline };
}
