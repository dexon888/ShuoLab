/**
 * Deterministic session planner (SPEC §6.2). Pure: the same inputs always
 * give the same plan. It chooses from rows already read from the curriculum
 * database; it never invents an item, a band or a topic.
 *
 * Target priority, until the caps are reached:
 *   (a) words missed in recent reviews, at most 3;
 *   (b) words still being learned, longest-ago first;
 *   (c) new words at the study band, at most MAX_NEW_WORDS;
 *   (d) one stretch word in longer sessions.
 * Grammar: at most one recycled and one new point (one in all in 15 minutes).
 * The session is set in a syllabus topic and aims at a syllabus task when
 * those are imported, otherwise in an app-authored situation.
 */
import { HSK_BANDS, type HskBand } from "../../shared/curriculum";
import type { SessionMinutes, Skill } from "../../shared/learning";
import {
  MAX_EXTRA_CHARACTERS,
  MAX_NEW_WORDS,
  SPINE,
  STEP_SKILL,
  grammarCap,
  slangAllowed,
  spineBudget,
  type PlanCharacter,
  type PlanGrammar,
  type PlanTask,
  type PlanTopic,
  type SpineStep,
} from "../../shared/lesson";
import {
  SESSION_PLAN_VERSION,
  TARGET_COUNTS,
  type PlanActivity,
  type PlanSituation,
  type PlanTarget,
  type SessionPlan,
} from "../../shared/session";

/** A curriculum row the planner may choose. */
export interface CandidateItem {
  id: string;
  sourceId: number;
  hskBand: HskBand;
  hanzi: string;
  pinyin: string | null;
}

export interface ColloquialPick {
  id: string;
  term: string;
  pinyin: string | null;
  meaningEn: string;
  warnings: string[];
  synthetic: boolean;
}

/** A checkable grammar point (SPEC §6.3) with one example showing its pattern. */
export type GrammarCandidate = Omit<PlanGrammar, "role">;

/** A character on one of the band's lists. */
export interface CharacterCandidate {
  itemId: string;
  hanzi: string;
  skill: "recognition" | "writing";
  unverified: boolean;
}

const STEP_TEXT: Readonly<Record<SpineStep, { title: string; description: string }>> = {
  warmup: { title: "Warm-up", description: "Recall a few due cards and last session's corrections before anything new." },
  listen: { title: "Listen first", description: "Hear a short exchange that carries out today's task, before seeing any text." },
  notice: { title: "Notice", description: "See the words and the grammar pattern in what you heard, with a syllabus example." },
  read: { title: "Read", description: "A short new text in the same topic. Answer before the translation." },
  practice: { title: "Guided practice", description: "Two or three short prompts that need the grammar point and the words." },
  speak: { title: "Conversation", description: "Carry out the task with the tutor, one turn at a time." },
  write: { title: "Write", description: "Do the task in writing, using the grammar point." },
  summary: { title: "Summary", description: "Corrections worth keeping, what you met, and what comes back when." },
};

export function buildActivities(durationMinutes: SessionMinutes, weakest: Skill | null = null): PlanActivity[] {
  const budget = spineBudget(durationMinutes, weakest);
  return SPINE.map((kind) => ({ kind, skill: STEP_SKILL[kind], minutes: budget[kind], ...STEP_TEXT[kind] }));
}

/** The band after `band`, or null for the last one. */
export function nextBand(band: HskBand): HskBand | null {
  return HSK_BANDS[HSK_BANDS.indexOf(band) + 1] ?? null;
}

export interface TargetMix {
  active: number;
  review: number;
  stretch: number;
}

/**
 * How many targets of each role a session gets: some review once there is
 * something to review (always room for recent misses), at most one stretch
 * item (never more than 20%), and the rest new, capped at MAX_NEW_WORDS.
 */
export function targetMix(total: number, reviewAvailable: number, stretchAvailable: number, misses = 0): TargetMix {
  const stretch = total >= 6 && stretchAvailable > 0 ? 1 : 0;
  const review = Math.min(Math.max(Math.floor(total / 3), Math.min(misses, 3)), reviewAvailable);
  const active = Math.min(total - stretch - review, MAX_NEW_WORDS);
  return { active, review, stretch };
}

