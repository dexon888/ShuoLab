import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import type { CurriculumItemDetailResponse } from "../../shared/api";
import { parseCurriculumItemId } from "../../shared/curriculum";
import { AsyncStatus } from "../components/AsyncStatus";
import { Section } from "../components/Section";
import { SyntheticDataNotice } from "../components/SyntheticDataNotice";
import { useCurriculumItem } from "../hooks/queries";
import { NotFoundPage } from "./NotFoundPage";

function bandName(band: string): string {
  return band === "7-9" ? "HSK 7–9 (shared band)" : `HSK ${band}`;
}

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

function ItemDetail({ data }: { data: CurriculumItemDetailResponse }) {
  const { item, edition, homographs, sources } = data;
  return (
    <article>
      <p className="mb-2">
        <Link to={`/curriculum/${item.hskBand}`} className="font-medium text-cobalt underline">
          {bandName(item.hskBand)}
        </Link>
      </p>

      <header className="mb-6">
        <h1 lang="zh-Hans" className="font-kai text-title text-cobalt-deep">
          {item.hanzi}
        </h1>
        <p className="mt-2 text-xl">{item.pinyin}</p>
        <p className="text-sm text-mist">Pinyin as printed in the syllabus</p>
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
        <Fact label="Part of speech">
          {item.partOfSpeech ? <span lang="zh-Hans">{item.partOfSpeech}</span> : "Not given"}
        </Fact>
        {item.entryRaw && item.entryRaw !== item.hanzi ? (
          <Fact label="Entry as printed">
            <span lang="zh-Hans">{item.entryRaw}</span>
          </Fact>
        ) : null}
        <Fact label="Entry number">{item.sourceId}</Fact>
      </dl>

      <div className="mt-8">
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

        {homographs.length > 0 ? (
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
          <p className="text-mist">
            Nothing recorded. Practice evidence for each skill starts with sessions and review,
            which are not built yet.
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
