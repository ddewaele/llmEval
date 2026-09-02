---
name: dev-start
description: Start the llmEval API (and optionally the Vite web dev server) in the background via scripts/dev.sh and report the URLs
allowed-tools: Bash
---

Start the development servers with the repo's process manager. Never start servers with a bare
`&` in a shell; only `scripts/dev.sh` may start them, so `dev-stop` / `dev-kill-all` can find them.

1. `scripts/dev.sh status` to see what is already running.
2. `scripts/dev.sh start` (API from `.env`, default port 3000, tsx watch mode).
   Options: `--web` also starts Vite on 5173 with hot reload; `--port N` and `--db PATH` for a
   scratch instance (use these for tests and experiments so the real database stays untouched);
   `--no-watch` for a plain run.
3. Report the URLs printed (API, MCP endpoint, OpenAPI, Vite) and the log path `.dev/api.log`.
4. If the port is busy and the owner is not from this repo, say so and offer `--port`; never kill
   processes that belong to other projects.
