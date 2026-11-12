/** Render resolution. Everything is drawn at 1920x1080 and scaled to the window. */
export const GAME_WIDTH = 1920;
export const GAME_HEIGHT = 1080;

/** One tile in pixels. All gameplay tuning is in tiles, so changing this rescales the game. */
export const TILE = 64;

/** Greybox palette (matches the reference screenshot: green room, red solids, white player). */
export const COLORS = {
  background: 0x4f9d6f,
  solid: 0xff4646,
  player: 0xffffff,
  playerEyes: 0x9e9e9e,
  ghost: 0x000000,
} as const;
