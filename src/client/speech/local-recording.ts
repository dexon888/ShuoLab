/**
 * A copy of the learner's attempt kept only in this page's memory, for
 * listening back against the model voice (SPEC §7.3). It is never uploaded,
 * never cached and is dropped when the page closes.
 */
export interface LocalRecording {
  /** Stops recording and returns the audio, or null when nothing was captured. */
  stop: () => Promise<Blob | null>;
}

const START_TIMEOUT_MS = 1500;

/** Starts recording from the microphone, or returns null where the browser can't. */
export async function startLocalRecording(): Promise<LocalRecording | null> {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  let stream: MediaStream;
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), START_TIMEOUT_MS));
    const got = await Promise.race([navigator.mediaDevices.getUserMedia({ audio: true }), timeout]);
    if (!got) return null;
    stream = got;
  } catch {
    return null;
  }
  const chunks: Blob[] = [];
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream);
  } catch {
    for (const t of stream.getTracks()) t.stop();
    return null;
  }
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start();
  return {
    stop: () =>
      new Promise<Blob | null>((resolve) => {
        const finish = () => {
          for (const t of stream.getTracks()) t.stop();
          resolve(chunks.length > 0 ? new Blob(chunks, { type: recorder.mimeType || "audio/webm" }) : null);
        };
        if (recorder.state === "inactive") return finish();
        recorder.onstop = finish;
        recorder.stop();
      }),
  };
}
