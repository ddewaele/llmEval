---
name: feature-sync
description: Safely return to an up-to-date main - refuse if the tree is dirty or work is unpushed, then pull, prune and delete branches whose PRs are merged
allowed-tools: Bash
---

The only sanctioned way back to `main`. It never discards or stashes work on its own: if anything
could be lost it stops and reports, and Davy decides.

1. Dirty-tree check: `git status --short`. If anything is modified, staged or untracked (other than
   files ignored by `.gitignore`), list the files and **stop**. Do not stash, reset or checkout over
   them. Suggest `feature-commit` (to keep the work) or an explicit instruction to discard it.
2. Unpushed-work check on the current branch (skip on `main`):
   `git log --oneline @{u}..HEAD 2>/dev/null || git log --oneline origin/main..HEAD`.
   If commits exist that are not on the remote, list them and **stop**; suggest `git push`.
3. PR state of the current branch: `gh pr view --json number,state,url 2>/dev/null`.
   Report OPEN (waiting for Davy's review), MERGED, CLOSED or no PR.
4. Switch and update: `git checkout main && git pull --ff-only origin main && git fetch --prune`.
5. Branch cleanup, only for branches whose PR is MERGED:
   for each local branch except `main`, `gh pr view <branch> --json state -q .state`; if `MERGED`,
   `git branch -D <branch>` (the squash commit differs from the branch, so `-d` refuses).
   Leave OPEN, CLOSED and PR-less branches alone and list them.
6. Report: current commit on `main`, branches deleted, branches kept and why, and the next slice
   from `docs/PLAN.md` / `CLAUDE.md` if the previous one is merged.
