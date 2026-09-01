---
name: feature-merge
description: Squash-merge a green PR, clean up branches, sync main, and update the plan status
allowed-tools: Bash
---

Merge the current branch's PR once CI is green.

1. `gh pr view --json number,state,mergeable,statusCheckRollup,url`. Require: state OPEN,
   mergeable MERGEABLE, every check SUCCESS. Otherwise stop and report what is blocking.
2. `gh pr merge <number> --squash --delete-branch` . The squash commit title is the PR title;
   the body is the PR summary. Do not use `--admin`.
3. `git checkout main && git pull --ff-only origin main`.
4. Delete the local branch if it still exists: `git branch -D <branch>`.
5. Update the slice status table in `CLAUDE.md` (mark the slice merged with the PR number) and
   commit that on a fresh `chore/plan-status` branch only if it is not already part of the PR.
   Preferred: include the status update in the slice PR itself so this step is a no-op.
6. Report: PR URL, squash commit SHA, next slice.
