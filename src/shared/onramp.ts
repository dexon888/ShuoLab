/**
 * The sound-system on-ramp (SPEC §2.6 rule 1, §5.9, FR-032). Authored for
 * ShuoLab: pinyin, tones, tone changes and typing, taught before HSK
 * sessions. Not HSK content. Each drill item names the exact sound played
 * (pinyin with a tone number) so the speech service says precisely that.
 */
import { z } from "zod";

export type DrillMode = "listen" | "read" | "type";

export interface DrillItem {
  /** Characters spoken (with \`phoneme\`) or shown. */
  text: string;
  /** Exact pronunciation for the speech service, e.g. "ma 1". */
  phoneme?: string;
  /** What is asked, when it differs per item. */
  ask?: string;
  options: string[];
  /** Index of the right option; for typing items the answer is \`text\`. */
  answer: number;
}

export interface Unit {
  id: string;
  titleZh: string;
  title: string;
  /** Short paragraphs, in English, with pinyin examples. */
  explain: string[];
  mode: DrillMode;
  ask: string;
  items: DrillItem[];
}

const TONES = ["1st tone (ā, high and level)", "2nd tone (á, rising)", "3rd tone (ǎ, low, dipping)", "4th tone (à, falling)", "neutral tone (a, short and light)"];

/** A tone-identification item: the character is spoken with the given tone. */
function tone(text: string, syllable: string, t: 1 | 2 | 3 | 4 | 5): DrillItem {
  return { text, phoneme: `${syllable} ${t}`, options: TONES, answer: t - 1 };
}

function pick(text: string, phoneme: string, options: string[]): DrillItem {
  return { text, phoneme, options, answer: 0 };
}

