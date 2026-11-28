import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ShadowPanel } from "../../src/client/components/ShadowPanel";
import { createQueryClient } from "../../src/client/app/App";
import { SpeechTokenSource } from "../../src/client/speech/token";
import type { AssessmentOutcome, RecognitionOutcome, SpeakOutcome, SpeechEngine } from "../../src/client/speech/types";
import { SpeechEnvironmentContext, type SpeechEnvironment } from "../../src/client/speech/useVoice";
import type { MeResponse } from "../../src/shared/api";
import { emptyProgress, json, renderApp, savedSettings } from "./render";

class ScoringEngine implements SpeechEngine {
  readonly real = true;
  readonly assessed: string[] = [];
  async assess(referenceText: string): Promise<AssessmentOutcome> {
    this.assessed.push(referenceText);
    return {
      kind: "assessed",
      scores: { accuracy: 71, fluency: 88, completeness: 100, pronunciation: 76 },
      words: [
        { text: "我", accuracy: 92, error: "None" },
        { text: "是", accuracy: 45, error: "Mispronunciation" },
        { text: "学", accuracy: 70, error: "None" },
        { text: "生", accuracy: 90, error: "None" },
      ],
      recognized: referenceText,
      audioSeconds: 2.4,
    };
  }
  async synthesize(text: string): Promise<{ audio: ArrayBuffer; characters: number }> {
    return { audio: new ArrayBuffer(0), characters: text.length };
  }
  async recognize(): Promise<RecognitionOutcome> {
    return { kind: "cancelled" };
  }
  async speak(text: string): Promise<SpeakOutcome> {
    return { characters: text.length, played: true };
  }
}

const me: MeResponse = {
  owner: { email: null, authMode: "dev-bypass" },
  settings: savedSettings(),
  providers: [{ id: "speech", vendor: "Azure AI Speech", mode: "live", model: null, setupHint: null }],
  curriculumImported: true,
  version: "test",
};
const allowance = { month: "2026-11", recognitionSeconds: 0, recognitionLimitSeconds: 18000, synthesisChars: 0, synthesisLimitChars: 500000, recognitionAvailable: true, synthesisAvailable: true };

function environment(engine: SpeechEngine): SpeechEnvironment {
  const fetchToken = vi.fn(async () => ({ token: "t", region: "eastus", expiresAt: new Date(Date.now() + 9 * 60_000).toISOString(), mock: false, allowance }));
  return { canRecord: () => true, createEngine: () => engine, createTokenSource: () => new SpeechTokenSource(fetchToken) };
}

describe("shadowing (SPEC §7.3, FR-039)", () => {
  it("scores a line, marks the weakest characters and saves scores only", async () => {
    const engine = new ScoringEngine();
    const posted: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/v1/me") return json(me);
        if (url === "/api/v1/speech/usage") return json({ recorded: true, allowance }, 201);
        if (url === "/api/v1/pronunciation/attempts") {
          posted.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return json({ id: "x" }, 201);
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    render(
      <QueryClientProvider client={createQueryClient()}>
        <SpeechEnvironmentContext.Provider value={environment(engine)}>
          <MemoryRouter>
            <ShadowPanel sessionId={null} lines={["我是学生", "你好"]} />
          </MemoryRouter>
        </SpeechEnvironmentContext.Provider>
      </QueryClientProvider>,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Shadow line 1" }));
    expect(await screen.findByText(/Pronunciation/)).toHaveTextContent("Pronunciation 76 · accuracy 71 · fluency 88 · completeness 100 (out of 100)");
    expect(engine.assessed).toEqual(["我是学生"]);
    expect(screen.getByRole("button", { name: /Hear 是/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Hear 学/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Hear 我/ })).not.toBeInTheDocument();
    expect(screen.getByText("(weak, 45)", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Drill tone pairs" })).toHaveAttribute("href", "/start/tone-pairs");
    expect(screen.getByRole("button", { name: "Shadow line 1 again" })).toBeInTheDocument();

    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(Object.keys(posted[0] ?? {}).sort()).toEqual(["audioSeconds", "referenceText", "scores", "sessionId", "words"]);
    expect(posted[0]).toMatchObject({ sessionId: null, referenceText: "我是学生", audioSeconds: 2.4 });
  });

  it("says when speech is not set up", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ...me, providers: [] })));
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter>
          <ShadowPanel sessionId={null} lines={["你好"]} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Shadowing needs the speech service, which is not set up.")).toBeInTheDocument();
  });

  it("shows the trend on Progress once there are attempts", async () => {
    renderApp("/progress", {
      "/api/v1/progress/summary?days=30": () => json(emptyProgress(30)),
      "/api/v1/pronunciation/summary": () => json({ attempts: 6, mean: { accuracy: 78, fluency: 81, completeness: 99, pronunciation: 80 }, weakCharacters: [{ text: "是", times: 3 }] }),
    });
    expect(await screen.findByRole("heading", { name: "Pronunciation" })).toBeInTheDocument();
    expect(screen.getByText("Mean of your last 6 shadowing attempts, out of 100.")).toBeInTheDocument();
    expect(screen.getByText(/Most often unclear/)).toHaveTextContent("是 (3×)");
    expect(screen.getByText(/not a tone grade/)).toBeInTheDocument();
  });
});
