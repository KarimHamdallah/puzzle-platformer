"""
Survivor player sprites, drawn pixel by pixel to match the CraftPix zombie packs:
96x96 frames, ~64 px tall character, feet on the bottom row, 1 px near-black outline,
flat colours with 1-2 shade tones, slim proportions. Faces RIGHT (the game flips it for left).

Each frame is a POSE: upper-body offset + lean, foot and hand positions. Legs and arms are drawn
as two segments solved with 2-bone IK (knees bend forward, elbows bend back); torso, head and
backpack are hand-placed pixel parts shared by every frame.

Usage: python -I draw_player.py <out_dir> [preview_dir]
"""
import math
import os
import sys
from PIL import Image

FRAME = 96
GROUND = 90          # ankle height when standing (boot occupies 91..95)
HIP = (48, 70)       # standing hip joint
THIGH, SHIN = 10, 10.4   # sum just over the standing hip->ankle distance (20): legs nearly straight at rest
UPPER_ARM, FOREARM = 8, 9

PALETTE = {
    'K': (5, 4, 3),        # outline (same near-black as the zombies)
    'H': (59, 42, 32),     # hair
    'S': (192, 138, 104),  # skin
    's': (143, 95, 69),    # skin shade
    'B': (74, 53, 40),     # beard
    'G': (110, 93, 80),    # grey in the beard
    'R': (123, 58, 44),    # plaid shirt base
    'P': (156, 90, 62),    # plaid light stripe
    'r': (79, 38, 32),     # plaid dark / shirt shade
    'W': (109, 113, 120),  # grey tee
    'w': (85, 89, 96),     # tee shade
    'T': (46, 38, 32),     # backpack strap
    'A': (93, 100, 56),    # backpack olive
    'a': (62, 68, 38),     # backpack shade
    'E': (138, 115, 80),   # bedroll
    'e': (107, 86, 56),    # bedroll shade
    'L': (42, 29, 24),     # belt
    'Y': (155, 134, 80),   # buckle
    'J': (61, 74, 102),    # jeans
    'j': (40, 48, 74),     # jeans shade (back leg)
    'I': (86, 101, 138),   # jeans highlight
    'O': (74, 51, 40),     # boots
    'o': (43, 28, 23),     # boot sole / shade
    'Q': (74, 116, 70),    # bottle glass
    'q': (150, 186, 128),  # bottle glass highlight
    'N': (40, 62, 40),     # bottle neck / dark glass
    'k': (214, 170, 72),   # key / padlock brass
    'g': (150, 110, 44),   # brass shade
    'D': (78, 74, 66),     # door steel
    'd': (54, 51, 46),     # door steel shade
    'U': (110, 72, 50),    # rust
    'V': (122, 118, 106),  # door highlight / rivet
    'F': (84, 88, 60),     # the father's field jacket
    'f': (60, 63, 43),     # jacket shade
    'X': (150, 141, 118),  # dead skin
    'x': (111, 103, 87),   # dead skin shade
    'Z': (92, 40, 34),     # beanie
    'z': (66, 28, 25),     # beanie shade
    'M': (226, 214, 180),  # paper
    'm': (176, 162, 128),  # paper shade / ink
    'b': (84, 26, 22),     # dried blood
    'C': (140, 140, 132),  # grey hair / beard
    # wrecked car
    '1': (112, 58, 40),    # rusted red paint
    '2': (82, 40, 30),     # paint shade
    '3': (140, 86, 52),    # rust highlight
    '4': (34, 34, 36),     # tyre / dark glass
    '5': (62, 64, 66),     # rim / steel
    '6': (58, 92, 104),    # broken glass (dull blue)
    '7': (24, 22, 30),     # gasoline puddle
    '8': (70, 60, 92),     # oil-sheen on the puddle
    'h': (196, 52, 44),    # red padlock
    'n': (60, 168, 72),    # green padlock
    'u': (58, 110, 206),   # blue padlock
    'c': (150, 150, 150),  # chain
    # fire (symbols: every letter is taken)
    '!': (255, 244, 190),  # flame core
    '@': (255, 200, 70),   # flame yellow
    '$': (240, 118, 34),   # flame orange
    '%': (178, 44, 26),    # flame red tips
    # rag
    '=': (196, 186, 150),  # cloth
    '-': (150, 138, 104),  # cloth shade
}


