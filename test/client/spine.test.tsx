import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { MeResponse } from "../../src/shared/api";
import type { SessionStateResponse } from "../../src/shared/debrief";
import type { LessonMaterials } from "../../src/shared/lesson";
import type { ListeningExercise } from "../../src/shared/listening";
import { buildActivities } from "../../src/server/services/planner";
import type { SessionDetail, SessionPlan } from "../../src/shared/session";
import { json, renderApp, savedSettings, type Responder } from "./render";

// Generated placeholder plan in the v2 shape: not HSK content.
const ID = "11111111-2222-4333-8444-555555555555";
const SESSION = `/api/v1/sessions/${ID}`;
const GRAMMAR = "synthetic-fixture:grammar:1";

const me: MeResponse = { owner: { email: null, authMode: "dev-bypass" }, settings: savedSettings(), providers: [], curriculumImported: true, version: "test" };

function plan(): SessionPlan {
  return {
    version: 2,
    kind: "hsk",
    editionId: "synthetic-fixture",
    synthetic: true,
    targetBand: "1",
    bandSource: "owner_choice",
    durationMinutes: 20,
    localStudyDate: "2026-03-04",
    situation: { id: "syllabus:t:k", sourceType: "syllabus", titleZh: "样例主题", titleEn: "样例领域 · 样例任务", communicativeGoal: "能完成样例任务。" },
    targets: [
      { itemId: "synthetic-fixture:vocab:1", sourceId: 1, hskBand: "1", hanzi: "样例词1", pinyin: null, role: "active" },
      { itemId: "synthetic-fixture:vocab:2", sourceId: 2, hskBand: "1", hanzi: "样例词2", pinyin: null, role: "active" },
    ],
    grammarIds: [GRAMMAR],
    grammar: [{ itemId: GRAMMAR, sourceId: 1, hskBand: "1", name: "是……的", grammarType: "特殊表达法", example: "我是坐车来的。", role: "new", unverified: true }],
    characters: [{ itemId: "synthetic-fixture:character:1", hanzi: "样", skill: "recognition", word: "样例词1", unverified: true }],
    topic: { itemId: "synthetic-fixture:topic:1", area: "样例领域", subject: "样例主题", details: "样例细节", unverified: true },
    task: { itemId: "synthetic-fixture:task:1", task: "样例任务", canDo: "能完成样例任务。", unverified: true },
    weakestSkill: "writing",
    colloquial: [],
    levelConstraints: { activeBand: "1", stretchBand: null },
    activities: buildActivities(20, "writing"),
  };
}

function session(status: SessionDetail["status"] = "active"): SessionDetail {
  return {
    id: ID,
    kind: "hsk",
    status,
    localStudyDate: "2026-03-04",
    durationMinutes: 20,
    targetBand: "1",
    situationTitleEn: "样例领域 · 样例任务",
    situationTitleZh: "样例主题",
    synthetic: true,
    createdAt: "2026-03-04T10:00:00.000Z",
    startedAt: "2026-03-04T10:01:00.000Z",
    endedAt: null,
    editionId: "synthetic-fixture",
    plan: plan(),
    actualSeconds: 60,
  };
}

const listening: ListeningExercise = {
  id: "eeeeeeee-0000-4000-8000-000000000001",
  sessionId: ID,
  source: "generated",
  model: "fake-tutor-1",
  standIn: true,
  coversTargets: true,
  lines: [
    { speaker: "A", zh: "你是怎么来的？", pinyin: "", en: "" },
    { speaker: "B", zh: "我是坐车来的，带了样例词1。", pinyin: "", en: "" },
  ],
  questions: [{ questionEn: "How did B come?", optionsEn: ["By car", "On foot", "By plane"], answerIndex: 0 }],
  createdAt: "2026-03-04T10:01:00.000Z",
  playedAt: "2026-03-04T10:01:10.000Z",
  revealedAt: null,
  answeredAt: "2026-03-04T10:02:00.000Z",
  answers: [0],
  result: { correct: 1, total: 1, unassisted: true },
};

function materials(over: Partial<LessonMaterials> = {}): LessonMaterials {
  return {
    sessionId: ID,
    source: "generated",
    standIn: true,
    coversTargets: true,
    reading: {
      lines: [{ zh: "他是昨天到的。我学了样例词2。", pinyin: "tā shì …", en: "He arrived yesterday." }],
      questions: [{ questionEn: "When did he arrive?", optionsEn: ["Yesterday", "Today", "Tomorrow"], answerIndex: null }],
      answers: null,
      correct: null,
      revealed: false,
      unassisted: null,
    },
    practice: [{ grammarId: GRAMMAR, promptZh: "用“是……的”说一句话。", promptEn: "Say one sentence with 是……的.", modelAnswerZh: null, result: null }],
    writing: {
      promptZh: "请写两三句话：能完成样例任务。",
      promptEn: "Write two or three sentences.",
      criteria: [
        { id: `grammar:${GRAMMAR}`, label: "Uses 是……的" },
        { id: "length", label: "At least 15 Chinese characters" },
      ],
      result: null,
    },
    ...over,
  };
}

