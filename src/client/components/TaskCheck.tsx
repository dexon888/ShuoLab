import { useState } from "react";
import type { SessionDetail } from "../../shared/session";
import { useFlagItem, useRunTaskCheck, useTaskCheck } from "../hooks/queries";
import { ApiRequestError } from "../lib/api";

function errorText(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : "Something went wrong. Try again.";
}

/** The task check of a finished session (SPEC §6.1): a personal can-do check, never an HSK result. */
export function TaskCheckPanel({ session }: { session: SessionDetail }) {
  const task = session.plan.task;
  const ended = session.status === "complete";
  const existing = useTaskCheck(session.id, Boolean(task) && ended);
  const run = useRunTaskCheck(session.id);
  if (!task) return null;
  const check = existing.data?.check ?? null;
  return (
    <div className="border-l-4 border-cobalt pl-4">
      <h3 className="font-semibold">Task check</h3>
      <p lang="zh-Hans" className="mt-1">
        {task.canDo}
      </p>
      {!ended ? (
        <p className="mt-2 text-mist">The task is checked after you finish, on everything you said and wrote.</p>
      ) : check ? (
        <div className="mt-2">
          <ul className="space-y-1">
            {check.criteria.map((c) => (
              <li key={c.label}>
                <span aria-hidden="true">{c.met ? "✓" : "✗"}</span> {c.label}: {c.met ? "yes" : "not shown"}
                {c.evidence ? (
                  <span className="block text-sm text-mist">
                    You: <span lang="zh-Hans">“{c.evidence}”</span>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-2 font-medium">
            {check.passed ? "Passed today." : "Not passed this time."} {check.task.achieved
              ? "Task achieved: passed on two days, in two topics."
              : `Passed on ${check.task.passes} of the 2 days needed, in ${check.task.topics} topic${check.task.topics === 1 ? "" : "s"} (2 needed).`}
          </p>
          <p className="mt-1 text-sm text-mist">
            {check.standIn ? "Judged by the practice stand-in, not a real check. " : `Judged by ${check.scorerModel} (${check.scorerVersion}). `}
            A met criterion needs your own words as evidence. This is a personal can-do check, not an HSK result
            {task.unverified ? ", and the task comes from an unverified second-hand transcription" : ""}.
          </p>
        </div>
      ) : (
        <div className="mt-2">
          <button
            type="button"
            disabled={run.isPending || existing.isPending}
            onClick={() => run.mutate()}
            className="min-h-11 rounded-md bg-cobalt px-5 font-semibold text-glaze disabled:opacity-60"
          >
            {run.isPending ? "Checking…" : "Check the task"}
          </button>
          {run.isError ? (
            <p role="alert" className="mt-2 text-seal">
              {errorText(run.error)}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Flag an unverified row as wrong, with a note (SPEC §2.5 rule 8). */
export function FlagControl({ itemId, flag }: { itemId: string; flag: { note: string | null; flaggedAt: string } | null }) {
  const mutate = useFlagItem(itemId);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (flag) {
    return (
      <div className="border-l-4 border-seal bg-seal-wash px-4 py-3">
        <p className="font-medium">You flagged this as wrong on {flag.flaggedAt.slice(0, 10)}.</p>
        {flag.note ? <p className="mt-1">Note: {flag.note}</p> : null}
        <p className="mt-1 text-sm">It is left out of lesson plans, review and tests.</p>
        <button type="button" disabled={mutate.isPending} onClick={() => mutate.mutate({ on: false })} className="mt-2 min-h-11 rounded-md border border-ink px-4 font-medium">
          Remove the flag
        </button>
      </div>
    );
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="min-h-11 rounded-md border border-seal px-4 font-medium text-seal">
        Flag as wrong…
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutate.mutate({ on: true, note: note.trim() }, { onSuccess: () => setOpen(false) });
      }}
      className="space-y-2"
    >
      <label htmlFor={`flag-${itemId}`} className="block font-medium">
        What is wrong? (optional)
      </label>
      <input
        id={`flag-${itemId}`}
        value={note}
        maxLength={300}
        onChange={(e) => setNote(e.target.value)}
        className="min-h-11 w-full rounded-md border border-mist bg-glaze px-3"
      />
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={mutate.isPending} className="min-h-11 rounded-md bg-seal px-4 font-semibold text-glaze disabled:opacity-60">
          Flag it
        </button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-md border border-ink px-4 font-medium">
          Cancel
        </button>
      </div>
      {mutate.isError ? (
        <p role="alert" className="text-seal">
          {errorText(mutate.error)}
        </p>
      ) : null}
    </form>
  );
}
