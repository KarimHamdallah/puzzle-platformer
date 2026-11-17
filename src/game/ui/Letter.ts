import type { Engine, HtmlNode, Shape, Text } from '../../engine';
import { Action } from '../Actions';
import { ART_SCALE, GOLD, Serif, TILE } from '../constants';
import type { Player } from '../entities/Player';

/**
 * Documents found on the dead (Arabic, Noto Naskh font): the game's guides, told as story.
 *  - FATHER_LETTER (Mechanic 1): a survivor against a wall, his will to his son; the noise guide.
 *  - SOLDIER_NEWSPAPER (Mechanic 2): a deserter shot by his own snipers, the army's paper with his note
 *    in the margin; the sniper guide.
 *  - A "!" bobs over the body until the document has been read once (remembered across restarts).
 *  - Standing next to him: Up opens the letter. The game pauses while it is open.
 *  - Arabic book order: ← next page, → previous page; Up / Space / X closes it.
 *  - The paper is an HTML element over the canvas: real text shaping, wrapping and fonts.
 */

interface LetterPage {
  title: string;
  paragraphs: string[];
  ink?: boolean; // handwritten in the margin (pencil), not printed
}

/** A document on a body: its pages, how it looks, and the body it lies with. */
export interface LetterDoc {
  id: string; // remembers "read" across restarts
  pages: LetterPage[];
  signature: string; // under the last page
  style: string; // extra CSS class on the paper: '' = letter, 'newspaper'
  masthead: string; // newspaper name over the first page ('' = none)
  sprite: string; // the body
  againstWall: boolean; // true: the body sits with its back to the wall at x (the father)
  prop: string; // image lying on the ground beside the body ('' = none)
  prompt: string;
}

