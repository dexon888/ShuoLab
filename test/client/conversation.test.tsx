import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { MeResponse, ProviderStatus } from "../../src/shared/api";
import type { Debrief, SessionStateResponse } from "../../src/shared/debrief";
import type { SessionDetail, SessionPlan } from "../../src/shared/session";
import type { OwnerSettings } from "../../src/shared/settings";
import type { Turn, TurnResponse } from "../../src/shared/tutor";
import { json, renderApp, savedSettings, type Responder } from "./render";

const ID = "11111111-2222-4333-8444-555555555555";
const SESSION = `/api/v1/sessions/${ID}`;
const TURN = `POST ${SESSION}/turn`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DRAFT_KEY = `shuolab:draft:${ID}`;

const mockTutor: ProviderStatus = { id: "tutor", vendor: "Local fake tutor", mode: "mock", model: null, setupHint: null };

function me(settings: Partial<OwnerSettings> = {}, providers: ProviderStatus[] = []): MeResponse {
  return { owner: { email: null, authMode: "dev-bypass" }, settings: savedSettings(settings), providers, curriculumImported: true, version: "test" };
}

const plan: SessionPlan = {
  version: 1,
  kind: "hsk",
  editionId: "synthetic-fixture",
  synthetic: true,
  targetBand: "2",
  bandSource: "owner_choice",
  durationMinutes: 20,
  localStudyDate: "2026-03-04",
  situation: { id: "order-food", sourceType: "app-authored", titleZh: "点菜", titleEn: "Ordering a meal", communicativeGoal: "Order food and drinks." },
  targets: [
    { itemId: "synthetic-fixture:vocab:301", sourceId: 301, hskBand: "2", hanzi: "周末", pinyin: "zhōumò", role: "active" },
    { itemId: "synthetic-fixture:vocab:302", sourceId: 302, hskBand: "2", hanzi: "朋友", pinyin: "péngyou", role: "active" },
    { itemId: "synthetic-fixture:vocab:501", sourceId: 501, hskBand: "3", hanzi: "火锅", pinyin: "huǒguō", role: "stretch" },
  ],
  grammarIds: [],
  grammar: [],
  characters: [],
  topic: null,
  task: null,
  weakestSkill: null,
  colloquial: [],
  levelConstraints: { activeBand: "2", stretchBand: "3" },
  activities: [{ kind: "speak", skill: "speaking", minutes: 20, title: "Conversation", description: "Talk it through." }],
};

function session(status: SessionDetail["status"] = "active"): SessionDetail {
  return {
    id: ID,
    kind: "hsk",
    status,
    localStudyDate: plan.localStudyDate,
    durationMinutes: 20,
    targetBand: "2",
    situationTitleEn: plan.situation.titleEn,
    situationTitleZh: plan.situation.titleZh,
    synthetic: true,
    createdAt: "2026-03-04T10:00:00.000Z",
    startedAt: status === "planned" ? null : "2026-03-04T10:01:00.000Z",
    endedAt: null,
    editionId: "synthetic-fixture",
    plan,
    actualSeconds: 0,
  };
}

function turn(n: number, over: Partial<Turn> = {}): Turn {
  return {
    turnId: `turn-${n}`,
    clientTurnId: `00000000-0000-4000-8000-00000000000${n}`,
    position: n,
    sourceMode: "typed",
    learnerText: `我的第${n}句话。`,
    reply: { spokenZh: `你周末喜欢做什么？（${n}）`, pinyin: `Nǐ zhōumò xǐhuan zuò shénme? (${n})`, translationEn: `What do you like to do on weekends? (${n})` },
    referencedCurriculumItemIds: ["synthetic-fixture:vocab:301"],
    referencedColloquialIds: [],
    grammarUsedIds: [],
    grammarElicitedIds: [],
    learnerGrammarIds: [],
    feedback: { understoodIntent: true, corrections: [], encouragementZh: null, transcriptUncertain: false },
    fallback: false,
    createdAt: "2026-03-04T10:02:00.000Z",
    listening: { playedAt: null, revealedAt: null },
    ...over,
  };
}

