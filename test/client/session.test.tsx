import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { MeResponse } from "../../src/shared/api";
import type { SessionDetail, SessionPlan, SessionSummary } from "../../src/shared/session";
import { json, renderApp, savedSettings } from "./render";

const ID = "11111111-2222-4333-8444-555555555555";

function me(over: Partial<MeResponse> = {}): MeResponse {
  return {
    owner: { email: null, authMode: "dev-bypass" },
    settings: savedSettings({ studyBand: "2", sessionMinutes: 20 }),
    providers: [],
    curriculumImported: true,
    version: "test",
    ...over,
  };
}

function plan(over: Partial<SessionPlan> = {}): SessionPlan {
  return {
    version: 1,
    kind: "hsk",
    editionId: "synthetic-fixture",
    synthetic: true,
    targetBand: "2",
    bandSource: "owner_choice",
    durationMinutes: 20,
    localStudyDate: "2026-03-04",
    situation: {
      id: "order-food",
      sourceType: "app-authored",
      titleZh: "点菜",
      titleEn: "Ordering a meal",
      communicativeGoal: "Order food and drinks, ask what is good, and pay.",
    },
    targets: [
      { itemId: "synthetic-fixture:vocab:301", sourceId: 301, hskBand: "2", hanzi: "样例词301", pinyin: "yànglì 301", role: "active" },
      { itemId: "synthetic-fixture:vocab:302", sourceId: 302, hskBand: "2", hanzi: "样例词302", pinyin: "yànglì 302", role: "active" },
      { itemId: "synthetic-fixture:vocab:5", sourceId: 5, hskBand: "1", hanzi: "样例词5", pinyin: "yànglì 5", role: "review" },
      { itemId: "synthetic-fixture:vocab:501", sourceId: 501, hskBand: "3", hanzi: "样例词501", pinyin: "yànglì 501", role: "stretch" },
    ],
    grammarIds: [],
    grammar: [],
    characters: [],
    topic: null,
    task: null,
    weakestSkill: null,
    colloquial: [],
    levelConstraints: { activeBand: "2", stretchBand: "3" },
    activities: [
      { kind: "warmup", skill: "speaking", minutes: 1, title: "Warm-up", description: "A short, familiar exchange." },
      { kind: "listen", skill: "listening", minutes: 4, title: "Listen first", description: "Hear a short exchange." },
      { kind: "speak", skill: "speaking", minutes: 9, title: "Conversation", description: "Talk it through." },
      { kind: "read", skill: "reading", minutes: 3, title: "Reading", description: "A short text." },
      { kind: "write", skill: "writing", minutes: 2, title: "Writing", description: "A short typed response." },
      { kind: "summary", skill: "reading", minutes: 1, title: "Summary", description: "Corrections worth keeping." },
    ],
    ...over,
  };
}

function detail(p: SessionPlan = plan(), over: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: ID,
    kind: p.kind,
    status: "planned",
    localStudyDate: p.localStudyDate,
    durationMinutes: p.durationMinutes,
    targetBand: p.targetBand,
    situationTitleEn: p.situation.titleEn,
    situationTitleZh: p.situation.titleZh,
    synthetic: p.synthetic,
    createdAt: "2026-03-04T10:00:00.000Z",
    startedAt: null,
    endedAt: null,
    editionId: p.editionId,
    plan: p,
    actualSeconds: 0,
    ...over,
  };
}

function summary(d: SessionDetail): SessionSummary {
  return {
    id: d.id,
    kind: d.kind,
    status: d.status,
    localStudyDate: d.localStudyDate,
    durationMinutes: d.durationMinutes,
    targetBand: d.targetBand,
    situationTitleEn: d.situationTitleEn,
    situationTitleZh: d.situationTitleZh,
    synthetic: d.synthetic,
    createdAt: d.createdAt,
    startedAt: d.startedAt,
    endedAt: d.endedAt,
  };
}

const status = () => json({ activeEdition: null, dimensions: [], vocabByBand: [], manifests: [] });
const SESSIONS = "/api/v1/sessions?limit=5";
const noSessions = () => json({ sessions: [], resumable: null });