class Canvas:
    def __init__(self):
        self.px = [[None] * FRAME for _ in range(FRAME)]
        self.ox = 0  # origin offset applied by put(): lets a part be drawn shifted
        self.oy = 0

    def put(self, x, y, c):
        x += self.ox
        y += self.oy
        if 0 <= x < FRAME and 0 <= y < FRAME:
            self.px[y][x] = c

    def rect(self, x0, y0, x1, y1, c):  # inclusive
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.put(x, y, c)

    def row(self, y, x0, x1, c):
        self.rect(x0, y, x1, y, c)

    def stroke(self, p0, p1, width, c):
        """Thick segment: stamp a width x width square along the line."""
        steps = max(1, int(max(abs(p1[0] - p0[0]), abs(p1[1] - p0[1])) * 2))
        lo = -(width // 2)
        for i in range(steps + 1):
            t = i / steps
            x = round(p0[0] + (p1[0] - p0[0]) * t)
            y = round(p0[1] + (p1[1] - p0[1]) * t)
            for oy in range(lo, lo + width):
                for ox in range(lo, lo + width):
                    self.put(x + ox, y + oy, c)

    def outline(self):
        """1 px outline around the silhouette (4-neighbourhood), like the zombie sprites."""
        add = []
        for y in range(FRAME):
            for x in range(FRAME):
                if self.px[y][x] is not None:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < FRAME and 0 <= ny < FRAME and self.px[ny][nx] not in (None, 'K'):
                        add.append((x, y))
                        break
        for x, y in add:
            self.px[y][x] = 'K'

    def image(self):
        im = Image.new('RGBA', (FRAME, FRAME), (0, 0, 0, 0))
        for y in range(FRAME):
            for x in range(FRAME):
                c = self.px[y][x]
                if c is not None:
                    im.putpixel((x, y), PALETTE[c] + (255,))
        return im


def solve_ik(root, target, l1, l2, bend):
    """2-bone IK. bend = +1 puts the middle joint to the right of root->target, -1 to the left."""
    dx, dy = target[0] - root[0], target[1] - root[1]
    d = max(0.001, min(math.hypot(dx, dy), l1 + l2 - 0.001))
    a = math.atan2(dy, dx)
    cos_b = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)
    b = math.acos(max(-1.0, min(1.0, cos_b)))
    ang = a - bend * b  # screen y points down, so "minus" swings the joint to the right of the line
    mid = (root[0] + math.cos(ang) * l1, root[1] + math.sin(ang) * l1)
    end = (root[0] + dx / math.hypot(dx, dy) * d if (dx or dy) else root[0],
           root[1] + dy / math.hypot(dx, dy) * d if (dx or dy) else root[1])
    return mid, end


class Pose:
    def __init__(self, dy=0, lean=0, back_foot=(45, GROUND), front_foot=(51, GROUND),
                 hand=(54, 64), back_hand=(43, 63), hip_dx=0, hip_dy=None, bottle=False):
        self.bottle = bottle        # draw a bottle in the front hand
        self.dy = dy                # upper body vertical offset (bob, crouch, breathing)
        self.hip_dy = dy if hip_dy is None else hip_dy   # hips follow the body unless told otherwise
        self.lean = lean            # upper body shifts right (forward) by this many px
        self.back_foot = back_foot  # ankle positions (absolute frame px)
        self.front_foot = front_foot
        self.hand = hand            # front hand (absolute, before lean/dy)
        self.back_hand = back_hand
        self.hip_dx = hip_dx


# ---------------------------------------------------------------- body parts

def draw_backpack(c):
    c.rect(37, 44, 45, 46, 'E')                 # bedroll strapped on top
    c.row(46, 37, 45, 'e')
    for x in (40, 42):
        c.put(x, 44, 'e')
        c.put(x, 45, 'e')
    c.rect(38, 47, 44, 63, 'A')                 # bag
    c.rect(38, 47, 38, 63, 'a')
    c.row(63, 38, 44, 'a')
    c.rect(39, 56, 42, 61, 'a')                 # front pocket
    c.row(56, 39, 42, 'T')
    c.put(41, 57, 'Y')


def draw_torso(c):
    c.rect(47, 44, 50, 45, 's')                 # neck
    c.row(46, 43, 53, 'R')
    c.rect(44, 47, 53, 65, 'R')
    for y in range(46, 66):                     # plaid
        for x in range(43, 54):
            stripe_x = (x - 44) % 4 == 2
            stripe_y = (y - 46) % 5 == 3
            if y == 46 and not (43 <= x <= 53):
                continue
            if stripe_x and stripe_y:
                c.put(x, y, 'r')
            elif stripe_x:
                c.put(x, y, 'P')
            elif stripe_y:
                c.put(x, y, 'r')
    c.rect(44, 47, 44, 65, 'r')                 # back edge shade
    c.rect(49, 46, 50, 57, 'W')                 # open shirt: grey tee
    c.rect(49, 46, 49, 57, 'w')
    c.rect(47, 46, 48, 60, 'T')                 # backpack strap
    c.row(66, 44, 53, 'L')                      # belt
    c.put(51, 66, 'Y')
    c.rect(44, 67, 53, 70, 'J')                 # hips


