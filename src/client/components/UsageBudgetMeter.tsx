export function usd(value: number): string {
  // Below a cent the amount is shown to four places so it is not rounded to nothing.
  return `US$${value > 0 && value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

interface UsageBudgetMeterProps {
  estimatedUsd: number;
  softUsd: number;
  hardUsd: number;
}

/**
 * This month's estimate as a bar against the stop amount, with a tick at the
 * warning amount (SPEC §10 UsageBudgetMeter). The sentence under it carries the
 * same information, so the bar is hidden from assistive technology and nothing
 * depends on its colour.
 */
export function UsageBudgetMeter({ estimatedUsd, softUsd, hardUsd }: UsageBudgetMeterProps) {
  const share = hardUsd > 0 ? Math.min(estimatedUsd / hardUsd, 1) : 1;
  const tick = hardUsd > 0 ? Math.min(softUsd / hardUsd, 1) : 1;
  const over = estimatedUsd >= softUsd;
  return (
    <div>
      <div aria-hidden="true" data-testid="budget-bar" className="relative h-3 overflow-hidden rounded-full bg-wash">
        <div
          className={`h-full rounded-full ${over ? "bg-seal" : "bg-cobalt"}`}
          style={{ width: `${Math.max(share * 100, estimatedUsd > 0 ? 1 : 0)}%` }}
        />
        <div className="absolute top-0 h-full w-0.5 bg-ink" style={{ left: `calc(${tick * 100}% - 1px)` }} />
      </div>
      <p className="mt-1 text-sm">
        {usd(estimatedUsd)} of {usd(hardUsd)} this month ({Math.round(share * 100)}%). Warning at {usd(softUsd)}.
      </p>
    </div>
  );
}
