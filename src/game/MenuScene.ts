import Phaser from 'phaser';
import { Action, InputActions } from '../core/InputActions';
import { createAnimations, loadAssets } from './Assets';
import { BACKGROUND, ROOM_H, ROOM_W, SOLID, SOLIDS } from './PlaygroundScene';

/**
 * Level select. Levels are grouped by what they test: the Day 1 movement room, then one section per
 * puzzle mechanic with its Easy / Medium / Hard levels. Not-yet-built levels show as locked cards.
 * Keyboard: arrows choose, Space / Enter plays. Mouse: hover + click. In a level, Esc comes back here.
 */

interface LevelEntry {
  scene: string; // scene key to start, '' = locked (not built yet)
  label: string; // difficulty / kind
  title: string;
  blurb: string;
  thumb: string; // texture key, '' = drawn thumbnail
}

interface MenuSection {
  heading: string;
  subheading: string;
  levels: LevelEntry[];
}

const THUMB_M1_EASY = 'thumb_m1_easy';
const THUMB_M1_EASY_PATH = 'assets/thumbs/mechanic1_easy.png';

const SECTIONS: MenuSection[] = [
  {
    heading: 'DAY 1  -  MOVEMENT',
    subheading: 'The very first test: the greybox room and the cube the movement was tuned with on Day 1.',
    levels: [
      { scene: 'Playground', label: 'TEST ROOM', title: 'Movement Test Room', blurb: 'No enemies. Just run, jump and get the feel.', thumb: '' },
    ],
  },
  {
    heading: 'MECHANIC 1  -  NOISE & DISTRACTION',
    subheading: 'Clickers hear but cannot see. Throw bottles to lure them, sneak, hide behind crates, strike from behind.',
    levels: [
      { scene: 'Demo', label: 'EASY', title: 'The Long Way Out', blurb: 'Tunnel, yard, a building, the rooftops.', thumb: THUMB_M1_EASY },
      { scene: '', label: 'MEDIUM', title: 'Coming soon', blurb: 'Locked: the difficulty design comes first.', thumb: '' },
      { scene: '', label: 'HARD', title: 'Coming soon', blurb: 'Locked: the difficulty design comes first.', thumb: '' },
    ],
  },
];

const CARD_W = 420;
const CARD_H = 300;
const THUMB_H = 175;
const PAD = 12;
const LEFT = 120; // x of the first card / headings
const GAP = 40;
const SECTION_Y = [140, 575]; // heading y per section
const GOLD = 0xffd24a;
const CREAM = 0xf0e6c8;
const TEXT_STYLE = { fontFamily: 'Georgia, serif', color: '#f0e6c8' };

interface Card {
  section: number;
  col: number;
  entry: LevelEntry;
  container: Phaser.GameObjects.Container;
  frame: Phaser.GameObjects.Graphics;
}

let lastSection = 1; // remembered between visits: back from a level, the cursor is where you left it
let lastCol = 0;

export class MenuScene extends Phaser.Scene {
  private controls!: InputActions;
  private cards: Card[] = [];
  private section = 0;
  private col = 0;
  private parallax: Phaser.GameObjects.TileSprite[] = [];
  private notice!: Phaser.GameObjects.Text;
  private leaving = false;

  constructor() {
    super('Menu');
  }

  preload(): void {
    loadAssets(this);
    this.load.image(THUMB_M1_EASY, THUMB_M1_EASY_PATH); // optional: a drawn thumbnail replaces it if missing
  }

