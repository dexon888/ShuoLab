import { describe, expect, it } from "vitest";
import {
  buildActivities,
  buildFreeChatPlan,
  buildHskPlan,
  nextBand,
  targetMix,
  weakestSkill,
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
  it("adds up to the session length for every option, with or without a weak skill", () => {
    for (const minutes of SESSION_MINUTE_OPTIONS) {
      for (const weak of [null, "listening", "speaking", "reading", "writing"] as const) {
        const activities = buildActivities(minutes, weak);
        expect(activities.reduce((sum, a) => sum + a.minutes, 0)).toBe(minutes);
        expect(activities.filter((a) => a.kind !== "summary").every((a) => a.minutes >= 1)).toBe(true);
      }
    }
  });

  it("matches the 25-minute spine: warm-up 3, listen 4, notice 2, read 3, practice 3, conversation 7, write 3", () => {
    expect(TIME_BUDGETS[25]).toEqual({ warmup: 3, listen: 4, notice: 2, read: 3, practice: 3, speak: 7, write: 3, summary: 0 });
  });

  it("keeps listening and speaking at 40% or more of every session, even after a shift", () => {
    for (const minutes of SESSION_MINUTE_OPTIONS) {
      for (const weak of [null, "listening", "speaking", "reading", "writing"] as const) {
        expect(listeningSpeakingShare(buildActivities(minutes, weak)), `${minutes} min, ${weak}`).toBeGreaterThanOrEqual(0.4);
      }
    }
    expect(listeningSpeakingShare(buildActivities(25))).toBeGreaterThanOrEqual(0.55);
  });

  it("runs every step of the spine in order", () => {
    expect(buildActivities(20).map((a) => a.kind)).toEqual(["warmup", "listen", "notice", "read", "practice", "speak", "write", "summary"]);
    expect(buildActivities(20)[1]?.skill).toBe("listening");
  });

  it("moves minutes to the weakest skill's step", () => {
    const base = buildActivities(25);
    const shifted = buildActivities(25, "writing");
    const write = (a: typeof base) => a.find((x) => x.kind === "write")?.minutes ?? 0;
    expect(write(shifted)).toBe(write(base) + 2);
  });
});

describe("target mix (SPEC §6.2 step 2)", () => {
  it("targets 3 to 8 entries for every length", () => {
    for (const minutes of SESSION_MINUTE_OPTIONS) {
      expect(TARGET_COUNTS[minutes]).toBeGreaterThanOrEqual(3);
      expect(TARGET_COUNTS[minutes]).toBeLessThanOrEqual(8);
    }
  });

  it("never exceeds the total, keeps new words to 5 and stretch at most 20%", () => {
    for (const total of [3, 4, 5, 6, 7, 8]) {
      for (const review of [0, 1, 5, 50]) {
        for (const stretch of [0, 1, 9]) {
          const mix = targetMix(total, review, stretch);
          expect(mix.active + mix.review + mix.stretch).toBeLessThanOrEqual(total);
          expect(mix.active).toBeLessThanOrEqual(5);
          expect(mix.active, JSON.stringify({ total, review, stretch })).toBeGreaterThanOrEqual(mix.review);
          expect(mix.stretch).toBeLessThanOrEqual(total * 0.2);
          expect(mix.review).toBeLessThanOrEqual(review);
        }
      }
    }
  });

  it("has no review in a first session and no stretch in a short one", () => {
    expect(targetMix(8, 0, 1)).toEqual({ active: 5, review: 0, stretch: 1 });
    expect(targetMix(4, 10, 1)).toEqual({ active: 3, review: 1, stretch: 0 });
    // Recent misses always get room, up to three.
    expect(targetMix(4, 10, 0, 3)).toEqual({ active: 1, review: 3, stretch: 0 });
  });
});

