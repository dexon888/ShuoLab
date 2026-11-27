import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { MeResponse } from "../../src/shared/api";
import { UNITS } from "../../src/shared/onramp";
import { json, renderApp, savedSettings } from "./render";

const me: MeResponse = { owner: { email: null, authMode: "dev-bypass" }, settings: savedSettings(), providers: [], curriculumImported: true, version: "test" };

describe("the sound-system on-ramp (SPEC §5.9, FR-032)", () => {
  it("is recommended on Today until the tone check is passed", async () => {
    renderApp("/", {
      "/api/v1/me": () => json(me),
      "/api/v1/onramp": () => json({ units: [], checkPassed: false, checkBest: null }),
      "/api/v1/sessions?limit=5": () => json({ sessions: [], resumable: null }),
      "/api/v1/curriculum/status": () => json({ activeEdition: null, dimensions: [], vocabByBand: [], manifests: [] }),
    });
    expect(await screen.findByText("New to Chinese? Start with the sounds.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start here" })).toHaveAttribute("href", "/start");
  });

  it("lists every unit and the tone check with the best result so far", async () => {
    renderApp("/start", {
      "/api/v1/me": () => json(me),
      "/api/v1/onramp": () => json({ units: [{ unitId: "tones", bestCorrect: 14, total: 16, attempts: 2 }], checkPassed: false, checkBest: null }),
    });
    const list = await screen.findAllByRole("link", { name: /Best|Not tried/ });
    expect(list).toHaveLength(UNITS.length + 1);
    expect(list[0]).toHaveTextContent("Best 14 of 16 ✓");
    expect(screen.getByRole("link", { name: /Tone check/ })).toHaveAttribute("href", "/start/tone-check");
  });

  it("a reading unit is answered, checked by the server, and shows the right answers", async () => {
    const unit = UNITS.find((u) => u.id === "tone-changes");
    if (!unit) throw new Error("no unit");
    const sent: unknown[] = [];
    renderApp(`/start/${unit.id}`, {
      "/api/v1/me": () => json(me),
      "POST /api/v1/onramp/answers": (init) => {
        sent.push(JSON.parse(String(init?.body)));
        return json(
          {
            result: {
              unitId: unit.id,
              correct: 1,
              total: unit.items.length,
              passed: false,
              keys: unit.items.map((i) => i.options[i.answer] ?? ""),
              marks: unit.items.map((_, n) => n === 0),
              answeredAt: "2026-11-27T10:00:00.000Z",
            },
          },
          201,
        );
      },
    });
    expect(await screen.findByText(/Two 3rd tones in a row/)).toBeInTheDocument();
    const first = screen.getAllByRole("group")[0] as HTMLElement;
    await userEvent.click(within(first).getByRole("radio", { name: "2nd tone (ní)" }));
    await userEvent.click(screen.getByRole("button", { name: "Check my answers" }));
    expect(await screen.findByText(/1 of 8 right\. 80% passes/)).toBeInTheDocument();
    expect(sent[0]).toMatchObject({ unitId: unit.id });
    expect((sent[0] as { answers: unknown[] }).answers[0]).toBe(0);
    expect(screen.getAllByText(/Answer:/).length).toBe(unit.items.length - 1);
  });

  it("says listening units need speech when it is not set up", async () => {
    renderApp("/start/tones", { "/api/v1/me": () => json(me) });
    expect(await screen.findByText(/Speech is not set up, so these sounds can't be played/)).toBeInTheDocument();
  });
});