def draw_head(c):
    y = 32
    c.row(y + 0, 46, 50, 'H')
    c.row(y + 1, 45, 51, 'H')
    c.row(y + 2, 44, 52, 'H')
    c.row(y + 3, 44, 49, 'H'); c.row(y + 3, 50, 52, 'S')
    c.row(y + 4, 44, 47, 'H'); c.row(y + 4, 48, 52, 'S'); c.row(y + 4, 51, 52, 'H')
    c.row(y + 5, 44, 46, 'H'); c.put(47, y + 5, 's'); c.row(y + 5, 48, 52, 'S')
    c.row(y + 6, 44, 46, 'H'); c.put(47, y + 6, 's'); c.row(y + 6, 48, 52, 'S')
    c.put(51, y + 6, 'K')
    c.put(53, y + 6, 'S')
    c.row(y + 7, 44, 45, 'H'); c.row(y + 7, 46, 52, 'S'); c.put(53, y + 7, 'S'); c.put(52, y + 7, 's')
    c.put(44, y + 8, 'H'); c.put(45, y + 8, 'B'); c.row(y + 8, 46, 49, 'S'); c.row(y + 8, 50, 53, 'B')
    c.row(y + 9, 45, 53, 'B'); c.put(52, y + 9, 'K')
    c.row(y + 10, 45, 52, 'B'); c.put(47, y + 10, 'G'); c.put(50, y + 10, 'G')
    c.row(y + 11, 46, 51, 'B'); c.put(49, y + 11, 'G')


def draw_leg(c, hip, foot, front):
    knee, ankle = solve_ik(hip, foot, THIGH, SHIN, bend=1)    # knee bends forward (right)
    colour = 'J' if front else 'j'
    c.stroke(hip, knee, 4, colour)
    c.stroke(knee, ankle, 4, colour)
    if front:
        c.stroke((knee[0] + 1, knee[1] + 1), (ankle[0] + 1, ankle[1] - 1), 1, 'I')  # shin highlight
    ax, ay = round(ankle[0]), round(ankle[1])
    c.rect(ax - 2, ay + 1, ax + 3, ay + 4, 'O' if front else 'o')             # boot, toe to the right
    c.row(ay + 5, ax - 2, ax + 4, 'o')
    c.put(ax + 4, ay + 4, 'O' if front else 'o')


def draw_arm(c, shoulder, hand, front):
    elbow, wrist = solve_ik(shoulder, hand, UPPER_ARM, FOREARM, bend=-1)   # elbow bends back (left)
    c.stroke(shoulder, elbow, 3, 'R' if front else 'r')
    c.stroke(elbow, wrist, 2, 'S' if front else 's')
    c.put(round(elbow[0]), round(elbow[1]), 'P' if front else 'r')         # rolled-up cuff
    wx, wy = round(wrist[0]), round(wrist[1])
    c.rect(wx - 1, wy, wx + 1, wy + 2, 'S' if front else 's')              # fist
    return wx, wy


def draw_bottle(c, x, y):
    """Glass bottle standing upright with its base at (x, y): 3 px wide body, 2 px neck."""
    c.rect(x - 1, y - 6, x + 1, y, 'Q')
    c.rect(x - 1, y - 5, x - 1, y - 1, 'q')     # highlight
    c.rect(x, y - 9, x, y - 7, 'N')             # neck
    c.put(x, y - 10, 'N')


def draw_pose(p):
    c = Canvas()
    ux, uy = p.lean, p.dy                       # upper-body offset
    hip = (HIP[0] + p.hip_dx, HIP[1] + p.hip_dy)

    # back arm (far side, behind everything)
    c.ox, c.oy = 0, 0
    draw_arm(c, (45 + ux, 49 + uy), (p.back_hand[0] + ux, p.back_hand[1] + uy), front=False)
    # back leg
    draw_leg(c, (hip[0] - 2, hip[1]), p.back_foot, front=False)
    # backpack, torso, head move with the upper body
    c.ox, c.oy = ux, uy
    draw_backpack(c)
    draw_torso(c)
    c.ox, c.oy = ux + (1 if p.lean >= 2 else 0), uy   # head leans a bit further when running
    draw_head(c)
    # front leg, then front arm on top
    c.ox, c.oy = 0, 0
    draw_leg(c, (hip[0] + 2, hip[1]), p.front_foot, front=True)
    wx, wy = draw_arm(c, (52 + ux, 49 + uy), (p.hand[0] + ux, p.hand[1] + uy), front=True)
    if p.bottle:
        draw_bottle(c, wx, wy + 1)              # held by the neck end, body above the fist
    c.outline()
    return c.image()