function open(step: string, state: Partial<SessionStateResponse> = {}, routes: Record<string, Responder> = {}) {
  const calls: { url: string; body: unknown }[] = [];
  const record = (url: string, respond: (body: unknown) => Response): Responder => (init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    return respond(body);
  };
  renderApp(`/session/${ID}?step=${step}`, {
    "/api/v1/me": () => json(me),
    [SESSION]: () => json({ session: session(), turns: [], debrief: null, listening: null, materials: null, ...state }),
    [`POST ${SESSION}/materials`]: record("materials", () => json({ materials: materials() }, 201)),
    [`POST ${SESSION}/materials/reading/answers`]: record("reading", () =>
      json({
        materials: materials({
          reading: { ...materials().reading, questions: materials().reading.questions.map((q) => ({ ...q, answerIndex: 0 })), answers: [0], correct: 1, unassisted: true },
        }),
      }),
    ),
    [`POST ${SESSION}/materials/practice`]: record("practice", (body) =>
      json({
        materials: materials({
          practice: materials().practice.map((p) => ({
              ...p,
              modelAnswerZh: "我是坐车来的。",
              result: {
                answer: (body as { answer: string }).answer,
                mode: "typed",
                passed: true,
                at: "2026-03-04T10:05:00.000Z",
                checks: [
                  { id: `grammar:${GRAMMAR}`, label: "Uses 是……的", met: true },
                  { id: "chinese", label: "Answers in Chinese", met: true },
                ],
              },
            })),
        }),
      }),
    ),
    [`POST ${SESSION}/materials/writing`]: record("writing", (body) =>
      json({
        materials: materials({
          writing: {
            ...materials().writing,
            result: {
              answer: (body as { answer: string }).answer,
              mode: "typed",
              passed: false,
              at: "2026-03-04T10:06:00.000Z",
              checks: [
                { id: `grammar:${GRAMMAR}`, label: "Uses 是……的", met: true },
                { id: "length", label: "At least 15 Chinese characters", met: false },
              ],
            },
          },
        }),
      }),
    ),
    ...routes,
  });
  return calls;
}

const step = async (name: string) => within(await screen.findByRole("region", { name }));

