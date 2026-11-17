import { Ease, GameState, MathUtil, Rect, type Group, type Shape, type Sprite, type Text, type TextStyle, type TilingImage } from '../../engine';
import { Action } from '../Actions';
import { CREAM, GOLD } from '../constants';
import { BACKGROUND, ROOM_H, ROOM_W, SOLID, SOLIDS } from './PlaygroundState';
import { StateId } from './StateId';

/**
 * Level select. Levels are grouped by what they test: the Day 1 movement room, then one section per
 * puzzle mechanic with its Easy / Medium / Hard levels. Not-yet-built levels show as locked cards.
 * Keyboard: arrows choose, Space / Enter plays. Mouse: hover + click, wheel scrolls. In a level, Esc
 * comes back here.
 */

interface LevelEntry {
  state: number; // StateId to start, -1 = locked (not built yet)
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

const SECTIONS: MenuSection[] = [
  {
    heading: 'DAY 1  -  MOVEMENT',
    subheading: 'The very first test: the greybox room and the cube the movement was tuned with on Day 1.',
    levels: [
      { state: StateId.Playground, label: 'TEST ROOM', title: 'Movement Test Room', blurb: 'No enemies. Just run, jump and get the feel.', thumb: '' },
    ],
  },
  {
    heading: 'MECHANIC 1  -  NOISE & DISTRACTION',
    subheading: 'Clickers hear but cannot see. Throw bottles to lure them, sneak, hide behind crates, strike from behind.',
    levels: [
      { state: StateId.M1Easy, label: 'EASY', title: 'The Long Way Out', blurb: 'Tunnel, yard, a building, the rooftops.', thumb: 'thumb_m1_easy' },
      { state: StateId.M1Medium, label: 'MEDIUM', title: 'The Horde', blurb: 'Too many to sneak past. A car leaks gasoline...', thumb: 'thumb_m1_medium' },
      { state: StateId.M1Hard, label: 'HARD', title: 'Blackout', blurb: 'Night. One bottle at a time. Listen.', thumb: 'thumb_m1_hard' },
    ],
  },
  {
    heading: 'MECHANIC 2  -  SNIPERS',
    subheading: 'The army shoots anything that moves. Read the laser, move between shots, let the infected draw the fire.',
    levels: [
      { state: StateId.M2Easy, label: 'EASY', title: 'The Tower', blurb: 'A sniper tower, then a machine gun.', thumb: 'thumb_m2_easy' },
      { state: StateId.M2Medium, label: 'MEDIUM', title: 'Smoke', blurb: 'Cover breaks. He reloads at random. Steal smoke.', thumb: 'thumb_m2_medium' },
      { state: StateId.M2Hard, label: 'HARD', title: 'Escape', blurb: 'A helicopter hunts you down the valley.', thumb: 'thumb_m2_hard' },
    ],
  },
  {
    heading: 'MECHANIC 3  -  SCAVENGE & UPGRADE',
    subheading: 'Search the ruins for parts, build upgrades at the workbench, reach what you could not before.',
    levels: [
      { state: StateId.M3Easy, label: 'EASY', title: 'Spring Boots', blurb: 'A cliff too high. Find the parts, build the boots.', thumb: 'thumb_m3_easy' },
      { state: StateId.M3Medium, label: 'MEDIUM', title: 'The Sea', blurb: 'One gas canister: dash, or breathe below.', thumb: 'thumb_m3_medium' },
      { state: StateId.M3Hard, label: 'HARD', title: 'Everything', blurb: 'Pills through the tunnel, then dash the sea.', thumb: 'thumb_m3_hard' },
    ],
  },
];

const CARD_W = 420;
const CARD_H = 222;
const THUMB_H = 108;
const PAD = 12;
const LEFT = 120; // x of the first card / headings
const GAP = 40;
const SECTION_TOP = 88; // heading y of the first section
const SECTION_STEP = 310; // heading to heading (cards end 72 + CARD_H below the heading, then a gap)
const TOP_BAND = 92; // the fixed title strip: the list scrolls under it
const BOTTOM_BAND = 56; // the fixed key help strip
const GOLD_HEX = 0xffd24a;
const CREAM_HEX = 0xf0e6c8;

function Style(size: number, style: string = '', color: string = CREAM, outline: number = 0): TextStyle {
  const s: TextStyle = { family: 'Georgia, serif', size: size, style: style, color: color };
  if (outline > 0) {
    s.stroke = '#000000';
    s.strokeThickness = outline;
  }
  return s;
}

interface Card {
  section: number;
  col: number;
  entry: LevelEntry;
  box: Rect; // world rectangle (for the mouse)
  group: Group;
  frame: Shape;
}

/** Heading y of section s (world space: the camera scrolls the list). */
function SectionY(s: number): number {
  return SECTION_TOP + s * SECTION_STEP;
}

let lastSection = 1; // remembered between visits: back from a level, the cursor is where you left it
let lastCol = 0;

export class MenuState extends GameState {
  private cards: Card[] = [];
  private section = 0;
  private col = 0;
  private parallax: TilingImage[] = [];
  private notice!: Text;
  private leaving = false;
  private hovered = -1; // card under the mouse
  private moreUp!: Text; // shown when part of the list is hidden above / below
  private moreDown!: Text;

