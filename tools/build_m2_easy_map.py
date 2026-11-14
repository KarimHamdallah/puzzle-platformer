"""
Builds MECHANIC 2 EASY's ASCII map (snipers), printed as a TypeScript array to paste into
src/game/Levels.ts (M2_EASY_MAP). The snipers themselves are LevelData.snipers (nest tile, area, zones).

Story: the army is wiping the village out; its snipers shoot anything that moves, people or infected.
A deserter lies dead in a camp at the start, shot from the tower; his newspaper explains, and his note
in the margin says how to survive.

  camp (x 1..13): safe. Tent, campfire, the dead soldier + newspaper ('J'). From here you can watch the
     laser wander before you step out.
  area 1, the tower (x 14..68): a rifle sniper on a tower at the right end. Step into his area and he
     has you: his laser chases you faster than you run, he fires 0.7 s after the dot reaches you, then
     reloads for 1.7 s. Big crates every 7 tiles take his bullets: let him hit the crate, run while he
     reloads. Outside his area the laser wanders (lower path 90%, scaffolding 10%). A doorway under the
     tower leads on (he can't see under himself).
  area 2, the machine gun (x 69..123): a gunner on a roof watches an open stretch (x 90..98) and kills
     anything exposed in it. A Clicker stands in the low passage before it. Throw a bottle into the
     open ground: the Clicker walks in, the gun turns on it for ~2.7 s, you run across under the roof.

Legend (on top of the others): W = big crate (cover), A = tent (decor), F = campfire (decor),
J = the dead soldier with his newspaper, Z = wooden scaffolding (walkable; snipers see and shoot
through it: stone ledges up there would shadow the whole lower path from a high tower).

Usage: python -I tools/build_m2_easy_map.py
"""
W, H = 124, 30
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

# ---- camp (x 1..13) ------------------------------------------------------------------------------
put(3, 25, 'P')
put(6, 25, 'A')                   # tent
put(9, 25, 'F')                   # campfire
put(12, 25, 'J')                  # the dead soldier and his newspaper

# ---- area 1: the tower (x 14..68) -----------------------------------------------------------------
fill(15, 24, 16, 25)              # steps up (2, then 4 high)...
fill(17, 22, 19, 25)
# ...to the upper route: wooden scaffolding (the sniper looks here 10% of the time)
for x0 in (21, 28, 35, 42, 49, 56):
    fill(x0, 19, x0 + 3, 19, 'Z')
# the lower path (90% of his attention): big crates every 7 tiles
for x in (22, 29, 36, 43, 50, 57):
    put(x, 25, 'W')
fill(63, 7, 68, 22)               # the tower; its doorway (rows 23..25) leads on. Sniper nest on top.
put(71, 25, 'K')

# ---- area 2: the machine gun (x 69..123) --------------------------------------------------------------
put(74, 25, 'x')                  # bottles
fill(79, 21, 89, 22)              # low passage roof: interior rows 23..25 (the gunner can't see in)
put(82, 25, 'B')                  # crate to hide behind (the Clicker passes it)
put(87, 25, 'C')                  # the Clicker, facing you (left)
# x 90..98: open ground. The gunner kills anything exposed here.
fill(99, 21, 121, 22)             # the last house: roof (gunner nest on top), interior rows 23..25
put(119, 25, 'E')

rows = [''.join(r) for r in g]
assert all(len(r) == W for r in rows)
print('\n'.join("  '" + r + "'," for r in rows))
