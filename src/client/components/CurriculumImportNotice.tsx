import type { CurriculumStatusResponse } from "../../shared/api";
import { VOCAB_TOTAL_ENTRIES } from "../../shared/curriculum";

const numberFormat = new Intl.NumberFormat("en-US");

/**
 * Says plainly whether real HSK vocabulary has been imported. Shown instead of
 * any percentage until the import is complete and verified (SPEC §5.1, FR-005).
 */
export function CurriculumImportNotice({ status }: { status: CurriculumStatusResponse }) {
  const vocab = status.dimensions.find((d) => d.itemType === "vocab");
  if (vocab?.status === "verified") {
    return (
      <p className="border-l-4 border-jade bg-jade-wash px-4 py-3">
        <span className="font-semibold">Vocabulary verified.</span>{" "}
        {numberFormat.format(vocab.importedCount)} numbered entries imported from edition{" "}
        {status.activeEdition?.id}.
      </p>
    );
  }

  const imported = vocab?.importedCount ?? 0;
  return (
    <div className="border-l-4 border-seal bg-seal-wash px-4 py-3">
      <p className="font-semibold">
        {imported === 0 ? "Curriculum not imported" : "Curriculum import is incomplete"}
      </p>
      <p className="mt-1">
        {imported === 0
          ? "No HSK vocabulary has been imported, so there is no HSK progress to show yet."
          : `${numberFormat.format(imported)} of ${numberFormat.format(VOCAB_TOTAL_ENTRIES)} numbered entries are present. HSK progress stays hidden until all of them pass the integrity checks.`}
      </p>
      <p className="mt-2 text-mist">
        ShuoLab only uses the real November 2025 HSK 3.0 syllabus list, which you import from your
        own copy. The import tool is the next part of the build (Phase 1).
      </p>
    </div>
  );
}
