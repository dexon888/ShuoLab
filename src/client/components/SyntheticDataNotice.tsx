/** Shown wherever generated placeholder entries appear, so they are never read as HSK content. */
export function SyntheticDataNotice() {
  return (
    <p className="border-l-4 border-seal bg-seal-wash px-4 py-3">
      <span className="font-semibold">Test data, not HSK content.</span> These are generated
      placeholder entries for development, not words from the HSK syllabus.
    </p>
  );
}