export const UNITS: readonly Unit[] = [
  {
    id: "tones",
    titleZh: "声调",
    title: "The four tones",
    explain: [
      "Every Mandarin syllable has a tone, and the tone changes the word: mā (mother), má (hemp), mǎ (horse), mà (to scold).",
      "1st tone ā is high and level. 2nd tone á rises, like a question in English. 3rd tone ǎ dips low; in speech it often stays low. 4th tone à falls sharply. Some syllables are light and short, with no tone mark: the neutral tone.",
      "Listen to each syllable and choose its tone. Voices change between items on purpose: tones are heard across speakers.",
    ],
    mode: "listen",
    ask: "Which tone is this?",
    items: [
      tone("妈", "ma", 1), tone("麻", "ma", 2), tone("马", "ma", 3), tone("骂", "ma", 4),
      tone("汤", "tang", 1), tone("糖", "tang", 2), tone("躺", "tang", 3), tone("烫", "tang", 4),
      tone("书", "shu", 1), tone("熟", "shu", 2), tone("鼠", "shu", 3), tone("树", "shu", 4),
      tone("衣", "yi", 1), tone("姨", "yi", 2), tone("椅", "yi", 3), tone("意", "yi", 4),
    ],
  },
  {
    id: "tone-pairs",
    titleZh: "双音节",
    title: "Tones in two-syllable words",
    explain: [
      "Most words have two syllables, and the tones combine: Běijīng is 3-1, Zhōngguó is 1-2, diànhuà is 4-4.",
      "Listen to each word and choose its tone pattern.",
    ],
    mode: "listen",
    ask: "Which tone pattern is this?",
    items: [
      { text: "中国", phoneme: "zhong 1 guo 2", options: ["1-2", "2-1", "4-2", "1-4"], answer: 0 },
      { text: "北京", phoneme: "bei 3 jing 1", options: ["4-1", "3-1", "3-4", "2-1"], answer: 1 },
      { text: "电话", phoneme: "dian 4 hua 4", options: ["4-1", "2-4", "4-4", "1-4"], answer: 2 },
      { text: "美国", phoneme: "mei 3 guo 2", options: ["3-4", "2-2", "4-2", "3-2"], answer: 3 },
      { text: "飞机", phoneme: "fei 1 ji 1", options: ["1-1", "1-4", "4-1", "2-1"], answer: 0 },
      { text: "熊猫", phoneme: "xiong 2 mao 1", options: ["1-1", "2-1", "2-4", "3-1"], answer: 1 },
      { text: "上海", phoneme: "shang 4 hai 3", options: ["4-1", "1-3", "4-3", "3-3"], answer: 2 },
      { text: "米饭", phoneme: "mi 3 fan 4", options: ["4-4", "3-1", "2-4", "3-4"], answer: 3 },
      { text: "学校", phoneme: "xue 2 xiao 4", options: ["2-4", "3-4", "2-1", "4-2"], answer: 0 },
      { text: "喝茶", phoneme: "he 1 cha 2", options: ["2-2", "1-2", "1-3", "4-2"], answer: 1 },
    ],
  },
  {
    id: "initials-1",
    titleZh: "声母（一）",
    title: "Initials: b p m f, d t n l, g k h",
    explain: [
      "The initial is the consonant at the start of a syllable. b, d, g are unaspirated: no puff of air, closer to English 'spy', 'sty', 'sky'. p, t, k are aspirated: a strong puff, like English 'pie', 'tie', 'kite'.",
      "h is rougher than English h, from the back of the throat. Listen and choose the syllable you hear.",
    ],
    mode: "listen",
    ask: "Which syllable do you hear?",
    items: [
      pick("八", "ba 1", ["ba", "pa", "fa"]),
      pick("他", "ta 1", ["ta", "da", "na"]),
      pick("哥", "ge 1", ["ge", "ke", "he"]),
      pick("喝", "he 1", ["he", "ke", "ge"]),
      pick("拉", "la 1", ["la", "na", "da"]),
      pick("怕", "pa 4", ["pa", "ba", "fa"]),
      pick("可", "ke 3", ["ke", "ge", "he"]),
      pick("大", "da 4", ["da", "ta", "la"]),
    ],
  },
  {
    id: "initials-2",
    titleZh: "声母（二）",
    title: "Initials: j q x, zh ch sh r, z c s",
    explain: [
      "j q x are said with the tongue flat behind the lower teeth, lips spread: jī, qī, xī. They are only ever followed by i or ü.",
      "zh ch sh r curl the tongue tip back. z c s keep it behind the top teeth: z like 'ds' in 'kids', c like 'ts' in 'cats'. q and c are aspirated; j and z are not.",
    ],
    mode: "listen",
    ask: "Which syllable do you hear?",
    items: [
      pick("鸡", "ji 1", ["ji", "qi", "xi"]),
      pick("七", "qi 1", ["qi", "ji", "xi"]),
      pick("西", "xi 1", ["xi", "qi", "shi"]),
      pick("知", "zhi 1", ["zhi", "zi", "ji"]),
      pick("吃", "chi 1", ["chi", "ci", "qi"]),
      pick("诗", "shi 1", ["shi", "si", "xi"]),
      pick("资", "zi 1", ["zi", "zhi", "ci"]),
      pick("四", "si 4", ["si", "shi", "xi"]),
      pick("日", "ri 4", ["ri", "li", "shi"]),
      pick("次", "ci 4", ["ci", "chi", "si"]),
    ],
  },
  {
    id: "finals",
    titleZh: "韵母",
    title: "Finals: -n and -ng, ü",
    explain: [
      "The final is the rest of the syllable. -n ends with the tongue at the top teeth (an, en, in); -ng ends at the back, like 'sing' (ang, eng, ing, ong).",
      "ü is 'ee' with rounded lips. After j q x y it is written u (ju, qu, xu, yu) but still said ü; after n and l it keeps its dots (nü, lü).",
    ],
    mode: "listen",
    ask: "Which syllable do you hear?",
    items: [
      pick("安", "an 1", ["an", "ang", "en"]),
      pick("帮", "bang 1", ["bang", "ban", "beng"]),
      pick("门", "men 2", ["men", "meng", "min"]),
      pick("冷", "leng 3", ["leng", "len", "lin"]),
      pick("绿", "lv 4", ["lü", "lu", "li"]),
      pick("女", "nv 3", ["nü", "nu", "ni"]),
      pick("金", "jin 1", ["jin", "jing", "zhen"]),
      pick("星", "xing 1", ["xing", "xin", "sheng"]),
      pick("东", "dong 1", ["dong", "deng", "dun"]),
      pick("雪", "xue 3", ["xue", "xie", "shue"]),
    ],
  },
  {
    id: "spelling",
    titleZh: "拼写规则",
    title: "How pinyin is spelled",
    explain: [
      "A few spellings hide sounds. iou is written iu (liù), uei is written ui (guì), uen is written un (lùn).",
      "A syllable that starts with i, u or ü adds y or w: i → yi, ia → ya, u → wu, ua → wa, ü → yu.",
      "Tone marks go on a, o or e if there is one; in iu and ui they go on the second letter (liù, guì).",
    ],
    mode: "read",
    ask: "Choose the correct spelling.",
    items: [
      { text: "j + ü", options: ["ju", "jü", "jiu"], answer: 0 },
      { text: "l + iou, 4th tone", options: ["lioù", "liù", "lìu"], answer: 1 },
      { text: "g + uei, 4th tone", options: ["guèi", "gùi", "guì"], answer: 2 },
      { text: "ü on its own", options: ["ü", "wu", "yu"], answer: 2 },
      { text: "u on its own", options: ["wu", "u", "yu"], answer: 0 },
      { text: "i + an on its own", options: ["ian", "yan", "yian"], answer: 1 },
      { text: "n + ü, 3rd tone", options: ["nǚ", "nǔ", "nyǔ"], answer: 0 },
      { text: "h + ao, 3rd tone", options: ["hǎo", "haǒ", "hǎǒ"], answer: 0 },
    ],
  },
  {
    id: "tone-changes",
    titleZh: "变调",
    title: "Tone changes: 3-3, 一 and 不",
    explain: [
      "Two 3rd tones in a row: the first becomes a 2nd tone. 你好 is written nǐ hǎo but said ní hǎo.",
      "不 (bù) becomes bú before a 4th tone: bú shì (不是), bú yào (不要); otherwise it stays bù: bù hǎo, bù lái.",
      "一 (yī) is yí before a 4th tone (yí gè, yí yàng), yì before the other tones (yì tiān, yì nián, yìqǐ), and yī when counting or alone (dì yī).",
    ],
    mode: "read",
    ask: "How is the marked syllable said here?",
    items: [
      { text: "你好 — 你", options: ["2nd tone (ní)", "3rd tone (nǐ)"], answer: 0 },
      { text: "很好 — 很", options: ["3rd tone (hěn)", "2nd tone (hén)"], answer: 1 },
      { text: "不是 — 不", options: ["bù", "bú"], answer: 1 },
      { text: "不好 — 不", options: ["bù", "bú"], answer: 0 },
      { text: "一个 — 一", options: ["yī", "yí", "yì"], answer: 1 },
      { text: "一天 — 一", options: ["yī", "yí", "yì"], answer: 2 },
      { text: "第一 — 一", options: ["yī", "yí", "yì"], answer: 0 },
      { text: "不要 — 不", options: ["bù", "bú"], answer: 1 },
    ],
  },
  {
    id: "typing",
    titleZh: "打字",
    title: "Typing Chinese with pinyin",
    explain: [
      "Add a Chinese (Simplified) pinyin keyboard on your phone and computer. Type the pinyin without tones and pick the character from the list: nihao → 你好.",
      "ü is typed as v: nv → 女, lv → 绿. The candidate list shows several characters with the same sound; choose the one you want, which is itself practice in reading.",
      "Type each word below with your pinyin keyboard.",
    ],
    mode: "type",
    ask: "Type this with your pinyin keyboard:",
    items: [
      { text: "你好", ask: "nǐ hǎo", options: [], answer: 0 },
      { text: "我", ask: "wǒ", options: [], answer: 0 },
      { text: "中国", ask: "Zhōngguó", options: [], answer: 0 },
      { text: "女", ask: "nǚ (type nv)", options: [], answer: 0 },
      { text: "绿", ask: "lǜ (type lv)", options: [], answer: 0 },
      { text: "谢谢", ask: "xièxie", options: [], answer: 0 },
    ],
  },
];

