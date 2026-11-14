import Phaser from 'phaser';
import { Action, type InputActions } from '../core/InputActions';
import { ART_SCALE, TILE } from './constants';
import type { Player } from './Player';

/**
 * The father's letter: a dead survivor at the start of the level, sitting against a wall with a letter
 * for his son in his lap. It is the game's guide, written as his will (Arabic, Noto Naskh font).
 *  - A "!" bobs over him until the letter has been read once (remembered across restarts).
 *  - Standing next to him: Up opens the letter. The game pauses while it is open.
 *  - Arabic book order: ← next page, → previous page; Up / Space / X closes it.
 *  - The paper is an HTML element over the canvas (Phaser DOM): real text shaping, wrapping and fonts.
 *    Each page ends with a game-UI tip strip (the keys), outside the letter itself.
 */

interface LetterPage {
  title: string;
  paragraphs: string[];
  tip: string;
}

const PAGES: LetterPage[] = [
  {
    title: 'إلى ابني',
    paragraphs: [
      'إن وجدتَ هذه الورقة، فقد سبقتُك. لا تبكِ طويلًا يا بُني؛ البكاء صوت، والصوت في هذا العالم يقتل.',
      'عشتُ بعد نهاية العالم سنواتٍ أكثر مما ظننت. لم أنجُ لأني الأقوى، بل لأني تعلّمتُ متى أصمت، ومتى أنتظر، ومتى أضرب.',
      'كتبتُ لك هنا كل ما تعلّمته، ورقةً ورقة. اقرأها كلها قبل أن تنزل إلى النفق. هذه وصيتي، وهي كل ما أملك أن أتركه لك.',
    ],
    tip: '',
  },
  {
    title: 'أولًا: الكليكرز (Clickers)',
    paragraphs: [
      'في النفق تحتنا واحدٌ منهم. الكليكرز عُمْيٌ لا يرون شيئًا؛ ماتت عيونهم، لكن آذانهم صارت أحدّ من آذان الكلاب. ستسمعه قبل أن تراه: طقطقةٌ في حلقه لا تهدأ.',
      'يسمع خطوتك العادية من بعيد، ويسمع ركضك من أبعد، ويسمع ارتطامك بالأرض إذا قفزتَ من مكانٍ عالٍ. فإن سمعك مرةً لن يتركك، وسيتبع صوتك أينما ذهبت.',
      'لذلك انحنِ، وامشِ منحنيًا؛ المنحني لا يُسمع. تعلّم هذا قبل أي شيء آخر. ولا تلتصق بأحدهم حتى وأنت منحنٍ؛ إن صرتَ على بُعد ذراعين منه شعر بأنفاسك.',
    ],
    tip: 'انحنِ / قِف:  ↓  أو  C     •     الركض: Shift (يُسمع من بعيدٍ جدًا)',
  },
  {
    title: 'لا تواجه الكليكر أبدًا',
    paragraphs: [
      'لا تقف أمام أحدهم ولا تضربه في وجهه. إنهم أعنف مما تتخيل؛ إن أمسك بك فلن تفلت منه. ولن تؤذيه زجاجة، مهما رميتَها بقوة.',
      'لكن للزجاجة فائدةً أعظم: ارمِها بعيدًا عنك. إذا تحطمت ذهب إلى صوتها، ووقف هناك يُصغي إليه، وظهره لك.',
      'هذه لحظتك الوحيدة. وهو واقفٌ مشغولٌ بالصوت، تسلّل خلفه منحنيًا واضربه من ظهره؛ ضربةٌ واحدة تكفي. لكن أسرِع، فلن يُصغي إلا ثوانيَ قليلة، ثم يعود يبحث عنك.',
      'وفي النفق السقف منخفض؛ ارمِ قريبًا ومنخفضًا، وإلا ارتطمت الزجاجة بالسقف فوق رأسك.',
    ],
    tip: 'ارمِ: اضغط E مطوّلًا، صوّب بالأسهم، ثم اترك     •     علامة ! فوق الكليكر = مشغول: اضربه من ظهره بـ X',
  },
  {
    title: 'الصناديق',
    paragraphs: [
      'إن سمعك وجاء نحوك فلا تركض؛ لن تسبقه إلى الأبد. ابحث عن أقرب صندوق، وانحنِ خلفه، ولا تتحرك.',
      'ما دمتَ منحنيًا خلف صندوق فلن يجدك أحدٌ منهم، لا الكليكرز ولا غيرهم، حتى لو مرّ من جانبك. سيبحث قليلًا، ثم ييأس ويعود إلى مكانه.',
      'تعلّم أين الصناديق قبل أن تحتاجها. واجمع الزجاجات أينما وجدتها؛ ستجد بعضها مخبّأً معًا. الزجاجة الفارغة هنا أثمن من الطعام.',
    ],
    tip: 'منحنٍ خلف صندوق = مختفٍ تمامًا: لا يراك أحد ولا يمسك بك',
  },
  {
    title: 'ثانيًا: الرانرز (Runners)',
    paragraphs: [
      'الرانرز يرون. يركضون أسرع منك، ويقفزون أعلى منك، ويتسلقون خلفك. لا تحاول أن تسبقهم؛ لن تستطيع.',
      'إن رآك أحدهم فاختبئ عن عينه خلف صندوق، فينسى مكانك بعد قليل. أو قاتِله، وليس لقتاله إلا طريقةٌ واحدة:',
      'اقفز وانزل على رأسه بقدميك. سيدوخ ويترنّح ثوانيَ قليلة، وفي هذه الثواني اضربه بيديك، مرةً ومرةً ومرة، حتى يسقط ولا يقوم. وإن أصابت زجاجةٌ رأسه دوّخته أيضًا.',
      'ولا تتوقف عن الضرب؛ إن أفاق قبل أن يسقط، عاد إليك أشرس مما كان.',
    ],
    tip: 'اقفز: Space     •     اضرب: X     •     اقفز على رأسه، ثم 3 ضربات وهو دائخ',
  },
  {
    title: 'ثالثًا: السكريمر (Screamer)',
    paragraphs: [
      'وفوق الأسطح، في آخر الطريق، امرأةٌ أسميتُها السكريمر. لم أصل إليها. رأيتُها من بعيد تقف وحدها، تلتفت يمينًا ثم يسارًا كأنها تنتظر أحدًا.',
      'سمعتُ صرختها مرةً واحدة، فخرج الرانرز من كل مكان يركضون نحو الصوت. لا أعرف عنها أكثر من هذا. لكن إياك أن تدعها تراك.',
      'وشيءٌ أخير: الأبواب في هذه المدينة مقفلة، والمفاتيح معهم. رأيتُ أقواهم يحمل مفتاحًا كأنه يحرس الطريق. لن تعبر بابًا إلا إذا أسقطتَ حارسه.',
    ],
    tip: '',
  },
  {
    title: '',
    paragraphs: [
      'كنتُ أريد أن أكمل الطريق معك. سامحني.',
      'لا تثق بالصمت، ولا بالظلام. كن أذكى منهم لا أقوى منهم، واصبر؛ الصبر هنا سلاح.',
      'عِشْ يا بُني. هذا كل ما أطلبه منك.',
    ],
    tip: '',
  },
];

