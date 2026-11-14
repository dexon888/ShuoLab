import type { ReactNode } from "react";
import { ApiRequestError } from "../lib/api";

interface AsyncStatusProps {
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  /** What is being loaded, e.g. "curriculum status". */
  label: string;
  children: ReactNode;
}

/** Loading and error states for a query; renders children once data is ready. */
export function AsyncStatus({ isPending, error, onRetry, label, children }: AsyncStatusProps) {
  if (isPending) {
    return (
      <p role="status" className="text-mist">
        Loading {label}…
      </p>
    );
  }
  if (error) {
    const message =
      error instanceof ApiRequestError ? error.message : "Something went wrong. Try again.";
    const canRetry = !(error instanceof ApiRequestError) || error.retryable;
    return (
      <div role="alert" className="border-l-4 border-seal bg-seal-wash px-4 py-3">
        <p className="font-semibold">Couldn't load {label}</p>
        <p className="mt-1">{message}</p>
        {canRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 min-h-11 rounded-md border border-ink px-4 font-medium"
          >
            Try again
          </button>
        ) : null}
      </div>
    );
  }
  return <>{children}</>;
}
