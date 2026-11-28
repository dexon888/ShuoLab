import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SpeechTokenSource } from "../../src/client/speech/token";
import type { RecognitionOutcome, SpeakOutcome, SpeechEngine } from "../../src/client/speech/types";
import type { SpeechEnvironment } from "../../src/client/speech/useVoice";
import type { MeResponse, ProviderStatus } from "../../src/shared/api";
import type { SessionStateResponse } from "../../src/shared/debrief";
import type { ListeningExercise } from "../../src/shared/listening";
import type { SessionDetail } from "../../src/shared/session";
import { json, renderApp, savedSettings, type Responder } from "./render";

const ID = "11111111-2222-4333-8444-555555555555";
const SESSION = `/api/v1/sessions/${ID}`;

const liveSpeech: ProviderStatus = { id: "speech", vendor: "Azure AI Speech", mode: "live", model: null, setupHint: null };

function me(speech: ProviderStatus | null = liveSpeech): MeResponse {
  return {
    owner: { email: null, authMode: "dev-bypass" },
    settings: savedSettings({ speechRate: 0.85 }),
    providers: speech ? [speech] : [],
    curriculumImported: true,
    version: "test",
  };
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
      activities: [{ kind: "listen", skill: "listening", minutes: 3, title: "Listen first", description: "Hear it." }],
    },
  };
}

const RIGHT = [1, 0];

function exercise(over: Partial<ListeningExercise> = {}): ListeningExercise {
  const base: ListeningExercise = {
    id: "eeeeeeee-0000-4000-8000-000000000001",
    sessionId: ID,
    source: "generated",
    model: "gpt-6-luna",
    standIn: false,
    coversTargets: true,
    lines: [
      { speaker: "A", zh: "你周末有空吗？", pinyin: "Nǐ zhōumò yǒu kòng ma?", en: "Are you free this weekend?" },
      { speaker: "B", zh: "星期六下午有空。", pinyin: "Xīngqīliù xiàwǔ yǒu kòng.", en: "I'm free on Saturday afternoon." },
    ],
    questions: [
      { questionEn: "When is B free?", optionsEn: ["Sunday morning", "Saturday afternoon", "Friday evening"], answerIndex: null },
      { questionEn: "What does A ask about?", optionsEn: ["Weekend plans", "Work", "Food"], answerIndex: null },
    ],
    createdAt: "2026-03-04T10:01:00.000Z",
    playedAt: null,
    revealedAt: null,
    answeredAt: null,
    answers: null,
    result: null,
    ...over,
  };
  // Like the server: the right answers are sent once the questions are answered or the text is shown.
  const open = base.answeredAt !== null || base.revealedAt !== null;
  return { ...base, questions: base.questions.map((q, i) => ({ ...q, answerIndex: open ? (RIGHT[i] ?? null) : null })) };
}

function state(listening: ListeningExercise | null = null, status: SessionDetail["status"] = "active"): SessionStateResponse {
  return { session: session(status), turns: [], debrief: null, listening, materials: null, glosses: {} };
}

class TestEngine implements SpeechEngine {
  async assess(): Promise<{ kind: "cancelled" }> {
    return { kind: "cancelled" };
  }
  async synthesize(text: string): Promise<{ audio: ArrayBuffer; characters: number }> {
    return { audio: new ArrayBuffer(0), characters: text.length };
  }
  readonly real = true;
  readonly spoken: { text: string; rate: number }[] = [];
  async recognize(): Promise<RecognitionOutcome> {
    return { kind: "cancelled" };
  }
  async speak(text: string, rate: number): Promise<SpeakOutcome> {
    this.spoken.push({ text, rate });
    return { characters: text.length, played: true };
  }
}

function environment(engine: TestEngine): SpeechEnvironment {
  const fetchToken = vi.fn(async () => ({
    token: "token",
    region: "eastus",
    expiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
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
  }));
  return { canRecord: () => true, createEngine: () => engine, createTokenSource: () => new SpeechTokenSource(fetchToken) };
}

/** Renders the session with listening routes that behave like the server. */
function open(options: { initial?: SessionStateResponse; who?: MeResponse; start?: Responder } = {}) {
  const engine = new TestEngine();
  const posted: { url: string; body: Record<string, unknown> }[] = [];
  let current: ListeningExercise | null = options.initial?.listening ?? null;
  const reply = (status = 200) => json({ exercise: current, existing: status === 200 }, status);
  const body = (init?: RequestInit) => JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;

  renderApp(
    `/session/${ID}?step=listen`,
    {
      "/api/v1/me": () => json(options.who ?? me()),
      [SESSION]: () => json({ ...(options.initial ?? state()), listening: current }),
      [`POST ${SESSION}/listening`]:
        options.start ??
        ((init) => {
          posted.push({ url: "start", body: body(init) });
          current = exercise();
          return reply(201);
        }),
      [`POST ${SESSION}/listening/events`]: (init) => {
        const b = body(init);
        posted.push({ url: "event", body: b });
        const base = current ?? exercise();
        current = b.event === "played" ? { ...base, playedAt: "t1" } : exercise({ ...base, revealedAt: "t2" });
        return reply();
      },
      [`POST ${SESSION}/listening/answers`]: (init) => {
        const b = body(init);
        posted.push({ url: "answers", body: b });
        const answers = b.answers as number[];
        const correct = answers.filter((a, i) => a === RIGHT[i]).length;
        const base = current ?? exercise();
        current = exercise({ ...base, answeredAt: "t3", answers, result: { correct, total: 2, unassisted: base.revealedAt === null } });
        return reply();
      },
      "POST /api/v1/speech/usage": () => json({ recorded: true, allowance: { month: "2026-03", recognitionSeconds: 0, recognitionLimitSeconds: 18000, synthesisChars: 30, synthesisLimitChars: 500000, recognitionAvailable: true, synthesisAvailable: true } }, 201),
    },
    { speech: environment(engine) },
  );
  return { engine, posted };
}

