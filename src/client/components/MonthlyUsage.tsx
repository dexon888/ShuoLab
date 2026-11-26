import { useMonthlyUsage } from "../hooks/queries";
import { UsageBudgetMeter, usd } from "./UsageBudgetMeter";

function minutes(seconds: number): string {
  return `${Math.floor(seconds / 60)} min`;
}

/** This month's estimated spending against the amounts set in Settings. */
export function MonthlyUsage() {
  const usage = useMonthlyUsage();

  if (usage.isPending) return <p className="text-mist">Loading this month's estimate…</p>;
  if (!usage.data) return <p className="text-mist">This month's estimate is unavailable right now.</p>;

  const { data } = usage;
  return (
    <div>
      <UsageBudgetMeter estimatedUsd={data.estimatedUsd} softUsd={data.softUsd} hardUsd={data.hardUsd} />
      <p className="mt-3">
        <span className="font-semibold">{usd(data.estimatedUsd)}</span> estimated in {data.month} (UTC), from{" "}
        {data.tutor.requests} tutor {data.tutor.requests === 1 ? "request" : "requests"}.
      </p>
      {data.hardLimitReached ? (
        <p className="mt-2 border-l-4 border-seal bg-seal-wash px-4 py-2">
          The stop amount of {usd(data.hardUsd)} has been reached. Paid tutor requests are paused
          until next month or until you raise it below.
        </p>
      ) : data.softLimitReached ? (
        <p className="mt-2 border-l-4 border-seal bg-seal-wash px-4 py-2">
          The warning amount of {usd(data.softUsd)} has been reached. Paid requests stop at{" "}
          {usd(data.hardUsd)}.
        </p>
      ) : (
        <p className="mt-1 text-mist">
          Warning at {usd(data.softUsd)}, stop at {usd(data.hardUsd)}.
        </p>
      )}
      <p className="mt-2 text-sm text-mist">{data.disclaimer}</p>

      <h3 className="mt-5 font-semibold">Speech (Azure free tier)</h3>
      <p className="mt-1">
        Speech recognition: {minutes(data.speech.recognitionSeconds)} of {minutes(data.speech.recognitionLimitSeconds)}.
        Spoken replies: {data.speech.synthesisChars.toLocaleString("en-US")} of{" "}
        {data.speech.synthesisLimitChars.toLocaleString("en-US")} characters.
      </p>
      {!data.speech.recognitionAvailable || !data.speech.synthesisAvailable ? (
        <p className="mt-2 border-l-4 border-seal bg-seal-wash px-4 py-2">
          {!data.speech.recognitionAvailable && !data.speech.synthesisAvailable
            ? "This month's free speech allowance is used up. Typed answers and written replies still work."
            : !data.speech.recognitionAvailable
              ? "This month's free speech recognition is used up. Answer by typing until next month."
              : "This month's free spoken replies are used up. Replies are shown as text until next month."}
        </p>
      ) : null}
      <p className="mt-2 text-sm text-mist">
        Counted from what this app reports after each use; Azure's own count may differ slightly. Speech stops at
        the free allowance and never moves to a paid tier.
      </p>
    </div>
  );
}
