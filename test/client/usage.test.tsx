import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MeResponse } from "../../src/shared/api";
import { USAGE_DISCLAIMER, type MonthlyUsageResponse } from "../../src/shared/tutor";
import { json, renderApp, savedSettings } from "./render";

const me: MeResponse = {
  owner: { email: null, authMode: "dev-bypass" },
  settings: savedSettings(),
  providers: [],
  curriculumImported: false,
  version: "test",
};

function usage(over: Partial<MonthlyUsageResponse> = {}): MonthlyUsageResponse {
  return {
    month: "2026-03",
    estimatedUsd: 0.42,
    softUsd: 5,
    hardUsd: 10,
    remainingUsd: 9.58,
    softLimitReached: false,
    hardLimitReached: false,
    tutor: { requests: 37, tokensIn: 30000, tokensOut: 4000, estimatedUsd: 0.42 },
    speech: {
      month: "2026-03",
      recognitionSeconds: 754,
      recognitionLimitSeconds: 18000,
      synthesisChars: 12345,
      synthesisLimitChars: 500000,
      recognitionAvailable: true,
      synthesisAvailable: true,
    },
    disclaimer: USAGE_DISCLAIMER,
    ...over,
  };
}

function renderSettings(body: MonthlyUsageResponse | null) {
  renderApp("/settings", {
    "/api/v1/me": () => json(me),
    "/api/v1/usage/monthly": () =>
      body ? json(body) : json({ error: { code: "INTERNAL", message: "Something went wrong. Try again.", retryable: true } }, 500),
  });
}

describe("spending this month (SPEC §4.3)", () => {
  it("shows the estimate, the amounts and that it is not a bill", async () => {
    renderSettings(usage());
    const region = await screen.findByRole("region", { name: "Spending this month" });
    expect(await within(region).findByText("US$0.42")).toBeInTheDocument();
    expect(region).toHaveTextContent("estimated in 2026-03 (UTC), from 37 tutor requests.");
    expect(region).toHaveTextContent("Warning at US$5.00, stop at US$10.00.");
    expect(region).toHaveTextContent("Your provider's bill may differ");
  });

  it("shows amounts under a cent instead of rounding them to nothing", async () => {
    renderSettings(usage({ estimatedUsd: 0.000129, tutor: { requests: 1, tokensIn: 812, tokensOut: 96, estimatedUsd: 0.000129 } }));
    const region = await screen.findByRole("region", { name: "Spending this month" });
    expect(await within(region).findByText("US$0.0001")).toBeInTheDocument();
    expect(region).toHaveTextContent("from 1 tutor request.");
  });

  it("draws the estimate as a share of the stop amount, with the same facts in words", async () => {
    renderSettings(usage({ estimatedUsd: 2.5 }));
    const region = await screen.findByRole("region", { name: "Spending this month" });
    expect(await within(region).findByText("US$2.50 of US$10.00 this month (25%). Warning at US$5.00.")).toBeInTheDocument();
    const bar = within(region).getByTestId("budget-bar");
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("25%");
  });

  it("caps the bar at the stop amount", async () => {
    renderSettings(usage({ estimatedUsd: 12, remainingUsd: 0, softLimitReached: true, hardLimitReached: true }));
    const bar = await screen.findByTestId("budget-bar");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("100%");
    expect(screen.getByText("US$12.00 of US$10.00 this month (100%). Warning at US$5.00.")).toBeInTheDocument();
  });

  it("shows the meter on Today, with a warning in words once it is reached", async () => {
    renderApp("/", {
      "/api/v1/me": () => json(me),
      "/api/v1/sessions?limit=5": () => json({ sessions: [], resumable: null }),
      "/api/v1/curriculum/status": () => json({ edition: null, dimensions: [], vocabByBand: [], manifests: [] }),
      "/api/v1/usage/monthly": () => json(usage({ estimatedUsd: 6, softLimitReached: true })),
    });
    expect(await screen.findByText("AI spending this month (estimate)")).toBeInTheDocument();
    expect(screen.getByText("Warning amount reached.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change the amounts in Settings" })).toHaveAttribute("href", "/settings");
  });

  it("says when the warning amount is reached", async () => {
    renderSettings(usage({ estimatedUsd: 5.2, softLimitReached: true }));
    expect(await screen.findByText(/The warning amount of US\$5\.00 has been reached\. Paid requests stop at US\$10\.00\./)).toBeInTheDocument();
  });

  it("says when paid requests are paused", async () => {
    renderSettings(usage({ estimatedUsd: 10.01, remainingUsd: 0, softLimitReached: true, hardLimitReached: true }));
    expect(await screen.findByText(/The stop amount of US\$10\.00 has been reached\. Paid tutor requests are paused/)).toBeInTheDocument();
    expect(screen.queryByText(/The warning amount/)).not.toBeInTheDocument();
  });

  it("shows this month's free speech use against the Azure allowance", async () => {
    renderSettings(usage());
    const region = await screen.findByRole("region", { name: "Spending this month" });
    expect(await within(region).findByText("Speech (Azure free tier)")).toBeInTheDocument();
    expect(region).toHaveTextContent("Speech recognition: 12 min of 300 min.");
    expect(region).toHaveTextContent("Spoken replies: 12,345 of 500,000 characters.");
    expect(region).toHaveTextContent("never moves to a paid tier");
    expect(region).not.toHaveTextContent(/used up/);
  });

  it.each([
    [false, true, "free speech recognition is used up. Answer by typing"],
    [true, false, "free spoken replies are used up. Replies are shown as text"],
    [false, false, "free speech allowance is used up. Typed answers and written replies still work."],
  ])("says which part of the speech allowance is used up (recognition %s, voice %s)", async (recognitionAvailable, synthesisAvailable, text) => {
    const base = usage();
    renderSettings({ ...base, speech: { ...base.speech, recognitionAvailable, synthesisAvailable } });
    expect(await screen.findByText((content) => content.includes(text))).toBeInTheDocument();
  });

  it("says the estimate is unavailable without hiding the rest of Settings", async () => {
    renderSettings(null);
    expect(await screen.findByText("This month's estimate is unavailable right now.")).toBeInTheDocument();
    expect(screen.getByLabelText("Stop paid requests at (US$)")).toHaveValue(10);
    expect(screen.getByText(/paid tutor requests are refused/)).toBeInTheDocument();
  });
});
