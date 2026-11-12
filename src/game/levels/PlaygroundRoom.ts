/**
 * Greybox room for tuning movement (tile units). Temporary: real levels will come from Tiled maps.
 * Each feature tests something specific in the controller.
 */
export interface SolidRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoomData {
  width: number;
  height: number;
  /** Player spawn: feet position in tiles. */
  spawn: { x: number; y: number };
  solids: SolidRect[];
}

export const PLAYGROUND_ROOM: RoomData = {
  width: 60,
  height: 24,
  spawn: { x: 3.5, y: 21 },
  solids: [
    // frame
    { x: 0, y: 0, w: 60, h: 1 }, // ceiling
    { x: 0, y: 0, w: 1, h: 24 }, // left wall
    { x: 59, y: 0, w: 1, h: 24 }, // right wall

    // ground
    { x: 1, y: 21, w: 20, h: 3 }, // floor A
    { x: 21, y: 23, w: 6, h: 1 }, // pit bottom (2 deep): tests coyote time at the pit edge
    { x: 27, y: 21, w: 14, h: 3 }, // floor B
    { x: 41, y: 19, w: 18, h: 5 }, // floor C: 2-tile step up

    // left staircase: short hops; the first one is low enough to bonk your head on
    { x: 5, y: 18, w: 4, h: 1 },
    { x: 10, y: 15, w: 4, h: 1 },
    { x: 15, y: 12, w: 4, h: 1 },

    // long platform over the pit: tests run-jump distance from the staircase
    { x: 21, y: 10, w: 8, h: 1 },

    // pillar on floor B: exactly 3 tiles tall -> needs a full (held) jump, a tapped jump fails
    { x: 33, y: 18, w: 2, h: 3 },

    // low tunnel on floor C: 1-tile gap, run under it without jumping
    { x: 47, y: 17, w: 3, h: 1 },

    // right climb: ledges with growing gaps
    { x: 43, y: 15, w: 3, h: 1 },
    { x: 51, y: 13, w: 3, h: 1 },
    { x: 55, y: 9, w: 3, h: 1 },
  ],
};
