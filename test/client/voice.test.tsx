import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SpeechTokenSource } from "../../src/client/speech/token";
import { SpeechFailure, type RecognitionOutcome, type SpeakOutcome, type SpeechEngine } from "../../src/client/speech/types";
import type { SpeechEnvironment } from "../../src/client/speech/useVoice";
import type { MeResponse, ProviderStatus } from "../../src/shared/api";
import type { SessionStateResponse } from "../../src/shared/debrief";
import type { SessionDetail } from "../../src/shared/session";
import type { SpeechAllowance, SpeechTokenResponse } from "../../src/shared/speech";
import type { Turn, TurnResponse } from "../../src/shared/tutor";
import { json, renderApp, savedSettings, type Responder } from "./render";

const ID = "11111111-2222-4333-8444-555555555555";
const SESSION = `/api/v1/sessions/${ID}`;

const liveSpeech: ProviderStatus = { id: "speech", vendor: "Azure AI Speech", mode: "live", model: null, setupHint: null };

function me(speech: ProviderStatus | null = liveSpeech, settings = savedSettings({ speechRate: 0.85 })): MeResponse {
  return { owner: { email: null, authMode: "dev-bypass" }, settings, providers: speech ? [speech] : [], curriculumImported: true, version: "test" };
}

function session(status: SessionDetail["status"] = "active"): SessionDetail {
  return {
    id: ID,
    kind: "free_chat",
    status,
    localStudyDate: "2026-03-04",
    durationMinutes: 15,
    targetBand: null,
    situationTitleEn: "Open conversation",
    situationTitleZh: "自由聊天",
    synthetic: false,
    createdAt: "2026-03-04T10:00:00.000Z",
    startedAt: "2026-03-04T10:01:00.000Z",
    endedAt: null,
    editionId: null,
    actualSeconds: 0,
    plan: {
      version: 1,
      kind: "free_chat",
      editionId: null,
      synthetic: false,
      targetBand: null,
      bandSource: null,
      durationMinutes: 15,
      localStudyDate: "2026-03-04",
      situation: { id: "free-chat", sourceType: "app-authored", titleZh: "自由聊天", titleEn: "Open conversation", communicativeGoal: "Talk." },
      targets: [],
      grammarIds: [],
      grammar: [],
      characters: [],
      topic: null,
      task: null,
      weakestSkill: null,
      colloquial: [],
      levelConstraints: { activeBand: null, stretchBand: null },
      activities: [{ kind: "speak", skill: "speaking", minutes: 15, title: "Conversation", description: "Talk." }],
    },
  };
}

function turn(n: number, over: Partial<Turn> = {}): Turn {
  return {
    turnId: `aaaaaaaa-0000-4000-8000-00000000000${n}`,
    clientTurnId: `00000000-0000-4000-8000-00000000000${n}`,
    position: n,
    sourceMode: "speech",
    learnerText: `第${n}句。`,
    reply: { spokenZh: `回答${n}，你呢？`, pinyin: null, translationEn: null },
    referencedCurriculumItemIds: [],
    referencedColloquialIds: [],
    grammarUsedIds: [],
    grammarElicitedIds: [],
    learnerGrammarIds: [],
    coverage: null,
    feedback: { understoodIntent: true, corrections: [], encouragementZh: null, transcriptUncertain: false },
    fallback: false,
    createdAt: "2026-03-04T10:02:00.000Z",
    listening: { playedAt: null, revealedAt: null },
    ...over,
  };
}

function state(turns: Turn[] = [], status: SessionDetail["status"] = "active"): SessionStateResponse {
  return { session: session(status), turns, debrief: null, listening: null, materials: null, glosses: {} };
}

const allowance = (over: Partial<SpeechAllowance> = {}): SpeechAllowance => ({
  month: "2026-03",
  recognitionSeconds: 0,
  recognitionLimitSeconds: 18000,
  synthesisChars: 0,
  synthesisLimitChars: 500000,
  recognitionAvailable: true,
  synthesisAvailable: true,
  ...over,
});

type Scripted = RecognitionOutcome | SpeechFailure | "wait";

/** A speech engine the test controls: what it "hears", and what it was asked to say. */
class TestEngine implements SpeechEngine {
  async assess(): Promise<{ kind: "cancelled" }> {
    return { kind: "cancelled" };
  }
  async synthesize(text: string): Promise<{ audio: ArrayBuffer; characters: number }> {
    return { audio: new ArrayBuffer(0), characters: text.length };
  }
  readonly real: boolean;
  readonly heard: Scripted[] = [];
  readonly spoken: { text: string; rate: number }[] = [];
  speakResult: SpeakOutcome | SpeechFailure | null = null;
  listening: AbortSignal | null = null;

  constructor(real = true) {
    this.real = real;
  }

