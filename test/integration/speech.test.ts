import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server";
import { FakeSpeechTokenProvider } from "../../src/server/providers/fake";
import { ProviderError, type SpeechTokenProvider } from "../../src/server/providers/types";
import { MAX_SPEECH_TOKENS_PER_MINUTE } from "../../src/server/services/speech";
import { errorEnvelopeSchema } from "../../src/shared/api";
import { speechTokenResponseSchema, speechUsageResponseSchema } from "../../src/shared/speech";
import { monthlyUsageResponseSchema } from "../../src/shared/tutor";
import { createTestDatabase, type TestDatabase } from "../helpers/d1";

let database: TestDatabase;
let speech: SpeechTokenProvider;
const app = createApp({ speech: () => speech });

type Extra = Record<string, string>;

function api(path: string, init: RequestInit = {}, extra: Extra = {}) {
  return app.request(`http://localhost/api/v1${path}`, init, { DB: database.db, APP_ENV: "development", DEV_AUTH_BYPASS: "true", ...extra });
}

const token = (extra: Extra = {}, headers: Record<string, string> = {}) => api("/speech/token", { method: "POST", headers }, extra);

function report(body: unknown, extra: Extra = {}) {
  return api("/speech/usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, extra);
}

const recognition = (audioSeconds: number, clientEventId: string = crypto.randomUUID()) => ({ clientEventId, kind: "recognition", audioSeconds });
const synthesis = (characters: number, clientEventId: string = crypto.randomUUID()) => ({ clientEventId, kind: "synthesis", characters });

async function failed(res: Response, status: number) {
  expect(res.status, await res.clone().text()).toBe(status);
  return errorEnvelopeSchema.parse(await res.json()).error;
}

async function rows(operation: string): Promise<number> {
  const row = await database.db.prepare("SELECT COUNT(*) AS n FROM usage_events WHERE operation = ?1").bind(operation).first<{ n: number }>();
  return row?.n ?? -1;
}

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.dispose();
});

beforeEach(async () => {
  speech = new FakeSpeechTokenProvider();
  await database.db.prepare("DELETE FROM usage_events").run();
});

describe("POST /speech/token (SPEC §7.1, FR-002)", () => {
  it("issues a short-lived token with the month's allowance, never the key, and never cached", async () => {
    const res = await token();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = speechTokenResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ token: "fake-speech-token", region: "local", mock: true });
    expect(Date.parse(body.expiresAt) - Date.now()).toBeGreaterThan(8 * 60_000);
    expect(body.allowance).toMatchObject({
      recognitionSeconds: 0,
      recognitionLimitSeconds: 18000,
      synthesisChars: 0,
      synthesisLimitChars: 500000,
      recognitionAvailable: true,
      synthesisAvailable: true,
    });
    expect(Object.keys(body).sort()).toEqual(["allowance", "expiresAt", "mock", "region", "token"]);
  });

  it("records that a token was issued, but never the token", async () => {
    await token();
    expect(await rows("speech_token")).toBe(1);
    const row = await database.db.prepare("SELECT * FROM usage_events WHERE operation = 'speech_token'").first<Record<string, unknown>>();
    expect(JSON.stringify(row)).not.toContain("fake-speech-token");
    expect(row).toMatchObject({ provider: "Local fake speech", status: "ok", estimated_usd: 0 });
  });

  it("requires the owner and refuses other sites", async () => {
    const production = { APP_ENV: "production", DEV_AUTH_BYPASS: "" };
    expect((await token(production)).status).toBe(503);
    expect((await report(synthesis(10), production)).status).toBe(503);
    expect((await token({}, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await api("/speech/token")).status).toBe(404);
    expect(await rows("speech_token")).toBe(0);
  });

  it("reports Azure refusing the key without passing on Azure's words, and logs the failure", async () => {
    speech = new FakeSpeechTokenProvider({
      fail: () => {
        throw new ProviderError("auth");
      },
    });
    const error = await failed(await token(), 503);
    expect(error).toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: false });
    expect(error.message).toMatch(/AZURE_SPEECH_KEY/);
    expect(error.message).toMatch(/Typed answers still work/);
    const row = await database.db.prepare("SELECT status FROM usage_events WHERE operation = 'speech_token'").first<{ status: string }>();
    expect(row?.status).toBe("error");
  });

  it("limits how often tokens can be asked for", async () => {
    for (let i = 0; i < MAX_SPEECH_TOKENS_PER_MINUTE; i += 1) expect((await token()).status).toBe(200);
    const error = await failed(await token(), 429);
    expect(error).toMatchObject({ code: "RATE_LIMITED", retryable: true });
    expect((speech as FakeSpeechTokenProvider).issued).toBe(MAX_SPEECH_TOKENS_PER_MINUTE);
  });
});

