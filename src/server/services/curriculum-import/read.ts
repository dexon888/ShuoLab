import { CsvFormatError, parseCsv } from "./csv";
import {
  VOCAB_SOURCE_FIELDS,
  type ImportIssue,
  type RawRecord,
  type SourceFile,
  type VocabSourceField,
} from "./types";

const REQUIRED_COLUMNS: readonly VocabSourceField[] = VOCAB_SOURCE_FIELDS;

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    // fatal: malformed sequences throw instead of becoming U+FFFD.
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    return null;
  }
}

function readCsv(file: SourceFile, text: string, issues: ImportIssue[]): RawRecord[] {
  let rows;
  try {
    rows = parseCsv(text);
  } catch (error) {
    if (error instanceof CsvFormatError) {
      issues.push({ code: "BAD_FORMAT", message: `${error.message}.`, file: file.name, position: error.line });
      return [];
    }
    throw error;
  }

  const header = rows[0];
  if (!header) {
    issues.push({ code: "BAD_FORMAT", message: "The file is empty.", file: file.name });
    return [];
  }
  const columns = header.cells.map((c) => c.trim());
  const missing = REQUIRED_COLUMNS.filter((name) => !columns.includes(name));
  if (missing.length > 0) {
    issues.push({
      code: "MISSING_COLUMN",
      message: `The header row is missing: ${missing.join(", ")}. Expected columns: ${REQUIRED_COLUMNS.join(", ")}.`,
      file: file.name,
      position: header.line,
    });
    return [];
  }

  const records: RawRecord[] = [];
  for (const row of rows.slice(1)) {
    if (row.cells.length !== columns.length) {
      issues.push({
        code: "BAD_FORMAT",
        message: `Expected ${columns.length} columns but found ${row.cells.length}.`,
        file: file.name,
        position: row.line,
      });
      continue;
    }
    const fields: RawRecord["fields"] = {};
    for (const name of REQUIRED_COLUMNS) {
      fields[name] = row.cells[columns.indexOf(name)];
    }
    records.push({ file: file.name, position: row.line, fields });
  }
  return records;
}

function readJson(file: SourceFile, text: string, issues: ImportIssue[]): RawRecord[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    issues.push({ code: "BAD_FORMAT", message: "The file is not valid JSON.", file: file.name });
    return [];
  }
  if (!Array.isArray(data)) {
    issues.push({
      code: "BAD_FORMAT",
      message: "Expected a JSON array of entry objects.",
      file: file.name,
    });
    return [];
  }

  const records: RawRecord[] = [];
  data.forEach((item: unknown, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      issues.push({
        code: "BAD_FORMAT",
        message: "Expected an entry object.",
        file: file.name,
        position: index + 1,
      });
      return;
    }
    const source = item as Record<string, unknown>;
    const fields: RawRecord["fields"] = {};
    for (const name of REQUIRED_COLUMNS) {
      fields[name] = Object.hasOwn(source, name) ? source[name] : undefined;
    }
    records.push({ file: file.name, position: index + 1, fields });
  });
  return records;
}

/** Decodes and parses the given files into raw records. Never throws on bad data. */
export function readVocabFiles(files: readonly SourceFile[]): {
  records: RawRecord[];
  issues: ImportIssue[];
} {
  const issues: ImportIssue[] = [];
  const records: RawRecord[] = [];

  for (const file of files) {
    const text = decodeUtf8(file.bytes);
    if (text === null) {
      issues.push({
        code: "INVALID_UTF8",
        message: "The file is not valid UTF-8. Re-download it; do not re-save it from a spreadsheet.",
        file: file.name,
      });
      continue;
    }
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".csv")) {
      records.push(...readCsv(file, text, issues));
    } else if (lower.endsWith(".json")) {
      records.push(...readJson(file, text, issues));
    } else {
      issues.push({ code: "BAD_FORMAT", message: "Only .csv and .json files are supported.", file: file.name });
    }
  }
  return { records, issues };
}