const PAGES: LetterPage[] = [
  {
    title: 'إلى ابني',
    paragraphs: [
      'إن وجدتَ هذه الورقة، فقد سبقتُك. لا تبكِ طويلًا يا بُني؛ البكاء صوت، والصوت في هذا العالم يقتل.',
      'عشتُ بعد نهاية العالم سنواتٍ أكثر مما ظننت. لم أنجُ لأني الأقوى، بل لأني تعلّمتُ متى أصمت، ومتى أنتظر، ومتى أضرب.',
      'كتبتُ لك هنا كل ما تعلّمته، ورقةً ورقة. اقرأها كلها قبل أن تنزل إلى النفق. هذه وصيتي، وهي كل ما أملك أن أتركه لك.',
    ],
  },
  {
    title: 'أولًا: الكليكرز (Clickers)',
    paragraphs: [
      'في النفق تحتنا واحدٌ منهم. الكليكرز عُمْيٌ لا يرون شيئًا؛ ماتت عيونهم، لكن آذانهم صارت أحدّ من آذان الكلاب. ستسمعه قبل أن تراه: طقطقةٌ في حلقه لا تهدأ.',
      'يسمع خطوتك العادية من بعيد، ويسمع ركضك من أبعد، ويسمع ارتطامك بالأرض إذا قفزتَ من مكانٍ عالٍ. فإن سمعك مرةً لن يتركك، وسيتبع صوتك أينما ذهبت.',
      'لذلك انحنِ، وامشِ منحنيًا؛ المنحني لا يُسمع. تعلّم هذا قبل أي شيء آخر. ولا تلتصق بأحدهم حتى وأنت منحنٍ؛ إن صرتَ على بُعد ذراعين منه شعر بأنفاسك.',
    ],
  },
  {
    title: 'لا تواجه الكليكر أبدًا',
    paragraphs: [
      'لا تقف أمام أحدهم ولا تضربه في وجهه. إنهم أعنف مما تتخيل؛ إن أمسك بك فلن تفلت منه. ولن تؤذيه زجاجة، مهما رميتَها بقوة.',
      'لكن للزجاجة فائدةً أعظم: ارمِها بعيدًا عنك. إذا تحطمت ذهب إلى صوتها، ووقف هناك يُصغي إليه، وظهره لك.',
      'هذه لحظتك الوحيدة. وهو واقفٌ مشغولٌ بالصوت، تسلّل خلفه منحنيًا واضربه من ظهره؛ ضربةٌ واحدة تكفي. لكن أسرِع، فلن يُصغي إلا ثوانيَ قليلة، ثم يعود يبحث عنك.',
      'وفي النفق السقف منخفض؛ ارمِ قريبًا ومنخفضًا، وإلا ارتطمت الزجاجة بالسقف فوق رأسك.',
    ],
  },
  {
    title: 'الصناديق',
    paragraphs: [
      'إن سمعك وجاء نحوك فلا تركض؛ لن تسبقه إلى الأبد. ابحث عن أقرب صندوق، وانحنِ خلفه، ولا تتحرك.',
      'ما دمتَ منحنيًا خلف صندوق فلن يجدك أحدٌ منهم، لا الكليكرز ولا غيرهم، حتى لو مرّ من جانبك. سيبحث قليلًا، ثم ييأس ويعود إلى مكانه.',
      'تعلّم أين الصناديق قبل أن تحتاجها. واجمع الزجاجات أينما وجدتها؛ ستجد بعضها مخبّأً معًا. الزجاجة الفارغة هنا أثمن من الطعام.',
    ],
  },
  {
    title: 'ثانيًا: الرانرز (Runners)',
    paragraphs: [
      'الرانرز يرون. يركضون أسرع منك، ويقفزون أعلى منك، ويتسلقون خلفك. لا تحاول أن تسبقهم؛ لن تستطيع.',
      'إن رآك أحدهم فاختبئ عن عينه خلف صندوق، فينسى مكانك بعد قليل. أو قاتِله، وليس لقتاله إلا طريقةٌ واحدة:',
      'اقفز وانزل على رأسه بقدميك. سيدوخ ويترنّح ثوانيَ قليلة، وفي هذه الثواني اضربه بيديك، مرةً ومرةً ومرة، حتى يسقط ولا يقوم. وإن أصابت زجاجةٌ رأسه دوّخته أيضًا.',
      'ولا تتوقف عن الضرب؛ إن أفاق قبل أن يسقط، عاد إليك أشرس مما كان.',
    ],
  },
  {
    title: 'ثالثًا: السكريمر (Screamer)',
    paragraphs: [
      'وفوق الأسطح، في آخر الطريق، امرأةٌ أسميتُها السكريمر. لم أصل إليها. رأيتُها من بعيد تقف وحدها، تلتفت يمينًا ثم يسارًا كأنها تنتظر أحدًا.',
      'سمعتُ صرختها مرةً واحدة، فخرج الرانرز من كل مكان يركضون نحو الصوت. لا أعرف عنها أكثر من هذا. لكن إياك أن تدعها تراك.',
      'وشيءٌ أخير: الأبواب في هذه المدينة مقفلة، والمفاتيح معهم. رأيتُ أقواهم يحمل مفتاحًا كأنه يحرس الطريق. لن تعبر بابًا إلا إذا أسقطتَ حارسه.',
    ],
  },
  {
    title: '',
    paragraphs: [
      'كنتُ أريد أن أكمل الطريق معك. سامحني.',
      'لا تثق بالصمت، ولا بالظلام. كن أذكى منهم لا أقوى منهم، واصبر؛ الصبر هنا سلاح.',
      'عِشْ يا بُني. هذا كل ما أطلبه منك.',
    ],
  },
];

const SIGNATURE = 'أبوك';

export const FATHER_LETTER: LetterDoc = {
  id: 'father', pages: PAGES, signature: SIGNATURE, style: '', masthead: '', sprite: 'corpse', againstWall: true, prop: '',
  prompt: '↑  Read the letter',
};

