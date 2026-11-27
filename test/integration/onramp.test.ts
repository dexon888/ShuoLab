import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/server";
import { TONE_CHECK, UNITS, onrampResultSchema, onrampStatusSchema } from "../../src/shared/onramp";
import { createTestDatabase, type TestDatabase } from "../helpers/d1";

let database: TestDatabase;
const app = createApp();
const send = (method: string, path: string, body?: unknown) =>
  app.request(
    `http://localhost/api/v1${path}`,
    { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) },
    { DB: database.db, APP_ENV: "development", DEV_AUTH_BYPASS: "true" },
  );

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(async () => {
  await database.dispose();
});

describe("the on-ramp API (SPEC §5.9, FR-032)", () => {
  it("scores a unit by its keys, records it, and reports the best result", async () => {
    const unit = UNITS[0];
    if (!unit) throw new Error("no unit");
    const answers = unit.items.map((i, n) => (n < 3 ? (i.answer + 1) % i.options.length : i.answer));
    const res = await send("POST", "/onramp/answers", { unitId: unit.id, answers });
    expect(res.status).toBe(201);
    const { result } = { result: onrampResultSchema.parse(((await res.json()) as { result: unknown }).result) };
    expect(result).toMatchObject({ correct: unit.items.length - 3, total: unit.items.length });
    expect(result.marks.slice(0, 4)).toEqual([false, false, false, true]);
    const status = onrampStatusSchema.parse(await (await send("GET", "/onramp")).json());
    expect(status.units).toEqual([{ unitId: unit.id, bestCorrect: unit.items.length - 3, total: unit.items.length, attempts: 1 }]);
    expect(status.checkPassed).toBe(false);
  });

  it("passes the tone check at 85% and not below", async () => {
    const right = TONE_CHECK.items.map((i) => i.answer);
    const wrong = (n: number) => right.map((a, i) => (i < n ? (a + 1) % 5 : a));
    let res = await send("POST", "/onramp/answers", { unitId: TONE_CHECK.id, answers: wrong(4) });
    expect(onrampResultSchema.parse(((await res.json()) as { result: unknown }).result).passed).toBe(false);
    expect(onrampStatusSchema.parse(await (await send("GET", "/onramp")).json()).checkPassed).toBe(false);
    res = await send("POST", "/onramp/answers", { unitId: TONE_CHECK.id, answers: wrong(3) });
    expect(onrampResultSchema.parse(((await res.json()) as { result: unknown }).result).passed).toBe(true);
    const status = onrampStatusSchema.parse(await (await send("GET", "/onramp")).json());
    expect(status).toMatchObject({ checkPassed: true, checkBest: 0.85 });
  });

  it("refuses an unknown unit and a wrong number of answers", async () => {
    expect((await send("POST", "/onramp/answers", { unitId: "nope", answers: [] })).status).toBe(404);
    expect((await send("POST", "/onramp/answers", { unitId: TONE_CHECK.id, answers: [0] })).status).toBe(400);
  });
});
