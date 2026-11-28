import { useState } from "react";
import { API_PREFIX } from "../../shared/api";
import { DELETE_ALL_PHRASE, OWNER_TABLES, type DeletionResponse, type OwnerTable } from "../../shared/owner-data";
import { RETENTION_OPTIONS, type OwnerSettings, type RetentionDays } from "../../shared/settings";
import { useDataSummary, useDeleteAllData, useUpdateSettings } from "../hooks/queries";
import { ApiRequestError } from "../lib/api";
import { AsyncStatus } from "./AsyncStatus";

const TABLE_LABELS: Readonly<Record<OwnerTable, string>> = {
  owner_settings: "Settings",
  sessions: "Sessions",
  session_targets: "Session words",
  session_items: "Session grammar and topics",
  session_materials: "Reading and writing",
  task_checks: "Task checks",
  item_flags: "Rows you flagged",
  assessment_runs: "Tests and checkpoints",
  onramp_results: "Sound-system drills",
  stories: "Stories",
  conversation_turns: "Conversation turns",
  listening_exercises: "Listening exercises",
  review_cards: "Review cards",
  review_events: "Review ratings",
  practice_attempts: "Practice attempts",
  mastery_states: "Mastery by skill",
  usage_events: "Usage ledger",
};

function errorText(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : "Something went wrong. Try again.";
}

function Retention({ settings }: { settings: OwnerSettings }) {
  const update = useUpdateSettings();
  const value = settings.transcriptRetentionDays === null ? "" : String(settings.transcriptRetentionDays);
  return (
    <div>
      <label className="block">
        <span className="mb-1 block font-medium">Keep conversation text</span>
        <select
          value={value}
          disabled={update.isPending}
          onChange={(e) =>
            update.mutate({ transcriptRetentionDays: e.target.value === "" ? null : (Number(e.target.value) as RetentionDays) })
          }
          className="min-h-11 w-full max-w-xs rounded-md border border-mist bg-glaze px-3"
        >
          <option value="">Until I delete it</option>
          {RETENTION_OPTIONS.map((d) => (
            <option key={d} value={d}>
              For {d} days
            </option>
          ))}
        </select>
      </label>
      <p className="mt-1 text-sm text-mist">
        After that, finished sessions lose what you typed or said and the tutor's replies. Their dates, minutes, listening
        answers and review history stay. Audio is never stored.
      </p>
      {update.isError ? (
        <p role="alert" className="mt-2 border-l-4 border-seal bg-seal-wash px-4 py-3">
          {errorText(update.error)}
        </p>
      ) : null}
    </div>
  );
}

function DeleteAll() {
  const remove = useDeleteAllData();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState<DeletionResponse | null>(null);

  if (done) {
    const total = Object.values(done.deleted).reduce((a, b) => a + b, 0);
    return (
      <div role="status" className="border-l-4 border-cobalt bg-wash px-4 py-3">
        <p className="font-semibold">Deleted {total} records.</p>
        <ul className="mt-1 list-disc pl-5 text-sm">
          {done.kept.map((k) => (
            <li key={k}>Kept: {k}</li>
          ))}
        </ul>
      </div>
    );
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="min-h-11 rounded-md border border-seal px-4 font-medium text-seal">
        Delete all my data…
      </button>
    );
  }
  return (
    <div className="border-l-4 border-seal bg-seal-wash px-4 py-3">
      <p className="font-semibold">This deletes your sessions, conversations, review history, progress and settings. It cannot be undone.</p>
      <p className="mt-1 text-sm">Export first if you may want them. The curriculum and this month's spending count are kept.</p>
      <label className="mt-3 block">
        <span className="mb-1 block text-sm font-medium">Type {DELETE_ALL_PHRASE} to confirm</span>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          className="min-h-11 w-full max-w-xs rounded-md border border-mist bg-glaze px-3"
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={typed !== DELETE_ALL_PHRASE || remove.isPending}
          onClick={() => remove.mutate(undefined, { onSuccess: setDone })}
          className="min-h-11 rounded-md bg-seal px-4 font-semibold text-glaze disabled:opacity-60"
        >
          Delete everything
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setTyped("");
          }}
          className="min-h-11 rounded-md border border-ink px-4 font-medium"
        >
          Cancel
        </button>
      </div>
      {remove.isError ? (
        <p role="alert" className="mt-3">
          {errorText(remove.error)}
        </p>
      ) : null}
    </div>
  );
}

/** Settings → Your data: what is stored, export, retention and deletion (SPEC §5.7). */
export function YourData({ settings }: { settings: OwnerSettings }) {
  const summary = useDataSummary();
  const [table, setTable] = useState<OwnerTable>("sessions");

  return (
    <div className="space-y-6">
      <AsyncStatus isPending={summary.isPending} error={summary.error} onRetry={() => void summary.refetch()} label="your data">
        {summary.data ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
            {(["sessions", "conversation_turns", "review_events", "listening_exercises", "practice_attempts", "usage_events"] as const).map((t) => (
              <div key={t}>
                <dt className="text-sm text-mist">{TABLE_LABELS[t]}</dt>
                <dd className="font-semibold tabular-nums">{summary.data.counts[t] ?? 0}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </AsyncStatus>

      <div>
        <p className="font-medium">Export</p>
        <p className="text-sm text-mist">
          Everything of yours as one JSON file, which can be loaded back into a local copy with{" "}
          <code>pnpm data:import</code>, or one table at a time as CSV for a spreadsheet. The curriculum is not included.
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <a
            href={`${API_PREFIX}/export?format=json`}
            download
            className="inline-flex min-h-11 items-center rounded-md bg-cobalt px-4 font-semibold text-glaze"
          >
            Download JSON
          </a>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">CSV table</span>
            <select
              value={table}
              onChange={(e) => setTable(e.target.value as OwnerTable)}
              className="min-h-11 rounded-md border border-mist bg-glaze px-3"
            >
              {OWNER_TABLES.map((t) => (
                <option key={t} value={t}>
                  {TABLE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <a
            href={`${API_PREFIX}/export?format=csv&table=${table}`}
            download
            className="inline-flex min-h-11 items-center rounded-md border border-cobalt px-4 font-medium text-cobalt"
          >
            Download CSV
          </a>
        </div>
      </div>

      <Retention settings={settings} />

      <div>
        <p className="font-medium">Delete</p>
        <p className="mb-2 text-sm text-mist">
          To delete one session, open it and use Delete this session. To delete everything:
        </p>
        <DeleteAll />
      </div>
    </div>
  );
}