describe("buildHskPlan", () => {
  it("produces a plan that passes the shared contract", () => {
    const plan = buildHskPlan(input({ reviewCandidates: items("2", 201, 4), stretchCandidates: items("3", 501, 1) }));
    expect(sessionPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.targets.map((t) => t.role)).toEqual(["active", "active", "active", "active", "active", "review", "review", "stretch"]);
    expect(plan.levelConstraints).toEqual({ activeBand: "2", stretchBand: "3" });
    expect(plan.grammarIds).toEqual([]);
    expect(plan.version).toBe(2);
  });

  it("takes candidates in the order given and is deterministic", () => {
    const a = buildHskPlan(input());
    const b = buildHskPlan(input());
    expect(a).toEqual(b);
    expect(a.targets.map((t) => t.sourceId)).toEqual([301, 302, 303, 304, 305]);
  });

  it("never lists the same entry twice, even if it is offered for two roles", () => {
    const shared = items("2", 301, 3);
    const plan = buildHskPlan(input({ reviewCandidates: shared, activeCandidates: [...shared, ...items("2", 304, 12)] }));
    expect(new Set(plan.targets.map((t) => t.itemId)).size).toBe(plan.targets.length);
    expect(plan.targets.filter((t) => t.role === "active").length).toBeLessThanOrEqual(5);
  });

  it("makes up a missing stretch entry at the study band", () => {
    const plan = buildHskPlan(input({ stretchCandidates: [] }));
    expect(plan.targets).toHaveLength(5);
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

describe("connected plan (SPEC §2.5, §6.2)", () => {
  const g = (n: number, band: HskBand = "2") => ({
    itemId: `test:grammar:${n}`,
    sourceId: n,
    hskBand: band,
    name: `样例${n}`,
    grammarType: "词类",
    example: `这是样例${n}。`,
    unverified: true,
  });
  const topic = { itemId: "test:topic:1", area: "基本信息", subject: "个人信息", details: "姓名、年龄", unverified: true };
  const task = { itemId: "test:task:1", task: "问答个人基本信息", canDo: "能询问个人的基本信息。", unverified: true };

  it("takes recent misses first, at most three", () => {
    const plan = buildHskPlan(input({ durationMinutes: 20, missedCandidates: items("2", 101, 4), reviewCandidates: items("2", 201, 4) }));
    expect(plan.targets.filter((t) => t.role === "review").map((t) => t.sourceId).slice(0, 3)).toEqual([101, 102, 103]);
    expect(plan.targets.some((t) => t.sourceId === 104)).toBe(false);
  });

  it("picks one recycled and one new grammar point, and only one in 15 minutes", () => {
    const plan = buildHskPlan(input({ recycledGrammar: [g(1)], newGrammar: [g(2), g(3)] }));
    expect(plan.grammar.map((x) => [x.sourceId, x.role])).toEqual([[1, "recycled"], [2, "new"]]);
    expect(plan.grammarIds).toEqual(["test:grammar:1", "test:grammar:2"]);
    const short = buildHskPlan(input({ durationMinutes: 15, recycledGrammar: [g(1)], newGrammar: [g(2)] }));
    expect(short.grammar).toHaveLength(1);
    expect(buildHskPlan(input({ newGrammar: [g(2), g(3)] })).grammar.map((x) => x.sourceId)).toEqual([2]);
  });

  it("shows the target words' characters in their words, plus up to three from words already met", () => {
    const plan = buildHskPlan(
      input({
        activeCandidates: [{ id: "t:1", sourceId: 1, hskBand: "2", hanzi: "学生", pinyin: null }],
        characters: [
          { itemId: "c:学", hanzi: "学", skill: "recognition", unverified: true },
          { itemId: "c:学w", hanzi: "学", skill: "writing", unverified: true },
          { itemId: "c:生", hanzi: "生", skill: "recognition", unverified: true },
          { itemId: "c:老", hanzi: "老", skill: "recognition", unverified: true },
          { itemId: "c:师", hanzi: "师", skill: "recognition", unverified: true },
          { itemId: "c:朋", hanzi: "朋", skill: "recognition", unverified: true },
          { itemId: "c:友", hanzi: "友", skill: "recognition", unverified: true },
        ],
        metWords: ["老师", "朋友"],
      }),
    );
    expect(plan.characters.map((c) => [c.hanzi, c.skill, c.word])).toEqual([
      ["学", "writing", "学生"],
      ["生", "recognition", "学生"],
      ["老", "recognition", "老师"],
      ["师", "recognition", "老师"],
      ["朋", "recognition", "朋友"],
    ]);
  });

  it("sets the session in a syllabus topic and makes the task's can-do statement the goal", () => {
    const plan = buildHskPlan(input({ topics: [topic], tasks: [task] }));
    expect(plan.topic).toEqual(topic);
    expect(plan.task).toEqual(task);
    expect(plan.situation).toMatchObject({ sourceType: "syllabus", titleZh: "个人信息", communicativeGoal: task.canDo });
    // Without both, the app-authored situation stays.
    expect(buildHskPlan(input({ topics: [topic] })).situation.sourceType).toBe("app-authored");
  });

  it("allows slang only in sessions of 20 minutes or more", () => {
    const colloquial = { id: "x", term: "靠谱", pinyin: null, meaningEn: "reliable", warnings: [], synthetic: true };
    expect(buildHskPlan(input({ durationMinutes: 15, colloquial })).colloquial).toEqual([]);
    expect(buildHskPlan(input({ durationMinutes: 20, colloquial })).colloquial).toHaveLength(1);
  });

  it("finds the weakest skill from evidence, and none without any", () => {
    expect(weakestSkill([])).toBeNull();
    expect(
      weakestSkill([
        { skill: "listening", attempts: 10, successes: 9 },
        { skill: "reading", attempts: 10, successes: 4 },
        { skill: "speaking", attempts: 0, successes: 0 },
        { skill: "writing", attempts: 5, successes: 5 },
      ]),
    ).toBe("speaking");
  });
});
