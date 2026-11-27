import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import type { CurriculumItemDetailResponse } from "../../shared/api";
import { parseCurriculumItemId } from "../../shared/curriculum";
import { SECTION_NAMES, type ItemDetails } from "../../shared/sections";
import { AsyncStatus } from "../components/AsyncStatus";
import { Section } from "../components/Section";
import { FlagControl } from "../components/TaskCheck";
import { SyntheticDataNotice } from "../components/SyntheticDataNotice";
import { useCurriculumItem } from "../hooks/queries";
import { NotFoundPage } from "./NotFoundPage";

function bandName(band: string): string {
  return band === "7-9" ? "HSK 7–9 (shared band)" : `HSK ${band}`;
}

const SKILL_LABELS = { listening: "Listening", speaking: "Speaking", reading: "Reading", writing: "Writing" } as const;

const SKILL_STATE_TEXT = {
  unseen: "Not met",
  introduced: "Met, not yet reviewed",
  practiced: "Practised, not yet recalled",
  developing: "Developing",
  mastered: "Mastered",
} as const;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-6 border-b border-line py-2">
      <dt className="text-mist">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function SourceLink({ url }: { url: string }) {
  // Only real web addresses become links; anything else is shown as text.
  return /^https:\/\//.test(url) ? (
    <a href={url} rel="noreferrer noopener" target="_blank" className="text-cobalt underline">
      {url}
    </a>
  ) : (
    <code>{url}</code>
  );
}

/** Grammar, character, topic and task details (sections-v1). */
function SectionDetails({ details }: { details: ItemDetails | null }) {
  if (!details) return <p className="text-mist">No details were imported for this item.</p>;
  switch (details.kind) {
    case "grammar":
      return (
        <>
          <dl className="border-t border-line">
            <Fact label="Kind">
              <span lang="zh-Hans">{details.grammarType}</span>
            </Fact>
            {details.category ? (
              <Fact label="Category">
                <span lang="zh-Hans">{details.category}</span>
              </Fact>
            ) : null}
            {details.detail ? (
              <Fact label="Detail">
                <span lang="zh-Hans">{details.detail}</span>
              </Fact>
            ) : null}
          </dl>
          <h3 className="mt-5 font-semibold">Examples from the syllabus</h3>
          <ul className="mt-2 space-y-2">
            {details.examples.map((example) => (
              <li key={example} lang="zh-Hans" className="border-l-4 border-line pl-3 text-lg">
                {example}
              </li>
            ))}
          </ul>
        </>
      );
    case "character":
      return (
        <p>
          {details.skill === "writing"
            ? "On the syllabus list of characters to write by hand at this band."
            : "On the syllabus list of characters to recognise at this band."}
        </p>
      );
    case "topic":
      return (
        <dl className="border-t border-line">
          <Fact label="Area">
            <span lang="zh-Hans">{details.area}</span>
          </Fact>
          <Fact label="Subject">
            <span lang="zh-Hans">{details.subject}</span>
          </Fact>
          <Fact label="Covers">
            <span lang="zh-Hans">{details.details}</span>
          </Fact>
        </dl>
      );
    case "task":
      return (
        <>
          <p className="text-mist">What you should be able to do:</p>
          <p lang="zh-Hans" className="mt-2 text-lg">
            {details.canDo}
          </p>
        </>
      );
  }
}

