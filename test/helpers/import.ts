import { createHash } from "node:crypto";
import {
  prepareVocabImport,
  type PrepareImportResult,
  type SourceFile,
} from "../../src/server/services/curriculum-import";
import { SYNTHETIC_EDITION_ID } from "../../src/shared/curriculum";

export function sourceFile(name: string, content: string | Uint8Array): SourceFile {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return { name, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export const TEST_SOURCE = {
  sourceUrl: "generated:test",
  commitSha: null,
  rightsNote: "Generated placeholder rows. Not HSK content.",
};

export function prepare(
  files: SourceFile[],
  editionId: string = SYNTHETIC_EDITION_ID,
  importedAt = "2026-01-01T00:00:00.000Z",
): PrepareImportResult {
  return prepareVocabImport({ editionId, files, source: TEST_SOURCE, importedAt });
}

/** Issue codes of a rejected import, or [] when it was accepted. */
export function issueCodes(result: PrepareImportResult): string[] {
  return result.ok ? [] : [...new Set(result.issues.map((i) => i.code))].sort();
}
