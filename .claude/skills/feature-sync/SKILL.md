---
name: feature-sync
description: After Davy merged a PR, sync local main and delete the merged branch
allowed-tools: Bash
---

Run only after Davy has merged the PR on GitHub (`gh pr view --json state` shows MERGED).

1. `git checkout main && git pull --ff-only origin main`.
2. Delete the merged local branch: `git branch -d <branch>` (use `-D` only if git refuses because
   the squash commit differs; confirm the PR is MERGED first).
3. `git fetch --prune`.
4. Report the merged PR number and the next slice from `docs/PLAN.md` / `CLAUDE.md`.
