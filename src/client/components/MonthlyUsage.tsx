import { useMonthlyUsage } from "../hooks/queries";

function usd(value: number): string {
  // Below a cent the amount is shown to four places so it is not rounded to nothing.
  return `US$${value > 0 && value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

/** This month's estimated spending against the amounts set in Settings. */
export function MonthlyUsage() {
  const usage = useMonthlyUsage();

  if (usage.isPending) return <p className="text-mist">Loading this month's estimate…</p>;
  if (!usage.data) return <p className="text-mist">This month's estimate is unavailable right now.</p>;

  const { data } = usage;
  return (
    <div>
      <p>
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
    </div>
  );
}
