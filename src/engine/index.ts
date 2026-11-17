/**
 * The engine's public API: the game imports everything from here (like including "Engine.h").
 * Nothing in this folder imports the game; nothing in the game imports 'phaser'.
 */
export { Engine, Clock, type EngineConfig } from './Engine';
export { GameState, StateMachine, type StateFactory } from './StateMachine';
export { Input } from './Input';
export { Assets } from './Assets';
export { Audio } from './Audio';
export {
  Renderer, Visual, Sprite, Text, Shape, Group, TileLayer, TilingImage, HtmlNode, Canvas,
  type TextStyle, type BurstDef,
} from './Renderer';
export { Camera } from './Camera';
export { CameraFollow } from './CameraFollow';
export { TweenSystem, Ease, type TweenOptions } from './Tween';
export { AnimationSystem, Animator, type AnimClip } from './Animation';
export { PhysicsWorld, type RayHit } from './physics/PhysicsWorld';
export { Body, BodyType, Contacts, type BodyDef } from './physics/Body';
export { Vec2 } from './math/Vec2';
export { Rect } from './math/Rect';
export * as MathUtil from './math/MathUtil';
export { DebugDraw } from './debug/DebugDraw';
export { DEBUG_ENABLED, debugPanel, TuningFolder } from './debug/DebugPanel';