  OnStart(): void {
    const e = this.engine;
    const r = e.renderer;
    this.section = lastSection;
    this.col = lastCol;
    const w = e.width;
    const h = e.height;

    // Fixed to the screen: the background, the title strip, the key help. The list scrolls.
    const layers = ['bg_sky', 'bg_far', 'bg_mid', 'bg_near'];
    for (let i = 0; i < layers.length; i++) this.parallax.push(r.CreateTiling(0, 0, w, h, layers[i]).SetFixed());
    r.CreateShape().FillStyle(0x0b0a08, 0.62).FillRect(0, 0, w, h).SetFixed();
    r.CreateShape().FillStyle(0x0b0a08, 0.85).FillRect(0, 0, w, TOP_BAND).SetFixed().SetDepth(10);
    r.CreateShape().FillStyle(0x0b0a08, 0.85).FillRect(0, h - BOTTOM_BAND, w, BOTTOM_BAND).SetFixed().SetDepth(10);
    r.CreateText(w / 2, 48, 'LEVEL SELECT', Style(56, 'bold', CREAM, 8)).SetOrigin(0.5).SetFixed().SetDepth(11);

    for (let s = 0; s < SECTIONS.length; s++) {
      const sec = SECTIONS[s];
      const y = SectionY(s);
      r.CreateText(LEFT, y, sec.heading, Style(34, 'bold', GOLD, 5));
      r.CreateText(LEFT, y + 40, sec.subheading, Style(22, '', CREAM, 3));
      for (let c = 0; c < sec.levels.length; c++) this.cards.push(this.CreateCard(s, c, sec.levels[c], LEFT + c * (CARD_W + GAP), y + 72));
    }

    this.notice = r.CreateText(w - 40, 48, '', Style(26, 'bold', CREAM, 5)).SetOrigin(1, 0.5).SetAlpha(0).SetFixed().SetDepth(11);
    r.CreateText(w / 2, h - 16, '← ↑ ↓ →  choose      Space / Enter  play      Esc in a level  back here      mouse + wheel work too',
      Style(22, '', CREAM, 4)).SetOrigin(0.5, 1).SetFixed().SetDepth(11);

    // ▲ / ▼: more of the list above or below.
    const arrow = Style(30, '', GOLD, 5);
    this.moreUp = r.CreateText(w - 60, TOP_BAND + 24, '▲ more', arrow).SetOrigin(1, 0.5).SetFixed().SetDepth(11);
    this.moreDown = r.CreateText(w - 60, h - BOTTOM_BAND - 24, '▼ more', arrow).SetOrigin(1, 0.5).SetFixed().SetDepth(11);

    this.Select(this.section, this.col);
    e.camera.scrollY = this.ScrollFor(this.section, 0); // back from a level: already there, no slide
    e.camera.FadeIn(0.2);
  }

  OnDestroy(): void {
    this.engine.input.SetCursor('default');
  }

  OnUpdate(dt: number): void {
    const e = this.engine;
    const cam = e.camera;
    for (let i = 0; i < this.parallax.length; i++) this.parallax[i].tileX += dt * 4 * (i + 1); // slow drift
    if (e.input.wheelY !== 0) { // the wheel scrolls the list
      e.tweens.Kill(cam);
      cam.scrollY = MathUtil.Clamp(cam.scrollY + e.input.wheelY, 0, this.MaxScroll());
    }
    this.moreUp.SetVisible(cam.scrollY > 1);
    this.moreDown.SetVisible(cam.scrollY < this.MaxScroll() - 1);
    if (this.leaving) return;
    this.UpdateMouse();
    const input = e.input;
    if (input.Pressed(Action.Left)) this.Select(this.section, this.col - 1);
    else if (input.Pressed(Action.Right)) this.Select(this.section, this.col + 1);
    else if (input.Pressed(Action.Up)) this.Select(this.section - 1, this.col);
    else if (input.Pressed(Action.Down)) this.Select(this.section + 1, this.col);
    else if (input.Pressed(Action.Jump) || input.Pressed(Action.Attack)) this.Play(this.Current());
  }