function state(status: SessionDetail["status"] = "active", turns: Turn[] = [], debrief: Debrief | null = null): SessionStateResponse {
  return { session: session(status), turns, debrief, listening: null, materials: null };
}

function answered(body: { clientTurnId: string; transcript: string }, n = 0, over: Partial<TurnResponse> = {}): TurnResponse {
  return {
    sessionId: ID,
    sessionStatus: "active",
    turn: turn(n, { clientTurnId: body.clientTurnId, learnerText: body.transcript }),
    replayed: false,
    provider: { vendor: "Local fake tutor", model: "fake-tutor-1", mock: true },
    usage: { estimatedUsdThisTurn: 0, monthEstimatedUsd: 0, softLimitReached: false },
    ...over,
  };
}

const failure = (code: string, message: string, retryable: boolean, status: number) =>
  json({ error: { code, message, retryable } }, status);

interface Sent {
  clientTurnId: string;
  transcript: string;
  sourceMode: string;
}

/** Renders the session page; `turnResponder` answers each POST of a turn in order. */
function open(initial: SessionStateResponse, extra: Record<string, Responder> = {}, who: MeResponse = me()) {
  const sent: Sent[] = [];
  const fetchMock = renderApp(`/session/${ID}?step=${initial.session.status === "complete" ? "summary" : "speak"}`, {
    "/api/v1/me": () => json(who),
    [SESSION]: () => json(initial),
    ...extra,
  });
  return { sent, fetchMock };
}

function turnRoute(sent: Sent[], respond: (body: Sent, attempt: number) => Response): Responder {
  return (init) => {
    const body = JSON.parse(String(init?.body)) as Sent;
    sent.push(body);
    return respond(body, sent.length);
  };
}

const box = () => screen.findByLabelText("Your reply in Chinese");

beforeEach(() => {
  window.localStorage.clear();
});

describe("typed conversation (SPEC §5.3, §7.2)", () => {
  it("sends a message, shows the tutor's reply and starts the session", async () => {
    const sent: Sent[] = [];
    open(state("planned"), { [TURN]: turnRoute(sent, (body) => json(answered(body), 201)) });

    expect(screen.queryByRole("button", { name: "Finish session" })).not.toBeInTheDocument();
    await userEvent.type(await box(), "我周末想跟朋友去吃火锅。");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    const list = await screen.findByRole("list", { name: "Conversation so far" });
    expect(await within(list).findByText("你周末喜欢做什么？（0）")).toBeInTheDocument();
    expect(within(list).getByText("我周末想跟朋友去吃火锅。")).toBeInTheDocument();
    expect(within(list).getByText("(typed)")).toBeInTheDocument();
    expect(within(list).getByText(/From today's words:/)).toHaveTextContent("周末");

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ transcript: "我周末想跟朋友去吃火锅。", sourceMode: "typed" });
    expect(sent[0]?.clientTurnId).toMatch(UUID);
    expect(await box()).toHaveValue("");
    expect(await box()).toHaveFocus();
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();

    // Once talking, the header and the controls reflect it, and the plan folds away below the steps.
    expect(screen.getByText(/In progress/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish session" })).toBeInTheDocument();
    expect(screen.getByText("Today's words, grammar and characters")).toBeInTheDocument();
  });

  it("sends with Enter but not with Shift+Enter, and never sends an empty message", async () => {
    const sent: Sent[] = [];
    open(state(), { [TURN]: turnRoute(sent, (body) => json(answered(body), 201)) });

    const input = await box();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await userEvent.type(input, "   {Enter}");
    expect(sent).toHaveLength(0);

    await userEvent.type(input, "第一行{Shift>}{Enter}{/Shift}第二行");
    expect(sent).toHaveLength(0);
    expect(input).toHaveValue("   第一行\n第二行");
    await userEvent.type(input, "{Enter}");
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.transcript).toBe("第一行\n第二行");
  });

  it("says the tutor is replying in a live region and blocks a second send meanwhile", async () => {
    let release: (r: Response) => void = () => undefined;
    const sent: Sent[] = [];
    const fetchSpy = open(state()).fetchMock;
    fetchSpy.mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Sent;
        sent.push(body);
        return new Promise<Response>((resolve) => {
          release = () => resolve(json(answered(body), 201));
        });
      }
      return url.endsWith("/me") ? json(me()) : json(state());
    });

    await userEvent.type(await box(), "你好{Enter}");
    const status = await screen.findByText("The tutor is replying…");
    expect(status).toHaveAttribute("role", "status");
    expect(screen.getByText("你好")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await userEvent.type(await box(), "再说一句{Enter}");
    expect(sent).toHaveLength(1);

    release(new Response());
    expect(await screen.findByText("你周末喜欢做什么？（0）")).toBeInTheDocument();
    expect(screen.queryByText("The tutor is replying…")).not.toBeInTheDocument();
  });
});

