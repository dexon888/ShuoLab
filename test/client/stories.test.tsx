import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { MeResponse } from "../../src/shared/api";
import type { Story } from "../../src/shared/stories";
import { json, renderApp, savedSettings } from "./render";

// Generated placeholder text: not HSK content.
const ID = "bbbbbbbb-0000-4000-8000-000000000001";
const me: MeResponse = { owner: { email: null, authMode: "dev-bypass" }, settings: savedSettings(), providers: [], curriculumImported: true, version: "test" };

function story(over: Partial<Story> = {}): Story {
  return {
    id: ID,
    kind: "story",
    band: "1",
    titleZh: "样例故事",
    titleEn: "A placeholder story",
    episode: 3,
    createdAt: "2026-11-27T10:00:00.000Z",
    coverage: { known: 18, total: 20 },
    finishedAt: null,
    minutes: 0,
    standIn: false,
    lines: [{ speaker: null, zh: "我的朋友喜欢茶。", pinyin: "", en: "" }],
    questions: [{ questionEn: "What does the friend like?", optionsEn: ["Tea", "Coffee", "Milk"], answerIndex: null }],
    answers: null,
    correct: null,
    revealed: false,
    unassisted: null,
    glossary: { 朋友: { pinyin: "péngyou", definition: "friend", provenance: "CC-CEDICT (CC BY-SA 4.0), matched by characters and pinyin. Not HSK content." }, 茶: { pinyin: "chá", definition: null, provenance: null } },
    ...over,
  };
}

describe("stories (SPEC §5.10, FR-036)", () => {
  it("shows the known-word share, glosses a tapped word with its source, and logs reading time", async () => {
    const sent: unknown[] = [];
    renderApp(`/stories/${ID}`, {
      "/api/v1/me": () => json(me),
      [`/api/v1/stories/${ID}`]: () => json({ story: story() }),
      [`POST /api/v1/stories/${ID}/finish`]: (init) => (sent.push(JSON.parse(String(init?.body))), json({ story: story({ minutes: 2, finishedAt: "2026-11-27T10:05:00.000Z" }) })),
    });
    expect(await screen.findByText(/You had met 18 of its 20 words/)).toBeInTheDocument();
    expect(screen.queryByText("A placeholder story")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "朋友" }));
    expect(screen.getByText("friend")).toBeInTheDocument();
    expect(screen.getByText(/CC-CEDICT \(CC BY-SA 4\.0\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "茶" }));
    expect(screen.getByText("No meaning imported yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Done: log my time" }));
    expect(await screen.findByText(/Logged\. 2 minutes on this story so far\./)).toBeInTheDocument();
    expect((sent[0] as { minutes: number }).minutes).toBeGreaterThanOrEqual(0);
  });

  it("lists stories with input minutes and starts the next episode", async () => {
    const sent: unknown[] = [];
    renderApp("/stories", {
      "/api/v1/me": () => json(me),
      "/api/v1/stories": () => json({ stories: [{ ...story(), finishedAt: "2026-11-27T10:05:00.000Z", minutes: 7 }], minutesThisWeek: 7, minutesTotal: 31 }),
      "POST /api/v1/stories": (init) => (sent.push(JSON.parse(String(init?.body))), json({ story: story({ episode: 4 }) }, 201)),
      [`/api/v1/stories/${ID}`]: () => json({ story: story({ episode: 4 }) }),
    });
    expect(await screen.findByText(/minutes of story input this week, 31 in all/)).toBeInTheDocument();
    expect(screen.getByText(/90% known words · 7 min/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next story episode" }));
    expect(sent).toEqual([{ kind: "story", continueSeries: true }]);
    expect(await screen.findByText(/You had met 18 of its 20 words/)).toBeInTheDocument();
  });
});
