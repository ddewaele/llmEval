---
name: feature-commit
description: Commit the current work as one or more well-described conventional commits
allowed-tools: Bash
---

Turn the working tree into clean commits. Never commit to `main` directly; if on `main`, stop.

1. `git status --short` and `git diff` (plus `git diff --cached`). Read the actual changes.
2. Never stage: `.env*` except `.env.example`, `data/`, `dist/`, `node_modules/`, editor files.
   If a secret-looking string appears in the diff, stop and warn.
3. Group changes into logical commits. One commit per concern; a slice usually needs 1–4.
4. Message format (Conventional Commits):
   - subject: `type(scope): imperative summary` ≤ 72 chars, no trailing period.
     Types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `ci`, `build`.
     Scope is the package or area: `core`, `server`, `web`, `shared`, `mcp`, `skills`, `ci`.
   - blank line, then a body explaining _why_ and any non-obvious decision. Wrap at 72.
   - never `WIP`, `fix stuff`, `updates`.
5. Commit with `git commit -m "<subject>" -m "<body>"`.
6. Never use `--no-verify` or amend/force-push published history; the hooks and branch protection
   are part of the process, not obstacles.
7. If files were changed by scripts (sed/python), grep for the new text before committing to prove
   the edit landed; Prettier reformatting makes exact-string edits miss silently.
8. Show `git log --oneline main..HEAD` as the report.
