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

- Never commit to `main`. One plan slice = one `feature/<name>` branch = one PR, squash-merged after CI is green. `main` is protected: the CI check is required and force pushes are disabled.
- Check CI with `gh pr checks --watch --fail-fast` as a standalone command (exit code matters; never pipe it). Before a PR that adds dependencies, run a clean `pnpm install --frozen-lockfile && pnpm verify`.
- Conventional commits, imperative subject ≤ 72 chars, body explains why. PR body follows `.github/pull_request_template.md`.
- All business logic lives in `packages/core` services. REST routes and MCP tools are thin adapters over the same services using the same Zod schemas from `packages/shared`.
- Services throw `AppError(code)`; REST maps to HTTP status, MCP returns `isError: true`.
- Provider keys come from env only; never persisted or returned by the API.
- Tests: vitest, in-memory SQLite for services, `app.request()` for routes. Add tests with every slice.

## Skills (in `.claude/skills/`)

`feature-start` → `feature-commit` → `feature-pr` → `feature-merge`, or `feature-ship` for the whole happy path.

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