describe("the free-tier allowance (SPEC §4.3)", () => {
  it("counts what the browser reports, once per event", async () => {
    const event = recognition(4.25);
    const first = await report(event);
    expect(first.status).toBe(201);
    expect(speechUsageResponseSchema.parse(await first.json())).toMatchObject({ recorded: true, allowance: { recognitionSeconds: 4.3 } });

    const again = await report(event);
    expect(again.status).toBe(200);
    expect(speechUsageResponseSchema.parse(await again.json())).toMatchObject({ recorded: false, allowance: { recognitionSeconds: 4.3 } });

    expect((await report(synthesis(38))).status).toBe(201);
    const month = monthlyUsageResponseSchema.parse(await (await api("/usage/monthly")).json());
    expect(month.speech).toMatchObject({ recognitionSeconds: 4.3, synthesisChars: 38, recognitionAvailable: true, synthesisAvailable: true });
    // Speech on the free tier costs nothing in the spending estimate.
    expect(month.estimatedUsd).toBe(0);
    expect(month.tutor.requests).toBe(0);
  });

  it("rejects malformed and implausible reports", async () => {
    for (const body of [{}, recognition(0), recognition(61), synthesis(0), synthesis(2001), { ...synthesis(5), audioSeconds: 3 }, { kind: "recognition", audioSeconds: 3 }]) {
      expect((await report(body)).status).toBe(400);
    }
    expect(await rows("speech_recognition")).toBe(0);
  });

  it("still issues a token when only one half is used up, and says which", async () => {
    const limits = { AZURE_RECOGNITION_SECONDS_PER_MONTH: "10", AZURE_SYNTHESIS_CHARS_PER_MONTH: "100" };
    await report(recognition(10), limits);
    const body = speechTokenResponseSchema.parse(await (await token(limits)).json());
    expect(body.allowance).toMatchObject({ recognitionAvailable: false, synthesisAvailable: true });
  });

  it("refuses a token once both halves are used up, and says typing still works", async () => {
    const limits = { AZURE_RECOGNITION_SECONDS_PER_MONTH: "10", AZURE_SYNTHESIS_CHARS_PER_MONTH: "100" };
    await report(recognition(10), limits);
    await report(synthesis(100), limits);
    const error = await failed(await token(limits), 429);
    expect(error).toMatchObject({ code: "BUDGET_EXCEEDED", retryable: false });
    expect(error.message).toMatch(/free speech allowance is used up/);
    expect(error.message).toMatch(/typed answers/);
    expect((speech as FakeSpeechTokenProvider).issued).toBe(0);

    const month = monthlyUsageResponseSchema.parse(await (await api("/usage/monthly", {}, limits)).json());
    expect(month.speech).toMatchObject({ recognitionLimitSeconds: 10, synthesisLimitChars: 100, recognitionAvailable: false, synthesisAvailable: false });
  });

  it("starts each UTC month from zero", async () => {
    const now = new Date();
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1000).toISOString();
    await database.db
      .prepare("INSERT INTO usage_events (id, provider, operation, audio_seconds, status, recorded_at) VALUES (?1, 'x', 'speech_recognition', 99999, 'ok', ?2)")
      .bind(crypto.randomUUID(), lastMonth)
      .run();
    const body = speechTokenResponseSchema.parse(await (await token()).json());
    expect(body.allowance.recognitionSeconds).toBe(0);
  });

  it("does not let speech reports count toward the tutor's request limit", async () => {
    for (let i = 0; i < 25; i += 1) await report(synthesis(10));
    const month = monthlyUsageResponseSchema.parse(await (await api("/usage/monthly")).json());
    expect(month.tutor.requests).toBe(0);
    expect(month.speech.synthesisChars).toBe(250);
  });
});
