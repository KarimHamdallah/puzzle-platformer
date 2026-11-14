"""
Builds MECHANIC 2 MEDIUM's ASCII map (snipers: breaking cover, the mad sniper, smoke), printed as a
TypeScript array to paste into src/game/Levels.ts (M2_MEDIUM_MAP).

  area 1, the mad sniper (x 12..68): his reload is random and sometimes he fires twice: listen for the
     bolt. Wooden crates break after 2 shots; 2 concrete blocks never break.
  area 2, the machine gun (x 69..123): open ground and nothing to draw his fire. Seeing it (x 84), the
     player remembers an army ammo crate under the tower.
  The smoke grenades are on a scaffold ledge under the tower (Y), reachable only from the scaffolding
  route, which starts back at the beginning of area 1. So area 1 is crossed THREE times:
     1. forward on the lower path (each crate he hits is cracked),
     2. back on the lower path (the cracked crates break: concrete and the crates you saved matter),
     3. forward on the scaffolding (fresh crates on every segment) to the ledge, then down to the tower
        doorway and on to area 2, where a smoke cloud blinds the gunner.
  A death restores the crates (fair retries); the stolen smoke and what you've seen are kept.

Legend (on top of the others): W = big wooden crate (breaks in M2 Medium), Q = concrete block (never
breaks), Y = the army ammo crate with the smoke grenades.

Usage: python -I tools/build_m2_medium_map.py
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

# ---- start (x 1..12) -------------------------------------------------------------------------------
put(3, 25, 'P')

# ---- area 1: the mad sniper (x 12..68) ----------------------------------------------------------------
fill(15, 24, 16, 25)              # steps up to the scaffolding (2, then 4 high)
fill(17, 22, 19, 25)
# lower path: breakable crates, two concrete blocks (the only cover that lasts all three passes)
for x in (23, 35, 41, 53, 58):
    put(x, 25, 'W')
put(29, 25, 'Q')
put(47, 25, 'Q')
# the scaffolding route (see-through for the sniper): a fresh crate on every segment for pass 3
for x0 in (21, 28, 35, 42, 49, 56):
    fill(x0, 19, x0 + 3, 19, 'Z')
    put(x0 + 1, 18, 'W')
fill(60, 16, 62, 16, 'Z')          # the ledge under the tower (from the last segment: 3 up)...
put(61, 15, 'Y')                  # ...with the army ammo crate: the smoke grenades
fill(63, 7, 68, 22)               # the tower; doorway rows 23..25. The mad sniper's nest on top.
put(71, 25, 'K')

# ---- area 2: the machine gun (x 69..123) --------------------------------------------------------------
fill(79, 21, 89, 22)              # low passage roof: the gunner can't see in; throw the smoke from here
# x 90..98: open ground. No crates, no infected: only smoke gets you across.
fill(99, 21, 121, 22)             # the last house: roof (gunner nest on top), interior rows 23..25
put(119, 25, 'E')

rows = [''.join(r) for r in g]
assert all(len(r) == W for r in rows)
print('\n'.join("  '" + r + "'," for r in rows))
