"""
Builds the demo level's ASCII map (printed as a TypeScript array to paste into DemoScene.ts).

Design rules (player: 1.8 tiles tall, jumps 3.2; Clicker 1.85 tall; Runner jumps 3.3, runs faster
than your sprint):
  - ENCOUNTERS HAPPEN UNDER A 3-TILE CEILING. 1.8 + 1.85 = 3.65 > 3, so jumping over a zombie in there
    is physically impossible and there is no way around: the encounter has to be solved (lure, hide,
    take down). Open sky is for movement and Runner fights.
  - Running away is not an escape. COVER CRATES are: crouched behind one you are invisible and
    untouchable, so every encounter has crates where you need them.
  - Crates under the Screamer's eye are spaced so a sneak between two fits one of her look-aways.
  - Gaps on walking routes are at most 2 tiles (sprinting is loud: 14 tiles).
  - Anywhere you can fall has a way back up (the street leads back into the building).

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

# ---- A: the tunnel (x 1..34) --------------------------------------------------------------
# A Clicker stands in a tunnel with a 3-tile ceiling: you can't jump over it. Walking is heard 8
# tiles away. Hide behind a crate while it hunts past you, or lure it with a LOW throw (the ceiling)
# and take it down from behind while it listens.
put(3, 25, 'P')
put(4, 25, 'x')                 # stash before the tunnel
put(9, 25, 'B')                 # practice crate (toggle crouch behind it)
fill(13, 21, 34, 22)            # tunnel roof: interior rows 23..25 = 3 tiles (covers the door too)
# THE FATHER'S LETTER, above the tunnel: a short climb (3-tile jumps, 1-2 tile gaps) to a dead man
# sitting against a ruined wall. His letter is the game's guide. The wall (top row 12, out of reach
# from the ledge) stops anyone walking along the roof past door 1. Everything up here is more than 8
# tiles from the tunnel Clicker: walking on the roof is not heard.
fill(6, 23, 7, 23)              # ledge 1 (ground 26 -> 23); walking under it on the ground still fits
fill(9, 20, 10, 20)             # ledge 2 (23 -> 20, 1-tile gap)
#                                 ledge 2 -> tunnel roof (21): 2-tile gap, 1 down
fill(14, 18, 17, 18)            # the father's ledge (roof 21 -> 18, jump from the roof's left end)
fill(18, 12, 18, 20)            # ruined wall on the roof
put(17, 17, 'L')                # the father, his back against the wall
put(17, 25, 'B')
put(25, 25, 'C')                # Clicker at its post in the tunnel, facing left; carries key 1
put(28, 25, 'B')
put(33, 25, 'D')                # locked door 1 at the tunnel exit
put(36, 25, 'K')

# ---- B: Runner yard (x 36..86), open sky ---------------------------------------------------------
# The Runner is faster than your sprint and jumps higher than you: break its line of sight behind a
# crate, or stomp it (jump on its head) and punch it while it's dizzy.
put(38, 25, 'x')
put(44, 25, 'B')
fill(48, 25, 48, 25)            # 1-high obstacle
put(52, 25, 'B')
fill(55, 23, 57, 25)            # 3-high block: a launch point for a stomp
put(56, 22, 'x')                # stash on the block
put(61, 25, 'R')                # yard Runner; carries key 2
put(64, 25, 'B')
fill(68, 24, 69, 25)            # 2-high obstacle
put(74, 25, 'B')
put(79, 25, 'x')
fill(84, 14, 84, 22)            # 12-tile wall at the end of the yard (no jumping over it)...
put(84, 25, 'D')                # ...with locked door 2 at its foot
put(89, 25, 'K')

# ---- C: three-floor building (x 90..130), every floor 3 tiles high ------------------------
# Sound travels between floors (they're only 3 tiles apart). One Clicker per floor, crates on every
# floor, no room to jump over anyone.
# STAIRWELL on the building's LEFT, under open sky (the side you arrive from). Under a 3-tile ceiling a
# jump only lifts the feet 1.2 tiles, so every big climb happens here, never inside a floor:
#   ground (26) -> step (24): 2-tile jump        step -> landing 1 (22): 2-tile jump
#   landing 1 is floor 2 itself, extended out under the sky: walk right onto floor 2, no jump
#   floor 2 at x 93 (no ceiling) -> landing 2 (19): 3-tile jump, drift left
#   landing 2 -> floor 3 (18): hop right across a 1-tile gap (2 tiles was too tight for a walking jump)
# (First version stacked landing 2 three tiles above landing 1: the jump between landing 1 and floor 2
#  was capped at 1.2 tiles and the feet cleared the edge too briefly to get on. Found by playtesting.)
fill(87, 24, 88, 24)            # step
fill(90, 22, 129, 22)           # floor 2 slab (x 90..92 = landing 1); ground floor interior rows 23..25
fill(90, 19, 92, 19)            # landing 2
put(91, 18, 'x')                # stash on landing 2
fill(130, 19, 130, 22)          # building right wall above the ground floor (the street door stays open)
put(99, 25, 'B')
put(105, 25, 'c')               # ground-floor Clicker (patrols)
put(118, 25, 'B')
put(101, 21, 'B')
put(110, 21, 'c')               # floor-2 Clicker (patrols)
put(118, 21, 'B')
fill(94, 18, 129, 18)           # floor 3 slab (starts at 94: floor 2 keeps x 93 open to the sky)
fill(94, 14, 130, 14)           # building roof: floor 3 interior rows 15..17 (covers the door too)
put(106, 17, 'B')
put(112, 17, 'C')               # floor-3 Clicker at its post, facing left; carries key 3
put(121, 17, 'B')
put(130, 17, 'D')               # locked door 3: floor 3 -> rooftops (the street has no way up). Takes 3 keys,
#                                 one from each floor's Clicker (DemoScene DOOR_KEYS): no floor can be skipped

# ---- D: rooftops (x 130..199) -------------------------------------------------------------
# Open rooftops with a Runner and crates, then the Screamer inside a low shack guarding the exit:
# no jumping over her. Wait for her look-away, crate to crate, distract her with a low throw, take her
# down from behind. Her scream sets the rooftop Runner on you.
fill(130, 18, 150, 18)          # first rooftop (continues from floor 3)
put(134, 17, 'K')
fill(153, 18, 175, 18)          # second rooftop after a 2-tile gap
put(155, 17, 'x')
put(157, 17, 'K')
put(160, 17, 'B')
put(165, 17, 'B')
put(167, 17, 'R')               # rooftop Runner
put(170, 17, 'B')
put(174, 17, 'B')
fill(178, 18, 197, 18)          # last rooftop after a 2-tile gap
put(180, 17, 'x')
put(182, 17, 'B')               # crate just outside the shack
fill(184, 13, 197, 14)          # shack roof: interior rows 15..17
put(187, 17, 'B')               # crate inside the shack
put(192, 17, 'S')               # Screamer, facing left (toward the entrance); carries key 4
put(196, 17, 'D')               # locked door 4 in front of the exit
put(197, 17, 'E')               # exit at the back of the shack
# street below: falling here means walking back through the building (no softlock)
put(145, 25, 'x')
put(150, 25, 'c')
put(172, 25, 'B')
put(184, 25, 'c')

rows = [''.join(r) for r in g]
assert all(len(r) == W for r in rows)
print('\n'.join("  '" + r + "'," for r in rows))
