import { Ease, Rect, type Body, type Engine, type Group, type Shape, type Sprite, type Text } from '../../engine';
import { ART_SCALE, GOLD, Serif, TILE } from '../constants';
import type { KeyColor } from '../levels/Levels';

const DOOR_HEIGHT = 3; // tiles
const TOUCH_MARGIN = 8; // px: walking into the door counts as touching it
const LOCKED_MESSAGE_COOLDOWN = 1.5; // s
const GATE = -1; // a door's `need` for a horde gate: no key opens it, OpenGates() does
/** Tints for the red / green / blue keys (multiplied over the brass key sprite). */
export const KEY_TINTS = [0xff6a58, 0x7ef08a, 0x7ab4ff];

interface Door {
  solid: Body; // the static body that blocks the way (disabled while open)
  cheated: boolean; // opened by the cheat (locks again when the cheat goes off)
  image: Sprite;
  label: Group | null; // "key x N" over doors that need more than one key
  rect: Rect;
  need: number; // keys it takes
  open: boolean;
}

interface KeyPickup {
  color: number; // KeyColor, or -1 for a plain door key
  x: number;
  y: number;
  sprite: Sprite;
  glow: Shape;
}

/**
 * Locked doors and their keys. Each section ends in a locked door; the section's guardian carries the
 * key and drops it when it dies, so no encounter can be skipped.
 *  - A door is a real static body in the physics world: it blocks the player AND the zombies, and the
 *    player's corner correction / the zombies' wall probes see it like any wall.
 *  - Walking into a door with enough keys opens it. Most doors take one key; a door after an area with
 *    several guardians takes one key from each of them (its "key x N" sign says so), so none of them
 *    can be sneaked past.
 */
export class Locks {
  keys = 0; // plain door keys
  /** Called with the colour when a coloured key is picked up. */
  onColouredKey: ((color: KeyColor) => void) | null = null;

  private readonly engine: Engine;
  private readonly doors: Door[] = [];
  private readonly pickups: KeyPickup[] = [];
  private readonly message: Text;
  private messageCooldown = 0;

  constructor(engine: Engine) {
    this.engine = engine;
    this.message = engine.renderer.CreateText(0, 0, '', Serif(26)).SetOrigin(0.5, 1).SetDepth(30).SetAlpha(0);
  }

  /** feetX / feetY: bottom centre of the door's lowest tile. need: keys it takes to open. */
  AddDoor(feetX: number, feetY: number, need: number): void {
    const r = this.engine.renderer;
    const h = DOOR_HEIGHT * TILE;
    const rect = new Rect(feetX - TILE / 2, feetY - h, TILE, h);
    const solid = this.engine.physics.CreateStaticBox(rect);
    const image = r.CreateSprite(feetX, feetY, 'door').SetOrigin(0.5, 1).SetScale(ART_SCALE).SetDepth(3);
    let label: Group | null = null;
    if (need > 1) { // painted on the door's upper plate: key icon + "x N"
      const key = r.CreateSprite(-14, 0, 'key').SetScale(ART_SCALE);
      const count = r.CreateText(12, 0, 'x' + need, Serif(22, 'bold', GOLD, 4)).SetOrigin(0, 0.5);
      label = r.CreateGroup(feetX - 4, feetY - h + TILE * 0.45).SetDepth(4).Add(key, count);
    }
    this.doors.push({ solid: solid, cheated: false, image: image, label: label, rect: rect, need: need, open: false });
  }

  /** Horde gate (bottom tile at feet): solid until OpenGates(). */
  AddGate(feetX: number, feetY: number): void {
    this.AddDoor(feetX, feetY, GATE);
    this.doors[this.doors.length - 1].image.SetTint(0x9a8f80);
  }

  OpenGates(): void {
    for (let i = 0; i < this.doors.length; i++) if (this.doors[i].need === GATE && !this.doors[i].open) this.OpenDoor(this.doors[i]);
  }

