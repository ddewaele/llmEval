---
name: feature-ship
description: Ship a finished slice end to end - commit, PR, wait for CI, squash-merge, sync main
allowed-tools: Bash
---

The happy-path one-shot for a finished slice. Run the skills in order and stop at the first
failure:

1. `feature-commit`
2. `feature-pr`
3. Wait for CI to finish (`gh pr checks --watch`).
4. `feature-merge`

Report a summary table: branch, PR URL, CI result, merge SHA, next slice from `docs/PLAN.md`.
