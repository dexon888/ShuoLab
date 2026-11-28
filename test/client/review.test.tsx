import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { untilText } from "../../src/client/pages/ReviewPage";
import { SpeechTokenSource } from "../../src/client/speech/token";
import type { RecognitionOutcome, SpeakOutcome, SpeechEngine } from "../../src/client/speech/types";
import type { SpeechEnvironment } from "../../src/client/speech/useVoice";
import type { MeResponse, ProviderStatus } from "../../src/shared/api";
import type { DueResponse, ReviewCard } from "../../src/shared/review";
import { json, renderApp, savedSettings, type Responder } from "./render";

const DUE = "/api/v1/reviews/due?limit=20";
const liveSpeech: ProviderStatus = { id: "speech", vendor: "Azure AI Speech", mode: "live", model: null, setupHint: null };

function me(speech: ProviderStatus | null = liveSpeech): MeResponse {
  return { owner: { email: null, authMode: "dev-bypass" }, settings: savedSettings({ speechRate: 0.9 }), providers: speech ? [speech] : [], curriculumImported: true, version: "test" };
}

const NOW = Date.now();
const later = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

function card(n: number, over: Partial<ReviewCard> = {}): ReviewCard {
  return {
    id: `cccccccc-0000-4000-8000-00000000000${n}`,
    template: "hanzi_to_meaning",
    skill: "reading",
    item: {
      id: `synthetic-fixture:vocab:30${n}`,
      editionId: "synthetic-fixture",
      synthetic: true,
      hskBand: "2",
      hanzi: ["周末", "朋友", "火锅"][n - 1] ?? "字",
      pinyin: ["zhōumò", "péngyou", "huǒguō"][n - 1] ?? null,
      definition: null,
      definitionProvenance: null,
      itemType: "vocab",
      details: null,
      example: null,
      words: [],
      unverified: false,
    },
    state: "new",
    dueAt: later(-5),
    reps: 0,
    lapses: 0,
    preview: { again: later(1), hard: later(6), good: later(10), easy: later(8 * 24 * 60) },
    mastery: "introduced",
    ...over,
  };
}

function due(cards: ReviewCard[], over: Partial<DueResponse> = {}): DueResponse {
  return { cards, dueCount: cards.length, totalCards: Math.max(cards.length, 6), nextDueAt: null, ...over };
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
    allowance: { month: "2026-03", recognitionSeconds: 0, recognitionLimitSeconds: 18000, synthesisChars: 0, synthesisLimitChars: 500000, recognitionAvailable: true, synthesisAvailable: true },
  }));
  return { canRecord: () => true, createEngine: () => engine, createTokenSource: () => new SpeechTokenSource(fetchToken) };
}

function open(responses: DueResponse[], options: { who?: MeResponse; rate?: Responder } = {}) {
  const engine = new TestEngine();
  const ratings: { cardId: string; body: Record<string, unknown> }[] = [];
  let call = 0;
  const routes: Record<string, Responder> = {
    "/api/v1/me": () => json(options.who ?? me()),
    [DUE]: () => json(responses[Math.min(call++, responses.length - 1)]),
    "POST /api/v1/speech/usage": () => json({ recorded: true, allowance: { month: "2026-03", recognitionSeconds: 0, recognitionLimitSeconds: 18000, synthesisChars: 4, synthesisLimitChars: 500000, recognitionAvailable: true, synthesisAvailable: true } }, 201),
  };
  for (const c of responses.flatMap((r) => r.cards)) {
    routes[`POST /api/v1/reviews/${c.id}/rate`] = (init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      ratings.push({ cardId: c.id, body });
      if (options.rate) return options.rate(init);
      return json({ cardId: c.id, rating: body.rating, nextDueAt: later(10), state: "learning", mastery: "developing", replayed: false }, 201);
    };
  }
  renderApp("/review", routes, { speech: environment(engine) });
  return { engine, ratings };
}

const cardView = () => screen.findByRole("article", { name: "Review card" });

