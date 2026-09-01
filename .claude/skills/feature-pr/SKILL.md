---
name: feature-pr
description: Verify the feature branch locally, push it, open a PR with a clear description, and watch CI
allowed-tools: Bash
---

Open a PR for the current feature branch. Do not merge here; that is `feature-merge`.

1. Branch check: `git branch --show-current` must start with `feature/`, `fix/` or `chore/`.
2. Commit anything outstanding (follow `feature-commit`).
3. Local gate: `pnpm verify` (lint, format:check, typecheck, test, build). If anything fails, fix it
   and commit the fix; do not open a PR on a red gate.
4. Rebase check: `git fetch origin && git rebase origin/main`. Resolve conflicts if any, re-run the gate.
5. Push: `git push -u origin <branch>` (use `--force-with-lease` only after a rebase).
6. Create the PR with `gh pr create --base main --title "<title>" --body "<body>"`:
   - title: conventional-commit style summarising the slice, e.g. `feat(core): dataset versions`.
   - body follows `.github/pull_request_template.md`: `## Summary` (what and why, link the plan
     slice), `## Changes` (bullets derived from `git log --oneline origin/main..HEAD`),
     `## Test plan` (what was run, how to verify manually), `## Notes / follow-ups`.
7. Watch CI: run `gh pr checks --watch --fail-fast` **as its own command and act on its exit
   code**. Never pipe it into `tail`/`grep` in the same shell line; a pipe hides the failure.
   Report the PR URL and the CI result. If CI fails, show the failing step's log excerpt
   (`gh run view <run-id> --log-failed`) and fix it.
8. Before opening a PR that adds dependencies, prove a clean install works the way CI does:
   `rm -rf node_modules packages/*/node_modules apps/*/node_modules && pnpm install --frozen-lockfile && pnpm verify`.
   pnpm's hoisting can make a dependency resolve locally even when it is missing from the
   package manifest.