describe("the session spine (SPEC §5.3)", () => {
  it("shows the topic and task, labelled as second-hand, and gives the weakest skill extra time", async () => {
    open("warmup");
    expect(await screen.findByText("能完成样例任务。", { selector: "span" })).toBeInTheDocument();
    expect(screen.getAllByText(/second-hand transcription/).length).toBeGreaterThan(0);
    const nav = screen.getByRole("navigation", { name: "Session steps" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent?.replace(/ · .*$/, ""))).toEqual([
      "1. Warm-up",
      "2. Introduce",
      "3. Listen first",
      "4. Notice",
      "5. Read",
      "6. Guided practice",
      "7. Conversation",
      "8. Write",
      "9. Summary",
    ]);
    expect(nav).toHaveTextContent("Extra time today for writing");
  });

  it("notice: shows the grammar point with its example, the transcript with words and pattern marked, and characters in their words", async () => {
    open("notice", { listening });
    const notice = await step("Notice");
    expect(notice.getByRole("link", { name: "是……的" })).toHaveAttribute("href", `/curriculum/item/${encodeURIComponent(GRAMMAR)}`);
    const marks = Array.from(document.querySelectorAll("mark")).map((m) => m.textContent);
    expect(marks).toContain("样例词1");
    expect(marks).toEqual(expect.arrayContaining(["是", "的"]));
    expect(notice.getByRole("link", { name: /in 样例词1 · to recognise/ })).toBeInTheDocument();
  });

  it("notice: waits for the listening answers before showing the transcript", async () => {
    open("notice", { listening: { ...listening, answeredAt: null, answers: null, result: null } });
    expect(await screen.findByText(/Answer the listening questions first/)).toBeInTheDocument();
  });

  it("read: writes the materials on request, then checks answers before the translation", async () => {
    const calls = open("read");
    const read = await step("Read");
    await userEvent.click(read.getByRole("button", { name: "Start" }));
    expect(await read.findByText("He arrived yesterday.", { exact: false }).catch(() => null)).toBeNull();
    await userEvent.click(await read.findByRole("radio", { name: "Yesterday" }));
    await userEvent.click(read.getByRole("button", { name: "Check answers" }));
    expect(await read.findByText("1 of 1 right, before the translation.")).toBeInTheDocument();
    expect(calls.map((c) => c.url)).toEqual(["materials", "reading"]);
    expect(calls[1]?.body).toEqual({ answers: [0] });
  });

  it("practice: checks an answer by the pattern and then shows a model answer", async () => {
    const calls = open("practice", { materials: materials() });
    const practice = await step("Guided practice");
    await userEvent.type(practice.getByLabelText("Your answer to prompt 1"), "我是走路来的。");
    await userEvent.click(practice.getByRole("button", { name: "Check" }));
    expect(await practice.findByText("Good: it uses the pattern.")).toBeInTheDocument();
    expect(practice.getByText("我是坐车来的。")).toBeInTheDocument();
    expect(practice.getByText(/Typed answers count as writing practice/)).toBeInTheDocument();
    expect(calls).toEqual([{ url: "practice", body: { index: 0, answer: "我是走路来的。", mode: "typed" } }]);
  });

  it("write: lists the criteria, then says which were met", async () => {
    const calls = open("write", { materials: materials() });
    const write = await step("Write");
    expect(write.getByText("At least 15 Chinese characters")).toBeInTheDocument();
    await userEvent.type(write.getByLabelText("Your writing"), "我是昨天来的。");
    await userEvent.click(write.getByRole("button", { name: "Check my writing" }));
    expect(await write.findByText(/Some criteria are not met yet/)).toBeInTheDocument();
    expect(write.getByText(/At least 15 Chinese characters: not yet/)).toBeInTheDocument();
    expect(calls[0]).toEqual({ url: "writing", body: { answer: "我是昨天来的。" } });
  });

  it("summary: says where the grammar point was used so far", async () => {
    open("summary", {
      materials: materials({
        writing: { ...materials().writing, result: { answer: "x", mode: "typed", passed: true, at: "2026-03-04T10:06:00.000Z", checks: [{ id: `grammar:${GRAMMAR}`, label: "Uses 是……的", met: true }] } },
      }),
    });
    const summary = await step("Summary");
    expect(summary.getByText(/you used it in writing\./)).toBeInTheDocument();
    expect(summary.getByText(/Finish the session from the Conversation step/)).toBeInTheDocument();
  });

  it("moves through the steps with Next and Back", async () => {
    open("warmup");
    await screen.findByRole("region", { name: "Warm-up" });
    await userEvent.click(screen.getByRole("button", { name: "Next: Introduce" }));
    expect(await screen.findByRole("region", { name: "Introduce" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("region", { name: "Warm-up" })).toBeInTheDocument();
  });
});

describe("the task check in the summary (SPEC §6.1, FR-030)", () => {
  const checked = {
    check: {
      sessionId: ID,
      taskItemId: "synthetic-fixture:task:1",
      canDo: "能完成样例任务。",
      criteria: [
        { label: "Stated a time", met: true, evidence: "三点见" },
        { label: "Asked a question", met: false, evidence: null },
      ],
      passed: false,
      scorerModel: "fake-tutor-1",
      scorerVersion: "task-check-v1",
      standIn: true,
      checkedAt: "2026-03-04T10:30:00.000Z",
      task: { passes: 0, topics: 0, achieved: false },
    },
  };

  it("offers the check once the session is finished, then shows each criterion with the learner's own words", async () => {
    let ran = false;
    open(
      "summary",
      { session: { ...session("complete"), endedAt: "2026-03-04T10:20:00.000Z" } },
      {
        [`${SESSION}/task-check`]: () => json(ran ? checked : { check: null }),
        [`POST ${SESSION}/task-check`]: () => ((ran = true), json(checked)),
      },
    );
    const summary = await step("Summary");
    await userEvent.click(await summary.findByRole("button", { name: "Check the task" }));
    expect(await summary.findByText(/Stated a time: yes/)).toBeInTheDocument();
    expect(summary.getByText("“三点见”")).toBeInTheDocument();
    expect(summary.getByText(/Asked a question: not shown/)).toBeInTheDocument();
    expect(summary.getByText(/Passed on 0 of the 2 days needed/)).toBeInTheDocument();
    expect(summary.getByText(/practice stand-in/)).toBeInTheDocument();
    expect(summary.getByText(/not an HSK result/)).toBeInTheDocument();
  });

  it("says the task is checked after finishing while the session is open", async () => {
    open("summary");
    expect(await (await step("Summary")).findByText(/checked after you finish/)).toBeInTheDocument();
  });
});

describe("introducing new words with sourced meanings (SPEC §2.6 rule 2, FR-033)", () => {
  it("shows each new word with pinyin and its meaning labelled with the dictionary, and says so when there is none", async () => {
    open("introduce", {
      glosses: { "synthetic-fixture:vocab:1": { definition: "placeholder meaning one", provenance: "CC-CEDICT (CC BY-SA 4.0), matched by characters and pinyin. Not HSK content." } },
    });
    const intro = await step("Introduce");
    expect(intro.getByText("样例词1")).toBeInTheDocument();
    expect(intro.getByText("placeholder meaning one")).toBeInTheDocument();
    expect(intro.getByText(/CC-CEDICT \(CC BY-SA 4.0\).*Not HSK content/)).toBeInTheDocument();
    expect(intro.getByText(/No meaning imported yet/)).toBeInTheDocument();
    expect(intro.getByText("是……的")).toBeInTheDocument();
  });

  it("lists today's words with their meanings in the notice step", async () => {
    open("notice", { glosses: { "synthetic-fixture:vocab:2": { definition: "placeholder meaning two", provenance: "CC-CEDICT" } } });
    expect(await (await step("Notice")).findByText("placeholder meaning two")).toBeInTheDocument();
  });
});
