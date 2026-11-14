import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { CurriculumStatusResponse, MeResponse } from "../../src/shared/api";
import {
  HSK_BANDS,
  ITEM_TYPES,
  VOCAB_NEW_ENTRIES_BY_BAND,
  cumulativeVocabEntries,
} from "../../src/shared/curriculum";
import { json, renderApp } from "./render";

const me: MeResponse = {
  owner: { email: null, authMode: "dev-bypass" },
  providers: [
    { id: "tutor", vendor: "Local fake tutor", mode: "mock", model: null, setupHint: null },
    { id: "speech", vendor: "Local fake speech", mode: "mock", model: null, setupHint: null },
  ],
  curriculumImported: false,
  version: "test",
};

function curriculumStatus(importedBand1 = 0): CurriculumStatusResponse {
  return {
    activeEdition: importedBand1 > 0 ? { id: "test-edition", publisher: "Synthetic", editionDate: "2025-11-01", synthetic: false } : null,
    dimensions: ITEM_TYPES.map((itemType) => ({
      itemType,
      status: itemType === "vocab" && importedBand1 > 0 ? "imported" : "missing",
      importedCount: itemType === "vocab" ? importedBand1 : 0,
      expectedCount: itemType === "vocab" ? 11000 : null,
    })),
    vocabByBand: HSK_BANDS.map((band) => ({
      band,
      importedNew: band === "1" ? importedBand1 : 0,
      expectedNew: VOCAB_NEW_ENTRIES_BY_BAND[band],
      expectedCumulative: cumulativeVocabEntries(band),
    })),
    manifests: [],
  };
}

const okRoutes = {
  "/api/v1/me": () => json(me),
  "/api/v1/curriculum/status": () => json(curriculumStatus()),
};

