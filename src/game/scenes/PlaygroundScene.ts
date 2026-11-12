import Phaser from 'phaser';
import { DEBUG_ENABLED } from '../../core/debug/Debug';
import { InputActions } from '../../core/input/InputActions';
import { COLORS, TILE } from '../constants';
import { PLAYGROUND_ROOM } from '../levels/PlaygroundRoom';
import { Player } from '../player/Player';
import { attachPlayerDebug } from '../player/PlayerDebug';

/** Movement test room: greybox solids + the player. R respawns. */
export class PlaygroundScene extends Phaser.Scene {
  private actions!: InputActions;
  private player!: Player;

  constructor() {
    super('Playground');
  }

  create(): void {
    const room = PLAYGROUND_ROOM;
    const worldW = room.width * TILE;
    const worldH = room.height * TILE;

    this.cameras.main.setBackgroundColor(COLORS.background);
    this.physics.world.setBounds(0, 0, worldW, worldH);

    const solids = this.physics.add.staticGroup();
    for (const s of room.solids) {
      const rect = this.add.rectangle((s.x + s.w / 2) * TILE, (s.y + s.h / 2) * TILE, s.w * TILE, s.h * TILE, COLORS.solid);
      solids.add(rect);
    }

    this.actions = new InputActions(this);
    this.player = new Player(this, this.actions, room.spawn.x * TILE, room.spawn.y * TILE);
    this.physics.add.collider(this.player.body, solids);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, worldW, worldH);
    cam.startFollow(this.player.view, false, 0.12, 0.12, 0, TILE);

    if (DEBUG_ENABLED) {
      const detach = attachPlayerDebug(this, this.player);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, detach);
    }
  }

  update(_time: number, deltaMs: number): void {
    if (this.actions.pressed('reset')) this.player.respawn();
    this.player.update(deltaMs);
  }
}
