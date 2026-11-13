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
    'M': (120, 122, 128),  # pipe metal
    'm': (168, 170, 176),  # pipe highlight
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
                 hand=(54, 64), back_hand=(43, 63), hip_dx=0, hip_dy=None, bottle=False, pipe=None):
        self.bottle = bottle        # draw a bottle in the front hand
        self.pipe = pipe            # angle in degrees of a metal pipe held in the front hand (None = no pipe)
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
    if p.pipe is not None:                      # pipe gripped in the fist, pointing along p.pipe degrees
        a = math.radians(p.pipe)
        tip = (wx + math.cos(a) * 15, wy + 1 + math.sin(a) * 15)
        c.stroke((wx, wy + 1), tip, 2, 'M')
        c.stroke((wx, wy + 1), tip, 1, 'm')
        c.rect(wx - 1, wy, wx + 1, wy + 2, 'S')  # fist stays on top of the pipe
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

    # Crouch: hips down 7, chest down 9 and leaning forward; knees bend through the IK.
    'crouch': [Pose(dy=9, hip_dy=7, lean=2, front_foot=(54, 90), back_foot=(42, 90), hand=(57, 71), back_hand=(44, 69)),
               Pose(dy=10, hip_dy=7, lean=2, front_foot=(54, 90), back_foot=(42, 90), hand=(57, 72), back_hand=(44, 70))],
    'sneak': cycle(8, stride=5, lift=2, stance=0.55, bob_down=1, bob_up=0, lean=2,
                   arm_swing=0.35, hand_y=71, back_hand_y=69, base_dy=9, base_hip_dy=7),

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
    # Melee: pipe pulled back over the shoulder -> horizontal strike -> follow-through down -> recover.
    'attack': [Pose(dy=0, lean=-1, front_foot=(54, 90), back_foot=(42, 90), hand=(46, 42), back_hand=(58, 56), pipe=-120),
               Pose(dy=1, lean=3, front_foot=(56, 90), back_foot=(43, 90), hand=(61, 51), back_hand=(46, 60), pipe=-5),
               Pose(dy=2, lean=3, front_foot=(56, 90), back_foot=(44, 89), hand=(60, 60), back_hand=(45, 62), pipe=55),
               Pose(dy=1, lean=1, front_foot=(54, 90), back_foot=(43, 90), hand=(56, 63), back_hand=(44, 63), pipe=80)],
}


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
