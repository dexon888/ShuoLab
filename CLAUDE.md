# ShuoLab — project instructions for Claude Code

Implement `SPEC.md` in phase order. The full TRD is authoritative for architecture, validated HSK source data, privacy and cost controls, required tests, and shipping gates. This is a personal single-user Mandarin learning PWA; do not add multi-user or subscription infrastructure.

## Existing GitHub repository (mandatory)
The owner **already created the ShuoLab GitHub repository**. Work inside its checked-out clone. Before coding, inspect `git status`, `git remote -v`, active branch and existing history. Never run `gh repo create`, reinitialize Git, replace `origin`, recreate the repository, force-push or discard existing content. If this directory is not the correct clone, give the owner instructions to clone or open it. Do not create another repository. Ask before pushing commits or opening PRs.

## Mandatory Git/GitHub publishing policy

- Follow `SPEC.md` §21 whenever staging, committing, pushing, publishing releases, or creating pull requests.
- Keep `.claude/settings.json` attribution settings intact: `commit` and `pr` must be empty strings and `sessionUrl` must be `false`.
- Use only the project owner's existing `git config user.name`/`user.email` and the owner's authenticated GitHub account. Request configuration rather than inventing author credentials.
- Do not add Claude/Anthropic as an author, co-author, collaborator, maintainer, or contributor to commit trailers, repository metadata, acknowledgments, project docs, or contributor lists.
- Commit messages must not include Claude `Co-Authored-By` trailers or automated generated-by lines. PR titles/descriptions must not include generated-with-Claude, AI-assisted stamps, or Claude session links.
- Before publishing, verify commit message and PR body plus author identity. Retain authentic upstream/license credits, and do not try to override platform badges or mandatory disclosures.

## Implementation workflow

- Begin with Phase 0 in the existing repository. Build tested vertical slices, keeping mocks explicitly labeled when secrets or licensed HSK source files are absent.
- Do not call synthetic curriculum fixtures official HSK data; import actual owner-provided data using source edition and integrity checks.
- Run the specified checks and explain what passes and what requires credentials, devices, or owner intervention.