  /** Hover selects a card (without sliding the list: the mouse is already there), a click plays it. */
  private UpdateMouse(): void {
    const input = this.engine.input;
    const inList = input.pointerY > TOP_BAND && input.pointerY < this.engine.height - BOTTOM_BAND;
    const worldX = input.pointerX + this.engine.camera.scrollX;
    const worldY = input.pointerY + this.engine.camera.scrollY;
    let over = -1;
    for (let i = 0; i < this.cards.length && inList; i++) if (this.cards[i].box.Contains(worldX, worldY)) over = i;
    if (over !== this.hovered) {
      this.hovered = over;
      input.SetCursor(over >= 0 ? 'pointer' : 'default');
      if (over >= 0) this.Select(this.cards[over].section, this.cards[over].col, false);
    }
    if (input.pointerPressed && over >= 0) {
      this.Select(this.cards[over].section, this.cards[over].col);
      this.Play(this.cards[over].entry);
    }
  }

  // ---------------------------------------------------------------- cards

  private CreateCard(section: number, col: number, entry: LevelEntry, x: number, y: number): Card {
    const r = this.engine.renderer;
    const locked = entry.state < 0;
    const group = r.CreateGroup(x + CARD_W / 2, y + CARD_H / 2); // centred: scales about its middle
    const left = -CARD_W / 2;
    const top = -CARD_H / 2;

    group.Add(r.CreateShape().FillStyle(0x14110c, 0.9).FillRoundedRect(left, top, CARD_W, CARD_H, 12));

    const tx = left + PAD;
    const ty = top + PAD;
    const tw = CARD_W - PAD * 2;
    if (entry.thumb !== '' && this.engine.assets.Exists(entry.thumb)) group.Add(this.CoverImage(entry.thumb, tx, ty, tw, THUMB_H));
    else if (entry.state === StateId.Playground) group.Add(this.DrawRoomThumb(tx, ty, tw, THUMB_H));
    else if (!locked) group.Add(this.CoverImage('bg_near', tx, ty, tw, THUMB_H));
    else group.Add(this.DrawLockedThumb(tx, ty, tw, THUMB_H));

    const textY = ty + THUMB_H + 12;
    group.Add(r.CreateText(tx, textY, entry.label, Style(20, 'bold', locked ? '#8c8470' : GOLD)));
    group.Add(r.CreateText(tx, textY + 26, entry.title, Style(30, 'bold')));
    const blurb = Style(19, '', '#c9bfa2');
    blurb.wrapWidth = tw;
    group.Add(r.CreateText(tx, textY + 66, entry.blurb, blurb));

    const frame = r.CreateShape();
    group.Add(frame);
    if (locked) group.SetAlpha(0.7);
    return { section: section, col: col, entry: entry, box: new Rect(x, y, CARD_W, CARD_H), group: group, frame: frame };
  }

  /** Image scaled to cover the box and cropped to it (no stretching). */
  private CoverImage(key: string, x: number, y: number, w: number, h: number): Sprite {
    const img = this.engine.renderer.CreateSprite(0, 0, key).SetOrigin(0, 0);
    const scale = Math.max(w / img.width, h / img.height);
    const cropW = w / scale;
    const cropH = h / scale;
    const cropX = (img.width - cropW) / 2;
    const cropY = (img.height - cropH) / 2;
    img.SetCrop(cropX, cropY, cropW, cropH).SetScale(scale);
    img.SetPosition(x - cropX * scale, y - cropY * scale); // the crop keeps its place in the frame
    return img;
  }

