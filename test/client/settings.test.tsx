import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { MeResponse } from "../../src/shared/api";
import { defaultSettings, type OwnerSettings } from "../../src/shared/settings";
import { json, renderApp, savedSettings } from "./render";

function me(settings: OwnerSettings, over: Partial<MeResponse> = {}): MeResponse {
  return {
    owner: { email: null, authMode: "dev-bypass" },
    settings,
    providers: [
      { id: "tutor", vendor: "Local fake tutor", mode: "mock", model: null, setupHint: null },
      { id: "speech", vendor: "Local fake speech", mode: "mock", model: null, setupHint: null },
    ],
    curriculumImported: false,
    version: "test",
    ...over,
  };
}

const status = () => json({ activeEdition: null, dimensions: [], vocabByBand: [], manifests: [] });

/** A PUT responder that records what was sent and answers with the merged settings. */
function recordingPut(current: OwnerSettings) {
  const bodies: Record<string, unknown>[] = [];
  const responder = (init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    const { onboarded, ...changes } = body;
    return json({
      settings: {
        ...current,
        ...changes,
        onboardedAt: onboarded ? "2026-02-02T00:00:00.000Z" : current.onboardedAt,
        updatedAt: "2026-02-02T00:00:00.000Z",
      },
    });
  };
  return { bodies, responder };
}

describe("settings page (SPEC §5.7)", () => {
  it("shows the saved preferences", async () => {
    renderApp("/settings", {
      "/api/v1/me": () =>
        json(me(savedSettings({ nickname: "小丁", sessionMinutes: 30, studyBand: "3", speechRate: 0.85, timezone: "Asia/Shanghai" }))),
    });
    expect(await screen.findByLabelText("Nickname (optional)")).toHaveValue("小丁");
    expect(screen.getByRole("radio", { name: "30 minutes" })).toBeChecked();
    expect(screen.getByLabelText("HSK band to study")).toHaveValue("3");
    expect(screen.getByLabelText("Speech rate")).toHaveValue("0.85");
    expect(screen.getByText("0.85×")).toBeInTheDocument();
    expect(screen.getByLabelText("Time zone")).toHaveValue("Asia/Shanghai");
    expect(screen.getByLabelText("Warn me at (US$)")).toHaveValue(5);
    expect(screen.getByLabelText("Stop paid requests at (US$)")).toHaveValue(10);
  });

  it("saves changes and confirms they apply on every device", async () => {
    const put = recordingPut(savedSettings());
    renderApp("/settings", { "/api/v1/me": () => json(me(savedSettings())), "PUT /api/v1/settings": put.responder });

    await userEvent.click(await screen.findByRole("radio", { name: "15 minutes" }));
    await userEvent.selectOptions(screen.getByLabelText("Reading help"), "hanzi");
    await userEvent.selectOptions(screen.getByLabelText("HSK band to study"), "7-9");
    fireEvent.change(screen.getByLabelText("Speech rate"), { target: { value: "0.9" } });
    await userEvent.clear(screen.getByLabelText("Warn me at (US$)"));
    await userEvent.type(screen.getByLabelText("Warn me at (US$)"), "2.5");
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByText(/Saved\. These settings apply on every device/)).toBeInTheDocument();
    expect(put.bodies).toHaveLength(1);
    expect(put.bodies[0]).toMatchObject({
      sessionMinutes: 15,
      displayMode: "hanzi",
      studyBand: "7-9",
      speechRate: 0.9,
      nickname: null,
      limits: { softUsd: 2.5, hardUsd: 10 },
    });
    // Saving from Settings never marks onboarding.
    expect(put.bodies[0]).not.toHaveProperty("onboarded");
    // The form shows what the server stored.
    await waitFor(() => expect(screen.getByRole("radio", { name: "15 minutes" })).toBeChecked());
  });

  it("refuses a warning amount above the stop amount without calling the server", async () => {
    const put = recordingPut(savedSettings());
    renderApp("/settings", { "/api/v1/me": () => json(me(savedSettings())), "PUT /api/v1/settings": put.responder });

    await userEvent.clear(await screen.findByLabelText("Warn me at (US$)"));
    await userEvent.type(screen.getByLabelText("Warn me at (US$)"), "20");
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The warning amount cannot be above the stop amount.");
    expect(put.bodies).toHaveLength(0);
  });

  it("shows the server's message when saving fails, and keeps what was typed", async () => {
    renderApp("/settings", {
      "/api/v1/me": () => json(me(savedSettings())),
      "PUT /api/v1/settings": () =>
        json({ error: { code: "BAD_REQUEST", message: 'Invalid value for "timezone".', retryable: false } }, 400),
    });
    await userEvent.type(await screen.findByLabelText("Nickname (optional)"), "Ding");
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByRole("alert")).toHaveTextContent('Not saved. Invalid value for "timezone".');
    expect(screen.getByLabelText("Nickname (optional)")).toHaveValue("Ding");
    expect(screen.queryByText(/^Saved\./)).not.toBeInTheDocument();
  });

  it("says the limits are estimates and not a cap at the providers", async () => {
    renderApp("/settings", { "/api/v1/me": () => json(me(savedSettings())) });
    const limits = (await screen.findByText("Monthly spending limits")).closest("fieldset") as HTMLElement;
    expect(limits).toHaveTextContent("not a cap at OpenAI or Azure");
    expect(screen.getByRole("region", { name: "Services" })).toHaveTextContent("may charge for use");
    expect(screen.getByRole("region", { name: "Your data" })).toHaveTextContent("Download JSON");
  });

  it("labels every control", async () => {
    renderApp("/settings", { "/api/v1/me": () => json(me(savedSettings())) });
    await screen.findByLabelText("Nickname (optional)");
    const main = screen.getByRole("main");
    for (const control of within(main).getAllByRole("combobox")) expect(control).toHaveAccessibleName();
    for (const control of within(main).getAllByRole("spinbutton")) expect(control).toHaveAccessibleName();
    expect(within(main).getByRole("slider")).toHaveAccessibleName("Speech rate");
    expect(within(main).getByRole("radiogroup", { name: "Daily session length" })).toBeInTheDocument();
  });
});

