/** What to tell the learner when speech did not work. Typing always keeps working. */
import type { VoiceProblem } from "./useVoice";

const PROBLEM_TEXT: Readonly<Record<Exclude<VoiceProblem["kind"], "server">, string>> = {
  denied: "Microphone access was refused. Allow it for this site in your browser's settings, or keep typing.",
  "no-microphone": "No microphone was found. Connect one, or keep typing.",
  unsupported: "This browser can't record here. Speaking needs a secure (https) page in a current browser. Typing works.",
  token: "Azure didn't accept the speech sign-in. Try again; typing still works.",
  busy: "Azure Speech is busy. The free tier allows one recognition at a time. Wait a moment, or type.",
  network: "Couldn't reach Azure Speech. Check your connection, or type.",
  failed: "Speech didn't work this time. Try again, or type.",
  "no-speech": "Didn't hear anything. Tap Speak and talk, or type instead.",
};

export function problemText(problem: VoiceProblem): string {
  return problem.kind === "server" ? problem.message : PROBLEM_TEXT[problem.kind];
}
