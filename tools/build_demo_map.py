"""
Builds the demo level's ASCII map (printed as a TypeScript array to paste into DemoScene.ts).

Design rules (player jump 3.2 tiles up, ~3 across walking; Runner jump 3.3, so no ledge is safe):
  - Running away is not an escape. COVER CRATES are: crouched behind one you are invisible and
    untouchable, so every threat has crates placed where you need them, not as decoration.
  - Crates under the Screamer's eye are spaced so a sneak between two of them (~5 tiles at 2.2 tiles/s
    = ~2.3 s) fits inside one of her 4 s look-aways.
  - Gaps on walking routes are at most 2 tiles (sprinting is loud).
  - Anywhere you can fall has a way back up (no softlocks).

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

# ---- A: Clicker corridor (x 1..34) ---------------------------------------------------------
# Lesson: a Clicker hunts what it hears. Hide behind a crate while it walks past, or lure it with a
# bottle and sneak up behind it while it listens (the only time it can be taken down).
put(3, 25, 'P')
put(6, 25, 'x')                 # stash before the first Clicker
put(10, 25, 'B')                # practice crate (toggle crouch behind it)
fill(13, 24, 13, 25)            # corridor wall (2 high)
put(17, 25, 'B')                # crate near the entrance: hide here as it patrols toward you
put(27, 25, 'B')                # crate near the far end: hide again on the way out
put(22, 25, 'c')                # patrolling Clicker between the two walls
fill(32, 24, 32, 25)            # corridor wall (2 high)
put(35, 25, 'K')

# ---- B: Runner yard (x 36..86) -------------------------------------------------------------
# Lesson: you can't outrun or out-climb the Runner. Break its line of sight behind a crate, or stomp it
# (jump on its head) and punch it while it's dizzy.
put(38, 25, 'x')
put(44, 25, 'B')
fill(48, 25, 48, 25)            # 1-high obstacle
put(52, 25, 'B')
fill(55, 23, 57, 25)            # 3-high block: a launch point for a stomp (the Runner can follow)
put(56, 22, 'x')                # stash on the block
put(61, 25, 'R')
put(64, 25, 'B')
fill(68, 24, 69, 25)            # 2-high obstacle
put(74, 25, 'B')
put(79, 25, 'x')
fill(84, 23, 86, 25)            # 3-high exit wall
put(89, 25, 'K')

# ---- C: three-floor building (x 90..131) -------------------------------------------------------
# Lesson: sound travels between floors. One Clicker per floor, crates on every floor.
fill(90, 24, 90, 25)            # doorstep (2 high)
put(93, 25, 'x')
put(98, 25, 'B')
put(105, 25, 'c')               # ground-floor Clicker
put(116, 25, 'B')
fill(131, 15, 131, 25)          # building's right wall
fill(126, 23, 128, 23)          # step up to floor 2 (right side)
fill(93, 20, 125, 20)           # floor 2
put(101, 19, 'B')
put(110, 19, 'c')               # floor-2 Clicker
put(119, 19, 'B')
fill(92, 17, 94, 17)            # step up to floor 3 (left side)
put(93, 16, 'x')                # stash on the step platform
fill(95, 14, 140, 14)           # floor 3, continues out as the first rooftop
put(106, 13, 'B')
put(112, 13, 'C')               # floor-3 Clicker at its post, facing left
put(121, 13, 'B')
fill(116, 11, 118, 11)          # perch above floor 3

# ---- D: rooftops + Screamer (x 131..199) --------------------------------------------------
# Lesson: the Screamer turns every 4 s ("?" first). Crate to crate during her look-aways, or distract
# her with a bottle; take her down from behind. A Runner guards the exit and comes when she screams.
put(134, 13, 'K')
fill(141, 14, 150, 14)          # rooftop (continues from floor 3)
fill(153, 14, 175, 14)          # rooftop after a 2-tile gap
fill(178, 14, 197, 14)          # last rooftop after a 2-tile gap
put(155, 13, 'x')
put(156, 13, 'K')
put(159, 13, 'B')
put(164, 13, 'B')
put(169, 13, 'B')
put(174, 13, 'B')
put(180, 13, 'x')
put(181, 13, 'B')
put(185, 13, 'B')
put(190, 13, 'S')               # Screamer: lookout turning around, facing left first
put(195, 13, 'R')               # Runner guarding the exit
put(197, 13, 'E')               # exit
put(145, 25, 'x')               # street below the rooftops
put(150, 25, 'c')
put(172, 25, 'B')
put(184, 25, 'c')
fill(160, 23, 162, 23)          # stairs back up from the street (no softlock)
fill(164, 20, 166, 20)
fill(168, 17, 170, 17)

rows = [''.join(r) for r in g]
assert all(len(r) == W for r in rows)
print('\n'.join("  '" + r + "'," for r in rows))
