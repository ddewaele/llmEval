---
name: dev-kill-all
description: Force-kill every llmEval server, Vite, tsx or vitest process from any session (scoped to this repo path)
allowed-tools: Bash
---

Use when servers are dangling from earlier Claude Code sessions or `dev-stop` was not enough.

1. `scripts/dev.sh kill-all`: SIGKILLs every process whose command line contains this repository's
   path and matches server/tsx/vite/vitest/esbuild, then frees the API and Vite ports **only** if
   their owners are from this repo. Processes of other projects are reported and left alone.
2. `scripts/dev.sh status` to confirm nothing is left.
3. Report what was killed (pids and commands) and any port still held by a foreign process.

Never widen the kill to processes outside this repo; if a foreign process holds a port you need,
use `dev-start --port N` instead.
