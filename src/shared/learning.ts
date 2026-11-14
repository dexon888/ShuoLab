/** Learning-model vocabulary shared by client and server (SPEC §6, §8.2). */

export const SKILLS = ["listening", "speaking", "reading", "writing"] as const;
export type Skill = (typeof SKILLS)[number];

/** Exposure is not ability: these states are tracked per item and per skill. */
export const MASTERY_STATES = [
  "unseen",
  "introduced",
  "practiced",
  "developing",
  "mastered",
] as const;
export type MasteryState = (typeof MASTERY_STATES)[number];

export const SESSION_MINUTE_OPTIONS = [15, 20, 25, 30] as const;
export type SessionMinutes = (typeof SESSION_MINUTE_OPTIONS)[number];

export const SESSION_STATUSES = ["planned", "active", "paused", "complete", "abandoned"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
