"""
Builds the HARD level's ASCII map (Mechanic 1: noise & distraction, at night), printed as a TypeScript
array to paste into src/game/levels/Levels.ts (HARD_MAP).

Night: you see ~3.5 tiles around you. Clickers flash when they click; lightning lights everything for a
moment and its thunder covers your footsteps for 2 s. Stashes hold ONE bottle. The upgrade is Listen
Mode (hold Q): frozen, you hear every infected within 20 tiles, through walls.

  1. intro street (x 1..30): safe. A Clicker is sealed in a cellar under the street: hold Q to hear it.
  2. dark alley (x 31..75): 3-tile ceiling, a patrolling Clicker, a guardian Clicker facing you, a
     bottle for each (one outside, one inside). Hide from the patrol, lure, strike from behind.
  3. thunder yard (x 76..123): open sky, the guardian Runner and a patrolling Clicker. Cross the Clicker's
     hearing while the thunder rolls; stomp + punch the Runner.
  4. the watch (x 124..168): a Screamer on a step at the end of a low hall, three Clickers between you
     and her. One bad noise: she screams, the Clickers come to her, Runners arrive. Listen to time her
     turns, cross crate to crate, take her down from behind.

Same rules as the other levels: encounters under 3-tile ceilings can't be jumped over; nothing is a
softlock (every part ends at a checkpoint).

Usage: python -I tools/build_hard_map.py
"""
W, H = 170, 32
GROUND = 26

g = [['.'] * W for _ in range(H)]


def fill(x0, y0, x1, y1, c='#'):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            g[y][x] = c


def put(x, y, c):
    g[y][x] = c


fill(0, 0, 0, H - 1)
fill(W - 1, 0, W - 1, H - 1)
fill(1, GROUND, W - 2, H - 1)

# ---- 1: intro street (x 1..30) --------------------------------------------------------------------
put(3, 25, 'P')
fill(12, 27, 20, 29, '.')         # a sealed cellar under the street...
put(16, 29, 'C')                  # ...with a Clicker in it: harmless, the Listen Mode tutorial
put(28, 25, 'K')

# ---- 2: dark alley (x 31..75) ---------------------------------------------------------------------
# One bottle per Clicker in every part (stashes hold a single bottle at night).
put(31, 25, 'x')                  # bottle 1, outside
fill(33, 21, 73, 22)              # alley roof: interior rows 23..25 (covers the door)
put(37, 25, 'B')
put(44, 25, 'c')                  # patrolling Clicker: hide when it passes
put(46, 25, 'B')
put(47, 25, 'x')                  # bottle 2, by the crate (the patrol walks past it)
put(55, 25, 'B')
put(64, 25, 'B')
put(66, 25, 'C')                  # guardian Clicker facing you: lure it toward the door, strike its back
put(72, 25, 'D')
put(76, 25, 'K')

# ---- 3: thunder yard (x 76..123), open sky ------------------------------------------------------------
put(80, 25, 'x')
put(84, 25, 'B')
fill(88, 23, 90, 25)              # 3-high block: stomp launch point
put(89, 22, 'x')
put(92, 25, 'B')
put(97, 25, 'R')                  # guardian Runner
fill(101, 24, 101, 25)            # 2-high obstacle (turns the patrol)
put(104, 25, 'B')
put(108, 25, 'c')                 # patrolling Clicker: cross its hearing in the thunder
put(113, 25, 'B')
fill(121, 12, 121, 22)            # tall wall at the end of the yard...
put(121, 25, 'D')                 # ...with its door
put(124, 25, 'K')

# ---- 4: the watch (x 124..168) ----------------------------------------------------------------------
put(123, 25, 'x')
fill(126, 21, 166, 22)            # hall roof: interior rows 23..25
put(129, 25, 'B')
put(130, 25, 'x')                 # bottle 2 of 3 (one per Clicker in the hall)
put(133, 25, 'C')                 # Clicker at its post
put(136, 25, 'B')
put(137, 25, 'x')                 # bottle 3 of 3
put(140, 25, 'c')                 # patrolling Clicker
put(144, 25, 'B')
put(148, 25, 'C')                 # Clicker at its post
put(151, 25, 'B')
fill(155, 25, 161, 25)            # the Screamer's step (1 tile: she sees the hall floor)
put(158, 24, 'S')                 # the Screamer, facing left (down the hall); carries the last key
put(164, 25, 'D')
put(167, 25, 'E')

rows = [''.join(r) for r in g]
assert all(len(r) == W for r in rows)
print('\n'.join("  '" + r + "'," for r in rows))
