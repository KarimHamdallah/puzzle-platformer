"""
Builds MECHANIC 3 MEDIUM's ASCII map (scavenge & upgrade: one gas canister, two upgrades), printed as a
TypeScript array to paste into src/game/Levels.ts (M3_MEDIUM_MAP).

You have the spring boots (double jump: LevelData.grants). A sea cuts the way; falling in kills you.
The workbench before it can build BRACE BOOTS (dash: 2 steel wire + the gas) or BREATH PILLS (breathe
under water: 2 herbs + the gas). There is ONE gas canister: you choose how you cross.

Measured reach (sprinting): jump 6.2 tiles, + double jump 10.3, + dash ~14.5. Jump height 3.2,
+ double jump 5.6.

  x 1..12    start, bottles
  x 13..29   a pillar (wire 1 on top, double jump), a Clicker at its post with herbs behind it
  x 30..50   the Runner's yard (4-tile walls it can't jump): the gas on the floor, two ledges 5 up
             (out of its reach) with herbs and wire 2. Grab the gas, double jump to safety.
  x 52..58   checkpoint, the workbench, a step up to the pier
  x 59..62   the pier, 10 up
  x 63..102  the sea (water rows 18..25 over the floor):
             dash:  jump island to island: 12 tiles, 11 tiles and 3 up, 12 tiles and 3 down
             pills: drop in and walk the sea floor, hop two rocks, climb the stones at the far end
  x 103..116 the far shore (10 up), the exit

Usage: python -I tools/build_m3_medium_map.py
"""
W, H = 120, 30
GROUND = 26
SEA_X0, SEA_X1, SURFACE = 63, 102, 18

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

# start
put(3, 25, 'P')
put(10, 25, 'x')                  # bottles

# a pillar (5 up: double jump), wire 1 on top
fill(16, 21, 18, 25)
put(17, 20, 'I')

# a Clicker at its post, facing you, herbs behind it
put(24, 25, 'C')
put(27, 25, 'h')

# the Runner's yard: 4-tile walls (a Runner jumps 3.3), two ledges 5 up
fill(30, 22, 30, 25)
fill(50, 22, 50, 25)
put(40, 25, 'R')
put(43, 25, 'g')                  # THE gas canister: one in the level
fill(33, 21, 35, 21)
put(34, 20, 'h')
fill(45, 21, 47, 21)
put(46, 20, 'I')

# checkpoint + the workbench, a step (5 up), the pier (10 up)
put(52, 25, 'K')
put(54, 25, 'T')
fill(56, 21, 57, 21)
fill(59, 16, 62, 25)

# the islands: floating rocks 2 above the water
fill(75, 16, 77, 17)              # 12 tiles from the pier
fill(89, 13, 90, 14)              # 11 tiles on, 3 up
# the far shore: 12 tiles on, 3 down; the exit on top
fill(103, 16, 116, 25)
put(113, 15, 'E')

# under water: two rocks to hop on the sea floor, stones up to the far shore
fill(72, 24, 73, 25)
fill(84, 24, 85, 25)
fill(97, 23, 98, 25)              # 3 up
fill(100, 20, 102, 25)            # 3 more; the shore top is 4 above it (double jump)

# the water: every empty cell of the sea from the surface down
for y in range(SURFACE, GROUND):
    for x in range(SEA_X0, SEA_X1 + 1):
        if g[y][x] == '.':
            g[y][x] = '~'

rows = [''.join(r) for r in g]
assert all(len(r) == W for r in rows)
print('\n'.join("  '" + r + "'," for r in rows))
