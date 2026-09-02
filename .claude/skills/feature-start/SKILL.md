---
name: feature-start
description: Start a new feature branch off an up-to-date main for one plan slice
allowed-tools: Bash
---

Start work on a plan slice. Stop and report if any step fails.

1. Require a clean tree: `git status --short` must be empty. If not, tell the user what is
   uncommitted and stop (use `feature-commit` first).
   Require that the previous slice's PR is merged (`gh pr list --state open` shows none of yours);
   never start a new slice on top of an unmerged one.
2. Sync main: `git checkout main && git pull --ff-only origin main`.
3. Derive a kebab-case branch name from the slice title (see `docs/PLAN.md` § 2.12; the plan
   already names the branch for each slice). Prefix: `feature/` for slices, `fix/` for bug fixes,
   `chore/` for tooling.
4. `git checkout -b <branch>`.
5. Report the branch name and the slice acceptance criterion you are working toward.
