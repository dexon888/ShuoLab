import { describe, expect, it } from "vitest";
import {
  buildActivities,
  buildFreeChatPlan,
  buildHskPlan,
  nextBand,
  targetMix,
  type CandidateItem,
  type HskPlanInput,
} from "../../src/server/services/planner";
import { SITUATIONS, situationFor } from "../../src/server/services/situations";
import { HSK_BANDS, type HskBand } from "../../src/shared/curriculum";
import { SESSION_MINUTE_OPTIONS } from "../../src/shared/learning";
import {
  TARGET_COUNTS,
  TIME_BUDGETS,
  listeningSpeakingShare,
  localStudyDate,
  sessionPlanSchema,
} from "../../src/shared/session";

function items(band: HskBand, from: number, count: number): CandidateItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `test:vocab:${from + i}`,
    sourceId: from + i,
    hskBand: band,
    hanzi: `样例词${from + i}`,
    pinyin: null,
  }));
}

function input(over: Partial<HskPlanInput> = {}): HskPlanInput {
  return {
    editionId: "test",
    synthetic: true,
    targetBand: "2",
    bandSource: "owner_choice",
    durationMinutes: 30,
    localStudyDate: "2026-03-04",
    situation: situationFor(0),
    activeCandidates: items("2", 301, 16),
    reviewCandidates: [],
    stretchCandidates: [],
    colloquial: null,
    ...over,
  };
}

describe("time budget (SPEC §5.3)", () => {
  it("adds up to the session length for every option", () => {
    for (const minutes of SESSION_MINUTE_OPTIONS) {
      const activities = buildActivities(minutes);
      expect(activities.reduce((sum, a) => sum + a.minutes, 0)).toBe(minutes);
      expect(activities.every((a) => a.minutes >= 1)).toBe(true);
    }
  });

  it("matches the 25-minute target: 5 listening, 12 speaking, 4 reading, 4 writing and review", () => {
    const b = TIME_BUDGETS[25];
    expect(b.listen).toBe(5);
    expect(b.warmup + b.speak).toBe(12);
    expect(b.read).toBe(4);
    expect(b.write + b.summary).toBe(4);
  });

  it("keeps listening and speaking between 60% and 70% of every session", () => {
    for (const minutes of SESSION_MINUTE_OPTIONS) {
      const share = listeningSpeakingShare(buildActivities(minutes));
      expect(share, `${minutes} min`).toBeGreaterThanOrEqual(0.6);
      expect(share, `${minutes} min`).toBeLessThanOrEqual(0.7);
    }
  });

  it("runs the activities in the order warm-up, listen, speak, read, write, summary", () => {
    expect(buildActivities(20).map((a) => a.kind)).toEqual(["warmup", "listen", "speak", "read", "write", "summary"]);
    expect(buildActivities(20)[1]?.skill).toBe("listening");
  });
});

describe("target mix (SPEC §6.2 step 2)", () => {
  it("targets 3 to 8 entries for every length", () => {
    for (const minutes of SESSION_MINUTE_OPTIONS) {
      expect(TARGET_COUNTS[minutes]).toBeGreaterThanOrEqual(3);
      expect(TARGET_COUNTS[minutes]).toBeLessThanOrEqual(8);
    }
  });

  it("always keeps at least half active and stretch at most 20%", () => {
    for (const total of [3, 4, 5, 6, 7, 8]) {
      for (const review of [0, 1, 5, 50]) {
        for (const stretch of [0, 1, 9]) {
          const mix = targetMix(total, review, stretch);
          expect(mix.active + mix.review + mix.stretch).toBe(total);
          expect(mix.active * 2, JSON.stringify({ total, review, stretch })).toBeGreaterThanOrEqual(total);
          expect(mix.stretch).toBeLessThanOrEqual(total * 0.2);
          expect(mix.review).toBeLessThanOrEqual(review);
        }
      }
    }
  });

  it("has no review in a first session and no stretch in a short one", () => {
    expect(targetMix(8, 0, 1)).toEqual({ active: 7, review: 0, stretch: 1 });
    expect(targetMix(4, 10, 1)).toEqual({ active: 3, review: 1, stretch: 0 });
  });
});

