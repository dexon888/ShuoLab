import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/server";
import { errorEnvelopeSchema, meResponseSchema } from "../../src/shared/api";
import { defaultSettings, settingsResponseSchema } from "../../src/shared/settings";
import { createTestDatabase, type TestDatabase } from "../helpers/d1";

let database: TestDatabase;

const env = () => ({ DB: database.db, APP_ENV: "development", DEV_AUTH_BYPASS: "true" });

function request(app: ReturnType<typeof createApp>, path: string, init: RequestInit = {}, bindings: object = env()) {
  return app.request(`http://localhost/api/v1${path}`, init, bindings);
}

function put(app: ReturnType<typeof createApp>, body: unknown, headers: Record<string, string> = {}) {
  return request(app, "/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function settingsOf(res: Response) {
  expect(res.status, await res.clone().text()).toBe(200);
  return settingsResponseSchema.parse(await res.json()).settings;
}

async function expectBadRequest(res: Response, message?: RegExp) {
  expect(res.status).toBe(400);
  const { error } = errorEnvelopeSchema.parse(await res.json());
  expect(error.code).toBe("BAD_REQUEST");
  if (message) expect(error.message).toMatch(message);
}

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);
afterAll(async () => {
  await database.dispose();
});

describe("settings (SPEC §5.1, §5.7, FR-020)", () => {
  const app = createApp();

  it("returns the defaults before anything is saved, with onboarding not done", async () => {
    const settings = await settingsOf(await request(app, "/settings"));
    expect(settings).toEqual(defaultSettings());
    expect(settings).toMatchObject({
      sessionMinutes: 20,
      studyBand: null,
      limits: { softUsd: 5, hardUsd: 10 },
      onboardedAt: null,
      updatedAt: null,
    });
    const me = meResponseSchema.parse(await (await request(app, "/me")).json());
    expect(me.settings).toEqual(defaultSettings());
  });

  it("requires the owner for reading and writing", async () => {
    const production = { DB: database.db, APP_ENV: "production" };
    expect((await request(app, "/settings", {}, production)).status).toBe(503);
    const res = await request(
      app,
      "/settings",
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" },
      production,
    );
    expect(res.status).toBe(503);
  });

  it("saves a partial update and leaves the other fields alone", async () => {
    const settings = await settingsOf(await put(app, { sessionMinutes: 30, studyBand: "7-9" }));
    expect(settings).toMatchObject({ sessionMinutes: 30, studyBand: "7-9", displayMode: "hanzi_pinyin", speechRate: 1 });
    expect(settings.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(settings.onboardedAt).toBeNull();
  });

  it("shows the same settings to a second device (a fresh app instance)", async () => {
    await settingsOf(
      await put(app, {
        nickname: "  小丁  ",
        timezone: "America/New_York",
        displayMode: "hanzi",
        speechRate: 0.85,
        slangIntensity: "high",
        selfRatedListening: "basic",
        selfRatedSpeaking: "none",
        limits: { softUsd: 2.5, hardUsd: 8 },
      }),
    );
    const otherDevice = createApp();
    const me = meResponseSchema.parse(await (await request(otherDevice, "/me")).json());
    expect(me.settings).toMatchObject({
      nickname: "小丁",
      timezone: "America/New_York",
      sessionMinutes: 30,
      studyBand: "7-9",
      displayMode: "hanzi",
      speechRate: 0.85,
      slangIntensity: "high",
      selfRatedListening: "basic",
      selfRatedSpeaking: "none",
      limits: { softUsd: 2.5, hardUsd: 8 },
      locale: "zh-Hans",
    });
  });

  it("keeps exactly one row however many times settings are saved", async () => {
    await put(app, { sessionMinutes: 15 });
    await put(app, { sessionMinutes: 25 });
    const rows = await database.db.prepare("SELECT owner_id, session_minutes FROM owner_settings").all();
    expect(rows.results).toEqual([{ owner_id: "owner", session_minutes: 25 }]);
  });

  it("records when onboarding was finished, once", async () => {
    const first = await settingsOf(await put(app, { onboarded: true }));
    expect(first.onboardedAt).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await settingsOf(await put(app, { onboarded: true, sessionMinutes: 20 }));
    expect(second.onboardedAt).toBe(first.onboardedAt);
    await expectBadRequest(await put(app, { onboarded: false }));
  });

  it("clears optional fields with null", async () => {
    const settings = await settingsOf(await put(app, { nickname: null, studyBand: null, selfRatedListening: null }));
    expect(settings).toMatchObject({ nickname: null, studyBand: null, selfRatedListening: null });
  });

  it.each([
    ["a session length that is not offered", { sessionMinutes: 45 }],
    ["a session length sent as text", { sessionMinutes: "20" }],
    ["a single level inside the shared 7–9 band", { studyBand: "8" }],
    ["an unknown reading-help level", { displayMode: "pinyin_only" }],
    ["a speech rate below the range", { speechRate: 0.5 }],
    ["a speech rate above the range", { speechRate: 1.2 }],
    ["an unknown colloquial level", { slangIntensity: "max" }],
    ["an unknown time zone", { timezone: "Mars/Olympus" }],
    ["an over-long nickname", { nickname: "x".repeat(41) }],
    ["a blank nickname", { nickname: "   " }],
    ["a negative limit", { limits: { softUsd: -1, hardUsd: 10 } }],
    ["a limit above the maximum", { limits: { softUsd: 5, hardUsd: 501 } }],
    ["a warning above the stop amount", { limits: { softUsd: 11, hardUsd: 10 } }],
    ["limits with a missing amount", { limits: { softUsd: 5 } }],
    ["an unknown self-rating", { selfRatedSpeaking: "fluent" }],
  ])("rejects %s and changes nothing", async (_name, body) => {
    const before = await settingsOf(await request(app, "/settings"));
    await expectBadRequest(await put(app, body));
    expect(await settingsOf(await request(app, "/settings"))).toEqual(before);
  });

  it("rejects fields that are not settings, rather than ignoring them", async () => {
    for (const body of [
      { ownerId: "someone-else" },
      { sessionMinutes: 20, isAdmin: true },
      { locale: "zh-Hant" },
      { updatedAt: "2000-01-01T00:00:00.000Z" },
      { onboardedAt: null },
    ]) {
      await expectBadRequest(await put(app, body), /cannot be changed here/);
    }
  });

  it("rejects an empty update, a non-object, invalid JSON and a non-JSON body", async () => {
    await expectBadRequest(await put(app, {}), /Nothing to update/);
    await expectBadRequest(await put(app, [1, 2]));
    await expectBadRequest(await put(app, "{not json"), /not valid JSON/);
    await expectBadRequest(await put(app, "sessionMinutes=20", { "Content-Type": "text/plain" }), /as JSON/);
    await expectBadRequest(await put(app, { nickname: "x".repeat(20_000) }), /too large/);
  });

  it("refuses a write sent from another site", async () => {
    const res = await put(app, { sessionMinutes: 15 }, { Origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(errorEnvelopeSchema.parse(await res.json()).error.code).toBe("FORBIDDEN");
    const settings = await settingsOf(await request(app, "/settings"));
    expect(settings.sessionMinutes).toBe(20);

    const sameSite = await put(app, { sessionMinutes: 15 }, { Origin: "http://localhost" });
    expect((await settingsOf(sameSite)).sessionMinutes).toBe(15);
  });

  it("stores text exactly, without it being read as SQL", async () => {
    const nickname = "Robert'); DROP TABLE owner_settings;--";
    const settings = await settingsOf(await put(app, { nickname }));
    expect(settings.nickname).toBe(nickname);
    const row = await database.db.prepare("SELECT COUNT(*) AS n FROM owner_settings").first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("rounds the speech rate to two decimals", async () => {
    expect((await settingsOf(await put(app, { speechRate: 0.8500001 }))).speechRate).toBe(0.85);
  });

  it("the database itself refuses a second owner row and out-of-range values", async () => {
    const insert = (id: string, minutes: number) =>
      database.db
        .prepare(
          "INSERT INTO owner_settings (owner_id, timezone, session_minutes, display_mode, speech_rate, slang_intensity, limits_json, updated_at) VALUES (?1, 'UTC', ?2, 'hanzi', 1, 'normal', '{}', 'now')",
        )
        .bind(id, minutes)
        .run();
    await expect(insert("intruder", 20)).rejects.toThrow();
    await database.db.prepare("DELETE FROM owner_settings").run();
    await expect(insert("owner", 45)).rejects.toThrow();
  });

  it("falls back to default limits when the stored limits are unreadable", async () => {
    await database.db
      .prepare(
        "INSERT INTO owner_settings (owner_id, timezone, session_minutes, display_mode, speech_rate, slang_intensity, limits_json, updated_at) VALUES ('owner', 'UTC', 25, 'hanzi', 1, 'normal', 'not json', '2026-01-01T00:00:00.000Z')",
      )
      .run();
    const settings = await settingsOf(await request(app, "/settings"));
    expect(settings).toMatchObject({ sessionMinutes: 25, limits: { softUsd: 5, hardUsd: 10 } });
  });
});
