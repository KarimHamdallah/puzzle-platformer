"""
Builds MECHANIC 2 HARD's ASCII map (the helicopter escape), printed as a TypeScript array to paste into
src/game/levels/Levels.ts (M2_HARD_MAP). The helicopter itself is LevelData.heli (Helicopter.ts).

An army helicopter follows you along a valley (slower than your sprint) with the mad sniper in its
door and a gun under its nose. Run crate to crate (wooden crates break, concrete holds), crouch, keep
ahead of it: crouched behind cover you are hidden, out of it with the helicopter over you, its gun has
you. Clickers feed on bodies in the way (they hear footsteps only up close): from the concrete before
each one, throw a bottle back toward the helicopter; the Clicker walks past you into the door gun, and
while the gunner cuts it down the pilot holds still. Smoke blinds both weapons. The tunnel at the end
is out of its reach.

  x 1..45    open ground: crates and concrete every 6-7 tiles, learn the rhythm (bottles at 42)
  x 52..76   two feeding Clickers, concrete before each (52, 65)
  x 82..86   checkpoint, an army crate with 2 smoke grenades, concrete
  x 90..118  the long run, the last bottles (115) and concrete (118) before the last Clicker (124)
  x 135..151 the last dash
  x 152..    the tunnel (out of reach), the exit inside

Usage: python -I tools/build_m2_hard_map.py
"""
W, H = 170, 30
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

put(3, 25, 'P')
# open ground: learn the rhythm
for x in (9, 15, 27, 33, 45):
    put(x, 25, 'W')
for x in (21, 39):
    put(x, 25, 'Q')
# Clickers in the path
put(42, 25, 'x')                  # bottles: picked up on the run, before the first Clicker
put(52, 25, 'Q')                  # concrete: throw the bottle back, the Clicker walks past you into the gun
put(57, 25, 'X')                  # a body...
put(58, 25, 'H')                  # ...and a Clicker eating him: it hears footsteps only up close, a bottle still carries
put(65, 25, 'Q')                  # concrete again, the same trick
put(70, 25, 'X')
put(71, 25, 'H')                  # another one feeding
put(76, 25, 'W')
put(82, 25, 'K')
put(84, 25, 'Y')                  # smoke grenades
put(86, 25, 'Q')                  # cover right after the checkpoint
# the long run
for x in (90, 104, 112, 135, 140, 145):
    put(x, 25, 'W')
for x in (97, 118):
    put(x, 25, 'Q')
put(115, 25, 'x')
put(123, 25, 'X')
put(124, 25, 'H')                 # the last Clicker: concrete at 118, the bottles at 115
# the tunnel
fill(152, 21, 167, 22)            # roof: interior rows 23..25, out of the helicopter's reach
put(164, 25, 'E')

rows = [''.join(r) for r in g]
assert all(len(r) == W for r in rows)
print('\n'.join("  '" + r + "'," for r in rows))
