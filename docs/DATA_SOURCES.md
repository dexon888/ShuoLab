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

Source: <https://hearmandarin.com/datasets/chinese-slang/> — 185 expressions
(dataset version 2026-09-09 as read on 2026-11-14), CC BY 4.0, credit
"HearMandarin (https://hearmandarin.com)". The licence covers the dataset's
terms and tags only, not the site's example sentences or audio, which are
never imported.

The owner downloads the file and runs `pnpm colloquial:import`; the app does
not fetch it. Fields: `slug, term, pinyin, category, register, channel, since,
status, checked, literal_en, real_en, url`. The dataset page's prose lists
category and channel values that differ from the file; the importer follows
the file (channel `both` or `typed`; category stored as given). Register
mapping: `anyone` → `neutral`, `casual` → `casual`, `mates` →
`very_informal`. The dataset has no region field, so `region` stays empty.

Not yet run on the real file: the importer is tested on generated rows in the
same shape.

## Software licences

Dependencies are listed in `package.json` with exact versions; their licences
are in `node_modules/<package>/LICENSE`.
