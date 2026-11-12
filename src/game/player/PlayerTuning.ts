import { createTuning } from '../../core/tuning/Tuning';

/**
 * Every movement number, in TILES and SECONDS (never pixels).
 * Gravity and jump speed are derived from jumpHeight + timeToApex, so designers tune what they feel.
 */
export const PLAYER_TUNING = createTuning(
  'player',
  {
    // horizontal
    runSpeed: 8.5, // tiles/s
    accelTime: 0.08, // s from 0 to full speed (ground)
    decelTime: 0.06, // s from full speed to 0 (ground, no input)
    turnTime: 0.05, // s to brake when pressing the opposite direction (ground)
    airAccelTime: 0.12,
    airDecelTime: 0.25,

    // jump
    jumpHeight: 3.2, // tiles, full held jump
    timeToApex: 0.36, // s
    fallGravityMult: 1.7, // falling is faster than rising = snappy, not floaty
    jumpCutGravityMult: 2.6, // release jump early while rising -> short hop (variable height)
    apexThreshold: 1.5, // tiles/s: near the top of the arc...
    apexGravityMult: 0.5, // ...gravity is reduced while jump is held = a little hang time
    maxFallSpeed: 15, // tiles/s
    fastFallSpeed: 22, // tiles/s while holding down
    fastFallGravityMult: 1.6,

    // forgiveness
    coyoteMs: 100, // can still jump this long after walking off a ledge
    jumpBufferMs: 120, // a jump pressed this long before landing still happens

    // presentation
    squash: 0.22, // squash & stretch strength (0 = off)
    ghostAlpha: 0.22, // takeoff shadow opacity (0 = off)
  },
  {
    runSpeed: { min: 1, max: 20, step: 0.1 },
    accelTime: { min: 0, max: 0.6, step: 0.01 },
    decelTime: { min: 0, max: 0.6, step: 0.01 },
    turnTime: { min: 0, max: 0.6, step: 0.01 },
    airAccelTime: { min: 0, max: 1, step: 0.01 },
    airDecelTime: { min: 0, max: 1, step: 0.01 },
    jumpHeight: { min: 0.5, max: 8, step: 0.1 },
    timeToApex: { min: 0.1, max: 1, step: 0.01 },
    fallGravityMult: { min: 0.5, max: 4, step: 0.05 },
    jumpCutGravityMult: { min: 1, max: 6, step: 0.1 },
    apexThreshold: { min: 0, max: 6, step: 0.1 },
    apexGravityMult: { min: 0.1, max: 1, step: 0.05 },
    maxFallSpeed: { min: 2, max: 40, step: 0.5 },
    fastFallSpeed: { min: 2, max: 50, step: 0.5 },
    fastFallGravityMult: { min: 1, max: 4, step: 0.1 },
    coyoteMs: { min: 0, max: 300, step: 5 },
    jumpBufferMs: { min: 0, max: 300, step: 5 },
    squash: { min: 0, max: 0.6, step: 0.01 },
    ghostAlpha: { min: 0, max: 1, step: 0.01 },
  },
);

/** Gravity (px/s²) and jump launch speed (px/s) derived from the tuning, for a given tile size. */
export function jumpPhysics(tile: number): { gravity: number; jumpSpeed: number } {
  const h = PLAYER_TUNING.jumpHeight * tile;
  const t = PLAYER_TUNING.timeToApex;
  return { gravity: (2 * h) / (t * t), jumpSpeed: (2 * h) / t };
}
