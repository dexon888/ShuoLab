import type { FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { CurriculumItemSummary } from "../../shared/api";
import { isHskBand, type HskBand } from "../../shared/curriculum";
import { AsyncStatus } from "../components/AsyncStatus";
import { PageHeader } from "../components/PageHeader";
import { SyntheticDataNotice } from "../components/SyntheticDataNotice";
import { useCurriculumFacets, useCurriculumItems } from "../hooks/queries";
import { NotFoundPage } from "./NotFoundPage";

const numberFormat = new Intl.NumberFormat("en-US");

function bandTitle(band: HskBand): string {
  return band === "7-9" ? "HSK 7–9" : `HSK ${band}`;
}

function EntryRow({ item }: { item: CurriculumItemSummary }) {
  return (
    <li>
      <Link
        to={`/curriculum/item/${encodeURIComponent(item.id)}`}
        className="flex min-h-14 items-baseline gap-x-4 gap-y-1 border-b border-line py-3 hover:bg-wash"
      >
        <span className="w-12 shrink-0 text-right text-sm tabular-nums text-mist">{item.sourceId}</span>
        <span className="min-w-0 flex-1">
          <span lang="zh-Hans" className="text-2xl leading-tight">
            {item.hanzi}
          </span>
          {item.homograph ? (
            <span className="ml-2 text-sm text-mist">form {item.homograph}</span>
          ) : null}
          <span className="block text-mist">{item.pinyin}</span>
        </span>
        {item.partOfSpeech ? (
          <span lang="zh-Hans" className="shrink-0 text-sm text-mist">
            {item.partOfSpeech}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function BandEntries({ band }: { band: HskBand }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const pos = searchParams.get("pos") ?? "";
  const filtered = q !== "" || pos !== "";

  const items = useCurriculumItems({ band, q, pos });
  const facets = useCurriculumFacets(band);

  const first = items.data?.pages[0];
  const entries = items.data?.pages.flatMap((page) => page.items) ?? [];
  const total = first?.total ?? 0;

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    const nextQ = String(form.get("q") ?? "").trim();
    const nextPos = String(form.get("pos") ?? "");
    if (nextQ) next.set("q", nextQ);
    if (nextPos) next.set("pos", nextPos);
    setSearchParams(next, { replace: true });
  };

  return (
    <>
      {/* The key resets the fields when filters change through the URL (back, Clear). */}
      <form
        key={`${q}|${pos}`}
        onSubmit={applyFilters}
        role="search"
        aria-label={`Filter ${bandTitle(band)} entries`}
        className="mb-6 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
      >
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Characters or pinyin</span>
          <input
            name="q"
            type="search"
            defaultValue={q}
            maxLength={40}
            autoComplete="off"
            className="min-h-11 w-full rounded-md border border-mist bg-glaze px-3"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Part of speech</span>
          <select
            name="pos"
            defaultValue={pos}
            className="min-h-11 w-full rounded-md border border-mist bg-glaze px-3"
          >
            <option value="">Any</option>
            {(facets.data?.partsOfSpeech ?? []).map((facet) => (
              <option key={facet.tag} value={facet.tag} lang="zh-Hans">
                {facet.tag} ({numberFormat.format(facet.count)})
              </option>
            ))}
            {/* Keeps a filter from the URL selectable before the list has loaded. */}
            {pos && !facets.data?.partsOfSpeech.some((f) => f.tag === pos) ? (
              <option value={pos}>{pos}</option>
            ) : null}
          </select>
        </label>
        <button
          type="submit"
          className="min-h-11 rounded-md bg-cobalt px-5 font-semibold text-glaze hover:bg-cobalt-deep"
        >
          Filter
        </button>
      </form>

      <AsyncStatus
        isPending={items.isPending}
        error={items.error}
        onRetry={() => void items.refetch()}
        label="entries"
      >
        {first?.synthetic ? (
          <div className="mb-4">
            <SyntheticDataNotice />
          </div>
        ) : null}

        <p role="status" className="mb-2 text-mist">
          {total === 0
            ? filtered
              ? "No entries match these filters."
              : "No entries are imported for this band."
            : `${numberFormat.format(total)} ${total === 1 ? "entry" : "entries"}${filtered ? (total === 1 ? " matches" : " match") : ""}, showing ${numberFormat.format(entries.length)}.`}{" "}
          {filtered ? (
            <Link to={`/curriculum/${band}`} replace className="font-medium text-cobalt underline">
              Clear filters
            </Link>
          ) : null}
        </p>

        {total === 0 && !filtered ? (
          <p>
            <Link to="/curriculum" className="font-medium text-cobalt underline">
              See what is imported and how to import the vocabulary
            </Link>
          </p>
        ) : null}

        <ul className="border-t border-line">
          {entries.map((item) => (
            <EntryRow key={item.id} item={item} />
          ))}
        </ul>

        {items.hasNextPage ? (
          <button
            type="button"
            onClick={() => void items.fetchNextPage()}
            disabled={items.isFetchingNextPage}
            className="mt-6 min-h-11 w-full rounded-md border border-cobalt px-5 font-semibold text-cobalt hover:bg-wash disabled:opacity-60 sm:w-auto"
          >
            {items.isFetchingNextPage ? "Loading more…" : "Show more entries"}
          </button>
        ) : null}
        {items.isFetchNextPageError ? (
          <p role="alert" className="mt-3 text-seal">
            Couldn't load more entries. Try again.
          </p>
        ) : null}
      </AsyncStatus>
    </>
  );
}

export function CurriculumBandPage() {
  const { band } = useParams();
  if (!isHskBand(band)) {
    return <NotFoundPage />;
  }
  return (
    <>
      <p className="mb-2">
        <Link to="/curriculum" className="font-medium text-cobalt underline">
          All bands
        </Link>
      </p>
      <PageHeader
        zh="课程"
        en={bandTitle(band)}
        summary={
          band === "7-9"
            ? "Entries first introduced in the shared HSK 7–9 band, in syllabus order."
            : `Entries first introduced at HSK ${band}, in syllabus order.`
        }
      />
      <BandEntries key={band} band={band} />
    </>
  );
}
