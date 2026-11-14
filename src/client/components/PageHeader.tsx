interface PageHeaderProps {
  /** Chinese title, set large in a Kai face. */
  zh: string;
  /** English page name; this is the accessible heading text's second half. */
  en: string;
  /** Optional one-line description of the page. */
  summary?: string;
}

export function PageHeader({ zh, en, summary }: PageHeaderProps) {
  return (
    <header className="mb-8">
      <h1 className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span lang="zh-Hans" className="font-kai text-title text-cobalt-deep">
          {zh}
        </span>
        <span className="text-lg text-mist">{en}</span>
      </h1>
      {summary ? <p className="mt-3 max-w-[60ch] text-mist">{summary}</p> : null}
    </header>
  );
}