describe("onboarding (SPEC §5.1)", () => {
  it("saves the choices, marks onboarding done and goes to Today", async () => {
    const put = recordingPut(defaultSettings());
    renderApp("/onboarding", {
      // Like the real server: once saved, /me reports onboarding as done.
      "/api/v1/me": () => json(me(put.bodies.length > 0 ? savedSettings() : defaultSettings())),
      "/api/v1/curriculum/status": status,
      "PUT /api/v1/settings": put.responder,
    });

    await userEvent.type(await screen.findByLabelText("Nickname (optional)"), "Ding");
    await userEvent.selectOptions(screen.getByLabelText("How much spoken Mandarin do you understand?"), "basic");
    await userEvent.click(screen.getByRole("radio", { name: "25 minutes" }));
    await userEvent.click(screen.getByRole("button", { name: "Save and continue" }));

    expect(await screen.findByRole("heading", { level: 1, name: /Today/ })).toBeInTheDocument();
    expect(put.bodies[0]).toMatchObject({
      nickname: "Ding",
      selfRatedListening: "basic",
      selfRatedSpeaking: null,
      sessionMinutes: 25,
      studyBand: null,
      onboarded: true,
    });
    expect(put.bodies[0]).not.toHaveProperty("limits");
    // The dashboard no longer asks for setup.
    expect(screen.queryByText("Set up your preferences.")).not.toBeInTheDocument();
  });

  it("starts from this device's time zone on first use", async () => {
    renderApp("/onboarding", { "/api/v1/me": () => json(me(defaultSettings())) });
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(await screen.findByLabelText("Time zone")).toHaveValue(zone);
  });

  it("can be skipped, which keeps the defaults", async () => {
    const put = recordingPut(defaultSettings());
    renderApp("/onboarding", {
      "/api/v1/me": () => json(me(defaultSettings())),
      "/api/v1/curriculum/status": status,
      "PUT /api/v1/settings": put.responder,
    });
    await userEvent.click(await screen.findByRole("button", { name: "Skip for now and use the defaults" }));
    expect(await screen.findByRole("heading", { level: 1, name: /Today/ })).toBeInTheDocument();
    expect(put.bodies).toEqual([{ onboarded: true }]);
  });

  it("says the curriculum is not imported, with no percentage, and that the band is a choice", async () => {
    renderApp("/onboarding", { "/api/v1/me": () => json(me(defaultSettings())) });
    expect(await screen.findByText("Curriculum not imported.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d\s?%/);
    expect(screen.getByText(/A study target you choose, not a proven level/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Placement check" })).toHaveTextContent("is not built");
    expect(screen.getAllByText("Practice stand-in")).toHaveLength(2);
  });

  it("offers no skip once onboarding is done", async () => {
    renderApp("/onboarding", { "/api/v1/me": () => json(me(savedSettings())) });
    expect(await screen.findByText(/You have already set this up/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Skip for now/ })).not.toBeInTheDocument();
  });
});

describe("dashboard", () => {
  it("asks a new owner to set up preferences, and stops asking afterwards", async () => {
    renderApp("/", { "/api/v1/me": () => json(me(defaultSettings())), "/api/v1/curriculum/status": status });
    expect(await screen.findByText("Set up your preferences.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/onboarding");
  });

  it("does not ask an owner who has finished onboarding", async () => {
    renderApp("/", { "/api/v1/me": () => json(me(savedSettings())), "/api/v1/curriculum/status": status });
    await screen.findByRole("region", { name: "Services" });
    await screen.findAllByText("Practice stand-in");
    expect(screen.queryByText("Set up your preferences.")).not.toBeInTheDocument();
  });
});