const section = async () => within(await screen.findByRole("region", { name: "Listen first" }));

describe("the listen-first exercise (SPEC §5.3 step 2)", () => {
  it("starts on request and shows questions without the text", async () => {
    const { posted } = open();
    const listen = await section();
    await userEvent.click(listen.getByRole("button", { name: "Start listening" }));

    expect(await listen.findByRole("button", { name: "Play the exchange" })).toBeInTheDocument();
    expect(listen.getByText(/When is B free\?/)).toBeInTheDocument();
    expect(screen.queryByText("你周末有空吗？")).not.toBeInTheDocument();
    expect(posted.filter((p) => p.url === "start")).toHaveLength(1);
  });

  it("plays the whole exchange at the Settings rate, or slower, and records the first play", async () => {
    const { engine, posted } = open({ initial: state(exercise()) });
    const listen = await section();
    await userEvent.click(await listen.findByRole("button", { name: "Play the exchange" }));
    await waitFor(() => expect(engine.spoken).toEqual([{ text: "你周末有空吗？\n星期六下午有空。", rate: 0.85 }]));
    await waitFor(() => expect(posted).toContainEqual({ url: "event", body: { event: "played" } }));

    await userEvent.click(listen.getByRole("button", { name: "Play slower" }));
    await waitFor(() => expect(engine.spoken[1]?.rate).toBeCloseTo(0.68));
    // Only the first play is sent.
    expect(posted.filter((p) => p.url === "event")).toHaveLength(1);
  });

  it("scores answers given before the text, then marks the right answers", async () => {
    const { posted } = open({ initial: state(exercise()) });
    const listen = await section();
    const check = await listen.findByRole("button", { name: "Check answers" });
    expect(check).toBeDisabled();

    await userEvent.click(within(listen.getByRole("group", { name: "1. When is B free?" })).getByLabelText(/Saturday afternoon/));
    expect(check).toBeDisabled();
    await userEvent.click(within(listen.getByRole("group", { name: "2. What does A ask about?" })).getByLabelText(/Work/));
    await userEvent.click(check);

    expect(await listen.findByText("1 of 2 correct")).toBeInTheDocument();
    expect(listen.getByText(/answered before seeing the text\. This counts as a listening check/)).toBeInTheDocument();
    expect(posted).toContainEqual({ url: "answers", body: { answers: [1, 1] } });
    expect(listen.getAllByText("Correct answer")).toHaveLength(2);
    expect(listen.getByText("Your answer")).toBeInTheDocument();
    expect(listen.queryByRole("button", { name: "Check answers" })).not.toBeInTheDocument();

    await userEvent.click(listen.getByRole("button", { name: "Show the text" }));
    expect(await listen.findByText("你周末有空吗？")).toBeInTheDocument();
    expect(listen.getByText("Are you free this weekend?")).toBeInTheDocument();
  });

  it("can show the text without answering, and says answers after that do not count", async () => {
    const { posted } = open({ initial: state(exercise()) });
    const listen = await section();
    expect(await listen.findByText("Answers given after seeing the text are not counted as listening.")).toBeInTheDocument();
    await userEvent.click(listen.getByRole("button", { name: "Skip the questions and show the text" }));
    expect(await listen.findByText("星期六下午有空。")).toBeInTheDocument();
    expect(posted).toContainEqual({ url: "event", body: { event: "revealed" } });

    await userEvent.click(within(listen.getByRole("group", { name: "1. When is B free?" })).getByLabelText(/Saturday afternoon/));
    await userEvent.click(within(listen.getByRole("group", { name: "2. What does A ask about?" })).getByLabelText(/Weekend plans/));
    await userEvent.click(listen.getByRole("button", { name: "Check answers" }));
    expect(await listen.findByText(/answered after the text was shown, so it is not counted as listening/)).toBeInTheDocument();
  });

  it("cannot play without speech set up, and says showing the text is reading", async () => {
    open({ initial: state(exercise()), who: me(null) });
    const listen = await section();
    expect(await listen.findByRole("button", { name: "Play the exchange" })).toBeDisabled();
    expect(listen.getByText(/Speech is not set up/)).toBeInTheDocument();
  });

  it("labels a prepared exchange", async () => {
    open({ initial: state(exercise({ source: "prepared", model: null })) });
    expect(await (await section()).findByText("Prepared exchange.")).toBeInTheDocument();
  });

  it("shows the server's message when the exercise cannot be written", async () => {
    open({
      start: () => json({ error: { code: "PROVIDER_UNAVAILABLE", message: "The tutor took too long to write the exercise. Try again.", retryable: true } }, 503),
    });
    const listen = await section();
    await userEvent.click(listen.getByRole("button", { name: "Start listening" }));
    expect(await listen.findByRole("alert")).toHaveTextContent("The tutor took too long to write the exercise.");
    expect(listen.getByRole("button", { name: "Start listening" })).toBeEnabled();
  });

  it("cannot start while paused, and is left out of a finished session that had none", async () => {
    open({ initial: state(null, "paused") });
    const listen = await section();
    expect(listen.getByRole("button", { name: "Start listening" })).toBeDisabled();
    expect(listen.getByText("Resume the session to start listening.")).toBeInTheDocument();
  });

  it("is not shown for a finished session without an exercise", async () => {
    open({ initial: state(null, "complete") });
    const listen = await section();
    expect(listen.getByText("This session ended without a listening exercise.")).toBeInTheDocument();
    expect(listen.queryByRole("button", { name: "Start listening" })).not.toBeInTheDocument();
  });
});