  /** The Day 1 room in miniature: the real layout, green and red. */
  private DrawRoomThumb(x: number, y: number, w: number, h: number): Shape {
    const g = this.engine.renderer.CreateShape();
    g.FillStyle(BACKGROUND, 1).FillRect(x, y, w, h);
    const scale = Math.min(w / ROOM_W, h / ROOM_H);
    const ox = x + (w - ROOM_W * scale) / 2;
    const oy = y + (h - ROOM_H * scale) / 2;
    g.FillStyle(SOLID, 1);
    for (let i = 0; i < SOLIDS.length; i++) {
      const s = SOLIDS[i];
      g.FillRect(ox + s.x * scale, oy + s.y * scale, s.w * scale, s.h * scale);
    }
    g.FillStyle(0xffffff, 1).FillRect(ox + 3.125 * scale, oy + 20.125 * scale, 0.75 * scale, 0.875 * scale); // the cube
    return g;
  }

  private DrawLockedThumb(x: number, y: number, w: number, h: number): Shape {
    const g = this.engine.renderer.CreateShape();
    g.FillStyle(0x221e17, 1).FillRect(x, y, w, h);
    const cx = x + w / 2;
    const cy = y + h / 2 + 12;
    g.LineStyle(10, 0x8c8470, 1).StrokeCircle(cx, cy - 34, 26); // padlock: shackle + body
    g.FillStyle(0x221e17, 1).FillRect(cx - 40, cy - 34, 80, 40);
    g.FillStyle(0x8c8470, 1).FillRoundedRect(cx - 40, cy - 22, 80, 62, 8);
    g.FillStyle(0x221e17, 1).FillCircle(cx, cy + 4, 8).FillRect(cx - 3, cy + 4, 6, 18);
    return g;
  }

  // ---------------------------------------------------------------- navigation

  private Current(): LevelEntry {
    return SECTIONS[this.section].levels[this.col];
  }

  /** keepVisible: slide the list so the chosen section is fully on screen (keys yes, mouse hover no). */
  private Select(section: number, col: number, keepVisible: boolean = true): void {
    const tw = this.engine.tweens;
    section = MathUtil.Clamp(section, 0, SECTIONS.length - 1);
    col = MathUtil.Clamp(col, 0, SECTIONS[section].levels.length - 1);
    this.section = section;
    this.col = col;
    lastSection = section;
    lastCol = col;
    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i];
      const on = card.section === section && card.col === col;
      card.frame.Clear().LineStyle(on ? 5 : 2, on ? GOLD_HEX : CREAM_HEX, on ? 1 : 0.25).StrokeRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 12);
      tw.Kill(card.group);
      tw.To(card.group, { scale: on ? 1.04 : 1 }, 0.12, { ease: Ease.QuadOut });
    }
    if (!keepVisible) return;
    // Keep the chosen section on screen: slide the list just enough.
    const cam = this.engine.camera;
    const target = this.ScrollFor(section, cam.scrollY);
    if (target !== cam.scrollY) {
      tw.Kill(cam);
      tw.To(cam, { scrollY: target }, 0.22, { ease: Ease.QuadOut });
    }
  }

  /** The camera scroll that shows the whole section (heading to card bottom) between the two strips. */
  private ScrollFor(section: number, current: number): number {
    const h = this.engine.height;
    const top = SectionY(section) - 8;
    const bottom = SectionY(section) + 72 + CARD_H + 16;
    let scroll = current;
    if (bottom - scroll > h - BOTTOM_BAND) scroll = bottom - (h - BOTTOM_BAND);
    if (top - scroll < TOP_BAND) scroll = top - TOP_BAND;
    return MathUtil.Clamp(scroll, 0, this.MaxScroll());
  }

  /** How far the list can scroll: the last section's cards just above the key help strip. */
  private MaxScroll(): number {
    return Math.max(0, SectionY(SECTIONS.length - 1) + 72 + CARD_H + 16 - (this.engine.height - BOTTOM_BAND));
  }

  private Play(entry: LevelEntry): void {
    if (this.leaving) return;
    const e = this.engine;
    if (entry.state < 0) { // locked: shake the card, say why
      const card = this.cards.find(c => c.section === this.section && c.col === this.col);
      if (card) e.tweens.To(card.group, { x: card.group.x + 10 }, 0.05, { yoyo: true, repeat: 3 });
      this.notice.SetText(entry.label + ' is not built yet: its difficulty design comes first').SetAlpha(1);
      e.tweens.Kill(this.notice);
      e.tweens.To(this.notice, { alpha: 0 }, 0.4, { delay: 1.4 });
      return;
    }
    this.leaving = true;
    e.camera.FadeOut(0.2, () => e.states.ChangeState(entry.state, { checkpoint: -1, bottles: 0 }));
  }
}