# ---------------------------------------------------------------- animations

def cycle(frames, stride, lift, stance, bob_down, bob_up, lean, arm_swing, hand_y, back_hand_y,
          base_dy=0, base_hip_dy=0):
    """Walk / run cycle: each leg spends `stance` of the cycle on the ground moving back.
    base_dy / base_hip_dy lower the upper body / hips for crouched cycles."""
    poses = []
    for i in range(frames):
        t = i / frames
        feet = []
        for phase in (t, (t + 0.5) % 1.0):     # front leg, back leg (half a cycle apart)
            if phase < stance:                 # planted: slides from +stride to -stride
                k = phase / stance
                fx, fy = stride * (1 - 2 * k), GROUND
            else:                              # swinging forward, lifted
                k = (phase - stance) / (1 - stance)
                fx, fy = -stride + 2 * stride * k, GROUND - lift * math.sin(math.pi * k)
            feet.append((HIP[0] + fx, fy))
        contact = min(t % 0.5, 0.5 - t % 0.5) < 0.07
        dy = bob_down if contact else bob_up
        front_x = feet[0][0] - HIP[0]
        back_x = feet[1][0] - HIP[0]
        poses.append(Pose(dy=base_dy + dy, hip_dy=base_hip_dy + dy, lean=lean, front_foot=(feet[0][0] + 2, feet[0][1]),
                          back_foot=(feet[1][0] - 2, feet[1][1]),
                          hand=(54 - front_x * arm_swing, hand_y),
                          back_hand=(46 - back_x * arm_swing, back_hand_y)))
    return poses


ANIMATIONS = {
    'idle': [Pose(dy=0), Pose(dy=0), Pose(dy=1, hip_dy=0), Pose(dy=1, hip_dy=0)],   # breathing: chest only
    'walk': cycle(8, stride=6, lift=3, stance=0.5, bob_down=1, bob_up=0, lean=0,
                  arm_swing=0.7, hand_y=64, back_hand_y=63),
    'run': cycle(8, stride=9, lift=6, stance=0.4, bob_down=2, bob_up=0, lean=2,
                 arm_swing=0.9, hand_y=59, back_hand_y=58),
    'jump': [Pose(dy=-1, front_foot=(53, 84), back_foot=(44, 88), hand=(57, 51), back_hand=(41, 55)),
             Pose(dy=-1, front_foot=(54, 83), back_foot=(45, 87), hand=(58, 50), back_hand=(42, 54))],
    'fall': [Pose(dy=0, front_foot=(52, 90), back_foot=(44, 88), hand=(58, 55), back_hand=(39, 54)),
             Pose(dy=0, front_foot=(53, 89), back_foot=(44, 89), hand=(59, 54), back_hand=(39, 53))],
    'land': [Pose(dy=4, front_foot=(54, 90), back_foot=(42, 90), hand=(57, 68), back_hand=(42, 66), hip_dx=0),
             Pose(dy=2, front_foot=(53, 90), back_foot=(43, 90), hand=(56, 66), back_hand=(43, 65))],

    # Crouch: deep (hips -9, chest -11), weight forward, back foot up on its toes, front hand low and
    # ready near the knee, back hand tucked; 4 frames of slow breathing in the shoulders.
    'crouch': [Pose(dy=11, hip_dy=9, lean=3, front_foot=(55, 90), back_foot=(41, 89), hand=(59, 73), back_hand=(49, 72)),
               Pose(dy=11, hip_dy=9, lean=3, front_foot=(55, 90), back_foot=(41, 89), hand=(59, 73), back_hand=(49, 72)),
               Pose(dy=12, hip_dy=9, lean=3, front_foot=(55, 90), back_foot=(41, 89), hand=(59, 74), back_hand=(49, 73)),
               Pose(dy=12, hip_dy=9, lean=3, front_foot=(55, 90), back_foot=(41, 89), hand=(59, 74), back_hand=(49, 73))],
    # Sneak: same deep crouch, long careful steps (60% of the cycle planted), barely lifted feet.
    'sneak': cycle(8, stride=6, lift=2, stance=0.6, bob_down=1, bob_up=0, lean=3,
                   arm_swing=0.3, hand_y=73, back_hand_y=72, base_dy=11, base_hip_dy=9),

    # Aim: bottle cocked behind the head, off hand pointing at the target, weight on the back foot.
    # The hand sits high behind the head so the forearm passes over the hair / backpack, never the face,
    # and the bottle shows above the head.
    'aim': [Pose(dy=0, lean=-1, front_foot=(54, 90), back_foot=(42, 90), hand=(44, 37), back_hand=(60, 52), bottle=True),
            Pose(dy=1, hip_dy=0, lean=-1, front_foot=(54, 90), back_foot=(42, 90), hand=(44, 38), back_hand=(60, 53), bottle=True)],
    # Throw: wind-up -> release (bottle leaves the hand) -> follow-through -> recover.
    'throw': [Pose(dy=0, lean=-2, front_foot=(54, 90), back_foot=(42, 90), hand=(42, 36), back_hand=(60, 51), bottle=True),
              Pose(dy=1, lean=2, front_foot=(55, 90), back_foot=(43, 90), hand=(62, 46), back_hand=(44, 60)),
              Pose(dy=2, lean=3, front_foot=(55, 90), back_foot=(44, 89), hand=(61, 58), back_hand=(43, 62)),
              Pose(dy=1, lean=1, front_foot=(54, 90), back_foot=(43, 90), hand=(57, 63), back_hand=(44, 63))],
    # Punch: guard (fists up at the chest) -> straight punch with a step and the shoulder behind it
    # -> pull back to guard. Short, so several punches fit in a Runner's dizzy window.
    'attack': [Pose(dy=1, lean=0, front_foot=(54, 90), back_foot=(42, 90), hand=(52, 55), back_hand=(50, 54)),
               Pose(dy=1, lean=3, front_foot=(57, 90), back_foot=(43, 90), hand=(65, 51), back_hand=(51, 56)),
               Pose(dy=1, lean=1, front_foot=(55, 90), back_foot=(42, 90), hand=(57, 55), back_hand=(50, 55))],
}