describe("the review page (SPEC §5.5)", () => {
  it("says where cards come from when there are none", async () => {
    open([due([], { totalCards: 0 })]);
    expect(await screen.findByText(/No review cards yet\. When you finish a session/)).toBeInTheDocument();
  });

  it("says when the next card is due when nothing is due now, without polling", async () => {
    open([due([], { totalCards: 4, nextDueAt: later(180) })]);
    expect(await screen.findByText("Nothing is due. The next card is due in 3 h.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check again" })).toBeInTheDocument();
  });

  it("shows the characters, then the answer, then rates the recall and moves on", async () => {
    const { ratings } = open([due([card(1), card(2)]), due([card(2)])]);
    const view = within(await cardView());
    expect(view.getByText("周末")).toBeInTheDocument();
    expect(view.getByText("How is this said, and what does it mean?")).toBeInTheDocument();
    expect(view.getByText("Generated placeholder word for testing. Not HSK content.")).toBeInTheDocument();
    expect(view.queryByText("zhōumò")).not.toBeInTheDocument();
    expect(view.queryByRole("button", { name: /^Good/ })).not.toBeInTheDocument();
    expect(screen.getByText("2 due of 6 cards.")).toBeInTheDocument();

    await userEvent.click(view.getByRole("button", { name: "Show answer" }));
    expect(view.getByText("zhōumò")).toBeInTheDocument();
    expect(view.getByText(/No English definition is imported/)).toBeInTheDocument();
    expect(view.getByRole("button", { name: /^Good.*next in 10 min/ })).toBeInTheDocument();
    expect(view.getByRole("button", { name: /^Easy.*next in 8 days/ })).toBeInTheDocument();

    await userEvent.click(view.getByRole("button", { name: /^Good/ }));
    expect(await screen.findByText("朋友")).toBeInTheDocument();
    expect(ratings).toHaveLength(1);
    expect(ratings[0]?.body).toMatchObject({ rating: "good" });
    expect(String(ratings[0]?.body.clientEventId)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("shows a definition only with its source", async () => {
    open([due([card(1, { item: { ...card(1).item, definition: "weekend", definitionProvenance: "CC-CEDICT 2026-01" } })])]);
    const view = within(await cardView());
    await userEvent.click(view.getByRole("button", { name: "Show answer" }));
    expect(view.getByText(/weekend/)).toBeInTheDocument();
    expect(view.getByText("Source: CC-CEDICT 2026-01")).toBeInTheDocument();
  });

  it("plays a listening card's word before showing it", async () => {
    const { engine } = open([due([card(1, { template: "audio_to_meaning", skill: "listening" })])]);
    const view = within(await cardView());
    expect(view.getByText("Listening")).toBeInTheDocument();
    expect(view.queryByText("周末")).not.toBeInTheDocument();

    await userEvent.click(view.getByRole("button", { name: "Play the word" }));
    await waitFor(() => expect(engine.spoken).toEqual([{ text: "周末", rate: 0.9 }]));
    await userEvent.click(view.getByRole("button", { name: "Play slower" }));
    await waitFor(() => expect(engine.spoken[1]?.rate).toBeCloseTo(0.72));

    await userEvent.click(view.getByRole("button", { name: "Show answer" }));
    expect(view.getByText("周末")).toBeInTheDocument();
  });

  it("cannot play a listening card without speech, and lets it be skipped", async () => {
    open([due([card(1, { template: "audio_to_meaning", skill: "listening" }), card(2)])], { who: me(null) });
    const view = within(await cardView());
    expect(view.getByRole("button", { name: "Play the word" })).toBeDisabled();
    expect(view.getByText(/Speech is not set up/)).toBeInTheDocument();
    await userEvent.click(view.getByRole("button", { name: "Skip for now" }));
    expect(await screen.findByText("朋友")).toBeInTheDocument();
  });

  it("keeps the card and reuses the rating's id when sending fails", async () => {
    let fail = true;
    const { ratings } = open([due([card(1)])], {
      rate: () => {
        if (fail) {
          fail = false;
          return json({ error: { code: "CONFLICT", message: "This card was just rated from somewhere else. Reload to see it as it is now.", retryable: true } }, 409);
        }
        return json({ cardId: card(1).id, rating: "good", nextDueAt: later(10), state: "learning", mastery: "developing", replayed: false }, 201);
      },
    });
    const view = within(await cardView());
    await userEvent.click(view.getByRole("button", { name: "Show answer" }));
    await userEvent.click(view.getByRole("button", { name: /^Good/ }));
    expect(await view.findByRole("alert")).toHaveTextContent("rated from somewhere else");
    await userEvent.click(view.getByRole("button", { name: /^Good/ }));
    await waitFor(() => expect(ratings).toHaveLength(2));
    expect(ratings[1]?.body.clientEventId).toBe(ratings[0]?.body.clientEventId);
  });

  it("says mastery is the learner's own rating and this app's rule", async () => {
    open([due([card(1, { mastery: "developing" })])]);
    const view = within(await cardView());
    expect(view.getByText(/Reading for this word: developing\. Your rating is your own judgement/)).toBeInTheDocument();
    expect(view.getByText(/not an HSK standard/)).toBeInTheDocument();
  });
});

describe("due time text", () => {
  const now = new Date("2026-03-04T10:00:00.000Z");
  it.each([
    ["2026-03-04T10:00:20.000Z", "in 1 min"],
    ["2026-03-04T10:10:00.000Z", "in 10 min"],
    ["2026-03-04T13:00:00.000Z", "in 3 h"],
    ["2026-03-05T10:00:00.000Z", "in 1 day"],
    ["2026-03-12T10:00:00.000Z", "in 8 days"],
  ])("%s is %s", (iso, text) => {
    expect(untilText(iso, now)).toBe(text);
  });
});

describe("grammar, character and production cards (SPEC §5.5, FR-025)", () => {
  const grammarItem = {
    id: "synthetic-fixture:grammar:1",
    itemType: "grammar" as const,
    hanzi: "是……的",
    pinyin: null,
    example: "我是坐车来的。",
    details: { kind: "grammar" as const, grammarType: "特殊表达法", category: null, detail: null, examples: ["我是坐车来的。"] },
    unverified: true,
  };

  it("a grammar writing card checks the typed sentence for the pattern and sends it with the rating", async () => {
    const c = card(1, { template: "grammar_write", skill: "writing", item: { ...card(1).item, ...grammarItem } });
    const { ratings } = open([due([c]), due([])]);
    const view = within(await cardView());
    expect(view.getByText("Writing (typed)")).toBeInTheDocument();
    expect(view.getByText(/second-hand transcription/)).toBeInTheDocument();
    await userEvent.type(view.getByLabelText("Your answer"), "我是走路来的。");
    await userEvent.click(view.getByRole("button", { name: "Show answer" }));
    expect(view.getByText(/✓ That matches\./)).toBeInTheDocument();
    expect(view.getByText("Example: 我是坐车来的。")).toBeInTheDocument();
    await userEvent.click(view.getByRole("button", { name: /^Good/ }));
    await waitFor(() => expect(ratings[0]?.body).toMatchObject({ rating: "good", answer: "我是走路来的。" }));
  });

  it("a grammar reading card shows the syllabus example first", async () => {
    open([due([card(1, { template: "grammar_read", item: { ...card(1).item, ...grammarItem } })])]);
    const view = within(await cardView());
    expect(view.getByText("我是坐车来的。")).toBeInTheDocument();
    expect(view.getByText("Read the example. What does the pattern do here?")).toBeInTheDocument();
  });

  it("a character typing card blanks the character in a word you met and checks it", async () => {
    const c = card(1, {
      template: "char_type",
      skill: "writing",
      item: { ...card(1).item, id: "synthetic-fixture:character:1", itemType: "character", hanzi: "周", pinyin: null, words: [{ hanzi: "周末", pinyin: "zhōumò" }], unverified: true },
    });
    open([due([c])]);
    const view = within(await cardView());
    expect(view.getByText("＿末")).toBeInTheDocument();
    expect(view.getByText(/not handwriting/)).toBeInTheDocument();
    await userEvent.type(view.getByLabelText("Your answer"), "末");
    await userEvent.click(view.getByRole("button", { name: "Show answer" }));
    expect(view.getByText(/✗ Not quite\./)).toBeInTheDocument();
  });

  it("a character reading card lists the words you know it from", async () => {
    const c = card(1, {
      template: "char_recognise",
      item: { ...card(1).item, id: "synthetic-fixture:character:2", itemType: "character", hanzi: "朋", pinyin: null, words: [{ hanzi: "朋友", pinyin: "péngyou" }], unverified: true },
    });
    open([due([c])]);
    const view = within(await cardView());
    await userEvent.click(view.getByRole("button", { name: "Show answer" }));
    expect(view.getByText("péngyou")).toBeInTheDocument();
  });
});
