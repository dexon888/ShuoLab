import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { percent } from "../../src/client/pages/ProgressPage";
import type { CurriculumStatusResponse, MeResponse } from "../../src/shared/api";
import type { ProgressSummary } from "../../src/shared/progress";
import type { DueResponse } from "../../src/shared/review";
import { emptyProgress, json, renderApp, savedSettings, type Responder } from "./render";

const me: MeResponse = { owner: { email: null, authMode: "dev-bypass" }, settings: savedSettings(), providers: [], curriculumImported: true, version: "test" };

/** Some evidence: placeholder vocabulary, two listening checks, reviews over the minimum. */
function withEvidence(days = 30): ProgressSummary {
  const base = emptyProgress(days);
  const bands = base.hsk.bands.map((b) =>
    b.band === "1"
      ? {
          ...b,
          entries: 120,
          introduced: 6,
          bySkill: { ...b.bySkill, reading: { introduced: 2, practiced: 1, developing: 2, mastered: 1 }, listening: { introduced: 5, practiced: 0, developing: 1, mastered: 0 } },
        }
      : b,
  );
  return {
    ...base,
    practice: { ...base.practice, days: base.practice.days.map((d, i) => ({ ...d, minutes: i === days - 1 ? 22.5 : i === days - 3 ? 10 : 0 })), totalMinutes: 32.5, activeDays: 2, sessionsCompleted: 2 },
    listening: { checks: 2, questions: 5, correct: 4, accuracy: null, assistedChecks: 1, lastCheckedAt: "2026-03-04T10:00:00.000Z" },
    speaking: { spokenTurns: 9, typedTurns: 4, sessionsWithSpeech: 2 },
    reviews: { ratings: 12, recalled: 9, recallRate: 0.75, averageRating: 2.75 },
    hsk: {
      editionId: "synthetic-fixture",
      synthetic: true,
      bands,
      total: { entries: 120, introduced: 6, bySkill: bands[0]?.bySkill ?? base.hsk.total.bySkill },
    },
  };
}

function open(path: string, routes: Record<string, Responder>) {
  return renderApp(path, { "/api/v1/me": () => json(me), ...routes });
}

describe("the progress page (SPEC §5.6)", () => {
  it("says there is too little evidence instead of showing a rate", async () => {
    open("/progress", { "/api/v1/progress/summary?days=30": () => json(emptyProgress(30)) });
    expect(await screen.findByText("Insufficient evidence: 0 listening checks of the 5 needed.")).toBeInTheDocument();
    expect(screen.getByText("Insufficient evidence: 0 ratings of the 5 needed.")).toBeInTheDocument();
    expect(screen.getByText(/No vocabulary is imported, so there is nothing to measure against/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d\s?%/);
  });

  it("shows each figure with what it is drawn from, and the coverage table with its denominators", async () => {
    open("/progress", { "/api/v1/progress/summary?days=30": () => json(withEvidence()) });
    expect(await screen.findByText("75%")).toBeInTheDocument();
    expect(screen.getByText("9 of 12 reviews recalled, by your own rating; average 2.8 of 4.")).toBeInTheDocument();
    // Two checks are fewer than five: no accuracy, but the count is shown.
    expect(screen.getByText("Insufficient evidence: 2 listening checks of the 5 needed.")).toBeInTheDocument();
    expect(screen.getByText(/1 listening check was answered after the text was shown and is left out/)).toBeInTheDocument();
    expect(screen.getByText(/4 typed turns, counted as writing, not speaking/)).toBeInTheDocument();
    expect(screen.getByText("32.5")).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Entries per band by evidence state" });
    const band1 = within(table).getByRole("row", { name: /^HSK 1/ });
    expect(band1).toHaveTextContent("120");
    expect(band1).toHaveTextContent("of 300 published");
    expect(within(band1).getAllByRole("cell").map((c) => c.textContent)).toEqual(["120of 300 published", "6", "0 · 1", "0 · 0", "1 · 2", "0 · 0"]);
    expect(screen.getByText(/Generated placeholder words for testing, not HSK content/)).toBeInTheDocument();
    expect(screen.getByText(/Coverage is not a prediction of an HSK exam result/)).toBeInTheDocument();
  });

  it("gives the practice chart's numbers as a table too", async () => {
    open("/progress", { "/api/v1/progress/summary?days=30": () => json(withEvidence()) });
    await userEvent.click(await screen.findByText("Show as a table"));
    const days = screen.getByRole("table", { name: "" });
    expect(within(days).getAllByRole("row")).toHaveLength(31);
    expect(within(days).getAllByRole("row")[1]).toHaveTextContent("22.5");
  });

  it("switches the period", async () => {
    const asked: string[] = [];
    open("/progress", {
      "/api/v1/progress/summary?days=30": () => (asked.push("30"), json(emptyProgress(30))),
      "/api/v1/progress/summary?days=90": () => (asked.push("90"), json(withEvidence(90))),
    });
    const period = await screen.findByRole("group", { name: "Period" });
    expect(within(period).getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(period).getByRole("button", { name: "90 days" }));
    expect(await screen.findByText("75%")).toBeInTheDocument();
    expect(asked).toEqual(["30", "90"]);
    expect(within(period).getByRole("button", { name: "90 days" })).toHaveAttribute("aria-pressed", "true");
  });

  it("formats rates as whole percentages", () => {
    expect([percent(0), percent(0.756), percent(1)]).toEqual(["0%", "76%", "100%"]);
  });
});

describe("Today's progress cards (SPEC §5.2)", () => {
  const status: CurriculumStatusResponse = {
    edition: { id: "synthetic-fixture", publisher: "Test", editionDate: "2026-01-01", synthetic: true },
    dimensions: [],
    vocabByBand: [],
    manifests: [],
  } as unknown as CurriculumStatusResponse;
  const due: DueResponse = { cards: [], dueCount: 3, totalCards: 10, nextDueAt: null };
  const routes = (week: ProgressSummary) => ({
    "/api/v1/sessions?limit=5": () => json({ sessions: [], resumable: null }),
    "/api/v1/curriculum/status": () => json(status),
    "/api/v1/progress/summary?days=7": () => json(week),
    "/api/v1/reviews/due?limit=20": () => json(due),
  });

  it("shows the week's practice, listening and speaking, due reviews and words met", async () => {
    open("/", routes(withEvidence(7)));
    const comms = await screen.findByRole("region", { name: "Communication progress" });
    expect(await within(comms).findByText(/minutes of practice on/)).toHaveTextContent("32.5 minutes of practice on 2 of the last 7 days.");
    expect(within(comms).getByText(/4 of 5 listening questions right in 2 checks \(too few for an accuracy figure\)\./)).toBeInTheDocument();
    expect(within(comms).getByText("9 spoken turns, 4 typed.")).toBeInTheDocument();
    const review = screen.getByRole("region", { name: "Review" });
    expect(review).toHaveTextContent("3 cards due.");
    expect(within(review).getByRole("link", { name: "Review now" })).toHaveAttribute("href", "/review");
    const hsk = screen.getByRole("region", { name: "HSK curriculum" });
    expect(await within(hsk).findByText(/^Met/)).toHaveTextContent("Met 6 of 120 entries (placeholder words). Mastered: listening 0, reading 1.");
  });

  it("leaves the review card out until there are cards", async () => {
    open("/", { ...routes(emptyProgress(7)), "/api/v1/reviews/due?limit=20": () => json({ cards: [], dueCount: 0, totalCards: 0, nextDueAt: null }) });
    expect(await screen.findByText("No listening checks this week.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Review" })).not.toBeInTheDocument();
  });
});