describe("reading help follows the settings", () => {
  it("shows pinyin by default and English only when asked", async () => {
    open(state("active", [turn(1)]));
    expect(await screen.findByText("Nǐ zhōumò xǐhuan zuò shénme? (1)")).toBeInTheDocument();
    expect(screen.queryByText("What do you like to do on weekends? (1)")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "Show English" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(screen.getByText("What do you like to do on weekends? (1)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Hide English" }));
    expect(screen.queryByText("What do you like to do on weekends? (1)")).not.toBeInTheDocument();
  });

  it("shows characters only when that is the setting", async () => {
    open(state("active", [turn(1)]), {}, me({ displayMode: "hanzi" }));
    expect(await screen.findByText("你周末喜欢做什么？（1）")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Nǐ zhōumò/)).not.toBeInTheDocument());
  });

  it("shows English straight away when the setting asks for it", async () => {
    open(state("active", [turn(1)]), {}, me({ displayMode: "hanzi_pinyin_english" }));
    expect(await screen.findByText("What do you like to do on weekends? (1)")).toBeInTheDocument();
  });

  it("marks Chinese text as Chinese for screen readers and fonts", async () => {
    open(state("active", [turn(1)]));
    expect(await screen.findByText("你周末喜欢做什么？（1）")).toHaveAttribute("lang", "zh-Hans");
    expect(screen.getByText("我的第1句话。")).toHaveAttribute("lang", "zh-Hans");
    expect(await box()).toHaveAttribute("lang", "zh-Hans");
  });
});