export const SOLDIER_NEWSPAPER: LetterDoc = {
  id: 'newspaper',
  pages: [
    {
      title: 'الجيش يدخل القرية',
      paragraphs: [
        'دخلت وحدات الجيش القرية فجر اليوم، بعد أن انتشرت العدوى في أحيائها الشرقية خلال أيامٍ قليلة.',
        'وقال متحدّثٌ باسم القيادة إنّ القرية «لم تعد قابلةً للإنقاذ»، وإنّ قرارًا صدر بإبادتها بالكامل، شارعًا شارعًا، وبيتًا بيتًا.',
        'ولم يُعلَن عن أي ممرٍّ آمنٍ للسكان.',
      ],
    },
    {
      title: 'لا أحد يخرج، لا أحد يدخل',
      paragraphs: [
        'وجاء في البيان أنّ كل من يغادر القرية سيُعامَل كمصاب، حتى لو بدا سليمًا؛ فالعدوى لا تظهر في ساعاتها الأولى، وقد يحملها من لا يعرف أنه يحملها.',
        'وصدر أمرٌ بتصفية أي شخصٍ يُرصد خارجًا من القرية أو داخلًا إليها، دون إنذار.',
        'ونُشر القنّاصة على الأبراج المطلّة على الطرق، ولديهم أوامر صريحة: لا تمييز بين مصابٍ وسليم، ولا بين إنسانٍ ومسخ.',
      ],
    },
    {
      title: 'على الهامش، بقلم رصاص',
      ink: true,
      paragraphs: [
        'كنتُ واحدًا منهم. رأيتهم يطلقون النار على أناسٍ لم تمسّهم العدوى. حاولتُ أن أهرب... ورآني القنّاص في البرج.',
        'إن وجدتَ هذه الجريدة: ما إن تخطو في مرماه حتى يجدك ضوؤه الأحمر، ويطاردك أسرع مما تركض. ولن يتركك أبدًا.',
        'لكنه يحتاج لحظةً ليُعيد التلقيم بعد كل طلقة. حين يصوّب انحنِ خلف صندوق ودعه يضرب الخشب؛ إن بقيتَ واقفًا رأى رأسك. وحين يُعمّر اركض إلى الصندوق التالي.',
        'والرشّاش عند البيت الأخير لا يرحم أحدًا... ولا حتى الموتى الذين يمشون.',
      ],
    },
  ],
  signature: 'جنديٌّ هارب',
  style: 'newspaper',
  masthead: 'صحيفة الوادي — العدد الأخير',
  sprite: 'dead_soldier',
  againstWall: false,
  prop: 'newspaper',
  prompt: '↑  Read the newspaper',
};
const READ_RANGE_X = 1.4 * TILE; // how close you must stand to pick up the letter
const READ_RANGE_Y = 0.6 * TILE;
const CORPSE_BACK = 37 / 44; // the corpse sprite's back edge (fraction of its width): sits against the wall

const readDocs = new Set<string>(); // survives level restarts: the "!" over a body only shows until it was read once
export class Letter {
  open = false;

  private readonly engine: Engine;
  private readonly x: number; // centre of the corpse, feet level
  private readonly y: number;
  private readonly marker: Text;
  private readonly prompt: Text;
  private readonly shade: Shape;
  private readonly element: HtmlNode;
  private readonly paper: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly bodyEl: HTMLDivElement;
  private readonly signEl: HTMLDivElement;
  private readonly pageEl: HTMLDivElement;
  private readonly mastheadEl: HTMLDivElement;
  private readonly doc: LetterDoc;
  private page = 0;

  /**
   * x = the wall the body leans on (doc.againstWall: its left edge, px) or the body's centre (px);
   * feetY = floor (px).
   */
  constructor(engine: Engine, doc: LetterDoc, x: number, feetY: number) {
    this.engine = engine;
    this.doc = doc;
    const r = engine.renderer;
    if (doc.againstWall) {
      const corpse = r.CreateSprite(x, feetY, doc.sprite).SetOrigin(CORPSE_BACK, 1).SetScale(ART_SCALE).SetDepth(11.5); // in front of the grass (11)
      this.x = x - corpse.displayWidth * (CORPSE_BACK - 0.5);
    } else {
      r.CreateSprite(x, feetY + 4, doc.sprite).SetOrigin(0.5, 1).SetScale(ART_SCALE).SetDepth(11.5);
      this.x = x;
    }
    if (doc.prop) r.CreateSprite(this.x - TILE * 0.9, feetY + 2, doc.prop).SetOrigin(0.5, 1).SetScale(ART_SCALE).SetDepth(11.6);
    this.y = feetY;

    this.marker = r.CreateText(this.x, feetY - TILE * 1.2, '!', Serif(56, 'bold', GOLD, 8)).SetOrigin(0.5, 1).SetDepth(25);
    this.prompt = r.CreateText(this.x, feetY - TILE * 1.25, doc.prompt, Serif(26)).SetOrigin(0.5, 1).SetDepth(25).SetVisible(false);

    const w = engine.width;
    const h = engine.height;
    this.shade = r.CreateShape().FillStyle(0x0b0a08, 0.72).FillRect(0, 0, w, h).SetFixed().SetDepth(90).SetVisible(false);

    const root = document.createElement('div');
    root.className = doc.style ? 'letter ' + doc.style : 'letter';
    root.innerHTML =
      '<div class="letter-paper"><div class="letter-masthead"></div><div class="letter-title"></div><div class="letter-body"></div>'
      + '<div class="letter-sign"></div><div class="letter-page"></div></div>'
      + '<div class="letter-keys"><span>← الصفحة التالية</span><span>→ السابقة</span><span>↑ إغلاق</span></div>';
    this.paper = root.querySelector('.letter-paper') as HTMLDivElement;
    this.titleEl = root.querySelector('.letter-title') as HTMLDivElement;
    this.bodyEl = root.querySelector('.letter-body') as HTMLDivElement;
    this.signEl = root.querySelector('.letter-sign') as HTMLDivElement;
    this.pageEl = root.querySelector('.letter-page') as HTMLDivElement;
    this.mastheadEl = root.querySelector('.letter-masthead') as HTMLDivElement;
    this.element = r.CreateHtml(w / 2, h / 2, root).SetDepth(100).SetVisible(false);
    void document.fonts.load('31px "Noto Naskh Arabic"'); // fetch the font now, not on the first page
  }

