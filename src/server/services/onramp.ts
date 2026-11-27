/** The sound-system on-ramp (SPEC §5.9, FR-032): scored by authored keys, kept as owner data. */
import type { D1Database } from "@cloudflare/workers-types";
import { ALL_UNITS, TONE_CHECK, passMark, scoreUnit, type OnrampResult, type OnrampStatus } from "../../shared/onramp";
import { ApiError } from "../validation/errors";

export async function onrampStatus(d1: D1Database): Promise<OnrampStatus> {
  const rows = await d1
    .prepare("SELECT unit_id, MAX(correct) AS best, MAX(total) AS total, COUNT(*) AS n, MAX(passed) AS passed FROM onramp_results GROUP BY unit_id")
    .all<{ unit_id: string; best: number; total: number; n: number; passed: number }>();
  const check = rows.results.find((r) => r.unit_id === TONE_CHECK.id);
  return {
    units: rows.results.map((r) => ({ unitId: r.unit_id, bestCorrect: r.best, total: r.total, attempts: r.n })),
    checkPassed: check?.passed === 1,
    checkBest: check ? check.best / check.total : null,
  };
}

export async function answerUnit(d1: D1Database, unitId: string, answers: readonly (number | string | null)[], now: Date = new Date()): Promise<OnrampResult> {
  const unit = ALL_UNITS.find((u) => u.id === unitId);
  if (!unit) throw new ApiError("NOT_FOUND", "No such on-ramp unit.");
  if (answers.length !== unit.items.length) throw new ApiError("BAD_REQUEST", `Send one answer for each of the ${unit.items.length} items (null to skip).`);
  const { marks, keys } = scoreUnit(unit, answers);
  const correct = marks.filter(Boolean).length;
  const passed = correct / unit.items.length >= passMark(unit.id);
  const at = now.toISOString();
  await d1
    .prepare("INSERT INTO onramp_results (id, unit_id, correct, total, passed, answers_json, answered_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
    .bind(crypto.randomUUID(), unit.id, correct, unit.items.length, passed ? 1 : 0, JSON.stringify(answers), at)
    .run();
  return { unitId: unit.id, correct, total: unit.items.length, passed, keys, marks, answeredAt: at };
}