export interface HskPlanInput {
  editionId: string;
  synthetic: boolean;
  targetBand: HskBand;
  bandSource: "owner_choice" | "suggestion";
  durationMinutes: SessionMinutes;
  localStudyDate: string;
  /** Used when no syllabus topic and task are imported. */
  situation: PlanSituation;
  /** Words missed in recent reviews, most recent first (priority a). */
  missedCandidates?: readonly CandidateItem[];
  /** Entries at the study band, in the order they should be introduced. */
  activeCandidates: readonly CandidateItem[];
  /** Entries targeted in earlier sessions and not mastered, longest-ago first (priority b). */
  reviewCandidates: readonly CandidateItem[];
  /** Entries one band up, in order. */
  stretchCandidates: readonly CandidateItem[];
  colloquial: ColloquialPick | null;
  /** Grammar targeted before and not mastered, longest-ago first. */
  recycledGrammar?: readonly GrammarCandidate[];
  /** Grammar at the study band never targeted, in syllabus order. */
  newGrammar?: readonly GrammarCandidate[];
  /** Characters on the lists of the study band and below. */
  characters?: readonly CharacterCandidate[];
  /** Words already met, to show extra characters in (SPEC §6.2). */
  metWords?: readonly string[];
  /** Topics of the study band, best first (not used recently, not where recycled items began). */
  topics?: readonly PlanTopic[];
  /** Tasks of the study band, best first (not achieved, not used recently). */
  tasks?: readonly PlanTask[];
  weakestSkill?: Skill | null;
}

function toTarget(item: CandidateItem, role: PlanTarget["role"]): PlanTarget {
  return { itemId: item.id, sourceId: item.sourceId, hskBand: item.hskBand, hanzi: item.hanzi, pinyin: item.pinyin, role };
}

/** Grammar for the session: a recycled point first, then a new one, within the cap. */
export function pickGrammar(
  minutes: SessionMinutes,
  recycled: readonly GrammarCandidate[],
  fresh: readonly GrammarCandidate[],
): PlanGrammar[] {
  const cap = grammarCap(minutes);
  const out: PlanGrammar[] = [];
  const first = recycled[0];
  if (first) out.push({ ...first, role: "recycled" });
  const next = fresh.find((g) => !out.some((o) => o.itemId === g.itemId));
  if (next && out.length < cap) out.push({ ...next, role: "new" });
  return out.slice(0, cap);
}

/**
 * Characters of the target words that are on the band's lists, then up to
 * MAX_EXTRA_CHARACTERS more from words already met, each shown in its word.
 */
export function pickCharacters(
  targets: readonly PlanTarget[],
  lists: readonly CharacterCandidate[],
  metWords: readonly string[],
): PlanCharacter[] {
  const byChar = new Map<string, CharacterCandidate>();
  for (const c of lists) {
    const known = byChar.get(c.hanzi);
    // A character on both lists is shown once, as one to write.
    if (!known || (known.skill === "recognition" && c.skill === "writing")) byChar.set(c.hanzi, c);
  }
  const out: PlanCharacter[] = [];
  const add = (ch: string, word: string) => {
    const c = byChar.get(ch);
    if (c && !out.some((o) => o.hanzi === ch)) {
      out.push({ itemId: c.itemId, hanzi: ch, skill: c.skill, word, unverified: c.unverified });
      return true;
    }
    return false;
  };
  for (const t of targets.filter((t) => t.role !== "stretch")) for (const ch of t.hanzi) add(ch, t.hanzi);
  let extra = 0;
  for (const word of metWords) {
    if (extra >= MAX_EXTRA_CHARACTERS) break;
    for (const ch of word) {
      if (extra >= MAX_EXTRA_CHARACTERS) break;
      if (add(ch, word)) extra += 1;
    }
  }
  return out;
}

function syllabusSituation(topic: PlanTopic, task: PlanTask): PlanSituation {
  return {
    id: `syllabus:${topic.itemId}:${task.itemId}`,
    sourceType: "syllabus",
    titleZh: topic.subject,
    titleEn: `${topic.area} · ${task.task}`,
    communicativeGoal: task.canDo,
  };
}