  async recognize(signal: AbortSignal): Promise<RecognitionOutcome> {
    const next = this.heard.shift() ?? { kind: "no-speech", audioSeconds: 1 };
    if (next === "wait") {
      this.listening = signal;
      return new Promise((resolve) => signal.addEventListener("abort", () => resolve({ kind: "cancelled" })));
    }
    if (next instanceof SpeechFailure) throw next;
    return next;
  }

  async speak(text: string, rate: number): Promise<SpeakOutcome> {
    this.spoken.push({ text, rate });
    const result = this.speakResult ?? { characters: text.length + 200, played: this.real };
    if (result instanceof SpeechFailure) throw result;
    return result;
  }
}

function environment(engine: TestEngine, over: Partial<SpeechTokenResponse> = {}, canRecord = true) {
  const fetchToken = vi.fn(async (): Promise<SpeechTokenResponse> => ({
    token: "token",
    region: "eastus",
    expiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
    mock: !engine.real,
    allowance: allowance(),
    ...over,
  }));
  const env: SpeechEnvironment = {
    canRecord: () => canRecord,
    createEngine: () => engine,
    createTokenSource: () => new SpeechTokenSource(fetchToken),
  };
  return { env, fetchToken };
}

interface Posted {
  url: string;
  body: Record<string, unknown>;
}

/** Renders the session with a working turn route that echoes the message back. */
function open(engine: TestEngine, options: { initial?: SessionStateResponse; who?: MeResponse; token?: Partial<SpeechTokenResponse>; canRecord?: boolean } = {}) {
  const posted: Posted[] = [];
  const record = (url: string, respond: (body: Record<string, unknown>) => Response): Responder => (init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    posted.push({ url, body });
    return respond(body);
  };
  let n = 0;
  const { env, fetchToken } = environment(engine, options.token, options.canRecord);
  const routes: Record<string, Responder> = {
    "/api/v1/me": () => json(options.who ?? me()),
    [SESSION]: () => json(options.initial ?? state()),
    [`POST ${SESSION}/turn`]: record("turn", (body) => {
      n += 1;
      const result: TurnResponse = {
        sessionId: ID,
        sessionStatus: "active",
        turn: turn(n, { clientTurnId: String(body.clientTurnId), learnerText: String(body.transcript), sourceMode: body.sourceMode as Turn["sourceMode"] }),
        replayed: false,
        provider: { vendor: "OpenAI", model: "gpt-6-luna", mock: false },
        usage: { estimatedUsdThisTurn: 0.0002, monthEstimatedUsd: 0.001, softLimitReached: false },
      };
      return json(result, 201);
    }),
    "POST /api/v1/speech/usage": record("usage", () => json({ recorded: true, allowance: allowance({ recognitionSeconds: 3 }) }, 201)),
  };
  for (let i = 1; i <= 3; i += 1) {
    const turnId = turn(i).turnId;
    routes[`POST ${SESSION}/turns/${turnId}/events`] = record(`event ${turnId}`, (body) =>
      json({ turnId, listening: { playedAt: body.event === "played" ? "t" : null, revealedAt: body.event === "revealed" ? "t" : null } }),
    );
  }
  renderApp(`/session/${ID}?step=speak`, routes, { speech: env });
  return { posted, fetchToken };
}

const speakButton = () => screen.findByRole("button", { name: "Speak" });
const sentTurns = (posted: Posted[]) => posted.filter((p) => p.url === "turn").map((p) => p.body);

beforeEach(() => {
  window.localStorage.clear();
});