function ItemDetail({ data }: { data: CurriculumItemDetailResponse }) {
  const { item, edition, homographs, sources } = data;
  const vocab = item.itemType === "vocab";
  const names = SECTION_NAMES[item.itemType];
  return (
    <article>
      <p className="mb-2">
        <Link
          to={vocab ? `/curriculum/${item.hskBand}` : `/curriculum/${item.hskBand}?type=${item.itemType}`}
          className="font-medium text-cobalt underline"
        >
          {bandName(item.hskBand)}
          {vocab ? "" : `: ${names.many}`}
        </Link>
      </p>

      <header className="mb-6">
        {vocab ? null : <p className="mb-1 text-sm font-medium uppercase tracking-wide text-mist">{names.one}</p>}
        <h1 lang="zh-Hans" className={vocab || item.itemType === "character" ? "font-kai text-title text-cobalt-deep" : "text-2xl font-semibold text-cobalt-deep"}>
          {item.hanzi}
        </h1>
        {vocab ? (
          <>
            <p className="mt-2 text-xl">{item.pinyin}</p>
            <p className="text-sm text-mist">Pinyin as printed in the syllabus</p>
          </>
        ) : (
          <p className="mt-3 border-l-4 border-line bg-wash px-4 py-3">
            From a second-hand transcription of the syllabus, not checked against the official document. It is not
            counted as verified HSK coverage.
          </p>
        )}
      </header>

      {edition.synthetic ? (
        <div className="mb-6">
          <SyntheticDataNotice />
        </div>
      ) : null}
      {!edition.isActive ? (
        <p className="mb-6 border-l-4 border-line bg-wash px-4 py-3">
          This entry belongs to edition {edition.id}, which is not the active edition.
        </p>
      ) : null}

      <dl className="border-t border-line">
        <Fact label="First introduced at">{bandName(item.hskBand)}</Fact>
        {item.levelLabel && item.levelLabel !== item.hskBand ? (
          <Fact label="Level label in the syllabus">
            <span lang="zh-Hans">{item.levelLabel}</span>
          </Fact>
        ) : null}
        {vocab ? (
          <Fact label="Part of speech">
            {item.partOfSpeech ? <span lang="zh-Hans">{item.partOfSpeech}</span> : "Not given"}
          </Fact>
        ) : null}
        {item.entryRaw && item.entryRaw !== item.hanzi ? (
          <Fact label="Entry as printed">
            <span lang="zh-Hans">{item.entryRaw}</span>
          </Fact>
        ) : null}
        <Fact label={vocab ? "Entry number" : "Row in the source file"}>{item.sourceId}</Fact>
      </dl>

      <div className="mt-8">
        {!vocab ? (
          <Section title="Details">
            <SectionDetails details={item.details} />
            <div className="mt-4">
              <FlagControl itemId={item.id} flag={item.flag} />
            </div>
          </Section>
        ) : null}
        {vocab ? (
        <Section title="Meaning">
          {item.definition ? (
            <>
              <p>{item.definition}</p>
              <p className="mt-1 text-sm text-mist">
                Source: {item.definitionProvenance ?? "not recorded"}. This gloss is not part of
                the HSK syllabus.
              </p>
            </>
          ) : (
            <p className="text-mist">
              No definition. The HSK syllabus lists entries without English meanings, and ShuoLab
              does not invent them.
            </p>
          )}
        </Section>
        ) : null}

        {vocab && homographs.length > 0 ? (
          <Section title="Same written form">
            <p className="mb-2 text-mist">
              The syllabus numbers these separately. They are different entries, not duplicates.
            </p>
            <ul>
              {homographs.map((other) => (
                <li key={other.id} className="border-b border-line">
                  <Link
                    to={`/curriculum/item/${encodeURIComponent(other.id)}`}
                    className="flex min-h-11 flex-wrap items-baseline gap-x-3 py-2 hover:bg-wash"
                  >
                    <span lang="zh-Hans" className="text-xl">
                      {other.hanzi}
                    </span>
                    {other.homograph ? <span className="text-sm text-mist">form {other.homograph}</span> : null}
                    <span className="text-mist">{other.pinyin}</span>
                    <span className="ml-auto text-sm text-mist">
                      {bandName(other.hskBand)}, entry {other.sourceId}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section title="Your practice">
          <dl>
            {data.progress.bySkill.map((p) => (
              <Fact key={p.skill} label={SKILL_LABELS[p.skill]}>
                {SKILL_STATE_TEXT[p.state]}
                {p.successDays > 0 || p.failureCount > 0 ? (
                  <span className="block text-sm font-normal text-mist">
                    Recalled on {p.successDays} day{p.successDays === 1 ? "" : "s"}, missed {p.failureCount} time{p.failureCount === 1 ? "" : "s"}
                  </span>
                ) : null}
              </Fact>
            ))}
          </dl>
          <p className="mt-3 text-sm text-mist">
            From your session targets and review ratings only. Mastered means recalled on three different days, at least
            once a day or more after you met the word, with the latest recall a success: this app's rule, not an HSK
            standard. Speaking and writing have no review cards yet.
          </p>
        </Section>

        <Section title="Source">
          <dl>
            <Fact label="Edition">{edition.id}</Fact>
            <Fact label="Publisher">{edition.publisher}</Fact>
            {item.sourcePdfPage ? (
              <Fact label="Page in the syllabus PDF">{item.sourcePdfPage}</Fact>
            ) : null}
          </dl>
          {sources.length === 0 ? (
            <p className="mt-3 text-mist">No source file is recorded for this entry.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {sources.map((source) => (
                <li key={`${source.sourceUrl}@${source.commitSha ?? ""}`} className="text-sm">
                  <p>
                    Transcribed data from <SourceLink url={source.sourceUrl} />
                    {source.commitSha ? (
                      <>
                        {" "}
                        at commit <code>{source.commitSha.slice(0, 12)}</code>
                      </>
                    ) : null}
                    , imported {source.importedAt.slice(0, 10)}.
                  </p>
                  <p className="mt-1 text-mist">{source.rightsNote}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </article>
  );
}

function ItemLoader({ id }: { id: string }) {
  const item = useCurriculumItem(id);
  return (
    <AsyncStatus
      isPending={item.isPending}
      error={item.error}
      onRetry={() => void item.refetch()}
      label="this entry"
    >
      {item.data ? <ItemDetail data={item.data} /> : null}
    </AsyncStatus>
  );
}

export function CurriculumItemPage() {
  const { itemId = "" } = useParams();
  if (!parseCurriculumItemId(itemId)) {
    return <NotFoundPage />;
  }
  return <ItemLoader key={itemId} id={itemId} />;
}
