/**
 * Generated speech kept in the browser's Cache Storage (SPEC §2.6 rule 5,
 * §5.10), so replaying a story's lines uses no more of the speech allowance.
 * Per device; a cleared cache just means the next play synthesizes again.
 */
const CACHE = "shuolab-audio-v1";

async function hash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function available(): boolean {
  return typeof caches !== "undefined";
}

/** The cache address for one utterance: voice, rate and text. */
export async function audioKey(text: string, voice: string, rate: number): Promise<string> {
  return `/__audio-cache/${await hash(`${voice}|${rate}|${text}`)}`;
}

export async function getCachedAudio(key: string): Promise<ArrayBuffer | null> {
  if (!available()) return null;
  try {
    const hit = await (await caches.open(CACHE)).match(key);
    return hit ? await hit.arrayBuffer() : null;
  } catch {
    return null;
  }
}

export async function putCachedAudio(key: string, audio: ArrayBuffer): Promise<void> {
  if (!available() || audio.byteLength === 0) return;
  try {
    await (await caches.open(CACHE)).put(key, new Response(audio, { headers: { "Content-Type": "audio/wav" } }));
  } catch {
    // A full or blocked cache only means the next play synthesizes again.
  }
}

/** Plays audio bytes; resolves when finished or stopped. Empty audio (the stand-in) resolves at once. */
export function playAudio(audio: ArrayBuffer, signal: AbortSignal): Promise<boolean> {
  if (audio.byteLength === 0 || typeof Audio === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([audio], { type: "audio/wav" }));
    const element = new Audio(url);
    const done = (played: boolean) => {
      URL.revokeObjectURL(url);
      resolve(played);
    };
    signal.addEventListener(
      "abort",
      () => {
        element.pause();
        done(false);
      },
      { once: true },
    );
    element.onended = () => done(true);
    element.onerror = () => done(false);
    void element.play().catch(() => done(false));
  });
}
