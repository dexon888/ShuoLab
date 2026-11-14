import { useOnline } from "../hooks/useOnline";

export function OfflineBanner() {
  const online = useOnline();
  return (
    <div role="status" aria-live="polite">
      {online ? null : (
        <p className="bg-ink px-4 py-2 text-center text-sm text-glaze">
          You're offline. Voice conversation and saving progress need a connection.
        </p>
      )}
    </div>
  );
}
