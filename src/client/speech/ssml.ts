/** Pure helpers for Azure speech: SSML, rates, and reading recognition results. */
import { MAX_UTTERANCE_SECONDS } from "../../shared/speech";

/** A standard Mandarin neural voice. */
export const AZURE_VOICE = "zh-CN-XiaoxiaoNeural";
/** More voices, so tones are heard across speakers (SPEC §5.9). */
export const AZURE_VOICES = ["zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural", "zh-CN-YunyangNeural"] as const;
export const RECOGNITION_LANGUAGE = "zh-CN";
/** Below this, the transcript is shown for checking instead of being sent straight away. */
export const CONFIDENT_RECOGNITION = 0.6;

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Speech rate as SSML prosody: 1 → "+0%", 0.85 → "-15%", 1.1 → "+10%". */
export function prosodyRate(rate: number): string {
  const safe = Number.isFinite(rate) ? Math.min(2, Math.max(0.5, rate)) : 1;
  const percent = Math.round((safe - 1) * 100);
  return `${percent >= 0 ? "+" : ""}${percent}%`;
}

/** Pinyin with tone numbers, as SSML's sapi alphabet wants it: "ma 1", "ni 3 hao 3". */
const PHONEME = /^[a-zü]+ [1-5]( [a-zü]+ [1-5])*$/;

/**
 * SSML for one utterance. Text is escaped, never inserted as markup. A
 * phoneme (authored drill content only) is checked against a strict pattern.
 */
export function buildSsml(text: string, rate: number, voice: string = AZURE_VOICE, phoneme?: string): string {
  const safeVoice = (AZURE_VOICES as readonly string[]).includes(voice) ? voice : AZURE_VOICE;
  const body =
    phoneme && PHONEME.test(phoneme)
      ? `<phoneme alphabet="sapi" ph="${escapeXml(phoneme)}">${escapeXml(text)}</phoneme>`
      : escapeXml(text);
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">` +
    `<voice name="${escapeXml(safeVoice)}"><prosody rate="${prosodyRate(rate)}">${body}</prosody></voice></speak>`
  );
}

/** Azure's confidence for the best result in a detailed recognition result, if any. */
export function readConfidence(json: string | undefined | null): number | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    const best = (parsed as { NBest?: { Confidence?: unknown }[] }).NBest?.[0]?.Confidence;
    return typeof best === "number" && best >= 0 && best <= 1 ? best : null;
  } catch {
    return null;
  }
}

/**
 * Seconds to count for one utterance. Azure counts the audio it receives,
 * silence included, so the time the microphone was open is used when it is
 * longer than the recognised speech. Rounded to a tenth, within 0.1–60.
 */
export function utteranceSeconds(durationTicks: number, elapsedMs: number): number {
  const spoken = Number.isFinite(durationTicks) ? durationTicks / 10_000_000 : 0;
  const open = Number.isFinite(elapsedMs) ? elapsedMs / 1000 : 0;
  const seconds = Math.max(spoken, open, 0.1);
  return Math.round(Math.min(MAX_UTTERANCE_SECONDS, seconds) * 10) / 10;
}