describe("speaking a reply (SPEC §7.1)", () => {
  it("sends what was heard as a spoken turn, reads the reply aloud, and counts both against the free allowance", async () => {
    const engine = new TestEngine();
    engine.heard.push({ kind: "recognized", text: "我想去公园。", confidence: 0.91, audioSeconds: 3.2 });
    const { posted, fetchToken } = open(engine);

    expect(fetchToken).not.toHaveBeenCalled();
    await userEvent.click(await speakButton());

    expect(await screen.findByText("回答1，你呢？")).toBeInTheDocument();
    expect(sentTurns(posted)).toEqual([expect.objectContaining({ transcript: "我想去公园。", sourceMode: "speech", asrUncertain: false })]);
    expect(within(screen.getByRole("list", { name: "Conversation so far" })).getByText("(spoken)")).toBeInTheDocument();

    await waitFor(() => expect(engine.spoken).toEqual([{ text: "回答1，你呢？", rate: 0.85 }]));
    await waitFor(() => expect(posted.filter((p) => p.url === "usage")).toHaveLength(2));
    const usage = posted.filter((p) => p.url === "usage").map((p) => p.body);
    expect(usage[0]).toMatchObject({ kind: "recognition", audioSeconds: 3.2, sessionId: ID });
    expect(usage[1]).toMatchObject({ kind: "synthesis", characters: 207 });
    expect(usage[0]?.clientEventId).not.toBe(usage[1]?.clientEventId);
    await waitFor(() => expect(posted.some((p) => p.url.startsWith("event") && p.body.event === "played")).toBe(true));
    // One token served both.
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("asks the learner to check an unsure transcript, then sends it as spoken and unsure", async () => {
    const engine = new TestEngine();
    engine.heard.push({ kind: "recognized", text: "我想去工员。", confidence: 0.41, audioSeconds: 2 });
    const { posted } = open(engine);

    await userEvent.click(await speakButton());
    expect(await screen.findByText(/Speech recognition wasn't sure it heard this right/)).toBeInTheDocument();
    const box = screen.getByLabelText("Your reply in Chinese");
    expect(box).toHaveValue("我想去工员。");
    expect(sentTurns(posted)).toHaveLength(0);

    // Correct the misheard characters in place.
    await userEvent.type(box, "{Backspace}{Backspace}{Backspace}公园。{Enter}");
    expect(await screen.findByText("回答1，你呢？")).toBeInTheDocument();
    expect(sentTurns(posted)).toEqual([expect.objectContaining({ transcript: "我想去公园。", sourceMode: "speech", asrUncertain: true })]);
  });

  it("says when nothing was heard, and sends nothing", async () => {
    const engine = new TestEngine();
    engine.heard.push({ kind: "no-speech", audioSeconds: 4 });
    const { posted } = open(engine);
    await userEvent.click(await speakButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Didn't hear anything. Tap Speak and talk, or type instead.");
    expect(sentTurns(posted)).toHaveLength(0);
    // The open microphone still counts toward the allowance.
    await waitFor(() => expect(posted.find((p) => p.url === "usage")?.body).toMatchObject({ kind: "recognition", audioSeconds: 4 }));
  });

  it.each([
    ["denied", /Microphone access was refused/],
    ["no-microphone", /No microphone was found/],
    ["busy", /The free tier allows one recognition at a time/],
    ["network", /Couldn't reach Azure Speech/],
  ] as const)("explains a %s failure and keeps typing available", async (kind, text) => {
    const engine = new TestEngine();
    engine.heard.push(new SpeechFailure(kind));
    const { posted } = open(engine);
    await userEvent.click(await speakButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    await userEvent.type(screen.getByLabelText("Your reply in Chinese"), "我打字。{Enter}");
    expect(await screen.findByText("回答1，你呢？")).toBeInTheDocument();
    expect(sentTurns(posted)).toEqual([expect.objectContaining({ sourceMode: "typed", asrUncertain: false })]);
  });

  it("shows the server's message when no token can be had, such as a used-up allowance", async () => {
    const engine = new TestEngine();
    const posted: string[] = [];
    const env: SpeechEnvironment = {
      canRecord: () => true,
      createEngine: () => engine,
      createTokenSource: () =>
        new SpeechTokenSource(async () => {
          posted.push("token");
          throw Object.assign(new (await import("../../src/client/lib/api")).ApiRequestError("BUDGET_EXCEEDED", "This month's free speech allowance is used up.", 429, false));
        }),
    };
    renderApp(`/session/${ID}?step=speak`, { "/api/v1/me": () => json(me()), [SESSION]: () => json(state()) }, { speech: env });
    await userEvent.click(await speakButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("This month's free speech allowance is used up.");
    expect(posted).toEqual(["token"]);
  });

  it("can stop listening, and stops by itself when the app goes to the background", async () => {
    const engine = new TestEngine();
    engine.heard.push("wait", "wait");
    const { posted } = open(engine);

    await userEvent.click(await speakButton());
    expect(await screen.findByText("Listening. Speak now; it stops when you pause.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Stop listening" }));
    expect(await speakButton()).toBeInTheDocument();
    expect(engine.listening?.aborted).toBe(true);

    await userEvent.click(await speakButton());
    await screen.findByText("Listening. Speak now; it stops when you pause.");
    const second = engine.listening;
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    visibility.mockRestore();
    await waitFor(() => expect(second?.aborted).toBe(true));
    expect(screen.queryByText(/Listening\./)).not.toBeInTheDocument();
    expect(sentTurns(posted)).toHaveLength(0);
  });
});

describe("listening to replies", () => {
  it("plays a reply on request and not automatically when reading aloud is off", async () => {
    const engine = new TestEngine();
    const { posted } = open(engine, { initial: state([turn(1)]) });
    await userEvent.click(await screen.findByLabelText("Read replies aloud"));
    expect(window.localStorage.getItem("shuolab:read-aloud")).toBe("false");

    await userEvent.type(screen.getByLabelText("Your reply in Chinese"), "好。{Enter}");
    expect(await screen.findByText("回答1，你呢？", { selector: "p" })).toBeInTheDocument();
    expect(engine.spoken).toEqual([]);

    await userEvent.click(screen.getAllByRole("button", { name: "Play" })[0] as HTMLElement);
    await waitFor(() => expect(engine.spoken).toHaveLength(1));
    expect(sentTurns(posted)).toHaveLength(1);
  });

  it("hides the newest reply's text when listening first, and records when it is shown", async () => {
    const engine = new TestEngine();
    const { posted } = open(engine, { initial: state([turn(1), turn(2)]) });
    await userEvent.click(await screen.findByRole("checkbox", { name: /Listen first/ }));

    expect(screen.getByText("回答1，你呢？")).toBeInTheDocument();
    expect(screen.queryByText("回答2，你呢？")).not.toBeInTheDocument();
    expect(screen.getByText("Text hidden so you can listen first.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show text" }));
    expect(screen.getByText("回答2，你呢？")).toBeInTheDocument();
    await waitFor(() =>
      expect(posted.filter((p) => p.url.startsWith("event"))).toEqual([{ url: `event ${turn(2).turnId}`, body: { event: "revealed" } }]),
    );
  });

  it("does not hide a reply whose text was already shown on another visit", async () => {
    window.localStorage.setItem("shuolab:listen-first", "true");
    open(new TestEngine(), { initial: state([turn(1, { listening: { playedAt: null, revealedAt: "2026-03-04T10:03:00.000Z" } })]) });
    expect(await screen.findByText("回答1，你呢？")).toBeInTheDocument();
  });

  it("offers the device's voice, with a warning about quality, when Azure's voice fails", async () => {
    const speak = vi.fn((utterance: SpeechSynthesisUtterance) => utterance.onend?.(new Event("end") as SpeechSynthesisEvent));
    vi.stubGlobal("speechSynthesis", { speak, cancel: vi.fn() });
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        text: string;
        lang = "";
        rate = 1;
        onend: ((e: Event) => void) | null = null;
        onerror: ((e: Event) => void) | null = null;
        constructor(text: string) {
          this.text = text;
        }
      },
    );
    const engine = new TestEngine();
    engine.speakResult = new SpeechFailure("network");
    open(engine, { initial: state([turn(1)]) });

    await userEvent.click(await screen.findByRole("button", { name: "Play" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach Azure Speech");
    expect(screen.getByText(/quality varies by phone and browser/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Play with this device's voice" }));
    await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
    expect((speak.mock.calls[0]?.[0] as { lang: string }).lang).toBe("zh-CN");
  });
});

describe("when speech is not available", () => {
  it("hides Speak in a browser that cannot record, and says why", async () => {
    open(new TestEngine(), { canRecord: false });
    expect(await screen.findByText(/Speaking needs a secure \(https\) page and microphone access/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Speak" })).not.toBeInTheDocument();
  });

  it("is typed only when speech is not set up, and never asks for a token", async () => {
    const missing: ProviderStatus = { id: "speech", vendor: "Azure AI Speech", mode: "missing", model: null, setupHint: "Add the AZURE_SPEECH_KEY secret." };
    const engine = new TestEngine();
    const { fetchToken } = open(engine, { who: me(missing) });
    expect(await screen.findByText(/Speech is not set up, so this conversation is typed\. Add the AZURE_SPEECH_KEY secret\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Speak" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Read replies aloud")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Your reply in Chinese"), "好。{Enter}");
    expect(await screen.findByText("回答1，你呢？")).toBeInTheDocument();
    expect(fetchToken).not.toHaveBeenCalled();
    expect(engine.spoken).toEqual([]);
  });

  it("turns Speak off once this month's recognition is used up", async () => {
    const engine = new TestEngine();
    engine.heard.push({ kind: "recognized", text: "你好。", confidence: 0.9, audioSeconds: 1 });
    open(engine, { token: { allowance: allowance({ recognitionAvailable: false }) } });
    await userEvent.click(await speakButton());
    expect(await screen.findByText("This month's free speech recognition is used up. Answer by typing until next month.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Speak" })).toBeDisabled();
  });

  it("does not count the stand-in against the allowance or record it as heard", async () => {
    const engine = new TestEngine(false);
    engine.heard.push({ kind: "recognized", text: "你好，我想练习说中文。", confidence: 0.92, audioSeconds: 2.4 });
    const { posted } = open(engine, { who: me({ ...liveSpeech, vendor: "Local fake speech", mode: "mock" }) });
    expect(await screen.findByText("Practice stand-in speech.")).toBeInTheDocument();
    await userEvent.click(await speakButton());
    expect(await screen.findByText("回答1，你呢？")).toBeInTheDocument();
    await waitFor(() => expect(engine.spoken).toHaveLength(1));
    expect(posted.filter((p) => p.url !== "turn")).toEqual([]);
  });
});