def draw_key_sprite():
    """Brass key dropped by a guardian: ring bow + shaft + two teeth, 15x8 px, outlined."""
    c = Canvas()
    c.rect(1, 2, 4, 5, 'k')                     # bow (ring)
    c.rect(2, 3, 3, 4, None)                    # hole
    c.put(1, 2, 'g'); c.put(1, 5, 'g')
    c.row(3, 5, 13, 'k')                        # shaft
    c.row(4, 5, 13, 'g')
    c.rect(10, 5, 10, 6, 'k')                   # teeth
    c.rect(12, 5, 12, 6, 'k')
    c.outline()
    return c.image().crop((0, 1, 15, 9))


def draw_door_sprite():
    """Locked steel door, 1 tile x 3 tiles at 2x = 32x96 px: riveted plates, rust, brass padlock."""
    c = Canvas()
    c.rect(1, 0, 30, 95, 'D')
    c.rect(1, 0, 2, 95, 'd')                    # frame shade
    c.rect(29, 0, 30, 95, 'd')
    for y in (31, 63):                          # plate seams
        c.row(y, 1, 30, 'd')
    for y in (4, 27, 35, 59, 67, 91):           # rivets
        c.put(5, y, 'V')
        c.put(26, y, 'V')
    for x, y in ((8, 20), (9, 21), (20, 44), (21, 45), (22, 45), (12, 80), (13, 81), (24, 74)):
        c.put(x, y, 'U')                        # rust spots
    c.rect(12, 44, 19, 52, 'k')                 # padlock body
    c.rect(12, 50, 19, 52, 'g')
    c.rect(13, 39, 18, 43, 'k')                 # shackle
    c.rect(15, 41, 16, 43, None)
    c.put(15, 47, 'd'); c.put(16, 47, 'd'); c.put(15, 48, 'd')   # keyhole
    c.outline()
    return c.image().crop((0, 0, 32, 96))


