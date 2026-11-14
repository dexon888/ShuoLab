import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import type { ColloquialExpression, ColloquialSourceStatus } from "../../shared/api";
import {
  CHANNEL_LABELS,
  COLLOQUIAL_CHANNELS,
  COLLOQUIAL_REGISTERS,
  CURRENCY_LABELS,
  CURRENCY_STATUSES,
  REGISTER_LABELS,
  usageWarnings,
  type ColloquialChannel,
  type ColloquialRegister,
  type CurrencyStatus,
} from "../../shared/colloquial";
import { AsyncStatus } from "../components/AsyncStatus";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { useColloquial } from "../hooks/queries";

function pick<T extends string>(value: string | null, allowed: readonly T[]): T | "" {
  return allowed.includes(value as T) ? (value as T) : "";
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  // Only real web addresses become links.
  return /^https:\/\//.test(href) ? (
    <a href={href} rel="noreferrer noopener" target="_blank" className="text-cobalt underline">
      {children}
    </a>
  ) : (
    <>{children}</>
  );
}

function Tag({ children }: { children: string }) {
  return <li className="rounded-sm border border-line bg-wash px-2 py-0.5 text-sm">{children}</li>;
}

function ExpressionCard({ item }: { item: ColloquialExpression }) {
  const warnings = usageWarnings(item);
  return (
    <li className="border-b border-line py-5">
      <h3 className="flex flex-wrap items-baseline gap-x-3">
        <span lang="zh-Hans" className="text-2xl">
          {item.term}
        </span>
        {item.pinyin ? <span className="text-base font-normal text-mist">{item.pinyin}</span> : null}
      </h3>
      <p className="mt-1">{item.meaningEn}</p>
      {item.literalEn ? <p className="text-sm text-mist">Literally: {item.literalEn}</p> : null}

      <ul aria-label="Register and context" className="mt-3 flex flex-wrap gap-2">
        <Tag>{REGISTER_LABELS[item.register]}</Tag>
        <Tag>{CHANNEL_LABELS[item.channel]}</Tag>
        <Tag>{CURRENCY_LABELS[item.currencyStatus]}</Tag>
        {item.region ? <Tag>{`Region: ${item.region}`}</Tag> : null}
        {item.verificationStatus === "unverified" ? <Tag>Unverified</Tag> : null}
      </ul>

      {warnings.length > 0 ? (
        <ul aria-label="Usage warnings" className="mt-3 space-y-1 border-l-4 border-seal bg-seal-wash px-4 py-2">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      <p className="mt-3 text-sm text-mist">
        {item.inUseSince && item.inUseSince !== "unknown" ? `In use since ${item.inUseSince}. ` : null}
        {item.lastVerifiedAt ? `Checked by the source ${item.lastVerifiedAt}. ` : null}
        <ExternalLink href={item.sourceUrl}>Source entry</ExternalLink>
      </p>
    </li>
  );
}

function Credits({ sources }: { sources: ColloquialSourceStatus[] }) {
  return (
    <Section title="Source and credit">
      <ul className="space-y-3">
        {sources.map((source) => (
          <li key={source.key}>
            <p>
              <span className="font-semibold">{source.name}</span>, {source.count}{" "}
              {source.count === 1 ? "expression" : "expressions"}
              {source.datasetVersion ? `, dataset version ${source.datasetVersion}` : ""}
              {source.importedAt ? `, imported ${source.importedAt.slice(0, 10)}` : ""}.
            </p>
            <p className="text-sm text-mist">
              Credit: {source.attribution}. Licence:{" "}
              {source.licenseUrl ? (
                <ExternalLink href={source.licenseUrl}>{source.license}</ExternalLink>
              ) : (
                source.license
              )}
              .
              {source.synthetic
                ? null
                : " The licence covers the dataset's terms and tags only. Example sentences and audio stay on the source's site and are not copied here."}
            </p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Select<T extends string>({
  name,
  label,
  value,
  options,
  labels,
}: {
  name: string;
  label: string;
  value: T | "";
  options: readonly T[];
  labels: Readonly<Record<T, string>>;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <select name={name} defaultValue={value} className="min-h-11 w-full rounded-md border border-mist bg-glaze px-3">
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {labels[option]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ColloquialPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const register: ColloquialRegister | "" = pick(searchParams.get("register"), COLLOQUIAL_REGISTERS);
  const channel: ColloquialChannel | "" = pick(searchParams.get("channel"), COLLOQUIAL_CHANNELS);
  const status: CurrencyStatus | "" = pick(searchParams.get("status"), CURRENCY_STATUSES);
  const filtered = q !== "" || register !== "" || channel !== "" || status !== "";

  const list = useColloquial({ q, register, channel, status });
  const first = list.data?.pages[0];
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const total = first?.total ?? 0;
  const sources = first?.sources ?? [];
  const imported = sources.length > 0;
  const synthetic = sources.some((source) => source.synthetic);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    for (const name of ["q", "register", "channel", "status"]) {
      const value = String(form.get(name) ?? "").trim();
      if (value) next.set(name, value);
    }
    setSearchParams(next, { replace: true });
  };

  return (
    <>
      <p className="mb-2">
        <Link to="/curriculum" className="font-medium text-cobalt underline">
          Curriculum
        </Link>
      </p>
      <PageHeader
        zh="口语"
        en="Colloquial expressions"
        summary="Everyday and slang expressions, each with who you can say it to and where it belongs."
      />

      <p className="mb-6 border-l-4 border-cobalt bg-wash px-4 py-3">
        <span className="font-semibold">Not part of the HSK syllabus.</span> These expressions have
        no HSK level and are never counted in HSK coverage or progress.
      </p>

      <AsyncStatus
        isPending={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        label="colloquial expressions"
      >
        {synthetic ? (
          <p className="mb-6 border-l-4 border-seal bg-seal-wash px-4 py-3">
            <span className="font-semibold">Test data, not real expressions.</span> These are
            generated placeholders for development.
          </p>
        ) : null}

        {!imported ? (
          <div className="border-l-4 border-line bg-wash px-4 py-3">
            <p className="font-semibold">No colloquial expressions imported</p>
            <p className="mt-1">
              This track is optional. To add it, download the dataset file from{" "}
              <ExternalLink href="https://hearmandarin.com/datasets/chinese-slang/">
                hearmandarin.com/datasets/chinese-slang
              </ExternalLink>{" "}
              (CC BY 4.0) and run <code>pnpm colloquial:import --file &lt;path&gt;</code>. The README
              has the steps.
            </p>
          </div>
        ) : (
          <>
            {/* The key resets the fields when filters change through the URL. */}
            <form
              key={`${q}|${register}|${channel}|${status}`}
              onSubmit={applyFilters}
              role="search"
              aria-label="Filter colloquial expressions"
              className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto] lg:items-end"
            >
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Term, pinyin or meaning</span>
                <input
                  name="q"
                  type="search"
                  defaultValue={q}
                  maxLength={40}
                  autoComplete="off"
                  className="min-h-11 w-full rounded-md border border-mist bg-glaze px-3"
                />
              </label>
              <Select name="register" label="Who it suits" value={register} options={COLLOQUIAL_REGISTERS} labels={REGISTER_LABELS} />
              <Select name="channel" label="Spoken or typed" value={channel} options={COLLOQUIAL_CHANNELS} labels={CHANNEL_LABELS} />
              <Select name="status" label="How current" value={status} options={CURRENCY_STATUSES} labels={CURRENCY_LABELS} />
              <button
                type="submit"
                className="min-h-11 rounded-md bg-cobalt px-5 font-semibold text-glaze hover:bg-cobalt-deep"
              >
                Filter
              </button>
            </form>

            <p role="status" className="mb-2 text-mist">
              {total === 0
                ? "No expressions match these filters."
                : `${total} ${total === 1 ? "expression" : "expressions"}${filtered ? (total === 1 ? " matches" : " match") : ""}, showing ${items.length}.`}{" "}
              {filtered ? (
                <Link to="/curriculum/colloquial" replace className="font-medium text-cobalt underline">
                  Clear filters
                </Link>
              ) : null}
            </p>

            <ul className="border-t border-line">
              {items.map((item) => (
                <ExpressionCard key={item.id} item={item} />
              ))}
            </ul>

            {list.hasNextPage ? (
              <button
                type="button"
                onClick={() => void list.fetchNextPage()}
                disabled={list.isFetchingNextPage}
                className="mt-6 min-h-11 w-full rounded-md border border-cobalt px-5 font-semibold text-cobalt hover:bg-wash disabled:opacity-60 sm:w-auto"
              >
                {list.isFetchingNextPage ? "Loading more…" : "Show more expressions"}
              </button>
            ) : null}
            {list.isFetchNextPageError ? (
              <p role="alert" className="mt-3 text-seal">
                Couldn't load more expressions. Try again.
              </p>
            ) : null}

            <div className="mt-8">
              <Credits sources={sources} />
            </div>
          </>
        )}
      </AsyncStatus>
    </>
  );
}
