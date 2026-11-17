"""
Builds MECHANIC 3 HARD's ASCII map (scavenge & upgrade: everything, in sequence), printed as a
TypeScript array to paste into src/game/levels/Levels.ts (M3_HARD_MAP).

You have the spring boots (double jump: LevelData.grants). This time there are TWO gas canisters: build
both upgrades, the route needs them one after the other.
  - A flooded tunnel under a rock ceiling (no jumping over it): only the BREATH PILLS get you through.
    Here a pill lasts 5 s (LevelData.pillTime), but air pockets ('a') on the way refill it.
  - Then an open sea with islands: only the BRACE BOOTS (dash + double jump) get you across. A Runner
    lives on the big island: stomp it, or be faster.

Measured reach (sprinting): jump 6.2 tiles, + double jump 10.3, + dash ~14.5. Jump height 3.2,
+ double jump 5.6. Sprint 8.5 tiles/s, walk ~4.5.

  x 1..32    start, bottles; a pillar (wire 1); two Clickers back to back: herbs 1 between them, gas 1 past
  x 33..55   the yard (4-tile walls): two Runners, gas 2 on the floor, ledges 5 up with herbs 2 / wire 2
  x 57..61   checkpoint, the workbench
  x 62..112  the flooded tunnel: rocks, two trenches, air pockets at 79..80 and 95..96 (~16 tiles apart)
  x 114..121 checkpoint, a step and the shore (10 up)
  x 122..167 the open sea: 12-tile gap, 11 and 3 up (the Runner's island), 12 and 3 down
  x 168..178 the far shore, the exit

Usage: python -I tools/build_m3_hard_map.py
"""
W, H = 182, 30
GROUND = 26
SURFACE = 18

g = [['.'] * W for _ in range(H)]


def fill(x0, y0, x1, y1, c='#'):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            g[y][x] = c


def put(x, y, c):
    g[y][x] = c


def flood(x0, x1, y0=SURFACE, y1=GROUND + 2):
    """Every empty cell in the box becomes water."""
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if g[y][x] == '.':
                g[y][x] = '~'


fill(0, 0, 0, H - 1)
fill(W - 1, 0, W - 1, H - 1)
fill(1, GROUND, W - 2, H - 1)

# --- the parts
put(3, 25, 'P')
put(8, 25, 'x')                   # bottles (3): two Clickers to lure
fill(13, 21, 15, 25)              # a pillar, 5 up
put(14, 20, 'I')                  # wire 1
put(21, 25, 'C')                  # facing you
put(24, 25, 'h')                  # herbs 1
put(27, 25, 'N')                  # facing away, toward gas 1
put(30, 25, 'g')                  # gas 1

fill(33, 22, 33, 25)              # the yard: 4-tile walls, a Runner jumps 3.3
fill(55, 22, 55, 25)
put(40, 25, 'R')
put(49, 25, 'R')
put(44, 25, 'g')                  # gas 2, on the floor between them
fill(36, 21, 38, 21)              # ledges 5 up
put(37, 20, 'h')                  # herbs 2
fill(46, 21, 47, 21)              # right by the gas: grab it, double jump up
fill(50, 21, 52, 21)
put(51, 20, 'I')                  # wire 2

put(57, 25, 'K')
put(59, 25, 'T')

# --- the flooded tunnel: a rock ceiling, the water under it
fill(62, 13, 112, 17)
fill(68, 24, 69, 25)              # a rock, 2 up
g[26][73:78] = ['.'] * 5          # a trench, 3 deep
g[27][73:78] = ['.'] * 5
g[28][73:78] = ['.'] * 5
fill(82, 23, 83, 25)              # a rock, 3 up
g[26][88:92] = ['.'] * 4          # another trench
g[27][88:92] = ['.'] * 4
g[28][88:92] = ['.'] * 4
fill(101, 23, 102, 25)            # a rock, 3 up
for x in (79, 80, 95, 96):        # air pockets: columns of trapped air, floor to ceiling
    for y in range(SURFACE, GROUND):
        g[y][x] = 'a'
flood(63, 110)

# --- the open sea
put(114, 25, 'K')
fill(116, 21, 117, 21)            # a step, 5 up
fill(119, 16, 121, 25)            # the shore, 5 more
fill(134, 16, 136, 17)            # island 1: 12 tiles out
fill(148, 13, 155, 14)            # island 2: 11 on, 3 up; its Runner
put(153, 12, 'R')
fill(168, 16, 178, 25)            # the far shore: 12 on, 3 down
put(175, 15, 'E')
flood(122, 167, SURFACE, GROUND - 1)

rows = [''.join(r) for r in g]
assert all(len(r) == W for r in rows)
print('\n'.join("  '" + r + "'," for r in rows))