const SIGNATURE = 'أبوك';
const READ_RANGE_X = 1.4 * TILE; // how close you must stand to pick up the letter
const READ_RANGE_Y = 0.6 * TILE;
const CORPSE_BACK = 37 / 44; // the corpse sprite's back edge (fraction of its width): sits against the wall

let letterRead = false; // survives scene restarts: the "!" over the father only shows until it was read once

export class Letter {
  open = false;

  private readonly scene: Phaser.Scene;
  private readonly input: InputActions;
  private readonly x: number; // centre of the corpse, feet level
  private readonly y: number;
  private readonly marker: Phaser.GameObjects.Text;
  private readonly prompt: Phaser.GameObjects.Text;
  private readonly shade: Phaser.GameObjects.Rectangle;
  private readonly element: Phaser.GameObjects.DOMElement;
  private readonly paper: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly bodyEl: HTMLDivElement;
  private readonly signEl: HTMLDivElement;
  private readonly pageEl: HTMLDivElement;
  private readonly tipEl: HTMLDivElement;
  private page = 0;

  /** wallX = left edge of the wall he leans on (px), feetY = floor (px). */
  constructor(scene: Phaser.Scene, input: InputActions, wallX: number, feetY: number) {
    this.scene = scene;
    this.input = input;
    const corpse = scene.add.image(wallX, feetY, 'corpse').setOrigin(CORPSE_BACK, 1).setScale(ART_SCALE).setDepth(11.5); // in front of the grass (11)
    this.x = wallX - corpse.displayWidth * (CORPSE_BACK - 0.5);
    this.y = feetY;

    this.marker = scene.add.text(this.x, feetY - TILE * 1.2, '!', {
      fontFamily: 'Georgia, serif', fontSize: '56px', fontStyle: 'bold', color: '#ffd24a', stroke: '#000000', strokeThickness: 8,
    }).setOrigin(0.5, 1).setDepth(25);
    this.prompt = scene.add.text(this.x, feetY - TILE * 1.25, '↑  Read the letter', {
      fontFamily: 'Georgia, serif', fontSize: '26px', fontStyle: 'bold', color: '#f0e6c8', stroke: '#000000', strokeThickness: 5,
    }).setOrigin(0.5, 1).setDepth(25).setVisible(false);

    const w = scene.scale.width;
    const h = scene.scale.height;
    this.shade = scene.add.rectangle(0, 0, w, h, 0x0b0a08, 0.72).setOrigin(0, 0).setScrollFactor(0).setDepth(90).setVisible(false);

    const root = document.createElement('div');
    root.className = 'letter';
    root.innerHTML =
      '<div class="letter-paper"><div class="letter-title"></div><div class="letter-body"></div>'
      + '<div class="letter-sign"></div><div class="letter-page"></div></div>'
      + '<div class="letter-tip"></div>'
      + '<div class="letter-keys"><span>← الصفحة التالية</span><span>→ السابقة</span><span>↑ إغلاق</span></div>';
    this.paper = root.querySelector('.letter-paper') as HTMLDivElement;
    this.titleEl = root.querySelector('.letter-title') as HTMLDivElement;
    this.bodyEl = root.querySelector('.letter-body') as HTMLDivElement;
    this.signEl = root.querySelector('.letter-sign') as HTMLDivElement;
    this.pageEl = root.querySelector('.letter-page') as HTMLDivElement;
    this.tipEl = root.querySelector('.letter-tip') as HTMLDivElement;
    this.element = scene.add.dom(w / 2, h / 2, root).setScrollFactor(0).setDepth(100).setVisible(false);
    void document.fonts.load('31px "Noto Naskh Arabic"'); // fetch the font now, not on the first page
  }

