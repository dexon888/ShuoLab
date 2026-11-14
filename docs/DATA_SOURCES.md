# Data sources and rights

Nothing in this repository is HSK syllabus content. Test fixtures are
synthetic and say so.

## HSK 3.0 vocabulary

- **Edition:** November 2025 *HSK Examination Syllabus*, id `hsk3-2025-11`.
- **Publisher portal:** <https://www.chinesetest.cn/HSK>
- **Import-friendly transcription:** <https://github.com/uranbekanarbaev/hsk-3.0-vocabulary-dataset>
  — an independent transcription, not the official publisher.
- **Expected totals** (numbered entries first introduced per band):
  300, 200, 500, 1,000, 1,600, 1,800, and 5,600 for the shared 7–9 band;
  11,000 in all. Encoded in `src/shared/curriculum.ts`.

A public repository being readable does not grant the right to republish the
syllabus. The owner downloads the data and imports it locally from
`private-data/`, which is git-ignored. The importer records the source
URL, pinned commit, SHA-256, rights note and import time for each file.

English glosses are not part of the syllabus. A missing definition is normal;
any definition added later carries its own provenance.

## Grammar, characters, topics, tasks

Not imported. Candidate: <https://github.com/profesorm/hsk30>, treated as an
unverified secondary transcription until checked. The app shows these sections
as "Not imported" and never counts them toward coverage.

## Colloquial expressions (Phase 1, separate from HSK)

Candidate: <https://hearmandarin.com/datasets/chinese-slang/> — 185
expressions, CC BY 4.0, credit "HearMandarin". The licence covers the dataset
terms only, not the site's examples or audio.

## Software licences

Dependencies are listed in `package.json` with exact versions; their licences
are in `node_modules/<package>/LICENSE`.