describe("dashboard", () => {
  it("says the curriculum is not imported instead of showing a percentage (FR-005)", async () => {
    renderApp("/", okRoutes);

    expect(await screen.findByText("Curriculum not imported")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d\s?%/);

    const start = screen.getByRole("button", { name: "Start today's session" });
    expect(start).toHaveAttribute("aria-disabled", "true");
    expect(start).toHaveAccessibleDescription(/has not been imported/);
  });

  it("labels fake providers as stand-ins, not as real services (FR-012)", async () => {
    renderApp("/", okRoutes);
    const services = await screen.findByRole("region", { name: "Services" });
    expect(await within(services).findAllByText("Practice stand-in")).toHaveLength(2);
    expect(within(services).getAllByText(/nothing is billed/i)).toHaveLength(2);
  });

  it("shows setup guidance when a provider is missing in production", async () => {
    renderApp("/", {
      ...okRoutes,
      "/api/v1/me": () =>
        json({
          ...me,
          providers: [
            { id: "tutor", vendor: "OpenAI", mode: "missing", model: "gpt-6-luna", setupHint: "Add the OPENAI_API_KEY secret." },
            me.providers[1],
          ],
        }),
    });
    expect(await screen.findByText("Not set up")).toBeInTheDocument();
    expect(screen.getByText(/Add the OPENAI_API_KEY secret/)).toBeInTheDocument();
  });

  it("shows the server's error message and no retry for a non-retryable failure", async () => {
    renderApp("/", {
      "/api/v1/me": () =>
        json({ error: { code: "FORBIDDEN", message: "This account is not the owner of this ShuoLab.", retryable: false } }, 403),
      "/api/v1/curriculum/status": () => json(curriculumStatus()),
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This account is not the owner of this ShuoLab.");
    expect(within(alert).queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers a retry that recovers after a server error", async () => {
    let failing = true;
    const fetchMock = renderApp("/", {
      "/api/v1/me": () => json(me),
      "/api/v1/curriculum/status": () =>
        failing
          ? json({ error: { code: "INTERNAL", message: "Something went wrong. Try again.", retryable: true } }, 500)
          : json(curriculumStatus()),
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load curriculum status");
    failing = false;
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Curriculum not imported")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("explains a non-JSON response, such as an expired sign-in page", async () => {
    renderApp("/", {
      "/api/v1/me": () => new Response("<html>Sign in</html>", { status: 200 }),
      "/api/v1/curriculum/status": () => json(curriculumStatus()),
    });
    expect(await screen.findByText(/sign-in may have expired/i)).toBeInTheDocument();
  });

  it("rejects a response that does not match the API contract", async () => {
    renderApp("/", {
      "/api/v1/me": () => json({ ...me, providers: "nope" }),
      "/api/v1/curriculum/status": () => json(curriculumStatus()),
    });
    expect(await screen.findByText(/doesn't understand/i)).toBeInTheDocument();
  });
});

describe("curriculum page", () => {
  it("lists every band with published totals and the shared 7–9 band (FR-016)", async () => {
    renderApp("/curriculum", okRoutes);

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(8);
    const last = rows.at(-1) as HTMLElement;
    expect(within(last).getByRole("rowheader")).toHaveTextContent("HSK 7–9 (shared band)");
    expect(last).toHaveTextContent("5,600");
    expect(last).toHaveTextContent("11,000");

    for (const name of ["Vocabulary", "Grammar", "Characters", "Topics", "Tasks"]) {
      expect(screen.getByText(name).closest("li")).toHaveTextContent("Not imported");
    }
    expect(screen.getByText("No source files have been imported.")).toBeInTheDocument();
  });

  it("reports a partial import as incomplete, never as verified", async () => {
    renderApp("/curriculum", {
      ...okRoutes,
      "/api/v1/curriculum/status": () => json(curriculumStatus(3)),
    });
    expect(await screen.findByText("Curriculum import is incomplete")).toBeInTheDocument();
    expect(screen.getByText(/3 of 11,000 numbered entries/)).toBeInTheDocument();
    expect(screen.getByText("Vocabulary").closest("li")).toHaveTextContent("Imported, not verified, 3 rows");
    expect(screen.queryByText(/Vocabulary verified/)).not.toBeInTheDocument();
  });

  function fullImport(synthetic: boolean): CurriculumStatusResponse {
    const base = curriculumStatus();
    return {
      ...base,
      activeEdition: {
        id: synthetic ? "synthetic-fixture" : "hsk3-2025-11",
        publisher: "Test publisher",
        editionDate: "2025-11",
        synthetic,
      },
      dimensions: base.dimensions.map((d) =>
        d.itemType === "vocab" ? { ...d, status: "verified" as const, importedCount: 11000 } : d,
      ),
      vocabByBand: base.vocabByBand.map((b) => ({ ...b, importedNew: b.expectedNew })),
      manifests: [
        {
          datasetKind: "vocab",
          sourceUrl: "https://example.test/dataset#all.csv",
          commitSha: "0123456789abcdef0123456789abcdef01234567",
          sha256: "a".repeat(64),
          rightsNote: "Imported locally for personal use.",
          fieldMappingVersion: "vocab-v1",
          verificationStatus: "verified",
          recordCount: 11000,
          importedAt: "2026-01-02T03:04:05.000Z",
        },
      ],
    };
  }

  it("shows a verified import with its source, pinned commit and rights note", async () => {
    renderApp("/curriculum", {
      ...okRoutes,
      "/api/v1/curriculum/status": () => json(fullImport(false)),
    });
    expect(await screen.findByText("Vocabulary verified.")).toBeInTheDocument();
    expect(screen.getByText(/11,000 numbered entries imported from edition hsk3-2025-11/)).toBeInTheDocument();
    expect(screen.getByText("Vocabulary").closest("li")).toHaveTextContent("Verified, 11,000 rows");
    expect(screen.getByText("Grammar").closest("li")).toHaveTextContent("Not imported");
    const sources = screen.getByRole("region", { name: "Sources" });
    expect(sources).toHaveTextContent("0123456789ab");
    expect(sources).toHaveTextContent("imported 2026-01-02");
    expect(sources).toHaveTextContent("Imported locally for personal use.");
  });

  it("never presents synthetic test data as HSK content, even when it verifies", async () => {
    renderApp("/curriculum", {
      ...okRoutes,
      "/api/v1/curriculum/status": () => json(fullImport(true)),
    });
    expect(await screen.findByText("Test data loaded, not HSK content")).toBeInTheDocument();
    expect(screen.getByText(/not words from the HSK syllabus/)).toBeInTheDocument();
    expect(screen.queryByText("Vocabulary verified.")).not.toBeInTheDocument();
    expect(screen.getByText("Vocabulary").closest("li")).toHaveTextContent("Test data, 11,000 rows");
    expect(screen.queryByText(/^Verified/)).not.toBeInTheDocument();
  });
});

describe("navigation", () => {
  it("has a labelled main navigation that marks the current page", async () => {
    renderApp("/", okRoutes);
    const nav = screen.getByRole("navigation", { name: "Main" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "今天Today",
      "课程Curriculum",
      "复习Review",
      "进度Progress",
      "设置Settings",
    ]);
    expect(links[0]).toHaveAttribute("aria-current", "page");

    await userEvent.click(links[2] as HTMLElement);
    expect(await screen.findByRole("heading", { level: 1, name: /Review/ })).toBeInTheDocument();
    expect(links[2]).toHaveAttribute("aria-current", "page");
  });

  it("shows a not-found page for unknown addresses", () => {
    renderApp("/nope", okRoutes);
    expect(screen.getByRole("heading", { level: 1, name: /Page not found/ })).toBeInTheDocument();
  });
});
