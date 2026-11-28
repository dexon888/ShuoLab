import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { MeResponse } from "../../src/shared/api";
import type { Assessment } from "../../src/shared/assessment";
import { json, renderApp, savedSettings } from "./render";

// Generated placeholder items: not HSK content.
const ID = "aaaaaaaa-0000-4000-8000-000000000001";
const me: MeResponse = { owner: { email: null, authMode: "dev-bypass" }, settings: savedSettings({ studyBand: "2" }), providers: [], curriculumImported: true, version: "test" };

function test1(results: Assessment["results"] = null): Assessment {
  return {
    id: ID,
    kind: "band_test",
    hskBand: "2",
    editionId: "synthetic-fixture",
    synthetic: true,
    rubricVersion: "band-test-v1",
    startedAt: "2026-03-04T10:00:00.000Z",
    finishedAt: results ? "2026-03-04T10:10:00.000Z" : null,
    frame: { topic: "样例领域 · 样例主题", task: "能完成样例任务。" },
    questions: [
      { index: 0, kind: "word_reading", ask: "Choose the pinyin for this word.", prompt: "样例词1", audio: null, options: ["yàng 2", "yàng 1", "yàng 3"], criteria: [], unverifiedKey: false },
      { index: 1, kind: "grammar_gap", ask: "Choose what fills the gap.", prompt: "我＿＿坐车来的。", audio: null, options: ["了", "是", "过"], criteria: [], unverifiedKey: true },
      { index: 2, kind: "writing_task", ask: "Write 2–4 sentences in Chinese for this task: 能完成样例任务。", prompt: null, audio: null, options: [], criteria: ["At least 20 Chinese characters"], unverifiedKey: false },
    ],
    results,
  };
}

describe("tests (SPEC §6.5, FR-027)", () => {
  it("starts a band test for the study band and says it is not an HSK score", async () => {
    const sent: unknown[] = [];
    renderApp("/tests", {
      "/api/v1/me": () => json(me),
      "/api/v1/tests": () => json({ runs: [], checkpointDue: true }),
      "POST /api/v1/tests": (init) => (sent.push(JSON.parse(String(init?.body))), json({ assessment: test1() }, 201)),
      [`/api/v1/tests/${ID}`]: () => json({ assessment: test1() }),
    });
    expect((await screen.findAllByText(/never an HSK score or pass/)).length).toBeGreaterThan(0);
    expect(await screen.findByRole("button", { name: "Take this month's checkpoint" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start a band practice test" }));
    expect(sent).toEqual([{ band: "2", kind: "band_test" }]);
    expect(await screen.findByText("Choose the pinyin for this word.", { exact: false })).toBeInTheDocument();
  });

  it("sends one answer per question and shows section scores and keys", async () => {
    let finished = false;
    const sent: unknown[] = [];
    renderApp(`/tests/${ID}`, {
      "/api/v1/me": () => json(me),
      [`/api/v1/tests/${ID}`]: () => json({ assessment: test1() }),
      [`POST /api/v1/tests/${ID}/answers`]: (init) => {
        sent.push(JSON.parse(String(init?.body)));
        finished = true;
        return json({
          assessment: test1({
            sections: [
              { kind: "word_reading", skill: "reading", correct: 1, total: 1 },
              { kind: "grammar_gap", skill: "reading", correct: 0, total: 1 },
              { kind: "writing_task", skill: "writing", correct: 1, total: 1 },
            ],
            questions: [
              { index: 0, correct: true, key: "yàng 1", answer: "1" },
              { index: 1, correct: false, key: "是", answer: "0" },
              { index: 2, correct: true, key: "At least 20 Chinese characters", answer: "…" },
            ],
            correct: 2,
            total: 3,
            placement: null,
          }),
        });
      },
    });
    expect(await screen.findByText(/Unverified key/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "yàng 1" }));
    await userEvent.click(screen.getByRole("radio", { name: "了" }));
    await userEvent.type(screen.getByLabelText("Your answer to question 3"), "我今天学了很多。");
    await userEvent.click(screen.getByRole("button", { name: "Finish and score" }));
    const result = await screen.findByRole("region", { name: "Result" });
    expect(result).toHaveTextContent("2 of 3 on 2026-03-04");
    expect(result).toHaveTextContent("Grammar: 0 of 1");
    expect(screen.getByText(/✗ Not this time\./)).toBeInTheDocument();
    expect(sent).toEqual([{ answers: [1, 0, "我今天学了很多。"], spoken: [false, false, false] }]);
    expect(finished).toBe(true);
  });
});

describe("placement and moving up (SPEC §2.6 rule 6, FR-037)", () => {
  it("shows the size estimate and suggested band, and saves it as the study band", async () => {
    const sent: unknown[] = [];
    const placed: Assessment = {
      ...test1({
        sections: [],
        questions: [],
        correct: 14,
        total: 42,
        placement: {
          bands: [
            { band: "1", correct: 6, total: 6, known: 1, bandSize: 300 },
            { band: "2", correct: 3, total: 6, known: 0.25, bandSize: 200 },
          ],
          estimatedWords: 350,
          sampleSize: 42,
          suggestedBand: "2",
        },
      }),
      kind: "placement",
      questions: [],
    };
    renderApp(`/tests/${ID}`, {
      "/api/v1/me": () => json(me),
      [`/api/v1/tests/${ID}`]: () => json({ assessment: placed }),
      "PUT /api/v1/settings": (init) => (sent.push(JSON.parse(String(init?.body))), json({ settings: savedSettings({ studyBand: "2" }) })),
    });
    expect(await screen.findByText(/About/)).toHaveTextContent("About 350 syllabus words known, estimated from 42 questions (corrected for guessing).");
    expect(screen.getByText("HSK 2: 3 of 6 right, about 25% known")).toBeInTheDocument();
    expect(screen.getByText(/not counted as recall/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Study HSK 2" }));
    expect(await screen.findByRole("button", { name: "Study band saved" })).toBeInTheDocument();
    expect(sent).toEqual([{ studyBand: "2" }]);
  });

  it("suggests moving up once ready, and says what is still needed when not", async () => {
    renderApp("/tests", {
      "/api/v1/me": () => json(me),
      "/api/v1/tests": () => json({ runs: [], checkpointDue: false }),
      "/api/v1/tests/promotion": () => json({ promotion: { band: "2", next: "3", bandSize: 200, recalled: 170, testPasses: 2, ready: true } }),
    });
    expect(await screen.findByText("Ready to move up to HSK 3?")).toBeInTheDocument();
    expect(screen.getByText(/You recall 170 of 200 HSK 2 words \(85%\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take the placement test" })).toBeInTheDocument();
  });
});
