import { createHash } from "node:crypto";
import type {
  ImportIssue,
  ImportSummary,
  VerifyReport,
} from "../../src/server/services/curriculum-import";
import { HSK_BANDS } from "../../src/shared/curriculum";

const MAX_ISSUES_SHOWN = 40;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function printIssues(issues: readonly ImportIssue[]): void {
  const byCode = new Map<string, number>();
  for (const issue of issues) byCode.set(issue.code, (byCode.get(issue.code) ?? 0) + 1);

  console.error(`\nImport rejected: ${issues.length} problem(s). Nothing was written.\n`);
  for (const [code, count] of byCode) console.error(`  ${String(count).padStart(6)}  ${code}`);
  console.error("");
  for (const issue of issues.slice(0, MAX_ISSUES_SHOWN)) {
    const where = issue.file ? `${issue.file}${issue.position ? `:${issue.position}` : ""}  ` : "";
    console.error(`  [${issue.code}] ${where}${issue.message}`);
  }
  if (issues.length > MAX_ISSUES_SHOWN) {
    console.error(`  … and ${issues.length - MAX_ISSUES_SHOWN} more. Use --report <file> for the full list.`);
  }
}

export function printSummary(summary: ImportSummary): void {
  if (summary.synthetic) {
    console.log("SYNTHETIC placeholder data — not HSK content.");
  }
  console.log(`Edition ${summary.editionId}: ${summary.totalEntries} numbered entries validated.`);
  console.log(`  By band: ${HSK_BANDS.map((b) => `${b}=${summary.entriesByBand[b]}`).join("  ")}`);
  console.log(`  Entries with a homograph number: ${summary.homographEntries}`);
  for (const file of summary.files) console.log(`  ${file.sha256}  ${file.name}`);
}

const DIMENSION_LABELS = { missing: "not imported", imported: "imported, NOT verified", verified: "verified" };

export function printVerifyReport(report: VerifyReport): void {
  for (const check of report.checks) {
    console.log(`  ${check.ok ? "PASS" : "FAIL"}  ${check.name} — ${check.detail}`);
  }
  console.log("\nSyllabus sections:");
  for (const d of report.dimensions) {
    console.log(`  ${d.itemType.padEnd(10)} ${DIMENSION_LABELS[d.status]}${d.count ? ` (${d.count} rows)` : ""}`);
  }
  if (report.synthetic) {
    console.log("\nThe active edition is SYNTHETIC placeholder data — not HSK content.");
  }
  console.log(report.ok ? "\nVerified." : "\nNOT verified.");
}