def draw_corpse_sprite():
    """The father: dead, sitting with his back against a wall (wall on the RIGHT), facing left toward
    whoever comes. Head slumped on his chest, one knee up, the letter for his son in his lap, a dried
    wound in his side. 44x32 px, feet on the bottom row."""
    c = Canvas()
    gy = 95                                      # ground row
    # far arm (behind the body): hangs down, hand on the ground
    c.stroke((57, 76), (60, 86), 3, 'f')
    c.stroke((60, 86), (61, 92), 2, 'x')
    c.rect(60, 92, 62, 93, 'x')
    # far leg: knee up
    c.stroke((52, 89), (43, 80), 4, 'j')
    c.stroke((43, 80), (37, 90), 4, 'j')
    c.rect(32, 90, 38, 93, 'o'); c.row(94, 31, 38, 'o')
    # torso, leaning back against the wall
    c.stroke((54, 88), (56, 75), 10, 'F')
    c.rect(59, 72, 60, 91, 'f')                  # back shade (against the wall)
    c.rect(50, 81, 53, 86, 'b')                  # the wound: dried blood soaking the jacket
    c.put(52, 87, 'b'); c.put(51, 80, 'b')
    c.row(91, 49, 60, 'L')                       # belt
    # near leg: stretched out flat along the ground, boot toe up
    c.stroke((54, 91), (33, 92), 5, 'J')
    c.stroke((50, 90), (36, 91), 1, 'I')
    c.rect(28, 88, 32, 94, 'O'); c.row(gy - 1, 27, 33, 'o'); c.rect(28, 86, 29, 88, 'O')
    # head slumped forward onto the chest, facing left/down
    hx, hy = 46, 68
    c.rect(hx, hy, hx + 7, hy + 7, 'X')          # face / skull
    c.rect(hx + 5, hy, hx + 7, hy + 7, 'x')      # far side shade
    c.rect(hx - 1, hy - 2, hx + 8, hy + 1, 'Z')  # beanie
    c.row(hy + 1, hx - 1, hx + 8, 'z')
    c.row(hy + 3, hx, hx + 1, 'x'); c.row(hy + 3, hx + 3, hx + 4, 'x')   # closed eyes
    c.rect(hx - 1, hy + 5, hx + 4, hy + 8, 'C')  # grey beard on the chest
    c.put(hx, hy + 8, 'C'); c.put(hx + 2, hy + 9, 'C')
    # near arm: limp, the hand resting in the lap on the letter
    c.stroke((53, 74), (49, 82), 3, 'F')
    c.stroke((49, 82), (44, 86), 2, 'X')
    c.rect(37, 85, 44, 90, 'M')                  # the letter, folded
    c.row(90, 37, 44, 'm')
    c.row(86, 38, 42, 'm'); c.row(88, 38, 41, 'm')            # ink lines
    c.rect(43, 85, 45, 87, 'X')                  # fingers over it
    c.outline()
    for x in range(34, 66):                      # old blood dried on the ground (after the outline: flat)
        if (x * 7) % 5 != 0 and c.px[gy][x] is None:
            c.px[gy][x] = 'b'
    return c.image().crop((24, 64, 68, 96))   # 44x32


def draw_car_sprite(opened):
    """Wrecked sedan, front to the RIGHT, ~84x40 px. Its tank still leaks: a drip and a dark puddle.
    The trunk (left) is chained shut with a red, a green and a blue padlock; opened = lid up, empty."""
    c = Canvas()
    gy = 95
    # puddle of gasoline under the tank (drawn first, everything else on top)
    c.row(gy, 22, 46, '7'); c.row(gy - 1, 26, 42, '7')
    for x in (28, 33, 39):
        c.put(x, gy - 1, '8')
    # wheels: rear one flat
    for dy in range(-4, 5):                                          # rear tyre: flat, squashed wide
        w = int(8 * (1 - (dy / 5) ** 2) ** 0.5) + 1
        c.row(91 + dy, 21 - w, 21 + w, '4')
    c.row(gy, 11, 31, '4')
    c.rect(19, 89, 23, 92, '5')
    for dy in range(-7, 8):
        w = int((49 - dy * dy) ** 0.5)
        c.row(87 + dy, 70 - w, 70 + w, '4')
    c.rect(67, 84, 73, 90, '5'); c.put(70, 87, '4')
    # body
    c.rect(6, 72, 90, 85, '1')
    c.row(85, 6, 90, '2'); c.row(84, 6, 90, '2')
    c.rect(6, 72, 7, 85, '2')
    c.rect(28, 76, 29, 85, '2'); c.rect(52, 76, 53, 85, '2')        # door seams
    # cabin (sloped windscreen and rear window)
    for i, y in enumerate(range(58, 72)):
        x0 = 30 - min(i, 8)
        x1 = 64 + min(i, 10)
        c.row(y, x0, x1, '1')
    c.row(58, 30, 64, '2')
    for i, y in enumerate(range(61, 71)):                            # side windows, smashed
        c.row(y, 30 - min(i, 6) + 2, 46, '4')
        c.row(y, 50, 62 + min(i, 8), '4')
    for x, y in ((33, 64), (34, 65), (36, 63), (55, 66), (57, 64), (58, 65), (41, 68), (60, 69)):
        c.put(x, y, '6')                                             # glass shards left in the frames
    c.rect(47, 60, 49, 71, '1')                                      # door pillar
    # rust and dents
    for x, y in ((12, 75), (13, 75), (13, 76), (40, 80), (41, 81), (78, 74), (79, 74), (79, 75), (60, 83), (22, 82)):
        c.put(x, y, '3')
    c.rect(86, 75, 89, 77, '5')                                      # broken headlight
    c.rect(4, 76, 6, 79, '5')                                        # rear bumper end
    # fuel cap + the drip
    c.rect(30, 76, 32, 78, '5')
    c.put(31, 79, '7'); c.put(31, 81, '7')
    if not opened:
        c.rect(8, 69, 26, 72, '1')                                   # trunk lid, shut
        c.row(69, 8, 26, '2')
        for i in range(0, 19):                                       # chain wrapped around the lid
            c.put(8 + i, 74 + (i % 2), 'c')
        c.rect(10, 75, 12, 79, 'h'); c.put(11, 76, '4')              # red, green, blue padlocks
        c.rect(15, 75, 17, 79, 'n'); c.put(16, 76, '4')
        c.rect(20, 75, 22, 79, 'u'); c.put(21, 76, '4')
    else:
        c.rect(9, 70, 26, 73, '4')                                   # open, empty trunk
        c.stroke((26, 70), (16, 52), 3, '1')                         # lid raised
        c.stroke((25, 69), (15, 51), 1, '2')
    c.outline()
    return c.image().crop((2, 50, 94, 96))   # 92x46


