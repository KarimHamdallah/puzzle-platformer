"""
Builds the MEDIUM level's ASCII map (Mechanic 1: noise & distraction), printed as a TypeScript array
to paste into src/game/Levels.ts (MEDIUM_MAP).

Story: a horde feeds on corpses in a sunken courtyard, between you and the exit. A wrecked car in the
hub leaks gasoline: a Molotov would burn them all, but the rag is in the trunk, chained with three
padlocks. Their keys: red = the Clicker in the tunnel, green = the two Runners in the yard (dropped
when both are dead), blue = the two Screamers on the rooftops (both dead).

Layout (a hub, left to right):
  tunnel (Clicker, red)  |  sunken Runner yard (green)  |  stairs  |  HUB: spawn, checkpoint, car
  |  rooftops above the hub (Screamers, blue), a 3-tile passage under them  |  overlook  |  horde
  courtyard (4 below)  ->  gate (opens when the horde is dead)  ->  exit

Rules kept from the Easy level: encounters under 3-tile ceilings can't be jumped over; climbs are solid
2-tile steps or open-sky ledges (3-tile rises, 1-tile gaps); the horde is too long to jump across.

Legend (on top of Easy's): N = Clicker at its post facing RIGHT, H = feeding horde Clicker,
X = corpse (decor), V = the car (feet tile = its centre), G = horde gate (bottom tile, 3 tall).

Usage: python -I tools/build_medium_map.py
"""
W, H = 130, 34
HUB = 20          # hub ground (top row)
YARD = 30         # sunken yard / tunnel floor
COURT = 24        # horde courtyard floor: 4 below the overlook (in view from it, too deep to climb back)
ROOF = 12         # rooftops

g = [['.'] * W for _ in range(H)]


def fill(x0, y0, x1, y1, c='#'):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            g[y][x] = c


def put(x, y, c):
    g[y][x] = c


# frame + bedrock
fill(0, 0, 0, H - 1)
fill(W - 1, 0, W - 1, H - 1)
fill(1, 31, W - 2, H - 1)

# ---- tunnel + sunken Runner yard (x 1..37), floor 30 ------------------------------------------
fill(1, YARD, 45, YARD)
# The tunnel: a dead end under a 3-tile roof. Its Clicker faces the way in (right): throw a bottle
# low over it into the dead end, it turns to listen there, you strike its back.
fill(1, 25, 13, 26)               # tunnel roof: interior rows 27..29
put(6, 29, 'N')                   # tunnel Clicker, facing right, carries the RED key
put(10, 29, 'B')                  # crate inside the tunnel
put(3, 29, 'x')                   # stash at the dead end (reward)
# The yard: two Runners, faster than you. Stomp + punch while dizzy, or hide. Both carry the GREEN key.
put(16, 29, 'B')
put(19, 29, 'R')
fill(22, 27, 23, 29)              # 3-high block: a stomp launch point
put(22, 26, 'x')                  # stash on the block
put(26, 29, 'B')
put(31, 29, 'R')
put(34, 29, 'B')
# solid stairs from the yard up to the hub (2-tile rises, nothing to walk under)
fill(38, 28, 39, 29)
fill(40, 26, 41, 29)
fill(42, 24, 43, 29)
fill(44, 22, 45, 29)

# ---- hub (x 46..95) ---------------------------------------------------------------------------
fill(46, HUB, 95, 30)
put(48, HUB - 1, 'P')
put(50, HUB - 1, 'K')             # checkpoint: every branch comes back here
put(55, HUB - 1, 'V')             # the wrecked car
put(52, HUB - 1, 'x')             # stash next to the checkpoint
# open-sky ledges up to the rooftops (walking under ledge 1 on the hub still fits)
fill(58, 17, 60, 17)              # ledge 1 (hub 20 -> 17)
fill(62, 14, 64, 14)              # ledge 2 (17 -> 14, 1-tile gap)
# the rooftops: a building over a 3-tile passage at hub level (the way to the horde)
fill(66, ROOF, 89, 16)            # building: roof row 12, passage rows 17..19 underneath
put(69, ROOF - 1, 'B')
put(71, ROOF - 1, 'x')
put(75, ROOF - 1, 'S')            # Screamer 1, open roof, facing left; BLUE key (with Screamer 2)
put(79, ROOF - 1, 'B')
fill(82, 7, 89, 8)                # shack roof: interior rows 9..11, no jumping over her
put(84, ROOF - 1, 'B')            # crate inside the shack
put(88, ROOF - 1, 'S')            # Screamer 2, inside the shack, facing left
fill(90, 4, 90, 16)               # the rooftops end in a wall that closes the shack (the passage below stays open)
put(68, 19, 'B')                  # crate in the passage
# overlook: the hub ends at x 95, the courtyard lies 7 tiles below

# ---- horde courtyard (x 96..128), floor 24 ------------------------------------------------------
fill(96, COURT, W - 2, 30)
horde_x = [99, 101, 103, 104, 106, 108, 109, 111, 113, 115]
corpse_x = [100, 102, 105, 107, 110, 112, 114]
for x in horde_x:
    put(x, COURT - 1, 'H')
for x in corpse_x:
    put(x, COURT - 1, 'X')
put(121, COURT - 1, 'G')          # gate: opens when the horde is dead
put(125, COURT - 1, 'E')

rows = [''.join(r) for r in g]
assert all(len(r) == W for r in rows)
print('\n'.join("  '" + r + "'," for r in rows))