  /** A guardian died: its key falls where it stood. color = KeyColor, or -1 for a plain door key. */
  DropKey(x: number, feetY: number, color: number = -1): void {
    const r = this.engine.renderer;
    const tw = this.engine.tweens;
    const glow = r.CreateShape(x, feetY - 30).SetDepth(13);
    glow.FillStyle(0xffd27a, 0.35).FillCircle(0, 0, 40);
    glow.FillStyle(0xffe6a8, 0.5).FillCircle(0, 0, 24);
    tw.To(glow, { scale: 1.2, alpha: 0.6 }, 0.6, { yoyo: true, repeat: -1, ease: Ease.SineInOut });
    const sprite = r.CreateSprite(x, feetY - 30, 'key').SetScale(ART_SCALE * 1.5).SetDepth(14);
    if (color >= 0) sprite.SetTint(KEY_TINTS[color]);
    tw.To(sprite, { y: feetY - 40 }, 0.5, { yoyo: true, repeat: -1, ease: Ease.SineInOut });
    this.pickups.push({ color: color, x: x, y: feetY, sprite: sprite, glow: glow });
  }

  /** At the physics rate: pick up keys, open doors the player walks into. */
  FixedUpdate(dt: number, playerBody: Body): void {
    const b = playerBody;
    this.messageCooldown = Math.max(0, this.messageCooldown - dt);

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      if (k.x > b.left - TILE * 0.5 && k.x < b.right + TILE * 0.5 && k.y > b.top && k.y < b.bottom + TILE * 0.5) {
        if (k.color < 0) this.keys++;
        else if (this.onColouredKey) this.onColouredKey(k.color);
        this.engine.tweens.Kill(k.sprite);
        this.engine.tweens.Kill(k.glow);
        k.sprite.Destroy();
        k.glow.Destroy();
        this.pickups.splice(i, 1);
      }
    }

    for (let i = 0; i < this.doors.length; i++) {
      const d = this.doors[i];
      if (d.open || d.need === GATE) continue;
      const r = d.rect;
      const touching = b.right + TOUCH_MARGIN > r.x && b.left - TOUCH_MARGIN < r.right && b.bottom > r.y && b.top < r.bottom;
      if (!touching) continue;
      if (this.keys >= d.need) {
        this.keys -= d.need;
        this.OpenDoor(d);
      } else if (this.messageCooldown <= 0) {
        this.messageCooldown = LOCKED_MESSAGE_COOLDOWN;
        const text = d.need === 1 ? 'LOCKED - its guardian has the key' : 'LOCKED - needs ' + d.need + ' keys (' + this.keys + '/' + d.need + ')';
        this.message.SetText(text).SetPosition(r.centerX, r.y - 10).SetAlpha(1);
        this.engine.tweens.Kill(this.message);
        this.engine.tweens.To(this.message, { alpha: 0 }, 0.4, { delay: 0.9 });
      }
    }
  }

  /** Cheat on: every locked door opens (horde gates excepted). */
  CheatOpenDoors(): void {
    for (let i = 0; i < this.doors.length; i++) {
      const d = this.doors[i];
      if (d.need === GATE || d.open) continue;
      d.cheated = true;
      this.OpenDoor(d);
    }
  }

  /** Cheat off: the doors it opened lock again (not one the player is standing in). */
  CheatCloseDoors(playerBody: Body): void {
    const tw = this.engine.tweens;
    for (let i = 0; i < this.doors.length; i++) {
      const d = this.doors[i];
      if (!d.cheated || !d.open) continue;
      const r = d.rect;
      if (playerBody.right > r.x && playerBody.left < r.right && playerBody.bottom > r.y && playerBody.top < r.bottom) continue;
      d.cheated = false;
      d.open = false;
      d.solid.enabled = true;
      tw.Kill(d.image);
      d.image.SetPosition(r.centerX, r.bottom).SetAlpha(1);
      if (d.label) {
        tw.Kill(d.label);
        d.label.SetPosition(r.centerX - 4, r.y + TILE * 0.45).SetAlpha(1);
      }
    }
  }

  private OpenDoor(d: Door): void {
    d.open = true;
    d.solid.enabled = false; // the static body stops blocking: the way is open
    this.engine.camera.Shake(0.12, 0.004);
    const rise = DOOR_HEIGHT * TILE;
    this.engine.tweens.To(d.image, { y: d.image.y - rise, alpha: 0 }, 0.45, { ease: Ease.QuadIn });
    if (d.label) this.engine.tweens.To(d.label, { y: d.label.y - rise, alpha: 0 }, 0.45, { ease: Ease.QuadIn });
  }
}
