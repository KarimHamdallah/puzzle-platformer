import Phaser from 'phaser';
import { debug } from '../../core/debug/Debug';
import { TILE } from '../constants';
import type { Player } from './Player';

/**
 * Debug tools for the player (lil-gui folder "Player"):
 *  - live readout: state, grounded, velocity in tiles/s, coyote time left
 *  - hitboxes: Arcade physics debug drawing
 *  - jump trail: the real path of the last jump + its measured height and distance in tiles
 *    (what a level designer needs: "can the player make this gap?")
 *  - slow motion, respawn
 */
export function attachPlayerDebug(scene: Phaser.Scene, player: Player): () => void {
  const world = scene.physics.world; // scene.physics.world is null by the time SHUTDOWN fires
  const view = {
    state: '',
    grounded: false,
    vx: 0,
    vy: 0,
    coyoteLeftMs: 0,
    hitboxes: false,
    jumpTrail: true,
    slowMotion: 1,
  };

  const folder = debug.gui.addFolder('Player');
  folder.add(view, 'state').listen().disable();
  folder.add(view, 'grounded').listen().disable();
  folder.add(view, 'vx').name('vx (tiles/s)').listen().disable();
  folder.add(view, 'vy').name('vy (tiles/s)').listen().disable();
  folder.add(view, 'coyoteLeftMs').name('coyote left (ms)').listen().disable();
  folder.add(view, 'hitboxes').name('show hitboxes').onChange(setHitboxes);
  folder.add(view, 'jumpTrail').name('show jump trail').onChange((v: boolean) => {
    trail.setVisible(v);
    label.setVisible(v && label.text !== '');
  });
  folder
    .add(view, 'slowMotion', 0.1, 1, 0.05)
    .name('time scale')
    .onChange((v: number) => {
      world.timeScale = 1 / v; // Arcade: bigger timeScale = slower
      scene.tweens.timeScale = v;
    });
  folder.add({ respawn: () => player.respawn() }, 'respawn').name('respawn (R)');

  // ---- jump trail
  const trail = scene.add.graphics().setDepth(20);
  const label = scene.add
    .text(0, 0, '', { fontFamily: 'Consolas, monospace', fontSize: '22px', color: '#ffffff', backgroundColor: '#00000088' })
    .setDepth(21)
    .setPadding(6, 3, 6, 3)
    .setVisible(false); // an empty label would still draw its background box
  let points: Phaser.Math.Vector2[] = [];
  let start = new Phaser.Math.Vector2();
  let apex = new Phaser.Math.Vector2();
  let tracking = false;

  const onJump = (x: number, y: number): void => {
    start = new Phaser.Math.Vector2(x, y);
    apex = start.clone();
    points = [start.clone()];
    tracking = true;
    label.setText('').setVisible(false);
  };

  const onStep = (): void => {
    syncView();
    if (!tracking) return;
    const p = new Phaser.Math.Vector2(player.feetX, player.feetY);
    points.push(p);
    if (p.y < apex.y) apex = p.clone();
    drawTrail();
  };

  const onLand = (): void => {
    if (!tracking) return;
    tracking = false;
    const height = (start.y - apex.y) / TILE;
    const dist = Math.abs(player.feetX - start.x) / TILE;
    const rise = (start.y - player.feetY) / TILE;
    label
      .setText(`height ${height.toFixed(2)}t   distance ${dist.toFixed(2)}t   ${rise >= 0 ? 'up' : 'down'} ${Math.abs(rise).toFixed(2)}t`)
      .setPosition(apex.x, apex.y - 44)
      .setOrigin(0.5, 1)
      .setVisible(view.jumpTrail);
    drawTrail();
  };

  function drawTrail(): void {
    trail.clear();
    if (points.length < 2) return;
    trail.lineStyle(3, 0xffffff, 0.8);
    trail.strokePoints(points, false);
    // apex marker + takeoff height line
    trail.lineStyle(2, 0xffff66, 0.9);
    trail.lineBetween(apex.x - 40, apex.y, apex.x + 40, apex.y);
    trail.lineStyle(1, 0xffffff, 0.35);
    trail.lineBetween(start.x - 60, start.y, start.x + 60, start.y);
    trail.fillStyle(0xffff66, 1).fillCircle(apex.x, apex.y, 5);
  }

  function setHitboxes(on: boolean): void {
    if (on && !world.debugGraphic) world.createDebugGraphic();
    world.drawDebug = on;
    world.debugGraphic?.clear().setVisible(on);
  }

  function syncView(): void {
    view.state = player.state;
    view.grounded = player.grounded;
    view.vx = round2(player.body.velocity.x / TILE);
    view.vy = player.grounded ? 0 : round2(player.body.velocity.y / TILE); // grounded vy is just 1 step of gravity
    const coyoteLeft = player.lastGroundedAt + 0.1 - player.simTime; // shown against the default 100 ms
    view.coyoteLeftMs = player.grounded ? 0 : Math.max(0, Math.round(coyoteLeft * 1000));
  }

  player.on('jump', onJump);
  player.on('step', onStep);
  player.on('land', onLand);

  const removeSection = debug.addSection('Player', () =>
    [
      `state ${view.state}  grounded ${view.grounded}`,
      `v (${view.vx}, ${view.vy}) tiles/s`,
      `pos (${(player.feetX / TILE).toFixed(2)}, ${(player.feetY / TILE).toFixed(2)}) tiles`,
    ].join('\n'),
  );

  return () => {
    removeSection();
    folder.destroy();
    world.timeScale = 1;
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
