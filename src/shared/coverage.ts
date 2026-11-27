/**
 * Known-word coverage (SPEC §2.6 rule 4, FR-035). Text is segmented by
 * forward maximum matching against the imported vocabulary, so a token is a
 * syllabus word where one fits and a single character otherwise. Coverage is
 * the share of tokens the learner has met. Deterministic; no model involved.
 */
const HAN = /\p{Script=Han}/u;
const MAX_WORD = 6;

/** Splits Chinese text into vocabulary words and single characters; other text is ignored. */
export function segment(text: string, vocabulary: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const chars = [...text];
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i] as string;
    if (!HAN.test(ch)) {
      i += 1;
      continue;
    }
    let taken = 1;
    for (let len = Math.min(MAX_WORD, chars.length - i); len > 1; len--) {
      const candidate = chars.slice(i, i + len).join("");
      if (vocabulary.has(candidate)) {
        taken = len;
        break;
      }
    }
    out.push(chars.slice(i, i + taken).join(""));
    i += taken;
  }
  return out;
}

export interface Coverage {
  known: number;
  total: number;
  /** Tokens the learner has not met, in order, without repeats. */
  unknown: string[];
}

export function coverage(text: string, vocabulary: ReadonlySet<string>, known: ReadonlySet<string>): Coverage {
  const tokens = segment(text, vocabulary);
  const unknown: string[] = [];
  let k = 0;
  for (const t of tokens) {
    if (known.has(t)) k += 1;
    else if (!unknown.includes(t)) unknown.push(t);
  }
  return { known: k, total: tokens.length, unknown };
}

/** Learners who know fewer words get scaffolding instead of regeneration (DECISIONS 121). */
export const BEGINNER_WORDS = 300;
export const REGENERATE_FROM_WORDS = 100;

/** The coverage target for a learner who knows `knownCount` words, or null when it cannot fairly be held. */
export function coverageTarget(knownCount: number): number | null {
  if (knownCount < REGENERATE_FROM_WORDS) return null;
  return knownCount < BEGINNER_WORDS ? 0.9 : 0.95;
}

/** How many sentences a reply may have, growing with the learner's own turns (SPEC §6.3). */
export function replySentences(meanLearnerChars: number): 1 | 2 | 3 {
  if (meanLearnerChars < 8) return 1;
  if (meanLearnerChars < 20) return 2;
  return 3;
}
