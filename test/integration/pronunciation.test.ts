import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server";
import { pronunciationSummarySchema } from "../../src/shared/pronunciation";
import { createTestDatabase, type TestDatabase } from "../helpers/d1";

let database: TestDatabase;
const app = createApp();
const send = (method: string, path: string, body?: unknown) =>
  app.request(`http://localhost/api/v1${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, { DB: database.db, APP_ENV: "development", DEV_AUTH_BYPASS: "true" });

const attempt = (accuracy: number, weak: string[] = []) => ({
  sessionId: null,
  referenceText: "我是学生",
  scores: { accuracy, fluency: accuracy, completeness: 100, pronunciation: accuracy },
  words: [..."我是学生"].map((c) => ({ text: c, accuracy: weak.includes(c) ? 40 : accuracy, error: weak.includes(c) ? "Mispronunciation" : "None" })),
  audioSeconds: 2.5,
});

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.dispose();
});

beforeEach(async () => {
  await database.db.prepare("DELETE FROM pronunciation_attempts").run();
});

describe("shadowing scores (SPEC §7.3, FR-039)", () => {
  it("stores scores and summarises them once there are enough", async () => {
    expect((await send("POST", "/pronunciation/attempts", attempt(70, ["学"]))).status).toBe(201);
    let s = pronunciationSummarySchema.parse(await (await send("GET", "/pronunciation/summary")).json());
    expect(s).toEqual({ attempts: 1, mean: null, weakCharacters: [{ text: "学", times: 1 }] });

    for (const a of [80, 90, 60, 100]) expect((await send("POST", "/pronunciation/attempts", attempt(a, a < 70 ? ["学", "生"] : []))).status).toBe(201);
    s = pronunciationSummarySchema.parse(await (await send("GET", "/pronunciation/summary")).json());
    expect(s.attempts).toBe(5);
    expect(s.mean).toEqual({ accuracy: 80, fluency: 80, completeness: 100, pronunciation: 80 });
    expect(s.weakCharacters).toEqual([
      { text: "学", times: 2 },
      { text: "生", times: 1 },
    ]);
  });

  it("refuses audio, bad scores and unknown sessions", async () => {
    expect((await send("POST", "/pronunciation/attempts", { ...attempt(80), audio: "UklGR" })).status).toBe(400);
    expect((await send("POST", "/pronunciation/attempts", { ...attempt(80), scores: { accuracy: 120, fluency: 1, completeness: 1, pronunciation: 1 } })).status).toBe(400);
    expect((await send("POST", "/pronunciation/attempts", { ...attempt(80), sessionId: crypto.randomUUID() })).status).toBe(404);
    const n = await database.db.prepare("SELECT COUNT(*) AS n FROM pronunciation_attempts").first<{ n: number }>();
    expect(n?.n).toBe(0);
  });
});
