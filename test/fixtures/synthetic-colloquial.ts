/**
 * SYNTHETIC colloquial rows for development and tests. They are generated
 * placeholders in the shape of the HearMandarin dataset, not real expressions
 * and not copied from any dataset.
 */
export interface SyntheticColloquialRecord {
  slug: string;
  term: string;
  pinyin: string;
  category: string;
  register: string;
  channel: string;
  since: string;
  status: string;
  checked: string;
  literal_en: string;
  real_en: string;
  url: string;
}

export const SYNTHETIC_COLLOQUIAL_COLUMNS = [
  "slug",
  "term",
  "pinyin",
  "category",
  "register",
  "channel",
  "since",
  "status",
  "checked",
  "literal_en",
  "real_en",
  "url",
] as const;

const REGISTERS = ["anyone", "casual", "casual", "mates"];
const CHANNELS = ["both", "both", "typed"];
const STATUSES = ["steady", "hot", "steady", "fading"];
const CATEGORIES = ["work", "social", "online"];

export const SYNTHETIC_COLLOQUIAL_COUNT = 12;

/** 12 rows: registers anyone×3, casual×6, mates×3; channel typed×4; status hot×3, fading×3. */
export function makeSyntheticColloquial(count = SYNTHETIC_COLLOQUIAL_COUNT): SyntheticColloquialRecord[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return {
      slug: `sample-${String(n).padStart(2, "0")}`,
      term: `样例口语${n}`,
      pinyin: `yànglì kǒuyǔ ${n}`,
      category: CATEGORIES[i % CATEGORIES.length] as string,
      register: REGISTERS[i % REGISTERS.length] as string,
      channel: CHANNELS[i % CHANNELS.length] as string,
      since: i % 2 === 0 ? "2020" : "unknown",
      status: STATUSES[i % STATUSES.length] as string,
      checked: "2026-09",
      literal_en: `placeholder literal ${n}`,
      real_en: `placeholder meaning ${n}`,
      url: `https://example.test/colloquial/sample-${String(n).padStart(2, "0")}`,
    };
  });
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function colloquialToCsv(records: readonly Partial<SyntheticColloquialRecord>[], columns: readonly string[] = SYNTHETIC_COLLOQUIAL_COLUMNS): string {
  const lines = [columns.join(",")];
  for (const record of records) {
    lines.push(columns.map((c) => csvCell(String((record as Record<string, unknown>)[c] ?? ""))).join(","));
  }
  return lines.join("\n") + "\n";
}

export function colloquialToJson(records: readonly unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ name: "synthetic", version: "2026-01-01", count: records.length, ...extra, terms: records });
}
