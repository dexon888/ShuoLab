import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/server/env";
import { AzureSpeechTokenProvider, isValidAzureRegion } from "../../src/server/providers/azure";
import { FakeSpeechTokenProvider } from "../../src/server/providers/fake";
import { selectSpeechProvider } from "../../src/server/providers/select";
import { ProviderError } from "../../src/server/providers/types";
import { speechLimits } from "../../src/server/services/speech";
import { ApiError } from "../../src/server/validation/errors";
import { speechUsageRequestSchema } from "../../src/shared/speech";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJyZWdpb24iOiJlYXN0dXMifQ.c2lnbmF0dXJl";
const NOW = new Date("2026-03-04T10:00:00.000Z");

function azure(fetchImpl: typeof fetch, timeoutMs?: number) {
  return new AzureSpeechTokenProvider({ key: "azure-test-key-0123456789", region: "eastus", fetch: fetchImpl, timeoutMs });
}

describe("Azure token issuer (SPEC §4.1, §7.1)", () => {
  it("posts an empty body to the regional STS endpoint with the key in the header only", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JWT, { status: 200 }));
    const token = await azure(fetchMock).issueToken(NOW);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://eastus.api.cognitive.microsoft.com/sts/v1.0/issueToken");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Ocp-Apim-Subscription-Key")).toBe("azure-test-key-0123456789");
    expect(init?.body).toBe("");
    expect(String(url)).not.toContain("azure-test-key");

    // Nine minutes, inside Azure's ten, so the browser refreshes before it fails.
    expect(token).toEqual({ token: JWT, region: "eastus", expiresAt: "2026-03-04T10:09:00.000Z" });
  });

  it.each([
    ["an empty body", ""],
    ["an HTML page", "<html>sign in</html>"],
    ["JSON", '{"token":"x"}'],
    ["something far too long", `${"a".repeat(9000)}.b.c`],
  ])("rejects %s instead of passing it on as a token", async (_name, body) => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(body, { status: 200 }));
    await expect(azure(fetchMock).issueToken(NOW)).rejects.toMatchObject({ kind: "malformed" });
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limited"],
    [500, "http"],
  ])("maps HTTP %i to a category without Azure's message", async (status, kind) => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("Access denied due to invalid subscription key azure-test-key", { status }));
    const error = await azure(fetchMock).issueToken(NOW).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).kind).toBe(kind);
    expect((error as ProviderError).message).not.toContain("azure-test-key");
  });

  it("reports a network failure and a timeout", async () => {
    const down = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(azure(down).issueToken(NOW)).rejects.toMatchObject({ kind: "network" });
    const hang = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    await expect(azure(hang, 20).issueToken(NOW)).rejects.toMatchObject({ kind: "timeout" });
  });

  it("accepts only plain region names, since the region is part of the URL", () => {
    for (const ok of ["eastus", "westeurope", "southeastasia", "chinaeast2"]) expect(isValidAzureRegion(ok)).toBe(true);
    for (const bad of ["", "e", "East US", "eastus.evil.example", "evil.example/#", "eastus/", "1eastus", "a".repeat(41)]) {
      expect(isValidAzureRegion(bad), bad).toBe(false);
    }
    expect(() => new AzureSpeechTokenProvider({ key: "k", region: "evil.example/x" })).toThrow();
  });
});

describe("choosing the speech token issuer", () => {
  const db = {} as Env["DB"];

  it("uses the stand-in locally when Azure is not configured", () => {
    const speech = selectSpeechProvider({ DB: db, APP_ENV: "development" });
    expect(speech).toBeInstanceOf(FakeSpeechTokenProvider);
    expect(speech.mock).toBe(true);
  });

  it("never uses the stand-in in production, and says typing still works", () => {
    expect(() => selectSpeechProvider({ DB: db })).toThrowError(ApiError);
    expect(() => selectSpeechProvider({ DB: db, AZURE_SPEECH_KEY: "k" })).toThrowError(/Typed answers still work/);
  });

  it("uses Azure when a key and region are set, normalising the region", () => {
    const speech = selectSpeechProvider({ DB: db, AZURE_SPEECH_KEY: "k", AZURE_SPEECH_REGION: " EastUS " });
    expect(speech).toBeInstanceOf(AzureSpeechTokenProvider);
    expect((speech as AzureSpeechTokenProvider).region).toBe("eastus");
    expect(speech.mock).toBe(false);
  });

  it("refuses a region that is not a plain name", () => {
    expect(() => selectSpeechProvider({ DB: db, AZURE_SPEECH_KEY: "k", AZURE_SPEECH_REGION: "eastus.evil.example" })).toThrowError(
      /not a region name/,
    );
  });
});

describe("free-tier limits", () => {
  it("default to the Azure F0 allowance", () => {
    expect(speechLimits({})).toEqual({ recognitionSeconds: 18000, synthesisChars: 500000 });
  });

  it("can be lowered but never raised past the free allowance", () => {
    expect(speechLimits({ AZURE_RECOGNITION_SECONDS_PER_MONTH: "3600", AZURE_SYNTHESIS_CHARS_PER_MONTH: "100000" })).toEqual({
      recognitionSeconds: 3600,
      synthesisChars: 100000,
    });
    expect(speechLimits({ AZURE_RECOGNITION_SECONDS_PER_MONTH: "999999", AZURE_SYNTHESIS_CHARS_PER_MONTH: "9000000" })).toEqual({
      recognitionSeconds: 18000,
      synthesisChars: 500000,
    });
    expect(speechLimits({ AZURE_RECOGNITION_SECONDS_PER_MONTH: "lots", AZURE_SYNTHESIS_CHARS_PER_MONTH: "-5" })).toEqual({
      recognitionSeconds: 18000,
      synthesisChars: 500000,
    });
    expect(speechLimits({ AZURE_RECOGNITION_SECONDS_PER_MONTH: "0" }).recognitionSeconds).toBe(0);
  });
});

describe("usage reports", () => {
  const id = "1ce823bc-4f1a-46d7-91ba-a211649eac3a";

  it("accept one recognition or one spoken reply", () => {
    expect(speechUsageRequestSchema.safeParse({ clientEventId: id, kind: "recognition", audioSeconds: 4.2 }).success).toBe(true);
    expect(speechUsageRequestSchema.safeParse({ clientEventId: id, kind: "synthesis", characters: 38 }).success).toBe(true);
  });

  it.each([
    ["an utterance over 60 seconds", { clientEventId: id, kind: "recognition", audioSeconds: 61 }],
    ["zero seconds", { clientEventId: id, kind: "recognition", audioSeconds: 0 }],
    ["characters on a recognition", { clientEventId: id, kind: "recognition", audioSeconds: 3, characters: 10 }],
    ["fractional characters", { clientEventId: id, kind: "synthesis", characters: 2.5 }],
    ["an implausibly long reply", { clientEventId: id, kind: "synthesis", characters: 2001 }],
    ["an unknown kind", { clientEventId: id, kind: "translation", characters: 5 }],
    ["an id that is not a UUID", { clientEventId: "x", kind: "synthesis", characters: 5 }],
  ])("reject %s", (_name, body) => {
    expect(speechUsageRequestSchema.safeParse(body).success).toBe(false);
  });
});