def draw_molotov_sprite():
    """Bottle with a rag stuffed in its neck, the rag's tip burning: 11x20 px."""
    c = Canvas()
    draw_bottle(c, 5, 18)
    c.rect(4, 5, 6, 8, '=')                                          # rag in the neck
    c.put(3, 6, '='); c.put(7, 4, '-'); c.put(6, 3, '=')
    c.rect(5, 1, 6, 2, '@'); c.put(5, 0, '!'); c.put(6, 0, '$')     # flame on the rag
    c.outline()
    return c.image().crop((0, 0, 11, 20))


def draw_rag_sprite():
    """A torn piece of cloth (HUD icon / pickup): 14x10 px."""
    c = Canvas()
    c.rect(2, 3, 11, 7, '=')
    c.row(2, 4, 9, '=')
    c.row(8, 3, 10, '-')
    for x, y in ((3, 4), (6, 5), (9, 3), (8, 6), (11, 5)):
        c.put(x, y, '-')
    c.put(12, 6, '='); c.put(1, 5, '=')
    c.outline()
    return c.image().crop((0, 1, 14, 11))


def draw_fire_frames(frames=8, w=32, h=48):
    """Pixel flames: a tapering body that sways and splits into tongues, white-yellow core, orange
    body, red tips. Loops (phase goes once around a circle). Returns a frames*w x h sheet."""
    sheet = Image.new('RGBA', (w * frames, h), (0, 0, 0, 0))
    for f in range(frames):
        ph = 2 * math.pi * f / frames
        c = Canvas()
        for y in range(h):
            t = 1 - y / (h - 1)                                      # 0 at the base, 1 at the top
            sway = math.sin(ph + t * 4.0) * 3 * t
            half = (w * 0.42) * (1 - t) ** 0.65 + math.sin(ph * 2 + t * 9) * 1.5 * (1 - t)
            if half < 0.6:
                continue
            cx = w / 2 + sway
            for x in range(w):
                d = abs(x + 0.5 - cx) / half                         # 0 centre .. 1 edge
                if d > 1:
                    continue
                if t > 0.55 and math.sin(x * 1.7 + ph * 3 + t * 6) > 0.55:
                    continue                                         # tongues: gaps near the top
                heat = (1 - d) * (1 - t * 0.9)
                col = '!' if heat > 0.62 else '@' if heat > 0.4 else '$' if heat > 0.18 else '%'
                c.put(x, y, col)
        sheet.alpha_composite(c.image().crop((0, 0, w, h)), (f * w, 0))
    return sheet


