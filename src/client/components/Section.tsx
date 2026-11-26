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
