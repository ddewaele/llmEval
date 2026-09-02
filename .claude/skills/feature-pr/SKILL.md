---
name: feature-pr
description: Self-review the feature branch against the Definition of Done, push it, open a PR for Davy to review, and report CI
allowed-tools: Bash
---

Open a PR for the current feature branch. **Never merge.** Davy reviews and merges every PR
himself; `gh pr merge` is denied by `.claude/settings.json`. Stop at the first failing step and
report it; do not open a PR with anything below unresolved, and never note a known defect as a
"follow-up" to fix in a later PR: fix it now or stop and say the slice is not done.

1. Branch check: `git branch --show-current` must start with `feature/`, `fix/` or `chore/`.
2. Definition of Done (see CLAUDE.md), verified with commands, not from memory:
   - `pnpm verify` passes (lint, format, typecheck, tests, build). The pre-push hook re-runs it.
   - `pnpm check:hygiene` passes (no `.only`/`.skip` tests, no TODO/FIXME/XXX, no `console.log` in src).
   - Every behaviour added in this branch has a test; `git diff origin/main --stat` and the test
     files agree.
   - Docs touched by the change are updated in this branch: the slice row in `CLAUDE.md`, `README.md`
     if user-facing, `docs/PLAN.md` if the design changed. Confirm with `git diff origin/main -- CLAUDE.md`.
   - Scripted edits applied: if you edited files with sed/python, grep for the new text to prove it
     landed (Prettier reformats lines; exact-string edits miss silently).
   - Dependencies: if `package.json` changed, run a clean `rm -rf node_modules */*/node_modules && pnpm install --frozen-lockfile && pnpm verify`.
   - `git diff origin/main --stat` contains only files this slice needs. No stray scratch files.
3. Commit anything outstanding (follow `feature-commit`).
4. `git fetch origin && git rebase origin/main`; re-run `pnpm verify` if anything was rebased.
5. `git push -u origin <branch>` (the pre-push hook runs the full gate; do not bypass it).
6. `gh pr create --base main --title "<conventional title>" --body "<body>"` following
   `.github/pull_request_template.md`. Every checklist box must be genuinely true; describe how
   each was verified. List anything deliberately out of scope under "Not in this PR" with the
   reason, so the reviewer can decide, never as a promise to fix later.
7. `gh pr checks --watch --fail-fast` as a standalone command (never piped). If it fails, fix on
   the branch and push again; do not report done until green.
8. Report: PR URL, CI result, and the exact review points Davy should look at. Then stop; the next
   slice starts only after Davy has merged (run `feature-sync` first).
