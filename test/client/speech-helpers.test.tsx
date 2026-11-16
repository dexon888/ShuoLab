import { afterEach, describe, expect, it, vi } from "vitest";
import { FAKE_TRANSCRIPT, FakeSpeechEngine } from "../../src/client/speech/fake-engine";
import { buildSsml, escapeXml, prosodyRate, readConfidence, utteranceSeconds } from "../../src/client/speech/ssml";
import { SpeechTokenSource } from "../../src/client/speech/token";
import { SpeechFailure } from "../../src/client/speech/types";
import type { SpeechTokenResponse } from "../../src/shared/speech";

function token(expiresInMs: number, now = Date.now()): SpeechTokenResponse {
  return {
    token: "t",
    region: "eastus",
    expiresAt: new Date(now + expiresInMs).toISOString(),
    mock: false,
    allowance: {
      month: "2026-03",
      recognitionSeconds: 0,
      recognitionLimitSeconds: 18000,
      synthesisChars: 0,
      synthesisLimitChars: 500000,
      recognitionAvailable: true,
      synthesisAvailable: true,
    },
  };
}

afterEach(() => {
  delete window.__shuolabFakeSpeech;
});

describe("SSML for Azure voices", () => {
  it("escapes the reply, so model output can never become markup", () => {
    const ssml = buildSsml(`好的</prosody><audio src="x"/>&"'`, 1);
    expect(ssml).toContain("好的&lt;/prosody&gt;&lt;audio src=&quot;x&quot;/&gt;&amp;&quot;&apos;");
    expect(ssml).not.toContain("<audio");
    expect(ssml.match(/<prosody/g)).toHaveLength(1);
    expect(escapeXml("a<b")).toBe("a&lt;b");
  });

  it("uses a Mandarin voice and the speech rate from Settings", () => {
    const ssml = buildSsml("你好", 0.85);
    expect(ssml).toContain('xml:lang="zh-CN"');
    expect(ssml).toContain('<voice name="zh-CN-XiaoxiaoNeural">');
    expect(ssml).toContain('<prosody rate="-15%">你好</prosody>');
  });

  it("turns rates into percentages and keeps them in a safe range", () => {
    expect(prosodyRate(1)).toBe("+0%");
    expect(prosodyRate(1.15)).toBe("+15%");
    expect(prosodyRate(0.75)).toBe("-25%");
    expect(prosodyRate(10)).toBe("+100%");
    expect(prosodyRate(Number.NaN)).toBe("+0%");
  });
});

describe("reading recognition results", () => {
  it("takes Azure's confidence for the best result", () => {
    expect(readConfidence('{"NBest":[{"Confidence":0.83,"Display":"你好"}]}')).toBe(0.83);
    expect(readConfidence('{"NBest":[]}')).toBeNull();
    expect(readConfidence('{"NBest":[{"Confidence":7}]}')).toBeNull();
    expect(readConfidence("not json")).toBeNull();
    expect(readConfidence(undefined)).toBeNull();
  });

  it("counts the longer of the speech and the time the microphone was open, within 0.1–60 seconds", () => {
    expect(utteranceSeconds(25_000_000, 1_000)).toBe(2.5);
    expect(utteranceSeconds(10_000_000, 4_340)).toBe(4.3);
    expect(utteranceSeconds(0, 0)).toBe(0.1);
    expect(utteranceSeconds(900_000_000, 0)).toBe(60);
    expect(utteranceSeconds(Number.NaN, 2_000)).toBe(2);
  });
});

describe("the speech token source", () => {
  it("fetches only when needed, reuses a fresh token, and shares one request between callers", async () => {
    let now = Date.parse("2026-03-04T10:00:00.000Z");
    const fetchToken = vi.fn(async () => token(9 * 60_000, now));
    const source = new SpeechTokenSource(fetchToken, () => now);

    expect(fetchToken).not.toHaveBeenCalled();
    await Promise.all([source.get(), source.get()]);
    expect(fetchToken).toHaveBeenCalledTimes(1);

    now += 8 * 60_000;
    await source.get();
    expect(fetchToken).toHaveBeenCalledTimes(1);

    // Within thirty seconds of the refresh time, a new token is fetched.
    now += 40_000;
    await source.get();
    expect(fetchToken).toHaveBeenCalledTimes(2);

    source.invalidate();
    await source.get();
    expect(fetchToken).toHaveBeenCalledTimes(3);
  });

  it("does not keep a failed request", async () => {
    const fetchToken = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(token(60_000));
    const source = new SpeechTokenSource(fetchToken);
    await expect(source.get()).rejects.toThrow("down");
    await expect(source.get()).resolves.toMatchObject({ token: "t" });
  });
});

describe("the stand-in speech engine", () => {
  const signal = () => new AbortController().signal;

  it("pretends to hear a fixed sentence and plays nothing", async () => {
    const engine = new FakeSpeechEngine(0);
    expect(engine.real).toBe(false);
    await expect(engine.recognize(signal())).resolves.toEqual({ kind: "recognized", text: FAKE_TRANSCRIPT, confidence: 0.92, audioSeconds: 2.4 });
    await expect(engine.speak("你好", 1, signal())).resolves.toEqual({ characters: 2, played: false });
    expect(window.__shuolabFakeSpeech?.spoken).toEqual(["你好"]);
  });

  it("follows a script, for browser tests", async () => {
    window.__shuolabFakeSpeech = { recognitions: [{ text: "我想喝茶。", confidence: 0.3 }, { noSpeech: true }, { error: "denied" }] };
    const engine = new FakeSpeechEngine(0);
    await expect(engine.recognize(signal())).resolves.toMatchObject({ text: "我想喝茶。", confidence: 0.3 });
    await expect(engine.recognize(signal())).resolves.toMatchObject({ kind: "no-speech" });
    await expect(engine.recognize(signal())).rejects.toBeInstanceOf(SpeechFailure);
  });

  it("stops when cancelled", async () => {
    const controller = new AbortController();
    const pending = new FakeSpeechEngine(1000).recognize(controller.signal);
    controller.abort();
    await expect(pending).resolves.toEqual({ kind: "cancelled" });
  });
});
