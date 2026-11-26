export interface Probe {
  name: string;
  path: string;
  headers: Record<string, string>;
}
export interface Verdict {
  ok: boolean;
  how: string;
}
export const PROBES: Probe[];
export function parseTarget(raw: string): string;
export function judge(status: number, location: string | null | undefined): Verdict;
export function checkAccess(origin: string, fetchImpl?: typeof fetch): Promise<(Probe & Verdict)[]>;
