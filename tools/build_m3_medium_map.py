"""
Builds MECHANIC 3 MEDIUM's ASCII map (scavenge & upgrade: one strap, two upgrades), printed as a
TypeScript array to paste into src/game/Levels.ts (M3_MEDIUM_MAP).

You have the spring boots (double jump). Ahead the way splits: a broken bridge up high, a subway full of
Clickers below. The workbench at the split can build BRACE BOOTS (dash: 2 wire + the strap) or RUBBER
SOLES (silent walking and landings: 2 rubber + the strap). There is ONE strap: you choose your route.

Measured reach (sprinting): jump 6.2 tiles, + double jump 10.3, + dash ~14.5. Jump height 3.2,
+ double jump 5.6.

  x 1..12    start, bottles
  x 13..29   a pillar (wire 1 on top, double jump), a Clicker at its post with rubber 1 behind it
  x 30..50   the Runner's yard (4-tile walls it can't jump): the strap on the floor, two ledges 5 up
             (out of its reach) with rubber 2 and wire 2. Grab the strap, double jump to safety.
  x 52..56   checkpoint, the workbench
  x 55..61   steps up to the bridge; the catwalk starts at 64 (4 up from the ground)
  upper      the bridge (row 10, 16 over the Clickers: they can't hear it): two 12-tile gaps, too wide
             without the dash. Its end drops to the subway floor by the exit
  lower      the subway: a catwalk 4 tiles over five Clickers, 3-tile gaps between its segments. Every
             landing is loud: without rubber soles they gather under you, right where you must drop
             down at the end: the exit is on the floor under the catwalk's last segment (x 101)

Usage: python -I tools/build_m3_medium_map.py
"""
W, H = 120, 30
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

# start
put(3, 25, 'P')
put(10, 25, 'x')                  # bottles

# a pillar (5 up: double jump), wire 1 on top
fill(16, 21, 18, 25)
put(17, 20, 'I')

# a Clicker at its post, facing you, rubber 1 behind it
put(24, 25, 'C')
put(27, 25, 'M')

# the Runner's yard: 4-tile walls (a Runner jumps 3.3), two ledges 5 up
fill(30, 22, 30, 25)
fill(50, 22, 50, 25)
put(40, 25, 'R')
put(43, 25, 'U')                  # THE strap: one in the level
fill(33, 21, 35, 21)
put(34, 20, 'M')
fill(45, 21, 47, 21)
put(46, 20, 'I')

# checkpoint + the workbench at the split
put(52, 25, 'K')
put(54, 25, 'T')

# steps up to the bridge (row 10: 16 over the subway floor, out of earshot even sprinting, 14)
fill(56, 21, 58, 21)              # 5 up from the ground
fill(60, 17, 61, 17)              # 4 up
fill(55, 13, 56, 13)              # 4 up, back left
fill(60, 10, 72, 10)              # the bridge: 3 up and 3 across from the last step

# upper route: two 12-tile gaps (73..84, 91..102)
fill(85, 10, 90, 10)
fill(103, 10, 109, 10)

# lower route: the catwalk over the subway (3-tile gaps), five Clickers below
for x0, x1 in ((64, 68), (72, 75), (79, 82), (86, 89), (93, 96), (100, 103)):
    fill(x0, 22, x1, 22)
for x in (66, 74, 81, 88, 95):
    put(x, 25, 'C')

# the exit: on the subway floor right under the catwalk's end, where a noisy climber's Clickers gather.
# The bridge route drops from its last segment (103..109) and walks back to it.
put(101, 25, 'E')
fill(112, 1, W - 2, 25)           # the end of the line; 110..111: the shaft down from the bridge's end

rows = [''.join(r) for r in g]
assert all(len(r) == W for r in rows)
print('\n'.join("  '" + r + "'," for r in rows))