describe("a reload or a failed request never loses or doubles a message (FR-010, FR-011)", () => {
  it("shows the saved turns in order after a reload", async () => {
    open(state("active", [turn(1), turn(2)]));
    const items = within(await screen.findByRole("list", { name: "Conversation so far" })).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("我的第1句话。");
    expect(items[1]).toHaveTextContent("你周末喜欢做什么？（2）");
  });

  it("keeps the message after a failure and resends it with the same id", async () => {
    const sent: Sent[] = [];
    open(state(), {
      [TURN]: turnRoute(sent, (body, attempt) =>
        attempt === 1
          ? failure("PROVIDER_UNAVAILABLE", "The tutor took too long to answer. Your message is kept; try sending it again.", true, 503)
          : json(answered(body), 201),
      ),
    });

    await userEvent.type(await box(), "我想喝茶。{Enter}");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("That message was not answered.");
    expect(alert).toHaveTextContent("The tutor took too long to answer.");
    expect(screen.getByText("我想喝茶。")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? "{}").pending.transcript).toBe("我想喝茶。");

    await userEvent.click(within(alert).getByRole("button", { name: "Send again" }));
    expect(await screen.findByText("你周末喜欢做什么？（0）")).toBeInTheDocument();
    expect(sent).toHaveLength(2);
    expect(sent[1]?.clientTurnId).toBe(sent[0]?.clientTurnId);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByText("我想喝茶。")).toHaveLength(1);
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("puts a failed message back in the box to edit, and gives the edited one a new id", async () => {
    const sent: Sent[] = [];
    open(state(), {
      [TURN]: turnRoute(sent, (body, attempt) =>
        attempt === 1 ? failure("PROVIDER_UNAVAILABLE", "The tutor could not be reached.", true, 503) : json(answered(body), 201),
      ),
    });

    await userEvent.type(await box(), "我想喝差。{Enter}");
    await userEvent.click(await screen.findByRole("button", { name: "Edit message" }));
    await waitFor(async () => expect(await box()).toHaveValue("我想喝差。"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await userEvent.clear(await box());
    await userEvent.type(await box(), "我想喝茶。{Enter}");
    expect(await screen.findByText("你周末喜欢做什么？（0）")).toBeInTheDocument();
    expect(sent[1]?.transcript).toBe("我想喝茶。");
    expect(sent[1]?.clientTurnId).not.toBe(sent[0]?.clientTurnId);
  });

  it("does not offer to edit a message the server turns out to have", async () => {
    const sent: Sent[] = [];
    let saved = state();
    const fetchMock = open(saved, {
      [TURN]: turnRoute(sent, (body) => {
        // The answer was saved but the response never reached the browser.
        saved = state("active", [turn(0, { clientTurnId: body.clientTurnId, learnerText: body.transcript })]);
        return failure("INTERNAL", "Something went wrong. Try again.", true, 500);
      }),
    }).fetchMock;
    const base = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (input, init) =>
      String(input) === SESSION && (init?.method ?? "GET") === "GET" ? json(saved) : (base as NonNullable<typeof base>)(input, init),
    );

    await userEvent.type(await box(), "我想喝茶。{Enter}");
    await userEvent.click(await screen.findByRole("button", { name: "Edit message" }));
    expect(await screen.findByText("你周末喜欢做什么？（0）")).toBeInTheDocument();
    expect(await box()).toHaveValue("");
    expect(screen.getAllByText("我想喝茶。")).toHaveLength(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("after a reload mid-send, offers the unconfirmed message again with its original id", async () => {
    const pending = { clientTurnId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", transcript: "我想喝茶。" };
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ text: "", pending }));
    const sent: Sent[] = [];
    open(state(), { [TURN]: turnRoute(sent, (body) => json(answered(body), 200)) });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This message may not have been sent.");
    await userEvent.click(within(alert).getByRole("button", { name: "Send again" }));
    expect(await screen.findByText("你周末喜欢做什么？（0）")).toBeInTheDocument();
    expect(sent).toEqual([{ ...pending, sourceMode: "typed", asrUncertain: false }]);
  });

  it("after a reload, quietly forgets a stored message the server already has", async () => {
    const pending = { clientTurnId: turn(1).clientTurnId, transcript: turn(1).learnerText };
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ text: "", pending }));
    open(state("active", [turn(1)]));

    expect(await screen.findByText("你周末喜欢做什么？（1）")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByText("我的第1句话。")).toHaveLength(1);
    await waitFor(() => expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull());
  });

  it("keeps what was being typed across a reload", async () => {
    open(state());
    await userEvent.type(await box(), "写到一半");
    cleanup();
    open(state());
    expect(await box()).toHaveValue("写到一半");
  });

  it("ignores damaged stored drafts", async () => {
    window.localStorage.setItem(DRAFT_KEY, "{not json");
    open(state());
    expect(await box()).toHaveValue("");
  });
});

