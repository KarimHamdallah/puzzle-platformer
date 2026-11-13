"""
Builds the demo level's ASCII map (printed as a TypeScript array to paste into DemoScene.ts).
Design rules used here (player jump = 3.2 tiles up; walking jump ~3 tiles across; Runner jump = 2.5):
  - a 3-tile step is climbable by the player and NOT by the Runner (safe perches, Runner-proof exits)
  - gaps on routes you walk are at most 2 tiles (sprinting is loud)
  - every place you can fall into has a way back up (no softlocks)

Usage: python -I tools/build_demo_map.py
"""
W, H = 200, 30
GROUND = 26  # top row of the street level

g = [['.'] * W for _ in range(H)]


def fill(x0, y0, x1, y1, c='#'):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            g[y][x] = c


def put(x, y, c):
    g[y][x] = c


# frame + street level
fill(0, 0, 0, H - 1)
fill(W - 1, 0, W - 1, H - 1)
fill(1, GROUND, W - 2, H - 1)

# ---- A: Clicker corridor (x 1..34) --------------------------------------------------
put(3, 25, 'P')
put(7, 25, 'x')                 # stash before the first Clicker
put(10, 25, 'B')                # cover crate to practise hiding
fill(13, 24, 13, 25)            # corridor wall (2 high)
fill(32, 24, 32, 25)            # corridor wall (2 high)
fill(16, 23, 19, 23)            # perch over the Clicker's path
fill(26, 23, 29, 23)            # second perch
put(22, 25, 'c')                # patrolling Clicker between the two walls
put(35, 25, 'K')                # checkpoint

# ---- B: Runner yard (x 36..86) --------------------------------------------------------
put(38, 25, 'x')
fill(47, 25, 47, 25)            # 1-high obstacle
fill(54, 23, 57, 25)            # 3-high block: safe perch (Runner can't climb it)
put(56, 22, 'x')                # stash on the perch
fill(70, 24, 71, 25)            # 2-high obstacle (the Runner jumps it)
put(63, 25, 'R')
fill(84, 23, 86, 25)            # 3-high exit wall: Runner-proof
put(89, 25, 'K')

# ---- C: three-floor building (x 90..131) ------------------------------------------------
fill(90, 24, 90, 25)            # doorstep (2 high)
put(93, 25, 'x')
fill(131, 15, 131, 25)          # building's right wall
put(105, 25, 'c')               # ground-floor Clicker
fill(126, 23, 128, 23)          # step up to floor 2 (right side)
fill(93, 20, 125, 20)           # floor 2
put(110, 19, 'c')               # floor-2 Clicker
fill(92, 17, 94, 17)            # step up to floor 3 (left side)
fill(95, 14, 140, 14)           # floor 3, continues out as the first rooftop
fill(108, 11, 110, 11)          # perch above floor 3: wait here while the Clicker walks back under you
put(101, 13, 'C')               # floor-3 Clicker at its post, facing left
put(93, 16, 'x')                # stash on the step platform (row 16 sits on the platform at row 17)

# ---- D: rooftops + Screamer (x 131..199) ---------------------------------------------
put(134, 13, 'K')
fill(141, 14, 150, 14)          # rooftop (continues from floor 3)
fill(153, 14, 175, 14)          # rooftop after a 2-tile gap
fill(178, 14, 197, 14)          # last rooftop after a 2-tile gap
put(155, 13, 'x')
put(156, 13, 'K')
put(160, 13, 'B')
put(168, 13, 'B')
put(182, 13, 'B')
put(187, 13, 'S')               # Screamer: lookout turning around, facing left first
put(195, 13, 'R')               # Runner guarding the exit
put(197, 13, 'E')               # exit
put(150, 25, 'c')               # street Clickers under the rooftops
put(184, 25, 'c')
fill(160, 23, 162, 23)          # stairs back up from the street (no softlock)
fill(164, 20, 166, 20)
fill(168, 17, 170, 17)
put(145, 25, 'x')

rows = [''.join(r) for r in g]
assert all(len(r) == W for r in rows)
print('\n'.join("  '" + r + "'," for r in rows))
