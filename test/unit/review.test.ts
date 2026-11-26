import { createEmptyCard } from "ts-fsrs";
import { describe, expect, it } from "vitest";
import { deserializeCard, isSuccess, preview, schedule, serializeCard } from "../../src/server/services/review";
import { deriveMastery, type RecallEvidence } from "../../src/shared/review";

const TZ = "Asia/Shanghai";
const introduced = "2026-03-01T02:00:00.000Z"; // 10:00 in Shanghai
const day = (n: number, hour = 2) => new Date(Date.UTC(2026, 2, 1 + n, hour)).toISOString();
const ok = (at: string): RecallEvidence => ({ attemptedAt: at, success: true });
const miss = (at: string): RecallEvidence => ({ attemptedAt: at, success: false });

describe("mastery from evidence (SPEC §6.1)", () => {
  it("is unseen with no exposure and no attempts", () => {
    expect(deriveMastery({ introducedAt: null, attempts: [], timeZone: TZ }).state).toBe("unseen");
  });

  it("exposure alone never goes past introduced", () => {
    expect(deriveMastery({ introducedAt: introduced, attempts: [], timeZone: TZ })).toMatchObject({
      state: "introduced",
      firstSeenAt: introduced,
      successDays: 0,
    });
  });

  it("is practiced after attempts with no successful recall", () => {
    expect(deriveMastery({ introducedAt: introduced, attempts: [miss(day(0)), miss(day(1))], timeZone: TZ })).toMatchObject({
      state: "practiced",
      failureCount: 2,
    });
  });

  it("is developing after one successful recall", () => {
    expect(deriveMastery({ introducedAt: introduced, attempts: [ok(day(0, 3))], timeZone: TZ }).state).toBe("developing");
  });

  it("needs successes on three different days, not three in one day", () => {
    const sameDay = [ok(day(2, 1)), ok(day(2, 3)), ok(day(2, 5))];
    expect(deriveMastery({ introducedAt: introduced, attempts: sameDay, timeZone: TZ })).toMatchObject({ state: "developing", successDays: 1 });
    const threeDays = [ok(day(0, 3)), ok(day(1)), ok(day(3))];
    expect(deriveMastery({ introducedAt: introduced, attempts: threeDays, timeZone: TZ })).toMatchObject({ state: "mastered", successDays: 3 });
  });

  it("counts days in the owner's time zone", () => {
    // 15:30 and 16:30 UTC fall on two different days in Shanghai (UTC+8).
    const attempts = [ok("2026-03-02T15:30:00.000Z"), ok("2026-03-02T16:30:00.000Z")];
    expect(deriveMastery({ introducedAt: introduced, attempts, timeZone: TZ }).successDays).toBe(2);
    expect(deriveMastery({ introducedAt: introduced, attempts, timeZone: "UTC" }).successDays).toBe(1);
  });

  it("needs at least one success a day or more after the word was introduced", () => {
    // Three local days, all within 24 hours of introduction.
    const start = "2026-03-01T15:00:00.000Z"; // 23:00 in Shanghai
    const attempts = [ok("2026-03-01T15:30:00.000Z"), ok("2026-03-01T16:30:00.000Z"), ok("2026-03-02T16:30:00.000Z")];
    expect(deriveMastery({ introducedAt: start, attempts, timeZone: TZ, rules: { minSuccessDays: 2, delayHours: 48 } }).state).toBe("developing");
    expect(deriveMastery({ introducedAt: start, attempts, timeZone: TZ, rules: { minSuccessDays: 2, delayHours: 24 } }).state).toBe("mastered");
  });

  it("a failed recall drops a mastered word back to developing, keeping the history", () => {
    const attempts = [ok(day(0, 3)), ok(day(1)), ok(day(3)), miss(day(4))];
    expect(deriveMastery({ introducedAt: introduced, attempts, timeZone: TZ })).toMatchObject({
      state: "developing",
      successDays: 3,
      failureCount: 1,
    });
    expect(deriveMastery({ introducedAt: introduced, attempts: [...attempts, ok(day(5))], timeZone: TZ }).state).toBe("mastered");
  });

  it("does not depend on the order attempts are given in", () => {
    const attempts = [ok(day(3)), miss(day(4)), ok(day(0, 3)), ok(day(1))];
    expect(deriveMastery({ introducedAt: introduced, attempts, timeZone: TZ }).state).toBe("developing");
  });
});

describe("FSRS scheduling (SPEC §14.1)", () => {
  const now = new Date("2026-03-04T10:00:00.000Z");

  it("gives the same due times for the same history and clock", () => {
    const run = () => {
      let card = createEmptyCard(now);
      const dues: string[] = [];
      let t = now;
      for (const rating of ["good", "good", "hard", "again", "good", "easy"] as const) {
        card = schedule(card, t, rating);
        dues.push(card.due.toISOString());
        t = card.due;
      }
      return dues;
    };
    expect(run()).toEqual(run());
  });

  it("schedules a better rating no sooner than a worse one", () => {
    const p = preview(createEmptyCard(now), now);
    expect(Date.parse(p.again)).toBeLessThanOrEqual(Date.parse(p.hard));
    expect(Date.parse(p.hard)).toBeLessThanOrEqual(Date.parse(p.good));
    expect(Date.parse(p.good)).toBeLessThan(Date.parse(p.easy));
    expect(Date.parse(p.again)).toBeGreaterThan(now.getTime());
  });

  it("stores and reads a card without changing its schedule", () => {
    const card = schedule(schedule(createEmptyCard(now), now, "good"), new Date("2026-03-04T10:10:00.000Z"), "good");
    const back = deserializeCard(serializeCard(card));
    expect(serializeCard(back)).toBe(serializeCard(card));
    const later = new Date("2026-03-20T10:00:00.000Z");
    expect(schedule(back, later, "good").due.toISOString()).toBe(schedule(card, later, "good").due.toISOString());
  });

  it("treats every rating but Again as a recall", () => {
    expect(["again", "hard", "good", "easy"].map((r) => isSuccess(r as "again"))).toEqual([false, true, true, true]);
  });
});