  /** Once per frame, after input. While the letter is open the level skips gameplay. */
  Update(timeMs: number, player: Player): void {
    const input = this.engine.input;
    if (this.open) {
      if (input.Pressed(Action.Left)) this.Turn(1);
      else if (input.Pressed(Action.Right)) this.Turn(-1);
      else if (input.Pressed(Action.Up) || input.Pressed(Action.Jump) || input.Pressed(Action.Attack)
        || input.Pressed(Action.Back)) this.Close();
      return;
    }

    const near = !player.dead && Math.abs(player.feetX - this.x) < READ_RANGE_X && Math.abs(player.feetY - this.y) < READ_RANGE_Y;
    this.prompt.SetVisible(near);
    const read = readDocs.has(this.doc.id);
    this.marker.SetVisible(!read && !near);
    if (!read) { // bob + pulse: "something here"
      this.marker.y = this.y - TILE * 1.2 + Math.sin(timeMs / 220) * 8;
      this.marker.SetScale(1 + Math.sin(timeMs / 140) * 0.08);
    }
    if (near && input.Pressed(Action.Up) && !input.Held(Action.Throw)) this.Show();
  }

  private Show(): void {
    this.open = true;
    readDocs.add(this.doc.id);
    this.page = 0;
    this.engine.physics.paused = true; // the world stops while you read
    this.shade.SetVisible(true);
    this.element.SetVisible(true);
    this.prompt.SetVisible(false);
    this.marker.SetVisible(false);
    this.Render();
  }

  private Close(): void {
    const input = this.engine.input;
    this.open = false;
    this.shade.SetVisible(false);
    this.element.SetVisible(false);
    // Keys pressed to read / close must not leak into gameplay (a buffered jump, a crouch toggle).
    input.Consume(Action.Jump);
    input.Consume(Action.Down);
    input.Consume(Action.Attack);
    input.Consume(Action.Throw);
    this.engine.physics.paused = false;
  }

  private Turn(step: number): void {
    const next = this.page + step;
    if (next >= this.doc.pages.length) {
      this.Close(); // past the last page: put the letter down
      return;
    }
    if (next < 0) return;
    this.page = next;
    this.Render();
    this.paper.classList.remove('turn', 'turn-back');
    void this.paper.offsetWidth; // restart the CSS animation
    this.paper.classList.add(step > 0 ? 'turn' : 'turn-back');
  }

  private Render(): void {
    const pages = this.doc.pages;
    const p = pages[this.page];
    this.mastheadEl.textContent = this.page === 0 ? this.doc.masthead : '';
    this.mastheadEl.style.display = this.page === 0 && this.doc.masthead ? '' : 'none';
    this.bodyEl.classList.toggle('ink', p.ink === true);
    this.titleEl.textContent = p.title;
    this.titleEl.style.display = p.title ? '' : 'none';
    this.bodyEl.textContent = '';
    for (let i = 0; i < p.paragraphs.length; i++) {
      const el = document.createElement('p');
      el.textContent = p.paragraphs[i];
      this.bodyEl.appendChild(el);
    }
    const last = this.page === pages.length - 1;
    this.signEl.textContent = last ? this.doc.signature : '';
    this.pageEl.textContent = ToArabicDigits(this.page + 1) + ' / ' + ToArabicDigits(pages.length);
  }
}

function ToArabicDigits(n: number): string {
  const digits = '٠١٢٣٤٥٦٧٨٩';
  let s = '';
  const text = String(n);
  for (let i = 0; i < text.length; i++) s += digits[text.charCodeAt(i) - 48];
  return s;
}