  create(): void {
    createAnimations(this);
    this.cards = [];
    this.parallax = [];
    this.leaving = false;
    this.section = lastSection;
    this.col = lastCol;
    const w = this.scale.width;
    const h = this.scale.height;

    const layers = ['bg_sky', 'bg_far', 'bg_mid', 'bg_near'];
    for (let i = 0; i < layers.length; i++) this.parallax.push(this.add.tileSprite(0, 0, w, h, layers[i]).setOrigin(0, 0));
    this.add.rectangle(0, 0, w, h, 0x0b0a08, 0.62).setOrigin(0, 0);

    this.add.text(w / 2, 62, 'LEVEL SELECT', {
      ...TEXT_STYLE, fontSize: '64px', fontStyle: 'bold', stroke: '#000000', strokeThickness: 8,
    }).setOrigin(0.5);

    for (let s = 0; s < SECTIONS.length; s++) {
      const sec = SECTIONS[s];
      const y = SECTION_Y[s];
      this.add.text(LEFT, y, sec.heading, { ...TEXT_STYLE, fontSize: '34px', fontStyle: 'bold', color: '#ffd24a', stroke: '#000000', strokeThickness: 5 });
      this.add.text(LEFT, y + 44, sec.subheading, { ...TEXT_STYLE, fontSize: '22px', stroke: '#000000', strokeThickness: 3 });
      for (let c = 0; c < sec.levels.length; c++) this.cards.push(this.createCard(s, c, sec.levels[c], LEFT + c * (CARD_W + GAP), y + 80));
    }

    this.notice = this.add.text(w / 2, h - 70, '', { ...TEXT_STYLE, fontSize: '26px', fontStyle: 'bold', stroke: '#000000', strokeThickness: 5 })
      .setOrigin(0.5).setAlpha(0);
    this.add.text(w / 2, h - 26, '← ↑ ↓ →  choose      Space / Enter  play      Esc in a level  back here      mouse works too', {
      ...TEXT_STYLE, fontSize: '22px', stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5, 1);

    this.controls = new InputActions();
    this.select(this.section, this.col);
    this.cameras.main.fadeIn(200);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.controls.destroy());
  }

  update(_time: number, deltaMs: number): void {
    for (let i = 0; i < this.parallax.length; i++) this.parallax[i].tilePositionX += deltaMs * 0.004 * (i + 1); // slow drift
    if (this.leaving) return;
    this.controls.update();
    const c = this.controls;
    if (c.pressed(Action.Left)) this.select(this.section, this.col - 1);
    else if (c.pressed(Action.Right)) this.select(this.section, this.col + 1);
    else if (c.pressed(Action.Up)) this.select(this.section - 1, this.col);
    else if (c.pressed(Action.Down)) this.select(this.section + 1, this.col);
    else if (c.pressed(Action.Jump) || c.pressed(Action.Attack)) this.play(this.current());
  }

  // ---------------------------------------------------------------- cards

  private createCard(section: number, col: number, entry: LevelEntry, x: number, y: number): Card {
    const locked = entry.scene === '';
    const container = this.add.container(x + CARD_W / 2, y + CARD_H / 2); // centred: scales about its middle
    const left = -CARD_W / 2;
    const top = -CARD_H / 2;

    const bg = this.add.graphics();
    bg.fillStyle(0x14110c, 0.9).fillRoundedRect(left, top, CARD_W, CARD_H, 12);
    container.add(bg);

    const tx = left + PAD;
    const ty = top + PAD;
    const tw = CARD_W - PAD * 2;
    if (entry.thumb !== '' && this.textures.exists(entry.thumb)) {
      container.add(this.coverImage(entry.thumb, tx, ty, tw, THUMB_H));
    } else if (entry.scene === 'Playground') {
      container.add(this.drawRoomThumb(tx, ty, tw, THUMB_H));
    } else if (!locked) {
      container.add(this.coverImage('bg_near', tx, ty, tw, THUMB_H));
    } else {
      container.add(this.drawLockedThumb(tx, ty, tw, THUMB_H));
    }

    const textY = ty + THUMB_H + 12;
    container.add(this.add.text(tx, textY, entry.label, {
      ...TEXT_STYLE, fontSize: '20px', fontStyle: 'bold', color: locked ? '#8c8470' : '#ffd24a',
    }));
    container.add(this.add.text(tx, textY + 26, entry.title, { ...TEXT_STYLE, fontSize: '30px', fontStyle: 'bold' }));
    container.add(this.add.text(tx, textY + 66, entry.blurb, {
      ...TEXT_STYLE, fontSize: '19px', color: '#c9bfa2', wordWrap: { width: tw },
    }));

    const frame = this.add.graphics();
    container.add(frame);
    if (locked) container.setAlpha(0.7);

    container.setSize(CARD_W, CARD_H).setInteractive({ useHandCursor: true });
    container.on('pointerover', () => this.select(section, col));
    container.on('pointerdown', () => {
      this.select(section, col);
      this.play(entry);
    });
    return { section: section, col: col, entry: entry, container: container, frame: frame };
  }