/**
 * The tone check (SPEC §5.9): unseen syllables in a voice not used in the
 * units. Passed at 85% or more. Advice, not a lock.
 */
export const TONE_CHECK: Unit = {
  id: "tone-check",
  titleZh: "声调测试",
  title: "Tone check",
  explain: ["Twenty syllables you have not heard in the units, in a new voice. 85% or more passes."],
  mode: "listen",
  ask: "Which tone is this?",
  items: [
    tone("天", "tian", 1), tone("甜", "tian", 2), tone("舔", "tian", 3), tone("店", "dian", 4),
    tone("花", "hua", 1), tone("滑", "hua", 2), tone("跑", "pao", 3), tone("画", "hua", 4),
    tone("高", "gao", 1), tone("来", "lai", 2), tone("好", "hao", 3), tone("去", "qu", 4),
    tone("飞", "fei", 1), tone("肥", "fei", 2), tone("水", "shui", 3), tone("坐", "zuo", 4),
    tone("吗", "ma", 5), tone("呢", "ne", 5), tone("听", "ting", 1), tone("懂", "dong", 3),
  ],
};
export const TONE_CHECK_PASS = 0.85;

export const ALL_UNITS: readonly Unit[] = [...UNITS, TONE_CHECK];

/** The voices a drill alternates; the check uses one the units never do. */
export const DRILL_VOICES = ["zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural"] as const;
export const CHECK_VOICE = "zh-CN-YunyangNeural";

