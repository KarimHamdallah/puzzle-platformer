/**
 * Scalar math helpers, used like a C++ namespace:  import * as MathUtil from '.../MathUtil';
 * then MathUtil.Clamp(x, 0, 1).
 */

export function Clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** a + (b - a) * t */
export function Lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Step from current toward target by at most maxDelta, never past it. */
export function MoveTowards(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

/** -1, 0 or +1. */
export function Sign(value: number): number {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

export function Distance(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

/** A random number in [min, max). */
export function RandomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Exponential smoothing for this frame, frame-rate independent: x += (target - x) * Smoothing(dt, tau).
 * tau = time constant in s (after tau seconds ~63% of the gap is closed). tau <= 0: snap at once.
 */
export function Smoothing(dt: number, tau: number): number {
  return tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
}

export function DegToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
