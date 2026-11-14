import { useId, type ReactNode } from "react";

interface SectionProps {
  title: string;
  children: ReactNode;
}

/** A titled region of a page, separated from its neighbours by a rule. */
export function Section({ title, children }: SectionProps) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="border-t border-line py-6">
      <h2 id={id} className="mb-3 text-xl font-semibold text-cobalt-deep">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Honest placeholder for a part of the app that a later phase delivers. */
export function NotBuiltYet({ phase, children }: { phase: number; children: ReactNode }) {
  return (
    <div className="border-l-4 border-line bg-wash px-4 py-3">
      <p className="font-semibold">Not built yet</p>
      <p className="mt-1 text-mist">
        {children} This arrives in Phase {phase} of the build plan.
      </p>
    </div>
  );
}