export function buildHskPlan(input: HskPlanInput): SessionPlan {
  const wanted = TARGET_COUNTS[input.durationMinutes];
  const missed = input.missedCandidates ?? [];
  const mix = targetMix(wanted, missed.length + input.reviewCandidates.length, input.stretchCandidates.length, missed.length);

  const seen = new Set<string>();
  const take = (candidates: readonly CandidateItem[], count: number, role: PlanTarget["role"]): PlanTarget[] => {
    const taken: PlanTarget[] = [];
    for (const item of candidates) {
      if (taken.length >= count) break;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      taken.push(toTarget(item, role));
    }
    return taken;
  };

  const misses = take(missed, Math.min(3, mix.review), "review");
  const review = [...misses, ...take(input.reviewCandidates, mix.review - misses.length, "review")];
  const stretch = take(input.stretchCandidates, mix.stretch, "stretch");
  // Whatever review or stretch could not supply is made up at the study band, within the new-word cap.
  let active = take(input.activeCandidates, Math.min(wanted - review.length - stretch.length, MAX_NEW_WORDS), "active");
  // Still short of the minimum: more review, then more new words past the cap.
  const more = take(input.reviewCandidates, Math.max(0, 3 - review.length - active.length - stretch.length), "review");
  review.push(...more);
  if (review.length + active.length + stretch.length < 3) {
    active = [...active, ...take(input.activeCandidates, 3 - review.length - active.length - stretch.length, "active")];
  }
  const stretchBand = stretch.length > 0 ? nextBand(input.targetBand) : null;
  const targets = [...active, ...review, ...stretch];

  const grammar = pickGrammar(input.durationMinutes, input.recycledGrammar ?? [], input.newGrammar ?? []);
  const characters = pickCharacters(targets, input.characters ?? [], input.metWords ?? []);
  const topic = input.topics?.[0] ?? null;
  const task = input.tasks?.[0] ?? null;
  const situation = topic && task ? syllabusSituation(topic, task) : input.situation;
  const weakest = input.weakestSkill ?? null;

  return {
    version: SESSION_PLAN_VERSION,
    kind: "hsk",
    editionId: input.editionId,
    synthetic: input.synthetic,
    targetBand: input.targetBand,
    bandSource: input.bandSource,
    durationMinutes: input.durationMinutes,
    localStudyDate: input.localStudyDate,
    situation,
    targets,
    grammarIds: grammar.map((g) => g.itemId),
    grammar,
    characters,
    topic: topic && task ? topic : null,
    task: topic && task ? task : null,
    weakestSkill: weakest,
    colloquial: input.colloquial && slangAllowed(input.durationMinutes) ? [input.colloquial] : [],
    levelConstraints: { activeBand: input.targetBand, stretchBand },
    activities: buildActivities(input.durationMinutes, weakest),
  };
}

export interface FreeChatPlanInput {
  durationMinutes: SessionMinutes;
  localStudyDate: string;
  situation: PlanSituation;
}

/** An open conversation with no syllabus targets. Never HSK-labelled. */
export function buildFreeChatPlan(input: FreeChatPlanInput): SessionPlan {
  return {
    version: SESSION_PLAN_VERSION,
    kind: "free_chat",
    editionId: null,
    synthetic: false,
    targetBand: null,
    bandSource: null,
    durationMinutes: input.durationMinutes,
    localStudyDate: input.localStudyDate,
    situation: input.situation,
    targets: [],
    grammarIds: [],
    grammar: [],
    characters: [],
    topic: null,
    task: null,
    weakestSkill: null,
    colloquial: [],
    levelConstraints: { activeBand: null, stretchBand: null },
    activities: buildActivities(input.durationMinutes),
  };
}

/**
 * The weakest skill (SPEC §6.2): lowest share of successful qualifying
 * attempts over the window, ties to the fewest attempts. Null without any
 * evidence, so a new learner's sessions keep the standard budget.
 */
export function weakestSkill(stats: readonly { skill: Skill; attempts: number; successes: number }[]): Skill | null {
  const withData = stats.filter((s) => s.attempts > 0);
  if (withData.length === 0) return null;
  const all: Skill[] = ["listening", "speaking", "reading", "writing"];
  const rows = all.map((skill) => stats.find((s) => s.skill === skill) ?? { skill, attempts: 0, successes: 0 });
  rows.sort((a, b) => {
    const ra = a.attempts === 0 ? 0 : a.successes / a.attempts;
    const rb = b.attempts === 0 ? 0 : b.successes / b.attempts;
    return ra - rb || a.attempts - b.attempts;
  });
  return rows[0]?.skill ?? null;
}
