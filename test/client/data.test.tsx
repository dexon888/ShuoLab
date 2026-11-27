import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { MeResponse } from "../../src/shared/api";
import { DELETE_ALL_PHRASE } from "../../src/shared/owner-data";
import type { OwnerSettings } from "../../src/shared/settings";
import { json, renderApp, savedSettings, type Responder } from "./render";

function me(settings: OwnerSettings = savedSettings()): MeResponse {
  return { owner: { email: null, authMode: "dev-bypass" }, settings, providers: [], curriculumImported: true, version: "test" };
}

const summary = { counts: { sessions: 4, conversation_turns: 37, review_events: 12, listening_exercises: 2, practice_attempts: 12, usage_events: 40 }, transcriptRetentionDays: null, sessionsPastRetention: 0 };

function openSettings(routes: Record<string, Responder> = {}) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const record = (method: string, url: string, respond: (body: unknown) => Response): Responder => (init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    return respond(body);
  };
  renderApp("/settings", {
    "/api/v1/me": () => json(me()),
    "/api/v1/usage/monthly": () => json({ month: "2026-03", estimatedUsd: 0, softUsd: 5, hardUsd: 10, remainingUsd: 10, softLimitReached: false, hardLimitReached: false, tutor: { requests: 0, tokensIn: 0, tokensOut: 0, estimatedUsd: 0 }, speech: { month: "2026-03", recognitionSeconds: 0, recognitionLimitSeconds: 18000, synthesisChars: 0, synthesisLimitChars: 500000, recognitionAvailable: true, synthesisAvailable: true }, disclaimer: "An estimate." }),
    "/api/v1/my-data": () => json(summary),
    "PUT /api/v1/settings": record("PUT", "/settings", (body) => json({ settings: { ...savedSettings(), ...(body as object) } })),
    "DELETE /api/v1/my-data": record("DELETE", "/my-data", () =>
      json({ deleted: { sessions: 4, conversation_turns: 37 }, kept: ["This month's usage ledger, so the spending limit cannot be reset."] }),
    ),
    ...routes,
  });
  return calls;
}

const data = async () => within(await screen.findByRole("region", { name: "Your data" }));

describe("Settings → Your data (SPEC §5.7, FR-019)", () => {
  it("shows what is stored and offers JSON and per-table CSV downloads", async () => {
    openSettings();
    const region = await data();
    expect(await region.findByText("37")).toBeInTheDocument();
    expect(region.getByRole("link", { name: "Download JSON" })).toHaveAttribute("href", "/api/v1/export?format=json");
    const csv = region.getByRole("link", { name: "Download CSV" });
    expect(csv).toHaveAttribute("href", "/api/v1/export?format=csv&table=sessions");
    await userEvent.selectOptions(region.getByLabelText("CSV table"), "review_events");
    expect(csv).toHaveAttribute("href", "/api/v1/export?format=csv&table=review_events");
    expect(region.getByText(/The curriculum is not included/)).toBeInTheDocument();
  });

  it("saves the retention period", async () => {
    const calls = openSettings();
    const region = await data();
    await userEvent.selectOptions(region.getByLabelText("Keep conversation text"), "30");
    await waitFor(() => expect(calls).toContainEqual({ method: "PUT", url: "/settings", body: { transcriptRetentionDays: 30 } }));
    expect(region.getByText(/Audio is never stored/)).toBeInTheDocument();
  });

  it("deletes everything only after the exact phrase is typed, and says what was kept", async () => {
    const calls = openSettings();
    const region = await data();
    await userEvent.click(region.getByRole("button", { name: "Delete all my data…" }));
    const confirm = region.getByRole("button", { name: "Delete everything" });
    expect(confirm).toBeDisabled();
    await userEvent.type(region.getByLabelText(`Type ${DELETE_ALL_PHRASE} to confirm`), "delete my data");
    expect(confirm).toBeDisabled();
    await userEvent.clear(region.getByLabelText(`Type ${DELETE_ALL_PHRASE} to confirm`));
    await userEvent.type(region.getByLabelText(`Type ${DELETE_ALL_PHRASE} to confirm`), DELETE_ALL_PHRASE);
    await userEvent.click(confirm);

    expect(await region.findByText("Deleted 41 records.")).toBeInTheDocument();
    expect(region.getByText(/Kept: This month's usage ledger/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "DELETE")).toEqual([{ method: "DELETE", url: "/my-data", body: { confirm: DELETE_ALL_PHRASE } }]);
  });

  it("can be cancelled", async () => {
    const calls = openSettings();
    const region = await data();
    await userEvent.click(region.getByRole("button", { name: "Delete all my data…" }));
    await userEvent.click(region.getByRole("button", { name: "Cancel" }));
    expect(region.getByRole("button", { name: "Delete all my data…" })).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
  });
});

describe("deleting one session (SPEC §8.4)", () => {
  const ID = "11111111-2222-4333-8444-555555555555";

  it("asks first, deletes, and returns to Today", async () => {
    let deleted = false;
    const session = {
      id: ID,
      kind: "free_chat",
      status: "complete",
      localStudyDate: "2026-03-04",
      durationMinutes: 15,
      targetBand: null,
      situationTitleEn: "Open conversation",
      situationTitleZh: "自由聊天",
      synthetic: false,
      createdAt: "2026-03-04T10:00:00.000Z",
      startedAt: "2026-03-04T10:01:00.000Z",
      endedAt: "2026-03-04T10:20:00.000Z",
      editionId: null,
      actualSeconds: 600,
      plan: {
        version: 1,
        kind: "free_chat",
        editionId: null,
        synthetic: false,
        targetBand: null,
        bandSource: null,
        durationMinutes: 15,
        localStudyDate: "2026-03-04",
        situation: { id: "free-chat", sourceType: "app-authored", titleZh: "自由聊天", titleEn: "Open conversation", communicativeGoal: "Talk." },
        targets: [],
        grammarIds: [],
        grammar: [],
        characters: [],
        topic: null,
        task: null,
        weakestSkill: null,
        colloquial: [],
        levelConstraints: { activeBand: null, stretchBand: null },
        activities: [{ kind: "speak", skill: "speaking", minutes: 15, title: "Conversation", description: "Talk." }],
      },
    };
    renderApp(`/session/${ID}`, {
      "/api/v1/me": () => json(me()),
      [`/api/v1/sessions/${ID}`]: () => json({ session, turns: [], debrief: null, listening: null }),
      [`DELETE /api/v1/sessions/${ID}`]: () => {
        deleted = true;
        return json({ deleted: { sessions: 1, conversation_turns: 0 }, kept: [] });
      },
      "/api/v1/sessions?limit=5": () => json({ sessions: [], resumable: null }),
      "/api/v1/curriculum/status": () => json({ edition: null, dimensions: [], vocabByBand: [], manifests: [] }),
    });
    const region = within(await screen.findByRole("region", { name: "Delete this session" }));
    await userEvent.click(region.getByRole("button", { name: "Delete this session…" }));
    expect(region.getByText(/Review cards for its words, and their history, are kept/)).toBeInTheDocument();
    await userEvent.click(region.getByRole("button", { name: "Keep it" }));
    expect(deleted).toBe(false);

    await userEvent.click(region.getByRole("button", { name: "Delete this session…" }));
    await userEvent.click(region.getByRole("button", { name: "Yes, delete it" }));
    expect(await screen.findByRole("heading", { level: 1, name: /Today/ })).toBeInTheDocument();
    expect(deleted).toBe(true);
  });
});
