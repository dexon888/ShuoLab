import { useState } from "react";
import type { ProgressSummary } from "../../shared/progress";

type Day = ProgressSummary["practice"]["days"][number];

const HEIGHT = 120;

function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, d ?? 1)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function minutesText(minutes: number): string {
  return minutes === 0 ? "no practice" : `${minutes % 1 === 0 ? minutes : minutes.toFixed(1)} min`;
}

/**
 * Practice minutes per day: one series in one colour, bars anchored to the
 * baseline with rounded tops and a gap between them, a hover tooltip per
 * day, and the same numbers as a table for screen readers and keyboards.
 */
export function PracticeChart({ days }: { days: readonly Day[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...days.map((d) => d.minutes), 0);
  // A round top for the scale, so the axis label is a plain number.
  const top = max <= 0 ? 10 : Math.ceil(max / 5) * 5;
  const gap = days.length > 40 ? 1 : 2;
  const shown = hover === null ? null : days[hover];

  return (
    <figure>
      <div className="flex gap-2">
        <div aria-hidden="true" className="flex w-10 shrink-0 flex-col justify-between text-right text-xs text-mist tabular-nums" style={{ height: HEIGHT }}>
          <span>{top} min</span>
          <span>0</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <div
            aria-hidden="true"
            className="flex items-end border-b border-line"
            style={{ height: HEIGHT, gap }}
            onMouseLeave={() => setHover(null)}
          >
            {days.map((day, i) => (
              <div
                key={day.date}
                className="flex h-full min-w-0 flex-1 items-end"
                onMouseEnter={() => setHover(i)}
              >
                <div
                  className={`w-full rounded-t ${hover === i ? "bg-cobalt-deep" : "bg-cobalt"}`}
                  style={{ height: day.minutes > 0 ? Math.max(2, (day.minutes / top) * HEIGHT) : 0 }}
                />
              </div>
            ))}
          </div>
          {shown ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-line bg-glaze px-2 py-1 text-sm whitespace-nowrap shadow-sm"
              style={{ left: `${(((hover ?? 0) + 0.5) / days.length) * 100}%` }}
            >
              <span className="font-medium">{dayLabel(shown.date)}</span>: {minutesText(shown.minutes)}
            </div>
          ) : null}
          <div aria-hidden="true" className="mt-1 flex justify-between text-xs text-mist">
            <span>{days[0] ? dayLabel(days[0].date) : ""}</span>
            <span>{days.at(-1) ? dayLabel(days.at(-1)?.date ?? "") : ""}</span>
          </div>
        </div>
      </div>
      <figcaption className="sr-only">Practice minutes per day</figcaption>
      <details className="mt-3">
        <summary className="min-h-11 cursor-pointer py-2 font-medium text-cobalt">Show as a table</summary>
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="py-1 font-medium">Day</th>
                <th className="py-1 text-right font-medium">Minutes</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((day) => (
                <tr key={day.date} className="border-b border-line">
                  <td className="py-1">{day.date}</td>
                  <td className="py-1 text-right tabular-nums">{day.minutes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