def draw_boot_sprite():
    """HUD noise meter: a work boot seen from the side, toe to the right, 16x13 px."""
    c = Canvas()
    c.rect(2, 1, 7, 8, 'O')                     # shaft
    c.rect(2, 1, 2, 8, 'o')
    c.row(1, 2, 7, 'L')                         # collar
    for y in (3, 5, 7):                         # laces
        c.put(6, y, 'Y')
    c.rect(2, 8, 13, 10, 'O')                   # foot
    c.rect(11, 7, 13, 8, 'O'); c.put(14, 9, 'O'); c.put(14, 10, 'O')   # rounded toe
    c.row(11, 2, 14, 'o')                       # sole
    c.put(8, 11, 'K'); c.put(11, 11, 'K')       # tread
    c.outline()
    return c.image().crop((0, 0, 16, 13))


def draw_stash_sprite():
    """Bottle stash (pickup worth several bottles): three bottles leaning together, 17x14 px."""
    c = Canvas()
    draw_bottle(c, 4, 12)
    draw_bottle(c, 12, 12)
    draw_bottle(c, 8, 12)
    c.outline()
    return c.image().crop((0, 0, 17, 14))


def draw_bottle_sprite():
    """Standalone bottle (pickup + thrown projectile): 9x14 px, centred, outlined."""
    c = Canvas()
    draw_bottle(c, 4, 12)
    c.outline()
    return c.image().crop((0, 0, 9, 14))


def main():
    out_dir = sys.argv[1]
    preview_dir = sys.argv[2] if len(sys.argv) > 2 else None
    os.makedirs(out_dir, exist_ok=True)
    sheets = {}
    for name, poses in ANIMATIONS.items():
        sheet = Image.new('RGBA', (FRAME * len(poses), FRAME), (0, 0, 0, 0))
        for i, pose in enumerate(poses):
            sheet.alpha_composite(draw_pose(pose), (i * FRAME, 0))
        sheet.save(os.path.join(out_dir, 'player_' + name + '.png'))
        sheets[name] = sheet
    draw_bottle_sprite().save(os.path.join(out_dir, 'bottle.png'))
    draw_stash_sprite().save(os.path.join(out_dir, 'stash.png'))
    draw_key_sprite().save(os.path.join(out_dir, 'key.png'))
    draw_door_sprite().save(os.path.join(out_dir, 'door.png'))
    draw_corpse_sprite().save(os.path.join(out_dir, 'corpse.png'))
    draw_car_sprite(False).save(os.path.join(out_dir, 'car_chained.png'))
    draw_car_sprite(True).save(os.path.join(out_dir, 'car_open.png'))
    draw_molotov_sprite().save(os.path.join(out_dir, 'molotov.png'))
    draw_rag_sprite().save(os.path.join(out_dir, 'rag.png'))
    draw_fire_frames().save(os.path.join(out_dir, 'fire.png'))
    draw_boot_sprite().save(os.path.join(out_dir, 'boot.png'))
    if preview_dir:
        os.makedirs(preview_dir, exist_ok=True)
        corpse = draw_corpse_sprite()
        bg = Image.new('RGBA', corpse.size, (120, 128, 100, 255))
        bg.alpha_composite(corpse)
        bg.resize((corpse.width * 8, corpse.height * 8), Image.NEAREST).save(os.path.join(preview_dir, 'corpse_preview.png'))
        items = [draw_car_sprite(False), draw_car_sprite(True), draw_molotov_sprite(), draw_rag_sprite(), draw_fire_frames()]
        pw = sum(i.width for i in items) + 10 * len(items)
        ph = max(i.height for i in items)
        prev = Image.new('RGBA', (pw, ph), (120, 128, 100, 255))
        x = 0
        for i in items:
            prev.alpha_composite(i, (x, ph - i.height))
            x += i.width + 10
        prev.resize((pw * 4, ph * 4), Image.NEAREST).save(os.path.join(preview_dir, 'medium_props_preview.png'))

    if preview_dir:  # contact sheet: every animation on its own row, 3x zoom, cropped to the body
        os.makedirs(preview_dir, exist_ok=True)
        rows = list(sheets.items())
        cw, ch = 40, 70
        prev = Image.new('RGBA', (cw * 8, ch * len(rows)), (90, 100, 110, 255))
        for r, (name, sheet) in enumerate(rows):
            for i in range(sheet.width // FRAME):
                prev.alpha_composite(sheet.crop((i * FRAME + 28, 26, i * FRAME + 28 + cw, 96)), (i * cw, r * ch))
        prev.resize((prev.width * 3, prev.height * 3), Image.NEAREST).save(os.path.join(preview_dir, 'player_contact_sheet.png'))


if __name__ == '__main__':
    main()
