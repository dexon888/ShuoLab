/**
 * Minimal RFC 4180 CSV reader: comma-delimited, double-quote quoting with ""
 * escapes, quoted fields may contain commas and line breaks, CRLF or LF rows.
 * Each returned row carries the 1-based line it started on, for error reports.
 */
export interface CsvRow {
  line: number;
  cells: string[];
}

export class CsvFormatError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(message);
    this.name = "CsvFormatError";
    this.line = line;
  }
}

export function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let line = 1;
  let rowLine = 1;
  let inQuotes = false;
  let quoteLine = 1;
  /** True once the current row has any content, so blank lines are skipped. */
  let rowHasContent = false;
  /** True right after a closing quote: only a delimiter or line end may follow. */
  let afterQuote = false;

  const endCell = () => {
    cells.push(cell);
    cell = "";
    afterQuote = false;
  };
  const endRow = () => {
    if (rowHasContent) {
      endCell();
      rows.push({ line: rowLine, cells });
    }
    cells = [];
    cell = "";
    rowHasContent = false;
    afterQuote = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }

    if (ch === "\r" && text[i + 1] === "\n") continue;
    if (ch === "\n" || ch === "\r") {
      endRow();
      line++;
      rowLine = line;
      continue;
    }
    if (ch === ",") {
      rowHasContent = true;
      endCell();
      continue;
    }
    if (afterQuote) {
      throw new CsvFormatError("Unexpected text after a closing quote", line);
    }
    if (ch === '"') {
      if (cell.length > 0) {
        throw new CsvFormatError("Quote in the middle of an unquoted field", line);
      }
      inQuotes = true;
      quoteLine = line;
      rowHasContent = true;
      continue;
    }
    cell += ch;
    rowHasContent = true;
  }

  if (inQuotes) {
    throw new CsvFormatError("Quoted field is never closed", quoteLine);
  }
  endRow();
  return rows;
}
