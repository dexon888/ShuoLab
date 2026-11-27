import { Link } from "react-router";
import type { CurriculumStatusResponse, DimensionStatus } from "../../shared/api";
import type { ItemType } from "../../shared/curriculum";
import { AsyncStatus } from "../components/AsyncStatus";
import { CurriculumImportNotice } from "../components/CurriculumImportNotice";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { useCurriculumStatus } from "../hooks/queries";

const numberFormat = new Intl.NumberFormat("en-US");

const DIMENSION_NAMES: Record<ItemType, string> = {
  vocab: "Vocabulary",
  grammar: "Grammar",
  character: "Characters",
  topic: "Topics",
  task: "Tasks",
};

const DIMENSION_STATUS_LABELS: Record<DimensionStatus, string> = {
  missing: "Not imported",
  imported: "Imported, not verified",
  verified: "Verified",
};

function bandName(band: string): string {
  return band === "7-9" ? "HSK 7–9 (shared band)" : `HSK ${band}`;
}

function BandTable({ status }: { status: CurriculumStatusResponse }) {
  // A table that scrolls sideways must be reachable by keyboard (axe scrollable-region-focusable).
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Imported entries per band">
      <table className="w-full border-collapse text-left tabular-nums">
        <caption className="mb-2 text-left text-sm text-mist">
          Numbered syllabus entries first introduced at each band. Homographs count separately.
          Choose a band to browse its entries.
        </caption>
        <thead>
          <tr className="border-b border-ink text-sm">
            <th scope="col" className="py-2 pr-3 font-semibold">
              Band
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-semibold">
              Imported
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-semibold">
              New in syllabus
            </th>
            <th scope="col" className="py-2 text-right font-semibold">
              Cumulative
            </th>
          </tr>
        </thead>
        <tbody>
          {status.vocabByBand.map((row) => (
            <tr key={row.band} className="border-b border-line">
              <th scope="row" className="py-2 pr-3 font-medium">
                <Link to={`/curriculum/${row.band}`} className="text-cobalt underline">
                  {bandName(row.band)}
                </Link>
              </th>
              <td className="py-2 pr-3 text-right">{numberFormat.format(row.importedNew)}</td>
              <td className="py-2 pr-3 text-right">{numberFormat.format(row.expectedNew)}</td>
              <td className="py-2 text-right">{numberFormat.format(row.expectedCumulative)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DimensionList({ status }: { status: CurriculumStatusResponse }) {
  const synthetic = status.activeEdition?.synthetic ?? false;
  return (
    <ul className="divide-y divide-line">
      {status.dimensions.map((dimension) => (
        <li key={dimension.itemType} className="flex flex-wrap justify-between gap-x-4 py-2">
          <span className="font-medium">
            {dimension.importedCount > 0 ? (
              <Link
                to={dimension.itemType === "vocab" ? "/curriculum/1" : `/curriculum/1?type=${dimension.itemType}`}
                className="text-cobalt underline"
              >
                {DIMENSION_NAMES[dimension.itemType]}
              </Link>
            ) : (
              DIMENSION_NAMES[dimension.itemType]
            )}
          </span>
          <span
            className={dimension.status === "verified" && !synthetic ? "text-jade" : "text-mist"}
          >
            {/* Placeholder data can be complete, but it is never "verified" HSK content. */}
            {synthetic && dimension.status !== "missing"
              ? "Test data"
              : DIMENSION_STATUS_LABELS[dimension.status]}
            {dimension.importedCount > 0 ? `, ${numberFormat.format(dimension.importedCount)} rows` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SourceList({ status }: { status: CurriculumStatusResponse }) {
  if (status.manifests.length === 0) {
    return <p className="text-mist">No source files have been imported.</p>;
  }
  return (
    <ul className="space-y-3">
      {status.manifests.map((manifest) => (
        <li key={`${manifest.datasetKind}-${manifest.sha256}`}>
          <p className="font-medium">
            {manifest.datasetKind === "vocab-crosscheck"
              ? "Vocabulary file used only to check the edition"
              : `${DIMENSION_NAMES[manifest.datasetKind as ItemType] ?? manifest.datasetKind} file`}
            {manifest.verificationStatus === "unverified" ? <span className="font-normal text-mist">, not verified</span> : null}
          </p>
          <p className="text-sm text-mist">
            {numberFormat.format(manifest.recordCount)} rows from <code>{manifest.sourceUrl}</code>
            {manifest.commitSha ? (
              <>
                {" "}
                at commit <code>{manifest.commitSha.slice(0, 12)}</code>
              </>
            ) : null}
            , imported {manifest.importedAt.slice(0, 10)}. {manifest.rightsNote}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function CurriculumPage() {
  const curriculum = useCurriculumStatus();

  return (
    <>
      <PageHeader
        zh="课程"
        en="Curriculum"
        summary="The November 2025 HSK 3.0 syllabus, imported from your own copy of the source data."
      />
      <AsyncStatus
        isPending={curriculum.isPending}
        error={curriculum.error}
        onRetry={() => void curriculum.refetch()}
        label="curriculum status"
      >
        {curriculum.data ? (
          <>
            <div className="mb-6">
              <CurriculumImportNotice status={curriculum.data} />
            </div>
            <Section title="Vocabulary by band">
              <BandTable status={curriculum.data} />
            </Section>
            <Section title="Syllabus sections">
              <DimensionList status={curriculum.data} />
              <p className="mt-3 text-sm text-mist">
                A section counts toward HSK coverage only after its data is imported and verified.
              </p>
              {curriculum.data.dimensions.some((d) => d.itemType !== "vocab" && d.status === "imported") &&
              !curriculum.data.activeEdition?.synthetic ? (
                <p className="mt-2 text-sm text-mist">
                  Grammar, characters, topics and tasks come from a second-hand transcription of the syllabus, credited
                  under Sources. Its vocabulary matched this edition entry for entry, but the sections themselves have
                  not been checked against the official document.
                </p>
              ) : null}
            </Section>
            <Section title="Outside the syllabus">
              <p>
                <Link to="/curriculum/colloquial" className="font-medium text-cobalt underline">
                  Colloquial expressions
                </Link>
              </p>
              <p className="mt-1 text-mist">
                Everyday and slang expressions with register and context notes. A separate track:
                not HSK content, and never counted in the numbers above.
              </p>
            </Section>
            <Section title="Sources">
              <SourceList status={curriculum.data} />
            </Section>
          </>
        ) : null}
      </AsyncStatus>
    </>
  );
}
