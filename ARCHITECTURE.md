# Architecture

The project is two parts: a small **engine** (`src/engine`) and the **game** (`src/game`) built on it.

```
┌──────────────────────────── src/game ─────────────────────────────┐
│ main.ts (in src/)   registers the states, engine.Run(Menu)        │
│ states/      MenuState, PlaygroundState, StateId                  │
│ levels/      BaseLevel, LevelMap, Levels (data),                  │
│              Mechanic1/2/3 (the 9 level classes)                  │
│ entities/    Player, Zombie, Sniper, Helicopter                   │
│ systems/     Noise, Throwing, Locks, Smoke, Molotov, Blackout,    │
│              Upgrades (scavenge + workbench)                      │
│ ui/          Dialogue, Letter                                     │
│ Actions, Assets, constants                                        │
└───────────────────────────────┬───────────────────────────────────┘
                                │ uses only the engine
┌──────────────────────────── src/engine ───────────────────────────┐
│ Engine (game loop + Clock)   StateMachine   Input   Assets  Audio │
│ Renderer   Camera   CameraFollow   Tween   Animation              │
│ physics/ (Body, PhysicsWorld)  math/ (Vec2, Rect, MathUtil)       │
│ debug/ (DebugDraw, DebugPanel)                                    │
└───────────────────────────────┬───────────────────────────────────┘
                                │ the only code that sees Phaser
                            Phaser 3 (WebGL drawing, requestAnimationFrame, loader, sound)
```

## The rule

- Only `src/engine` imports `phaser`. The game imports everything from `src/engine/index.ts`.
- The engine never imports the game, so another game could use it as it is.
- `npm run check` (also part of `npm run build`) fails if either rule is broken.

## The game loop (`Engine.Frame`)

Phaser calls the engine once per browser frame with the elapsed time. Everything between that call
and the drawing is our code:

```
Frame(dtMs):
  dt = min(dtMs / 1000, 0.25) * timeScale       a long stall can't explode the physics
  debug.BeginFrame()                            last frame's debug drawing is wiped
  input.Poll()                                  latch this frame's key presses
  accumulator += dt
  while accumulator >= 1/60:                    fixed 60 Hz, whatever the screen's refresh rate
      states.FixedUpdate(1/60)                  gameplay: AI, player control -> velocities
      physics.Step(1/60)                        move bodies, collide, write contacts
      accumulator -= 1/60
  tweens.Update(dt); animations.Update(dt); clock.Update(dt)
  states.Update(dt)                             visuals, HUD, menus, camera follow
  camera.Update(dt)                             shake, fade, flash
  states.ApplyPendingChange()                   a state switch happens between frames
```

While a dialogue, a letter or the workbench is open, `physics.paused` is true and the fixed steps
don't run: the world stands still, the UI keeps working.

## States and levels

`StateMachine` runs one `GameState` at a time: `OnStart(data)`, `OnFixedUpdate(dt)`,
`OnUpdate(dt)`, `OnDestroy()`. States are registered as factories, so every start (a new level, a
restart after a death) builds a **new** object. When a state ends, the engine destroys everything it
made: visuals, bodies, tweens, animators, timers.

Levels: `BaseLevel` holds what every level has (map, player, zombies, bottles, noise, doors and
keys, checkpoints, exit, HUD, cheats, death and restart). Each level class adds only its mechanic
through hooks: `OnLevelCreate`, `SpawnTile`, `OnLevelStart`, `CreateLevelHud`, `OnLevelInput`,
`OnLevelFixedUpdate`, `OnLevelUpdate`, `OnCheckpoint`, `OnRestart`, `OnCheat`, `OnIntroDone`.

| Class | Adds |
|---|---|
| `M1Easy`, `M1Hard` | nothing: the base plus their data (Hard: night, Listen Mode) |
| `M1Medium` | the Molotov quest, the horde, the Molotov HUD |
| `M2Easy` | the snipers |
| `SmokeLevel` (abstract) | smoke grenades, their HUD, Tab to choose |
| `M2Medium` | snipers + smoke + the scaffolding that appears |
| `M2Hard` | the helicopter + smoke, checkpoint smoke, restart rules |
| `ScavengeLevel` (abstract) | parts, workbench, upgrades, water, breath pills |
| `M3Easy/Medium/Hard` | only their data |

## Physics (`engine/physics`)

Axis-aligned boxes, used like Box2D: `CreateBody({ type, x, y, w, h })`, `body.SetVelocity()`,
`world.Step(dt)`, `body.contacts.down`.

- Static bodies never move (walls, floors, doors). `LevelMap` merges solid tiles into rectangles:
  a straight wall is one body.
- `Step`: for each dynamic body, `velocity += gravity * gravityScale * dt`, then move on X and push
  out of any static body it now overlaps, then the same on Y. Moving one axis at a time means a body
  sliding along a wall never catches on a seam, and a body on a floor touches it without overlapping.
- The player and the zombies apply their own gravity (`gravityScale: 0`): the player's jump has
  variable gravity (jump cut, apex hang, fast fall).
- Queries: `QueryBox(rect)` ("can I stand up here?", the zombies' wall and ledge probes) and
  `RayCast(from, to)` (line of sight, with the slab method).

Measured with the bots after the port, the same as before it: jump 3.21 tiles high, with double jump
5.59, sprint jump 6.23 tiles long, and jump + double jump + dash crosses the 12-tile sea gaps.

## Rendering, camera, tweens, animation

- `Renderer` creates handles: `Sprite`, `Text`, `Shape`, `Group`, `TileLayer`, `TilingImage`,
  `HtmlNode`, `Canvas`, and particle bursts. `SetFixed()` = screen space (HUD). Depth = a number.
- `Camera`: scroll, bounds, our own shake / fade / flash, grayscale. `CameraFollow`: a Cinemachine
  style dead zone / soft zone / look-ahead rig that follows a body.
- `TweenSystem.To(target, { prop: value }, seconds, { ease, delay, yoyo, repeat, onDone })`:
  `value = start + (end - start) * ease(t)`.
- `AnimationSystem`: clips (sheet, fps, loop / yoyo), an `Animator` per sprite advances frames.

## Math and debugging

- `Vec2` (Add, Sub, Scale, Dot, Length, Normalized, DistanceTo, Lerp, MoveTowards), `Rect`
  (Contains, Overlaps, Inflated), `MathUtil` (Clamp, Lerp, MoveTowards, Smoothing, RandomRange...).
- `DebugDraw`: immediate mode, in world space: `Line`, `Ray`, `Box`, `Circle`, `Point`, `Text`. What
  you draw this frame shows this frame only. Used by the zombie overlay (senses, where it is going,
  line of sight), the player's jump trail, the physics bodies and the snipers' line of fire
  ("show hitboxes").
- `DebugPanel` (lil-gui, backtick toggles it) with `TuningFolder` sliders saved in localStorage.

## Adding a level

1. Draw the map with a script in `tools/`, paste it into `levels/Levels.ts` with its `LevelData`.
2. Add a class in the right `MechanicN.ts` (override the hooks it needs).
3. Add a `StateId`, register it in `main.ts`, add a card in `MenuState`.
