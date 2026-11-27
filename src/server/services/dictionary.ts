/**
 * English meanings for the HSK vocabulary from a separately licensed
 * dictionary (SPEC §2.2 #5, §2.6 rule 2, FR-033). CC-CEDICT lines look like
 *
 *   愛 爱 [ai4] /to love/to be fond of/to like/
 *
 * Each syllabus entry is matched by its simplified characters and pinyin;
 * when the pinyin does not match any reading, every reading's senses are
 * kept and the provenance says it was matched by characters only. The
 * meaning is stored in \`definition\` with \`definition_provenance\` naming
 * the dictionary. Nothing here is HSK content.
 */
import type { SqlStatement } from "./curriculum-import";

export interface DictionaryEntry {
  simplified: string;
  /** Pinyin with tone numbers, as written in the dictionary: "ba4 ba5". */
  pinyin: string;
  senses: string[];
}

export const DICTIONARY_KEY = "cc-cedict";
export const DICTIONARY_NAME = "CC-CEDICT";
export const DICTIONARY_LICENSE = "CC BY-SA 4.0";
export const DICTIONARY_URL = "https://www.mdbg.net/chinese/dictionary?page=cc-cedict";
const MAX_DEFINITION = 300;

const LINE = /^(\S+)\s+(\S+)\s+\[([^\]]*)\]\s+\/(.*)\/\s*$/;

/** Parses CC-CEDICT text; comment lines (#) and malformed lines are skipped and counted. */
export function parseCedict(text: string): { entries: DictionaryEntry[]; skipped: number } {
  const entries: DictionaryEntry[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = LINE.exec(line);
    if (!m) {
      skipped += 1;
      continue;
    }
    const senses = (m[4] ?? "").split("/").map((s) => s.trim()).filter(Boolean);
    if (senses.length === 0) {
      skipped += 1;
      continue;
    }
    entries.push({ simplified: m[2] as string, pinyin: m[3] as string, senses });
  }
  return { entries, skipped };
}

const MARKS: Record<string, [string, number]> = {};
for (const [base, marked] of [
  ["a", "āáǎà"],
  ["e", "ēéěè"],
  ["i", "īíǐì"],
  ["o", "ōóǒò"],
  ["u", "ūúǔù"],
  ["ü", "ǖǘǚǜ"],
] as const) {
  [...marked].forEach((ch, i) => (MARKS[ch] = [base, i + 1]));
}

/**
 * A comparable key for pinyin, toneless letters plus the tones in order:
 * "bàba" → "baba|45", "ba4 ba5" → "baba|45". Neutral tone is 5 in both.
 * Spacing, case, apostrophes and ü spellings (u:, v) are ignored.
 */