describe("limits and provider state", () => {
  it("explains a reached spending stop and points to Settings, without offering to resend", async () => {
    const sent: Sent[] = [];
    open(state(), {
      [TURN]: turnRoute(sent, () =>
        failure("BUDGET_EXCEEDED", "This month's estimated spending has reached the stop amount of US$10.00 set in Settings.", false, 429),
      ),
    });
    await userEvent.type(await box(), "你好{Enter}");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("stop amount of US$10.00");
    expect(within(alert).getByRole("link", { name: /Open Settings/ })).toHaveAttribute("href", "/settings");
    expect(within(alert).queryByRole("button", { name: "Send again" })).not.toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "Edit message" })).toBeInTheDocument();
  });

  it("mentions the warning amount once it is reached", async () => {
    const sent: Sent[] = [];
    open(state(), {
      [TURN]: turnRoute(sent, (body) =>
        json(answered(body, 0, { usage: { estimatedUsdThisTurn: 0.01, monthEstimatedUsd: 5.01, softLimitReached: true } }), 201),
      ),
    });
    await userEvent.type(await box(), "你好{Enter}");
    expect(await screen.findByText(/reached your warning amount/)).toBeInTheDocument();
  });

  it("says plainly when the stand-in tutor is answering", async () => {
    open(state(), {}, me({}, [mockTutor]));
    expect(await screen.findByText("Practice stand-in tutor.")).toBeInTheDocument();
    expect(screen.getByText(/not a language model/)).toBeInTheDocument();
  });

  it("says when the tutor is not set up, with the setup hint", async () => {
    const missing: ProviderStatus = { id: "tutor", vendor: "OpenAI", mode: "missing", model: null, setupHint: "Add the OPENAI_API_KEY secret." };
    open(state(), {}, me({}, [missing]));
    expect(await screen.findByText("The tutor is not set up.")).toBeInTheDocument();
    expect(screen.getByText(/Add the OPENAI_API_KEY secret\./)).toBeInTheDocument();
  });

  it("labels a prepared fallback reply", async () => {
    open(state("active", [turn(1, { fallback: true, referencedCurriculumItemIds: [] })]));
    expect(await screen.findByText(/Prepared reply\. The tutor's own answer could not be used/)).toBeInTheDocument();
    expect(screen.queryByText(/From today's words/)).not.toBeInTheDocument();
  });
});

describe("pause, resume and finish (SPEC §5.3)", () => {
  const debrief: Debrief = {
    sessionId: ID,
    practiceSeconds: 754,
    plannedMinutes: 20,
    turns: { total: 6, typed: 6, spoken: 0, fallback: 1 },
    words: [
      { itemId: "synthetic-fixture:vocab:301", hanzi: "周末", pinyin: "zhōumò", hskBand: "2", role: "active", usedByLearner: true, usedByTutor: true },
      { itemId: "synthetic-fixture:vocab:302", hanzi: "朋友", pinyin: "péngyou", hskBand: "2", role: "active", usedByLearner: false, usedByTutor: true },
      { itemId: "synthetic-fixture:vocab:501", hanzi: "火锅", pinyin: "huǒguō", hskBand: "3", role: "stretch", usedByLearner: false, usedByTutor: false },
    ],
    recommendedReviewItemIds: ["synthetic-fixture:vocab:302"],
    corrections: [{ original: "我去了北京三次", corrected: "我去过北京三次", noteEn: "Use 过 for experience." }],
    listening: null,
  };

  it("pauses and resumes, hiding the message box while paused", async () => {
    const actions: unknown[] = [];
    open(state("active", [turn(1)]), {
      [`PATCH ${SESSION}`]: (init) => {
        const body = JSON.parse(String(init?.body)) as { action: string };
        actions.push(body);
        return json(state(body.action === "pause" ? "paused" : "active", [turn(1)]));
      },
    });

    await userEvent.click(await screen.findByRole("button", { name: "Pause" }));
    expect(await screen.findByText("Paused time is not counted as practice. Your conversation is saved.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your reply in Chinese")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    expect(screen.getByText("你周末喜欢做什么？（1）")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(await box()).toBeInTheDocument();
    expect(actions).toEqual([{ action: "pause" }, { action: "resume" }]);
  });

  it("opens a paused session with Resume ready", async () => {
    open(state("paused", [turn(1)]));
    expect(await screen.findByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(screen.getByText(/· Paused/)).toBeInTheDocument();
  });

  it("asks before finishing, and can be backed out of", async () => {
    let completed = 0;
    open(state("active", [turn(1)]), {
      [`POST ${SESSION}/complete`]: () => {
        completed += 1;
        return json(state("complete", [turn(1)], debrief));
      },
    });

    await userEvent.click(await screen.findByRole("button", { name: "Finish session" }));
    expect(screen.getByText("Finish now? You cannot add to this conversation afterwards.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keep going" }));
    expect(completed).toBe(0);
    expect(await box()).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Finish session" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, finish" }));
    expect(await screen.findByRole("region", { name: "Session summary" })).toBeInTheDocument();
    expect(completed).toBe(1);
    expect(screen.queryByLabelText("Your reply in Chinese")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish session" })).not.toBeInTheDocument();
  });

  it("shows what happened in a finished session without claiming what was learned", async () => {
    open(state("complete", [turn(1)], debrief));

    const summary = await screen.findByRole("region", { name: "Session summary" });
    expect(summary).toHaveTextContent("12 min 34 s of practice, of a planned 20 minutes.");
    expect(summary).toHaveTextContent("6 turns: 6 typed, 0 spoken.");
    expect(summary).toHaveTextContent("Typed turns are writing practice. They are not counted as speaking.");
    expect(summary).toHaveTextContent("In 1 turn the tutor's answer could not be used");

    const corrections = screen.getByRole("region", { name: "Corrections worth keeping" });
    expect(corrections).toHaveTextContent("You wrote: 我去了北京三次");
    expect(corrections).toHaveTextContent("More natural: 我去过北京三次");
    expect(corrections).toHaveTextContent("Use 过 for experience.");

    const words = screen.getByRole("region", { name: "Today's words" });
    const rows = within(words).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("You used it");
    expect(rows[1]).toHaveTextContent("The tutor used it; you did not");
    expect(rows[2]).toHaveTextContent("Did not come up");
    expect(within(words).getByRole("link", { name: "周末" })).toHaveAttribute("href", "/curriculum/item/synthetic-fixture%3Avocab%3A301");
    expect(words).toHaveTextContent("Using a word once is not evidence that you know it");
    expect(words).toHaveTextContent("Worth meeting again: 朋友.");

    expect(screen.getByRole("link", { name: "Back to Today" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("list", { name: "Conversation so far" })).toBeInTheDocument();
    expect(screen.getByRole("main").textContent).not.toMatch(/fluen|mastered|score/i);
  });

  it("says so when there were no corrections", async () => {
    open(state("complete", [turn(1)], { ...debrief, corrections: [], turns: { total: 1, typed: 1, spoken: 0, fallback: 0 }, practiceSeconds: 45 }));
    expect(await screen.findByText("No corrections were recorded in this session.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Session summary" })).toHaveTextContent("45 seconds of practice");
    expect(screen.getByRole("region", { name: "Session summary" })).toHaveTextContent("1 turn: 1 typed, 0 spoken.");
  });

  it("shows an ended, unfinished session read-only", async () => {
    open(state("abandoned", [turn(1)]));
    expect(await screen.findByText(/ended without finishing, so it has no summary/)).toBeInTheDocument();
    expect(screen.getByText("你周末喜欢做什么？（1）")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your reply in Chinese")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
  });

  it("shows the server's message when finishing fails", async () => {
    open(state("active", [turn(1)]), {
      [`POST ${SESSION}/complete`]: () => failure("CONFLICT", "This session has ended. Start a new one from Today.", false, 409),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Finish session" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, finish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This session has ended.");
  });
});
