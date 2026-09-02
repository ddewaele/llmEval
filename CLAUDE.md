# llmEval — working notes for Claude Code

Minimalistic, LLM-first evaluation harness in TypeScript. Full plan and requirements live in
`docs/PLAN.md`; keep that file and this one in sync when scope changes.

## Stack

- pnpm 9 workspaces, Node 22, TypeScript 5.9 (ESM, `moduleResolution: Bundler`), vitest 4, eslint 9 + prettier.
- `packages/shared` — Zod schemas, DTO types, enums, error codes. Depends on zod only.
- `packages/core` — drizzle/SQLite schema + migrations, services, run engine, scorers, LLM adapter (LangChain.js v1 `initChatModel`).
- `apps/server` — Hono: `/api` (zod-openapi), `/openapi.json`, `/mcp` (Streamable HTTP), serves `apps/web/dist` in prod. `bin/server.ts`, `bin/mcp-stdio.ts`.
- `apps/web` — Vite + React 19 + Tailwind 4 + TanStack Query SPA.
- Workspace packages point `main`/`types` at `src/index.ts`; the server runs with `tsx`. No build step is needed for TS packages; `build` only bundles the web app.

## Commands

```
pnpm install
pnpm dev            # server on :3000 (tsx watch)
pnpm dev:web        # vite on :5173 with HMR, proxies /api to :3000
pnpm build && pnpm dev   # server also serves the built SPA at http://localhost:3000/
pnpm verify             # lint + format:check + typecheck + test + build  (same as GitHub Actions)
pnpm test:watch
```

## Conventions

- Never commit to `main`. One plan slice = one `feature/<name>` branch = one PR.
- **Davy reviews and merges every PR himself.** Claude never merges (`gh pr merge` is denied in
  `.claude/settings.json`), never force-pushes, never bypasses hooks, and never starts the next
  slice before the previous PR is merged. `main` is protected: CI is required, force pushes disabled.
- Conventional commits, imperative subject ≤ 72 chars, body explains why. PR body follows
  `.github/pull_request_template.md` and every checklist item must be genuinely verified.
- All business logic lives in `packages/core` services. REST routes and MCP tools are thin adapters over the same services using the same Zod schemas from `packages/shared`.
- Services throw `AppError(code)`; REST maps to HTTP status, MCP returns `isError: true`.
- Provider keys come from env only; never persisted or returned by the API.

## Definition of Done (per PR)

A PR is ready for review only when all of these are true and were checked with commands:

1. `pnpm verify` and `pnpm check:hygiene` pass; the pre-push hook enforces both; CI is green.
2. Every new behaviour has a test in the same PR (vitest; temp-file SQLite for services, `app.request()` for routes, JSON-RPC for MCP).
3. Changes to model calls, transports or the UI were exercised for real (e.g. against local Ollama or the served web app) and the PR says how.
4. Docs are updated in the same PR: `CLAUDE.md` slice status row, `README.md` when user-facing, `docs/PLAN.md` when the design changed.
5. No known defect is deferred. A discovered problem is fixed in the branch or the PR is not opened and the problem is reported. "Follow-up" is only for deliberate scope exclusions, listed under "Not in this PR" for the reviewer to accept.
6. Scripted edits were confirmed to have landed (grep for the new text); Prettier reformatting makes exact-string edits miss silently.
7. If `package.json` changed, a clean `pnpm install --frozen-lockfile && pnpm verify` was run.

## Skills (in `.claude/skills/`)

`feature-start` → `feature-commit` → `feature-pr` (opens the PR and stops) → Davy reviews and merges →
`feature-sync`.

## Plan slice status

| #   | Slice                             | Branch                               | Status        |
| --- | --------------------------------- | ------------------------------------ | ------------- |
| 1   | Scaffolding, CI, skills, docs     | `feature/scaffolding`                | done (#1)     |
| 2   | DB schema + dataset/item services | `feature/db-datasets-items`          | done (#2, #3) |
| 3   | REST API + OpenAPI                | `feature/rest-api`                   | done (#4)     |
| 4   | MCP server (datasets/items)       | `feature/mcp-server`                 | done (#5)     |
| 5   | Dataset versions                  | `feature/versions`                   | done (#6)     |
| 6   | Import JSON/JSONL/CSV/XLSX        | `feature/import`                     | done (#7)     |
| 7   | Run engine                        | `feature/run-engine`                 | done (#8)     |
| 8   | Deterministic scoring             | `feature/deterministic-scoring`      | done (#9)     |
| 9   | LLM judge + compare               | `feature/llm-judge-compare`          | done (#10)    |
| 10  | Web: datasets/items/versions      | `feature/web-datasets`               | done (#11)    |
| 11  | Web: runs + compare               | `feature/web-runs`                   | done (#12)    |
| 12  | Ground-truth generation + review  | `feature/ground-truth-generation`    | done (#13)    |
| 13  | Synthetic item generation         | `feature/synthetic-items`            | done (#14)    |
| 14  | MCP resources, prompts, docs      | `feature/mcp-resources-prompts-docs` | done (#15)    |

## Using the MCP server from Claude Code (available from slice 4)

```
pnpm dev
claude mcp add --transport http llmeval http://localhost:3000/mcp
```

## Status

All 14 plan slices are merged (PRs #1–#15). Next ideas (not planned): task/scorer preset CRUD,
multi-turn or tool-using systems under test, browser tests for the web app, auth beyond the
bearer token.