// --- API -----------------------------------------------------------------------------

export const onrampAnswerRequestSchema = z
  .object({
    unitId: z.string().max(40),
    /** An option index, or the typed text for a typing item. */
    answers: z.array(z.union([z.number().int().min(0).max(9), z.string().trim().max(40), z.null()])).max(30),
  })
  .strict();

export const onrampResultSchema = z.object({
  unitId: z.string(),
  correct: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  passed: z.boolean(),
  /** The right answer for each item, shown after answering. */
  keys: z.array(z.string()),
  /** Whether each answer was right. */
  marks: z.array(z.boolean()),
  answeredAt: z.string(),
});
export type OnrampResult = z.infer<typeof onrampResultSchema>;

export const onrampStatusSchema = z.object({
  /** Best result per unit so far. */
  units: z.array(z.object({ unitId: z.string(), bestCorrect: z.number().int(), total: z.number().int(), attempts: z.number().int() })),
  checkPassed: z.boolean(),
  /** Best tone-check score, 0–1, or null before a first try. */
  checkBest: z.number().min(0).max(1).nullable(),
});
export type OnrampStatus = z.infer<typeof onrampStatusSchema>;

/** A unit passes at 80%; the check at 85%. */
export function passMark(unitId: string): number {
  return unitId === TONE_CHECK.id ? TONE_CHECK_PASS : 0.8;
}

/** Scores answers to a unit by its authored keys. */
export function scoreUnit(unit: Unit, answers: readonly (number | string | null)[]): { marks: boolean[]; keys: string[] } {
  const marks = unit.items.map((item, i) => {
    const a = answers[i];
    if (unit.mode === "type") return typeof a === "string" && a.replace(/\s+/g, "") === item.text;
    return a === item.answer;
  });
  const keys = unit.items.map((item) => (unit.mode === "type" ? item.text : (item.options[item.answer] ?? "")));
  return { marks, keys };
}