  /** Image scaled to cover the box and cropped to it (no stretching). */
  private coverImage(key: string, x: number, y: number, w: number, h: number): Phaser.GameObjects.Image {
    const img = this.add.image(0, 0, key).setOrigin(0, 0);
    const scale = Math.max(w / img.width, h / img.height);
    const cropW = w / scale;
    const cropH = h / scale;
    const cropX = (img.width - cropW) / 2;
    const cropY = (img.height - cropH) / 2;
    img.setCrop(cropX, cropY, cropW, cropH).setScale(scale);
    img.setPosition(x - cropX * scale, y - cropY * scale); // the crop keeps its place in the frame
    return img;
  }

  /** The Day 1 room in miniature: the real layout, green and red. */
  private drawRoomThumb(x: number, y: number, w: number, h: number): Phaser.GameObjects.Graphics {
    const g = this.add.graphics();
    g.fillStyle(BACKGROUND, 1).fillRect(x, y, w, h);
    const scale = Math.min(w / ROOM_W, h / ROOM_H);
    const ox = x + (w - ROOM_W * scale) / 2;
    const oy = y + (h - ROOM_H * scale) / 2;
    g.fillStyle(SOLID, 1);
    for (let i = 0; i < SOLIDS.length; i++) {
      const s = SOLIDS[i];
      g.fillRect(ox + s.x * scale, oy + s.y * scale, s.w * scale, s.h * scale);
    }
    g.fillStyle(0xffffff, 1).fillRect(ox + 3.125 * scale, oy + 20.125 * scale, 0.75 * scale, 0.875 * scale); // the cube
    return g;
  }

  private drawLockedThumb(x: number, y: number, w: number, h: number): Phaser.GameObjects.Graphics {
    const g = this.add.graphics();
    g.fillStyle(0x221e17, 1).fillRect(x, y, w, h);
    const cx = x + w / 2;
    const cy = y + h / 2 + 12;
    g.lineStyle(10, 0x8c8470, 1).strokeCircle(cx, cy - 34, 26); // padlock: shackle + body
    g.fillStyle(0x221e17, 1).fillRect(cx - 40, cy - 34, 80, 40);
    g.fillStyle(0x8c8470, 1).fillRoundedRect(cx - 40, cy - 22, 80, 62, 8);
    g.fillStyle(0x221e17, 1).fillCircle(cx, cy + 4, 8).fillRect(cx - 3, cy + 4, 6, 18);
    return g;
  }

  // ---------------------------------------------------------------- navigation

  private current(): LevelEntry {
    return SECTIONS[this.section].levels[this.col];
  }

  private select(section: number, col: number): void {
    section = Phaser.Math.Clamp(section, 0, SECTIONS.length - 1);
    col = Phaser.Math.Clamp(col, 0, SECTIONS[section].levels.length - 1);
    this.section = section;
    this.col = col;
    lastSection = section;
    lastCol = col;
    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i];
      const on = card.section === section && card.col === col;
      card.frame.clear();
      card.frame.lineStyle(on ? 5 : 2, on ? GOLD : CREAM, on ? 1 : 0.25);
      card.frame.strokeRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 12);
      this.tweens.killTweensOf(card.container);
      this.tweens.add({ targets: card.container, scale: on ? 1.04 : 1, duration: 120, ease: 'Quad.easeOut' });
    }
  }

  private play(entry: LevelEntry): void {
    if (this.leaving) return;
    if (entry.scene === '') { // locked: shake the card, say why
      const card = this.cards.find(c => c.section === this.section && c.col === this.col);
      if (card) this.tweens.add({ targets: card.container, x: card.container.x + 10, duration: 50, yoyo: true, repeat: 3 });
      this.notice.setText(entry.label + ' is not built yet: its difficulty design comes first').setAlpha(1);
      this.tweens.killTweensOf(this.notice);
      this.tweens.add({ targets: this.notice, alpha: 0, delay: 1400, duration: 400 });
      return;
    }
    this.leaving = true;
    this.cameras.main.fadeOut(200, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start(entry.scene, { checkpoint: -1, bottles: 0 }));
  }
}