describe("buildHskPlan", () => {
  it("produces a plan that passes the shared contract", () => {
    const plan = buildHskPlan(input({ reviewCandidates: items("2", 201, 4), stretchCandidates: items("3", 501, 1) }));
    expect(sessionPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.targets.map((t) => t.role)).toEqual(["active", "active", "active", "active", "active", "review", "review", "stretch"]);
    expect(plan.levelConstraints).toEqual({ activeBand: "2", stretchBand: "3" });
    expect(plan.grammarIds).toEqual([]);
  });

  it("takes candidates in the order given and is deterministic", () => {
    const a = buildHskPlan(input());
    const b = buildHskPlan(input());
    expect(a).toEqual(b);
    expect(a.targets.map((t) => t.sourceId)).toEqual([301, 302, 303, 304, 305, 306, 307, 308]);
  });

  it("never lists the same entry twice, even if it is offered for two roles", () => {
    const shared = items("2", 301, 3);
    const plan = buildHskPlan(input({ reviewCandidates: shared, activeCandidates: [...shared, ...items("2", 304, 12)] }));
    expect(new Set(plan.targets.map((t) => t.itemId)).size).toBe(plan.targets.length);
    expect(plan.targets).toHaveLength(8);
  });

  it("makes up a missing stretch entry at the study band", () => {
    const plan = buildHskPlan(input({ stretchCandidates: [] }));
    expect(plan.targets).toHaveLength(8);
    expect(plan.targets.every((t) => t.role === "active")).toBe(true);
    expect(plan.levelConstraints.stretchBand).toBeNull();
  });

  it("only ever uses ids it was given", () => {
    const given = input({ reviewCandidates: items("1", 1, 5), stretchCandidates: items("3", 501, 2) });
    const allowed = new Set([...given.activeCandidates, ...given.reviewCandidates, ...given.stretchCandidates].map((c) => c.id));
    expect(buildHskPlan(given).targets.every((t) => allowed.has(t.itemId))).toBe(true);
  });
});

describe("free chat and situations", () => {
  it("builds an open conversation with nothing from the syllabus", () => {
    const plan = buildFreeChatPlan({ durationMinutes: 15, localStudyDate: "2026-03-04", situation: situationFor(3) });
    expect(sessionPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan).toMatchObject({ kind: "free_chat", editionId: null, targetBand: null, targets: [], synthetic: false });
  });

  it("labels every situation as app-authored, with unique ids", () => {
    expect(SITUATIONS.length).toBeGreaterThanOrEqual(8);
    expect(SITUATIONS.every((s) => s.sourceType === "app-authored" && s.communicativeGoal.length > 10)).toBe(true);
    expect(new Set(SITUATIONS.map((s) => s.id)).size).toBe(SITUATIONS.length);
  });

  it("rotates through the situations without repeating until all are used", () => {
    const run = Array.from({ length: SITUATIONS.length }, (_, i) => situationFor(i).id);
    expect(new Set(run).size).toBe(SITUATIONS.length);
    expect(situationFor(SITUATIONS.length).id).toBe(situationFor(0).id);
  });
});

describe("bands and dates", () => {
  it("steps up one band at a time and stops at the shared 7–9 band", () => {
    expect(nextBand("1")).toBe("2");
    expect(nextBand("6")).toBe("7-9");
    expect(nextBand("7-9")).toBeNull();
    expect(HSK_BANDS.map((b) => nextBand(b)).filter(Boolean)).toHaveLength(6);
  });

  it("uses the owner's time zone for the study date", () => {
    const instant = new Date("2026-03-04T20:30:00.000Z");
    expect(localStudyDate(instant, "UTC")).toBe("2026-03-04");
    expect(localStudyDate(instant, "Asia/Shanghai")).toBe("2026-03-05");
    expect(localStudyDate(new Date("2026-03-04T03:00:00.000Z"), "America/Los_Angeles")).toBe("2026-03-03");
  });
});
