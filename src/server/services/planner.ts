/**
 * Deterministic session planner (SPEC §6.2). Pure: the same inputs always
 * give the same plan. It chooses from rows already read from the curriculum
 * database; it never invents an item, a band or a topic.
 */
import { HSK_BANDS, type HskBand } from "../../shared/curriculum";
import type { SessionMinutes } from "../../shared/learning";
import {
  SESSION_PLAN_VERSION,
  TARGET_COUNTS,
  TIME_BUDGETS,
  type ActivityKind,
  type PlanActivity,
  type PlanSituation,
  type PlanTarget,
  type SessionPlan,
} from "../../shared/session";
import type { Skill } from "../../shared/learning";

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

const ACTIVITY_TEXT: Readonly<Record<ActivityKind, { skill: Skill; title: string; description: string }>> = {
  warmup: {
    skill: "speaking",
    title: "Warm-up",
    description: "A short, familiar exchange to get talking.",
  },
  listen: {
    skill: "listening",
    title: "Listen first",
    description: "Hear a short exchange about the situation before seeing any text.",
  },
  speak: {
    skill: "speaking",
    title: "Conversation",
    description: "Talk through the situation, one turn at a time.",
  },
  read: {
    skill: "reading",
    title: "Reading",
    description: "A short text that uses the session's words.",
  },
  write: {
    skill: "writing",
    title: "Writing",
    description: "A short typed response in your own words.",
  },
  summary: {
    skill: "reading",
    title: "Summary",
    description: "One to three corrections worth keeping, and what to review.",
  },
};

const ACTIVITY_ORDER: readonly ActivityKind[] = ["warmup", "listen", "speak", "read", "write", "summary"];

export function buildActivities(durationMinutes: SessionMinutes): PlanActivity[] {
  const budget = TIME_BUDGETS[durationMinutes];
  return ACTIVITY_ORDER.map((kind) => ({ kind, minutes: budget[kind], ...ACTIVITY_TEXT[kind] }));
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
 * How many targets of each role a session gets: at least half at the study
 * band, some review once there is something to review, and at most one
 * stretch item (never more than 20%).
 */
export function targetMix(total: number, reviewAvailable: number, stretchAvailable: number): TargetMix {
  const stretch = total >= 6 && stretchAvailable > 0 ? 1 : 0;
  const review = Math.min(Math.floor(total / 3), reviewAvailable);
  return { active: total - stretch - review, review, stretch };
}

export interface HskPlanInput {
  editionId: string;
  synthetic: boolean;
  targetBand: HskBand;
  bandSource: "owner_choice" | "suggestion";
  durationMinutes: SessionMinutes;
  localStudyDate: string;
  situation: PlanSituation;
  /** Entries at the study band, in the order they should be introduced. */
  activeCandidates: readonly CandidateItem[];
  /** Entries targeted in earlier sessions, longest-ago first. */
  reviewCandidates: readonly CandidateItem[];
  /** Entries one band up, in order. */
  stretchCandidates: readonly CandidateItem[];
  colloquial: ColloquialPick | null;
}

function toTarget(item: CandidateItem, role: PlanTarget["role"]): PlanTarget {
  return { itemId: item.id, sourceId: item.sourceId, hskBand: item.hskBand, hanzi: item.hanzi, pinyin: item.pinyin, role };
}

export function buildHskPlan(input: HskPlanInput): SessionPlan {
  const wanted = TARGET_COUNTS[input.durationMinutes];
  const mix = targetMix(wanted, input.reviewCandidates.length, input.stretchCandidates.length);

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

  const review = take(input.reviewCandidates, mix.review, "review");
  const stretch = take(input.stretchCandidates, mix.stretch, "stretch");
  // Whatever review or stretch could not supply is made up at the study band.
  const active = take(input.activeCandidates, wanted - review.length - stretch.length, "active");
  const stretchBand = stretch.length > 0 ? nextBand(input.targetBand) : null;

  return {
    version: SESSION_PLAN_VERSION,
    kind: "hsk",
    editionId: input.editionId,
    synthetic: input.synthetic,
    targetBand: input.targetBand,
    bandSource: input.bandSource,
    durationMinutes: input.durationMinutes,
    localStudyDate: input.localStudyDate,
    situation: input.situation,
    targets: [...active, ...review, ...stretch],
    grammarIds: [],
    colloquial: input.colloquial ? [input.colloquial] : [],
    levelConstraints: { activeBand: input.targetBand, stretchBand },
    activities: buildActivities(input.durationMinutes),
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
    colloquial: [],
    levelConstraints: { activeBand: null, stretchBand: null },
    activities: buildActivities(input.durationMinutes),
  };
}