describe("starting today's session (SPEC §5.2)", () => {
  it("plans a session with the saved settings and opens its plan", async () => {
    const bodies: unknown[] = [];
    renderApp("/", {
      "/api/v1/me": () => json(me()),
      "/api/v1/curriculum/status": status,
      [SESSIONS]: noSessions,
      "POST /api/v1/sessions/plan": (init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return json({ session: detail(), reused: false }, 201);
      },
      [`/api/v1/sessions/${ID}`]: () => json({ session: detail() }),
    });

    expect(await screen.findByText(/20 minutes, HSK 2 \(your chosen band\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start today's session" }));

    expect(await screen.findByRole("heading", { level: 1, name: /点菜/ })).toBeInTheDocument();
    expect(bodies).toEqual([{}]);
  });

  it("says the band is a suggestion when none is chosen", async () => {
    renderApp("/", {
      "/api/v1/me": () => json(me({ settings: savedSettings() })),
      "/api/v1/curriculum/status": status,
      [SESSIONS]: noSessions,
    });
    expect(await screen.findByText(/starting from HSK 1 as a suggestion, since no band is chosen/)).toBeInTheDocument();
  });

  it("offers to open today's unfinished session instead of planning another", async () => {
    const d = detail();
    renderApp("/", {
      "/api/v1/me": () => json(me()),
      "/api/v1/curriculum/status": status,
      [SESSIONS]: () => json({ sessions: [summary(d)], resumable: summary(d) }),
    });
    const link = await screen.findByRole("link", { name: "Open today's plan" });
    expect(link).toHaveAttribute("href", `/session/${ID}`);
    expect(screen.queryByRole("button", { name: "Start today's session" })).not.toBeInTheDocument();
    // Today's session is not repeated under "Recent sessions".
    expect(screen.queryByText("Recent sessions")).not.toBeInTheDocument();
  });

  it("says Resume for a session that has been started, and lists earlier ones", async () => {
    const today = summary(detail(plan(), { status: "paused" }));
    const earlier: SessionSummary = { ...today, id: "99999999-2222-4333-8444-555555555555", status: "complete", localStudyDate: "2026-03-03", situationTitleEn: "Asking the way" };
    renderApp("/", {
      "/api/v1/me": () => json(me()),
      "/api/v1/curriculum/status": status,
      [SESSIONS]: () => json({ sessions: [today, earlier], resumable: today }),
    });
    expect(await screen.findByRole("link", { name: "Resume today's session" })).toBeInTheDocument();
    const recent = screen.getByText("Recent sessions").parentElement as HTMLElement;
    expect(within(recent).getAllByRole("link")).toHaveLength(1);
    expect(recent).toHaveTextContent("2026-03-03");
    expect(recent).toHaveTextContent("Asking the way");
    expect(recent).toHaveTextContent("Complete");
  });

  it("blocks HSK sessions without the curriculum and offers a clearly labelled open conversation", async () => {
    const bodies: unknown[] = [];
    const chat = plan({ kind: "free_chat", editionId: null, synthetic: false, targetBand: null, bandSource: null, targets: [], levelConstraints: { activeBand: null, stretchBand: null }, situation: { id: "free-chat", sourceType: "app-authored", titleZh: "自由聊天", titleEn: "Open conversation", communicativeGoal: "Talk about whatever you like." } });
    renderApp("/", {
      "/api/v1/me": () => json(me({ curriculumImported: false })),
      "/api/v1/curriculum/status": status,
      [SESSIONS]: noSessions,
      "POST /api/v1/sessions/plan": (init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return json({ session: detail(chat), reused: false }, 201);
      },
      [`/api/v1/sessions/${ID}`]: () => json({ session: detail(chat) }),
    });

    const start = await screen.findByRole("button", { name: "Start today's session" });
    expect(start).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/Not an HSK lesson: no syllabus words/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Plan an open conversation instead" }));
    expect(await screen.findByText("Open conversation, not an HSK lesson.")).toBeInTheDocument();
    expect(bodies).toEqual([{ freeChat: true }]);
    expect(screen.queryByRole("region", { name: "Words for this session" })).not.toBeInTheDocument();
    expect(screen.getByRole("main").textContent).not.toMatch(/HSK \d/);
  });

  it("shows the server's message when planning fails", async () => {
    renderApp("/", {
      "/api/v1/me": () => json(me()),
      "/api/v1/curriculum/status": status,
      [SESSIONS]: noSessions,
      "POST /api/v1/sessions/plan": () =>
        json({ error: { code: "CURRICULUM_MISSING", message: "No vocabulary is imported for that band.", retryable: false } }, 503),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Start today's session" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't plan a session. No vocabulary is imported for that band.");
    expect(screen.getByRole("heading", { level: 1, name: /Today/ })).toBeInTheDocument();
  });
});

describe("session plan page (SPEC §5.3, FR-006)", () => {
  const url = `/api/v1/sessions/${ID}`;

  it("shows the situation, goal, words with their roles, and the time budget", async () => {
    renderApp(`/session/${ID}`, { "/api/v1/me": () => json(me()), [url]: () => json({ session: detail() }) });

    expect(await screen.findByRole("heading", { level: 1, name: /点菜 Ordering a meal/ })).toBeInTheDocument();
    expect(screen.getByText("Order food and drinks, ask what is good, and pay.")).toBeInTheDocument();
    expect(screen.getByText(/written for ShuoLab\. It is not an HSK topic or task/)).toBeInTheDocument();
    expect(screen.getByText(/2026-03-04 · 20 minutes · Planned, not started/)).toBeInTheDocument();

    const words = screen.getByRole("region", { name: "Words for this session" });
    const links = within(words).getAllByRole("link");
    expect(links).toHaveLength(4);
    expect(links[0]).toHaveAttribute("href", "/curriculum/item/synthetic-fixture%3Avocab%3A301");
    expect(links[0]).toHaveTextContent("New");
    expect(links[2]).toHaveTextContent("Review, HSK 1");
    expect(links[3]).toHaveTextContent("Stretch, HSK 3");
    expect(words).toHaveTextContent("the band you chose to study. It is not a measured level.");
    expect(words).toHaveTextContent("Appearing here is not evidence that you know a word.");

    // The steps, in order, with their minutes (SPEC §5.3).
    const steps = screen.getByRole("navigation", { name: "Session steps" });
    expect(within(steps).getAllByRole("button")).toHaveLength(detail().plan.activities.length);
    expect(within(steps).getByRole("button", { name: /^1\. / })).toHaveAttribute("aria-current", "step");
    expect(steps).toHaveTextContent("of the time is listening and speaking.");
  });

  it("labels synthetic data, starts on the first step below the plan, and moves between steps", async () => {
    renderApp(`/session/${ID}`, { "/api/v1/me": () => json(me()), [url]: () => json({ session: detail() }) });
    expect(await screen.findByText("Test data, not HSK content.")).toBeInTheDocument();
    const regions = screen.getAllByRole("region").map((r) => r.getAttribute("aria-labelledby"));
    // The words come before the current step; only the delete control comes after it.
    expect(regions[0]).toBe(screen.getByRole("region", { name: "Words for this session" }).getAttribute("aria-labelledby"));
    expect(regions.at(-1)).toBe(screen.getByRole("region", { name: "Delete this session" }).getAttribute("aria-labelledby"));
    expect(screen.getByRole("region", { name: "Warm-up" })).toBeInTheDocument();

    await userEvent.click(within(screen.getByRole("navigation", { name: "Session steps" })).getByRole("button", { name: /Conversation/ }));
    const conversation = await screen.findByRole("region", { name: "Conversation" });
    expect(within(conversation).getByLabelText("Your reply in Chinese")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Warm-up" })).not.toBeInTheDocument();
  });

  it("says a suggested band is a suggestion", async () => {
    renderApp(`/session/${ID}`, {
      "/api/v1/me": () => json(me()),
      [url]: () => json({ session: detail(plan({ targetBand: "1", bandSource: "suggestion", synthetic: false })) }),
    });
    expect(await screen.findByText(/suggested as a starting point because you have not chosen a band/)).toBeInTheDocument();
    expect(screen.queryByText(/Test data/)).not.toBeInTheDocument();
  });

  it("shows a colloquial expression apart from the words, with its warnings", async () => {
    const p = plan({
      colloquial: [{ id: "colloquial:synthetic-fixture:sample-02", term: "样例口语2", pinyin: "yànglì kǒuyǔ 2", meaningEn: "placeholder meaning 2", warnings: ["Casual. Avoid with elders, clients, teachers and officials."], synthetic: true }],
    });
    renderApp(`/session/${ID}`, { "/api/v1/me": () => json(me()), [url]: () => json({ session: detail(p) }) });
    const region = await screen.findByRole("region", { name: "Colloquial expression" });
    expect(region).toHaveTextContent("样例口语2");
    expect(within(region).getByRole("list", { name: "Usage warnings" })).toHaveTextContent("Casual.");
    expect(region).toHaveTextContent("never counted as HSK");
    expect(within(screen.getByRole("region", { name: "Words for this session" })).queryByText("样例口语2")).not.toBeInTheDocument();
  });

  it("shows the server's message for a session that does not exist", async () => {
    renderApp(`/session/${ID}`, {
      "/api/v1/me": () => json(me()),
      [url]: () => json({ error: { code: "NOT_FOUND", message: "No such session.", retryable: false } }, 404),
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("No such session.");
  });

  it("shows not-found for a malformed session address without asking the server", () => {
    const fetchMock = renderApp("/session/example", { "/api/v1/me": () => json(me()) });
    expect(screen.getByRole("heading", { level: 1, name: /Page not found/ })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/sessions/"))).toBe(false);
  });
});
