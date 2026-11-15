/**
 * What the learner is typing, and a message that was sent but not yet
 * confirmed, kept in this browser so a reload or a dropped connection does
 * not lose it (SPEC §4.2). Only text the learner wrote is stored, and it is
 * removed once the server has the message.
 */
export interface SessionDraft {
  /** Text in the box. */
  text: string;
  /** A message that was sent and has not been confirmed as saved. */
  pending: { clientTurnId: string; transcript: string } | null;
}

const EMPTY: SessionDraft = { text: "", pending: null };
const key = (sessionId: string) => `shuolab:draft:${sessionId}`;

function isDraft(value: unknown): value is SessionDraft {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.text !== "string") return false;
  if (v.pending === null) return true;
  if (typeof v.pending !== "object" || v.pending === undefined) return false;
  const p = v.pending as Record<string, unknown>;
  return typeof p.clientTurnId === "string" && typeof p.transcript === "string";
}

export function loadDraft(sessionId: string): SessionDraft {
  try {
    const raw = window.localStorage.getItem(key(sessionId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isDraft(parsed) ? parsed : EMPTY;
  } catch {
    // Storage can be unavailable (private mode, blocked): the page works without it.
    return EMPTY;
  }
}

export function saveDraft(sessionId: string, draft: SessionDraft): void {
  try {
    if (draft.text === "" && draft.pending === null) {
      window.localStorage.removeItem(key(sessionId));
    } else {
      window.localStorage.setItem(key(sessionId), JSON.stringify(draft));
    }
  } catch {
    // Nothing to do: the draft simply will not survive a reload.
  }
}
