import type { FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { CurriculumItemSummary } from "../../shared/api";
import { ITEM_TYPES, isHskBand, type HskBand, type ItemType } from "../../shared/curriculum";
import { MASTERY_STATES, type MasteryState } from "../../shared/learning";
import { SECTION_NAMES } from "../../shared/sections";
import { AsyncStatus } from "../components/AsyncStatus";
import { PageHeader } from "../components/PageHeader";
import { SyntheticDataNotice } from "../components/SyntheticDataNotice";
import { useCurriculumFacets, useCurriculumItems } from "../hooks/queries";
import { NotFoundPage } from "./NotFoundPage";

const numberFormat = new Intl.NumberFormat("en-US");

function bandTitle(band: HskBand): string {
  return band === "7-9" ? "HSK 7–9" : `HSK ${band}`;
}

/** Words for an entry's most advanced state across skills. */
export const STATE_LABELS: Readonly<Record<MasteryState, string>> = {
  unseen: "Not met",
  introduced: "Met",
  practiced: "Practised",
  developing: "Developing",
  mastered: "Mastered",
};

function isState(value: string): value is MasteryState {
  return (MASTERY_STATES as readonly string[]).includes(value);
}

function isSection(value: string): value is ItemType {
  return (ITEM_TYPES as readonly string[]).includes(value);
}

/** Links between the five syllabus sections of one band. */
function SectionTabs({ band, current }: { band: HskBand; current: ItemType }) {
  return (
    <nav aria-label="Syllabus sections" className="mb-6 flex flex-wrap gap-2">
      {ITEM_TYPES.map((type) => (
        <Link
          key={type}
          to={type === "vocab" ? `/curriculum/${band}` : `/curriculum/${band}?type=${type}`}
          aria-current={type === current ? "page" : undefined}
          className={`flex min-h-11 items-center rounded-md border px-4 font-medium ${
            type === current ? "border-cobalt bg-cobalt text-glaze" : "border-line text-cobalt hover:bg-wash"
          }`}
        >
          <span lang="zh-Hans" className="mr-1">
            {SECTION_NAMES[type].zh}
          </span>
          {SECTION_NAMES[type].many}
        </Link>
      ))}
    </nav>
  );
}

function SectionRow({ item }: { item: CurriculumItemSummary }) {
  return (
    <li>
      <Link
        to={`/curriculum/item/${encodeURIComponent(item.id)}`}
        className="flex min-h-14 items-baseline gap-x-4 gap-y-1 border-b border-line py-3 hover:bg-wash"
      >
        <span className="w-12 shrink-0 text-right text-sm tabular-nums text-mist">{item.sourceId}</span>
        <span className="min-w-0 flex-1">
          <span lang="zh-Hans" className={item.itemType === "character" ? "text-2xl leading-tight" : "text-lg leading-snug"}>
            {item.hanzi}
          </span>
          {item.note ? (
            <span lang="zh-Hans" className="block text-mist">
              {item.note}
            </span>
          ) : null}
        </span>
        {item.state !== "unseen" ? (
          <span className="shrink-0 text-right text-sm font-medium text-cobalt-deep">{STATE_LABELS[item.state]}</span>
        ) : null}
      </Link>
    </li>
  );
}

function EntryRow({ item }: { item: CurriculumItemSummary }) {
  if (item.itemType !== "vocab") return <SectionRow item={item} />;
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
        <span className="shrink-0 text-right text-sm">
          {item.partOfSpeech ? (
            <span lang="zh-Hans" className="block text-mist">
              {item.partOfSpeech}
            </span>
          ) : null}
          {item.state !== "unseen" ? <span className="block font-medium text-cobalt-deep">{STATE_LABELS[item.state]}</span> : null}
        </span>
      </Link>
    </li>
  );
}

function BandEntries({ band }: { band: HskBand }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const pos = searchParams.get("pos") ?? "";
  const rawState = searchParams.get("state") ?? "";
  const state = isState(rawState) ? rawState : "";
  const rawType = searchParams.get("type") ?? "vocab";
  const type: ItemType = isSection(rawType) ? rawType : "vocab";
  const vocab = type === "vocab";
  const filtered = q !== "" || (vocab && pos !== "") || state !== "";
  const noun = SECTION_NAMES[type];
  const plural = vocab ? "entries" : `${noun.one}s`;
  const baseUrl = vocab ? `/curriculum/${band}` : `/curriculum/${band}?type=${type}`;

  const items = useCurriculumItems({ band, q, pos: vocab ? pos : "", state, type });
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
    const nextState = String(form.get("state") ?? "");
    if (nextQ) next.set("q", nextQ);
    if (nextPos) next.set("pos", nextPos);
    if (nextState) next.set("state", nextState);
    if (!vocab) next.set("type", type);
    setSearchParams(next, { replace: true });
  };

  return (
    <>
      <SectionTabs band={band} current={type} />
      {!vocab ? (
        <p className="mb-6 border-l-4 border-line bg-wash px-4 py-3">
          From a second-hand transcription of the syllabus (CC BY 4.0), not checked against the official document.{" "}
          <Link to="/curriculum" className="font-medium text-cobalt underline">
            Sources
          </Link>
        </p>
      ) : null}
      {/* The key resets the fields when filters change through the URL (back, Clear). */}
      <form
        key={`${type}|${q}|${pos}|${state}`}
        onSubmit={applyFilters}
        role="search"
        aria-label={`Filter ${bandTitle(band)} ${vocab ? "entries" : noun.many.toLowerCase()}`}
        className={`mb-6 grid gap-3 sm:items-end ${vocab ? "sm:grid-cols-[1fr_auto_auto_auto]" : "sm:grid-cols-[1fr_auto_auto]"}`}
      >
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{vocab ? "Characters or pinyin" : "Search"}</span>
          <input
            name="q"
            type="search"
            defaultValue={q}
            maxLength={40}
            autoComplete="off"
            className="min-h-11 w-full rounded-md border border-mist bg-glaze px-3"
          />
        </label>
        {vocab ? (
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
        ) : null}
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Your progress</span>
          <select name="state" defaultValue={state} className="min-h-11 w-full rounded-md border border-mist bg-glaze px-3">
            <option value="">Any</option>
            {MASTERY_STATES.map((s) => (
              <option key={s} value={s}>
                {STATE_LABELS[s]}
              </option>
            ))}
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
              ? `No ${plural} match these filters.`
              : `No ${plural} are imported for this band.`
            : `${numberFormat.format(total)} ${total === 1 ? (vocab ? "entry" : noun.one) : plural}${filtered ? (total === 1 ? " matches" : " match") : ""}, showing ${numberFormat.format(entries.length)}.`}{" "}
          {filtered ? (
            <Link to={baseUrl} replace className="font-medium text-cobalt underline">
              Clear filters
            </Link>
          ) : null}
        </p>

        {total === 0 && !filtered ? (
          <p>
            <Link to="/curriculum" className="font-medium text-cobalt underline">
              See what is imported and how to import it
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
            {items.isFetchingNextPage ? "Loading more…" : `Show more ${plural}`}
          </button>
        ) : null}
        {items.isFetchNextPageError ? (
          <p role="alert" className="mt-3 text-seal">
            Couldn't load more {plural}. Try again.
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
            ? "What the syllabus first introduces in the shared HSK 7–9 band, in syllabus order."
            : `What the syllabus first introduces at HSK ${band}, in syllabus order.`
        }
      />
      <BandEntries key={band} band={band} />
    </>
  );
}
