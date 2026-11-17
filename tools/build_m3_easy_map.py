"""
Builds MECHANIC 3 EASY's ASCII map (scavenge & upgrade: the spring boots), printed as a TypeScript
array to paste into src/game/levels/Levels.ts (M3_EASY_MAP).

You start at the workbench, under a cliff too high to jump (5 tiles; a jump is 3.2). The bench shows
a sketch: boots on springs = a double jump, from 2 springs and a leather strap. The parts are west:

  x 61..76   start, the workbench, the cliff (needs the double jump)
  x 36..53   a rubble hill: spring 1 on its top (plain platforming)
  x 18..35   a Clicker paces around x 23, spring 2 behind it at 18; bottles on the hill's foot (37)
  x 3..15    a pit: a Clicker at its post, the strap behind it (lure it, take it down from behind)
  x 77..105  past the cliff: a step and a 4-tile wall (double jump from the step), the exit

Usage: python -I tools/build_m3_easy_map.py
"""
W, H = 108, 30
GROUND = 26

g = [['.'] * W for _ in range(H)]


def fill(x0, y0, x1, y1, c='#'):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            g[y][x] = c


def dig(x0, y0, x1, y1):
    fill(x0, y0, x1, y1, '.')


def put(x, y, c):
    g[y][x] = c


fill(0, 0, 0, H - 1)
fill(W - 1, 0, W - 1, H - 1)
fill(1, GROUND, W - 2, H - 1)

# start + workbench + the cliff
put(61, 25, 'P')
put(64, 25, 'T')
fill(68, 21, 76, 25)              # 5 tiles high

# the rubble hill (2-tile steps both ways), spring 1 on top
fill(52, 24, 53, 25)
fill(48, 22, 51, 25)
fill(44, 20, 47, 25)
put(45, 19, 'O')
fill(40, 22, 43, 25)
fill(36, 24, 39, 25)
put(37, 23, 'x')                  # bottles, before the Clicker

# a Clicker pacing 3 tiles either side of x 23 (its far end is 9 tiles from where the hill drops you:
# landings are loud, 8 tiles), spring 2 just past it: lure it, take it down from behind
put(23, 25, 'c')
put(18, 25, 'O')

# the pit: the strap behind a Clicker at its post (facing left, its back to you)
dig(3, 26, 15, 27)
put(5, 27, 'U')
put(11, 27, 'C')

# past the cliff
fill(86, 23, 87, 25)              # a step...
fill(88, 19, 92, 25)              # ...and a wall 4 above it: double jump from the step
put(102, 25, 'E')

rows = [''.join(r) for r in g]
assert all(len(r) == W for r in rows)
print('\n'.join("  '" + r + "'," for r in rows))
