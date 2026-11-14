import Phaser from 'phaser';
import { ART_SCALE, TILE } from './constants';

const DOOR_HEIGHT = 3; // tiles
const TOUCH_MARGIN = 8; // px: walking into the door counts as touching it
const LOCKED_MESSAGE_COOLDOWN = 1.5; // s

interface Door {
  zone: Phaser.GameObjects.Zone; // the static body that blocks the way
  image: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Container | null; // "key x N" over doors that need more than one key
  rect: Phaser.Geom.Rectangle;
  need: number; // keys it takes
  open: boolean;
}

interface KeyPickup {
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Graphics;
}

/**
 * Locked doors and their keys. Each section ends in a locked door; the section's guardian carries the
 * key and drops it when it dies, so no encounter can be skipped.
 *  - A door is a real static body in the level's solids: it blocks the player AND the zombies, and the
 *    player's corner correction / the zombies' wall probes see it like any wall.
 *  - Walking into a door with enough keys opens it. Most doors take one key; a door after an area with
 *    several guardians takes one key from each of them (its "key x N" sign says so), so none of them
 *    can be sneaked past.
 */
export class Locks {
  keys = 0;

  private readonly scene: Phaser.Scene;
  private readonly solids: Phaser.Physics.Arcade.StaticGroup;
  private readonly doors: Door[] = [];
  private readonly pickups: KeyPickup[] = [];
  private readonly message: Phaser.GameObjects.Text;
  private messageCooldown = 0;

  constructor(scene: Phaser.Scene, solids: Phaser.Physics.Arcade.StaticGroup) {
    this.scene = scene;
    this.solids = solids;
    this.message = scene.add.text(0, 0, 'LOCKED - its guardian has the key', {
      fontFamily: 'Georgia, serif', fontSize: '26px', fontStyle: 'bold', color: '#f0e6c8', stroke: '#000000', strokeThickness: 5,
    }).setOrigin(0.5, 1).setDepth(30).setAlpha(0);
  }

  /** feetX / feetY: bottom centre of the door's lowest tile. need: keys it takes to open. */
  addDoor(feetX: number, feetY: number, need: number): void {
    const h = DOOR_HEIGHT * TILE;
    const zone = this.scene.add.zone(feetX, feetY - h / 2, TILE, h);
    this.solids.add(zone);
    const image = this.scene.add.image(feetX, feetY, 'door').setOrigin(0.5, 1).setScale(ART_SCALE).setDepth(3);
    let label: Phaser.GameObjects.Container | null = null;
    if (need > 1) { // painted on the door's upper plate: key icon + "x N"
      const key = this.scene.add.image(-14, 0, 'key').setScale(ART_SCALE);
      const count = this.scene.add.text(12, 0, 'x' + need, {
        fontFamily: 'Georgia, serif', fontSize: '22px', fontStyle: 'bold', color: '#ffd24a', stroke: '#000000', strokeThickness: 4,
      }).setOrigin(0, 0.5);
      label = this.scene.add.container(feetX - 4, feetY - h + TILE * 0.45, [key, count]).setDepth(4);
    }
    this.doors.push({
      zone: zone, image: image, label: label, rect: new Phaser.Geom.Rectangle(feetX - TILE / 2, feetY - h, TILE, h), need: need, open: false,
    });
  }

  /** A guardian died: its key falls where it stood. */
  dropKey(x: number, feetY: number): void {
    const glow = this.scene.add.graphics({ x: x, y: feetY - 30 }).setDepth(13);
    glow.fillStyle(0xffd27a, 0.35).fillCircle(0, 0, 40);
    glow.fillStyle(0xffe6a8, 0.5).fillCircle(0, 0, 24);
    this.scene.tweens.add({ targets: glow, scale: 1.2, alpha: 0.6, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const sprite = this.scene.add.image(x, feetY - 30, 'key').setScale(ART_SCALE * 1.5).setDepth(14);
    this.scene.tweens.add({ targets: sprite, y: feetY - 40, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.pickups.push({ x: x, y: feetY, sprite: sprite, glow: glow });
  }

  /** At the physics rate: pick up keys, open doors the player walks into. */
  fixedUpdate(dt: number, playerBody: Phaser.Physics.Arcade.Body): void {
    const b = playerBody;
    this.messageCooldown = Math.max(0, this.messageCooldown - dt);

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      if (k.x > b.left - TILE * 0.5 && k.x < b.right + TILE * 0.5 && k.y > b.top && k.y < b.bottom + TILE * 0.5) {
        this.keys++;
        k.sprite.destroy();
        k.glow.destroy();
        this.pickups.splice(i, 1);
      }
    }

    for (let i = 0; i < this.doors.length; i++) {
      const d = this.doors[i];
      if (d.open) continue;
      const r = d.rect;
      const touching = b.right + TOUCH_MARGIN > r.x && b.left - TOUCH_MARGIN < r.right && b.bottom > r.y && b.top < r.bottom;
      if (!touching) continue;
      if (this.keys >= d.need) {
        this.keys -= d.need;
        this.openDoor(d);
      } else if (this.messageCooldown <= 0) {
        this.messageCooldown = LOCKED_MESSAGE_COOLDOWN;
        const text = d.need === 1 ? 'LOCKED - its guardian has the key' : 'LOCKED - needs ' + d.need + ' keys (' + this.keys + '/' + d.need + ')';
        this.message.setText(text).setPosition(r.centerX, r.y - 10).setAlpha(1);
        this.scene.tweens.killTweensOf(this.message);
        this.scene.tweens.add({ targets: this.message, alpha: 0, delay: 900, duration: 400 });
      }
    }
  }

  private openDoor(d: Door): void {
    d.open = true;
    this.solids.remove(d.zone, true, true); // the static body is gone: the way is open
    this.scene.cameras.main.shake(120, 0.004);
    const targets: Phaser.GameObjects.GameObject[] = [d.image];
    if (d.label) targets.push(d.label);
    this.scene.tweens.add({ targets: targets, y: '-=' + DOOR_HEIGHT * TILE, alpha: 0, duration: 450, ease: 'Quad.easeIn' });
  }
}