  /** Once per frame, after input. While the letter is open the scene skips gameplay. */
  update(timeMs: number, player: Player): void {
    if (this.open) {
      if (this.input.pressed(Action.Left)) this.turn(1);
      else if (this.input.pressed(Action.Right)) this.turn(-1);
      else if (this.input.pressed(Action.Up) || this.input.pressed(Action.Jump) || this.input.pressed(Action.Attack)) this.close();
      return;
    }

    const near = !player.dead && Math.abs(player.feetX - this.x) < READ_RANGE_X && Math.abs(player.feetY - this.y) < READ_RANGE_Y;
    this.prompt.setVisible(near);
    this.marker.setVisible(!letterRead && !near);
    if (!letterRead) { // bob + pulse: "something here"
      this.marker.y = this.y - TILE * 1.2 + Math.sin(timeMs / 220) * 8;
      this.marker.setScale(1 + Math.sin(timeMs / 140) * 0.08);
    }
    if (near && this.input.pressed(Action.Up) && !this.input.held(Action.Throw)) this.show();
  }

  private show(): void {
    this.open = true;
    letterRead = true;
    this.page = 0;
    this.scene.physics.pause(); // the world stops while you read
    this.shade.setVisible(true);
    this.element.setVisible(true);
    this.prompt.setVisible(false);
    this.marker.setVisible(false);
    this.render();
  }

  private close(): void {
    this.open = false;
    this.shade.setVisible(false);
    this.element.setVisible(false);
    // Keys pressed to read / close must not leak into gameplay (a buffered jump, a crouch toggle).
    this.input.consume(Action.Jump);
    this.input.consume(Action.Down);
    this.input.consume(Action.Attack);
    this.input.consume(Action.Throw);
    this.scene.physics.resume();
  }

  private turn(step: number): void {
    const next = this.page + step;
    if (next >= PAGES.length) {
      this.close(); // past the last page: put the letter down
      return;
    }
    if (next < 0) return;
    this.page = next;
    this.render();
    this.paper.classList.remove('turn', 'turn-back');
    void this.paper.offsetWidth; // restart the CSS animation
    this.paper.classList.add(step > 0 ? 'turn' : 'turn-back');
  }

  private render(): void {
    const p = PAGES[this.page];
    this.titleEl.textContent = p.title;
    this.titleEl.style.display = p.title ? '' : 'none';
    this.bodyEl.textContent = '';
    for (let i = 0; i < p.paragraphs.length; i++) {
      const el = document.createElement('p');
      el.textContent = p.paragraphs[i];
      this.bodyEl.appendChild(el);
    }
    const last = this.page === PAGES.length - 1;
    this.signEl.textContent = last ? SIGNATURE : '';
    this.pageEl.textContent = toArabicDigits(this.page + 1) + ' / ' + toArabicDigits(PAGES.length);
    this.tipEl.textContent = p.tip;
    this.tipEl.style.visibility = p.tip ? 'visible' : 'hidden';
  }
}

function toArabicDigits(n: number): string {
  const digits = '٠١٢٣٤٥٦٧٨٩';
  let s = '';
  const text = String(n);
  for (let i = 0; i < text.length; i++) s += digits[text.charCodeAt(i) - 48];
  return s;
}
