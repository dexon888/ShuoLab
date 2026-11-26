import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import { AppRoutes, createQueryClient } from "../../src/client/app/App";
import { SpeechEnvironmentContext, defaultSpeechEnvironment, type SpeechEnvironment } from "../../src/client/speech/useVoice";
import { HSK_BANDS, VOCAB_NEW_ENTRIES_BY_BAND } from "../../src/shared/curriculum";
import { SKILLS } from "../../src/shared/learning";
import type { ProgressSummary } from "../../src/shared/progress";
import type { DueResponse } from "../../src/shared/review";
import { defaultSettings, type OwnerSettings } from "../../src/shared/settings";

/** jsdom has no microphone: by default the app sees a browser that cannot record. */
const noSpeech: SpeechEnvironment = { ...defaultSpeechEnvironment, canRecord: () => false };

export type Responder = (init?: RequestInit) => Response;

/** Settings of an owner who has finished onboarding. */
export function savedSettings(over: Partial<OwnerSettings> = {}): OwnerSettings {
  return {
    ...defaultSettings(),
    onboardedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const zeroSkills = () =>
  Object.fromEntries(SKILLS.map((s) => [s, { introduced: 0, practiced: 0, developing: 0, mastered: 0 }])) as ProgressSummary["hsk"]["total"]["bySkill"];

/** A progress summary with no evidence at all, for a window ending 2026-03-04. */
export function emptyProgress(days = 7, over: Partial<ProgressSummary> = {}): ProgressSummary {
  return {
    generatedAt: "2026-03-04T10:00:00.000Z",
    timeZone: "UTC",
    window: { days, from: "2026-02-26", to: "2026-03-04" },
    practice: {
      days: Array.from({ length: days }, (_, i) => ({ date: `2026-03-${String(Math.max(1, i - days + 5)).padStart(2, "0")}`, minutes: 0 })),
      totalMinutes: 0,
      activeDays: 0,
      sessionsCompleted: 0,
    },
    listening: { checks: 0, questions: 0, correct: 0, accuracy: null, assistedChecks: 0, lastCheckedAt: null },
    speaking: { spokenTurns: 0, typedTurns: 0, sessionsWithSpeech: 0 },
    reviews: { ratings: 0, recalled: 0, recallRate: null, averageRating: null },
    hsk: {
      editionId: null,
      synthetic: false,
      bands: HSK_BANDS.map((band) => ({ band, entries: 0, expectedEntries: VOCAB_NEW_ENTRIES_BY_BAND[band], introduced: 0, bySkill: zeroSkills() })),
      total: { entries: 0, introduced: 0, bySkill: zeroSkills() },
    },
    ...over,
  };
}

const noCards: DueResponse = { cards: [], dueCount: 0, totalCards: 0, nextDueAt: null };

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A month with nothing spent, for pages that show the budget meter. */
export const quietMonth = {
  month: "2026-03",
  estimatedUsd: 0,
  softUsd: 5,
  hardUsd: 10,
  remainingUsd: 10,
  softLimitReached: false,
  hardLimitReached: false,
  tutor: { requests: 0, tokensIn: 0, tokensOut: 0, estimatedUsd: 0 },
  speech: { month: "2026-03", recognitionSeconds: 0, recognitionLimitSeconds: 18000, synthesisChars: 0, synthesisLimitChars: 500000, recognitionAvailable: true, synthesisAvailable: true },
  disclaimer: "An estimate.",
};

/** Renders the whole app at `path`; any request not listed in `routes` fails the test. */
export function renderApp(path: string, routes: Record<string, Responder>, options: { speech?: SpeechEnvironment } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    // Writes are listed as "PUT /path"; reads by path alone.
    // Today asks for these; tests that care about them override them.
    const defaults: Record<string, Responder> = {
      "/api/v1/progress/summary?days=7": () => json(emptyProgress(7)),
      "/api/v1/reviews/due?limit=20": () => json(noCards),
      "/api/v1/my-data": () => json({ counts: {}, transcriptRetentionDays: null, sessionsPastRetention: 0 }),
      "/api/v1/usage/monthly": () => json(quietMonth),
    };
    const key = method === "GET" ? url : `${method} ${url}`;
    const responder = routes[key] ?? defaults[key];
    if (!responder) throw new Error(`Unexpected request: ${method} ${url}`);
    return responder(init);
  });
  vi.stubGlobal("fetch", fetchMock);

  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  render(
    <QueryClientProvider client={client}>
      <SpeechEnvironmentContext.Provider value={options.speech ?? noSpeech}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </SpeechEnvironmentContext.Provider>
    </QueryClientProvider>,
  );
  return fetchMock;
}