export function pinyinKey(pinyin: string, numbered: boolean): string {
  const lower = pinyin.toLowerCase().replace(/u:/g, "ü").replace(/v/g, "ü").replace(/[’'·\-\s,]/g, " ");
  if (numbered) {
    const syllables = lower.split(" ").filter(Boolean);
    const letters = syllables.map((s) => s.replace(/[0-9]/g, "")).join("");
    const tones = syllables.map((s) => (/[1-5]$/.test(s) ? s.slice(-1) : "5")).join("");
    return `${letters}|${tones}`;
  }
  // Marked pinyin: one tone per vowel group; a syllable with no mark is neutral.
  let letters = "";
  const tones: number[] = [];
  for (const word of lower.split(" ").filter(Boolean)) {
    for (const syl of splitSyllables(word)) {
      let tone = 5;
      for (const ch of syl) {
        const mark = MARKS[ch];
        if (mark) {
          letters += mark[0];
          tone = mark[1];
        } else letters += ch;
      }
      tones.push(tone);
    }
  }
  return `${letters}|${tones.join("")}`;
}

const INITIALS = /^(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?/;
const FINALS = [
  "iang", "iong", "uang", "ueng", "üan",
  "ang", "eng", "ing", "ong", "ian", "iao", "uai", "uan", "üe",
  "ai", "ei", "ao", "ou", "an", "en", "in", "un", "ün", "ia", "ie", "iu", "ua", "uo", "ui", "er",
  "a", "o", "e", "i", "u", "ü",
];
const BASE = (s: string) => [...s].map((c) => MARKS[c]?.[0] ?? c).join("");

/** Splits a marked pinyin word into syllables, greedily, with erhua kept on its syllable. */
export function splitSyllables(word: string): string[] {
  const out: string[] = [];
  let rest = word;
  while (rest.length > 0) {
    const plain = BASE(rest);
    const initial = INITIALS.exec(plain)?.[0] ?? "";
    let len = initial.length;
    const final = FINALS.find((f) => plain.startsWith(f, initial.length));
    len += final ? final.length : 1;
    // A final ending in n or ng followed by a vowel belongs to the next syllable: "xian" + "an".
    if (final && /n$|ng$/.test(final) && /^[aeiouü]/.test(plain.slice(len))) len -= final.endsWith("ng") ? 1 : 1;
    if (plain.slice(len).startsWith("r") && !/^r[aeiouü]/.test(plain.slice(len))) len += 1;
    out.push(rest.slice(0, len));
    rest = rest.slice(len);
  }
  return out;
}

export interface VocabRow {
  id: string;
  hanzi: string;
  pinyin: string | null;
}

export interface Gloss {
  id: string;
  definition: string;
  provenance: string;
}

/** Strips homograph digits the syllabus adds to its written forms. */
function bare(hanzi: string): string {
  return hanzi.replace(/[0-9¹²³⁴⁵⁶⁷⁸⁹⁰]/g, "").trim();
}

function join(senses: readonly string[]): string {
  const text = [...new Set(senses)].join("; ");
  return text.length > MAX_DEFINITION ? `${text.slice(0, MAX_DEFINITION - 1)}…` : text;
}

/** Matches syllabus entries to dictionary entries; unmatched entries get nothing. */
export function matchGlosses(rows: readonly VocabRow[], entries: readonly DictionaryEntry[]): { glosses: Gloss[]; byPinyin: number; byCharacters: number; missing: number } {
  const byWord = new Map<string, DictionaryEntry[]>();
  for (const e of entries) {
    const list = byWord.get(e.simplified);
    if (list) list.push(e);
    else byWord.set(e.simplified, [e]);
  }
  const glosses: Gloss[] = [];
  let byPinyin = 0;
  let byCharacters = 0;
  let missing = 0;
  for (const row of rows) {
    const candidates = byWord.get(row.hanzi) ?? byWord.get(bare(row.hanzi)) ?? [];
    if (candidates.length === 0) {
      missing += 1;
      continue;
    }
    const key = row.pinyin ? pinyinKey(row.pinyin, false) : null;
    const exact = key ? candidates.filter((c) => pinyinKey(c.pinyin, true) === key) : [];
    // Neutral tones are written inconsistently; fall back to the letters alone before characters only.
    const letters = key ? candidates.filter((c) => pinyinKey(c.pinyin, true).split("|")[0] === key.split("|")[0]) : [];
    const chosen = exact.length > 0 ? exact : letters;
    if (chosen.length > 0) {
      byPinyin += 1;
      glosses.push({ id: row.id, definition: join(chosen.flatMap((c) => c.senses)), provenance: `${DICTIONARY_NAME} (${DICTIONARY_LICENSE}), matched by characters and pinyin. Not HSK content.` });
    } else {
      byCharacters += 1;
      glosses.push({
        id: row.id,
        definition: join(candidates.flatMap((c) => c.senses)),
        provenance: `${DICTIONARY_NAME} (${DICTIONARY_LICENSE}), matched by characters only; the reading may differ. Not HSK content.`,
      });
    }
  }
  return { glosses, byPinyin, byCharacters, missing };
}

const CHUNK = 200;

/** Writes the glosses and a manifest row for the dictionary file. */
export function glossStatements(editionId: string, glosses: readonly Gloss[], file: { name: string; sha256: string }, importedAt: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  for (let i = 0; i < glosses.length; i += CHUNK) {
    statements.push({
      sql: `UPDATE curriculum_items SET
  definition = (SELECT json_extract(value, '$.d') FROM json_each(?2) WHERE json_extract(value, '$.id') = curriculum_items.id),
  definition_provenance = (SELECT json_extract(value, '$.p') FROM json_each(?2) WHERE json_extract(value, '$.id') = curriculum_items.id)
WHERE edition_id = ?1 AND item_type = 'vocab' AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?2))`,
      params: [editionId, JSON.stringify(glosses.slice(i, i + CHUNK).map((g) => ({ id: g.id, d: g.definition, p: g.provenance })))],
    });
  }
  statements.push({
    sql: `INSERT INTO source_manifests (id, edition_id, dataset_kind, source_url, commit_sha, sha256, rights_note, field_mapping_version, verification_status, record_count, imported_at)
VALUES (?1, ?2, 'dictionary', ?3, NULL, ?4, ?5, 'cedict-v1', 'unverified', ?6, ?7)
ON CONFLICT(id) DO UPDATE SET record_count = excluded.record_count, imported_at = excluded.imported_at`,
    params: [
      `${editionId}:dictionary:${file.sha256}`,
      editionId,
      `${DICTIONARY_URL}#${file.name}`,
      file.sha256,
      `${DICTIONARY_NAME} by MDBG and contributors, licensed ${DICTIONARY_LICENSE} (https://creativecommons.org/licenses/by-sa/4.0/). English meanings shown beside HSK entries; not part of the HSK syllabus. Imported locally by the owner.`,
      glosses.length,
      importedAt,
    ],
  });
  return statements;
}
