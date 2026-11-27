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
