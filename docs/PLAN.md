# llmEval — Plan & Functional/Technical Requirements

## Context

Davy wants a minimalistic, LLM-first evaluation harness for LLM applications, written in TypeScript, living at `github.com/ddewaele/llmEval` (currently empty). The core loop is: build a test dataset (manually, by import, or synthetically), attach ground truths, execute the dataset against a model, capture outputs + metadata, score, and compare. Everything must be driveable from Claude Code through MCP; the web UI is a second client over the same services.

Decisions already taken with the user:

| Topic                | Decision                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------- |
| LLM access           | Multi-provider via **LangChain.js v1** (`initChatModel`), Anthropic + OpenAI + Ollama in v1 |
| Scoring in v1        | Deterministic scorers **and** LLM-as-judge                                                  |
| Frontend             | Vite + React 19 + Tailwind 4 SPA                                                            |
| Merge policy         | Claude squash-merges a PR once CI is green                                                  |
| Storage (my default) | SQLite (better-sqlite3 + drizzle) — single file, zero setup, single user                    |
| Backend (my default) | Hono + Zod + OpenAPI generation                                                             |
| MCP (my default)     | Streamable HTTP served by the API process at `/mcp`, plus a stdio shim for Claude Code      |

---

## Part 1 — Functional requirements

### 1.1 Datasets

- FR-D1 Create a dataset with name, description, optional tags.
- FR-D2 A dataset has a mutable **draft** working set of items and zero or more immutable **published versions** (`v1`, `v2`, …).
- FR-D3 Publish the draft as a new version with an optional changelog note. Publishing is the only way to create a version; versions are never edited.
- FR-D4 List / view / rename / archive / delete a dataset (delete cascades; blocked if runs exist unless `force`).
- FR-D5 Diff two versions: added / removed / changed items.

### 1.2 Items

- FR-I1 An item = `{ input, expected?, metadata }` where `input` is JSON (string prompt, object of template variables, or chat messages array), `expected` is the ground truth (JSON), `metadata` holds `tags[]`, `source` (`manual | imported | synthetic`), `notes`.
- FR-I2 CRUD on draft items; bulk add; bulk delete; tag filtering; full-text search over input.
- FR-I3 Import items from **JSON array, JSONL, CSV, XLSX** (upload or paste). Column/field mapping for CSV (which column is input, which is expected). Dry-run validation report before commit.
- FR-I4 Export a version as JSONL.

### 1.3 Synthetic data generation

- FR-S1 Generate N items from: a natural-language description of the task, optional seed items (few-shot), optional JSON schema for `input`, choice of model.
- FR-S2 Generation runs as a background job with progress; output lands in the draft set with `source=synthetic` and provenance (model, prompt, job id).
- FR-S3 Simple dedup against existing draft items (normalized exact match on input).
- FR-S4 Generated items are reviewable: accept / edit / reject before publishing.

### 1.4 Ground truths

- FR-G1 Generate `expected` for items lacking one, using a chosen model and an instruction prompt; stored with provenance (`generated_by_model`, `reviewed=false`).
- FR-G2 Human review: edit `expected`, mark reviewed. UI filter "unreviewed ground truths".
- FR-G3 Ground truth belongs to the item in the draft; it is frozen into the published version like any other field.

### 1.5 Execution (runs)

- FR-R1 A run = (dataset version, task config, scorer list). A **task config** = provider:model string, params (temperature, max tokens, …), system prompt, prompt template (mustache-style `{{field}}` over `input`), optional structured-output schema.
- FR-R2 Run executes every item with bounded concurrency, per-item retry on transient errors, per-item error isolation (one failure does not abort the run).
- FR-R3 Lifecycle: `pending → running → completed | failed | cancelled`. Cancel is cooperative. A restart of the server resumes or marks interrupted runs.
- FR-R4 Per item capture: raw output text, parsed structured output (if any), provider raw response, latency ms, token usage (in/out), cost estimate, error, timestamps.
- FR-R5 Run-level metadata: model, provider, params, prompt template snapshot, dataset version, started/finished, totals (items, succeeded, failed, tokens, cost), who triggered (ui | mcp | api).
- FR-R6 Progress observable live (SSE for UI, polling for MCP).
- FR-R7 Re-run with the same config in one click / one tool call.

### 1.6 Scoring

- FR-SC1 Deterministic scorers: `exact_match`, `contains`, `regex`, `json_equal` (order-insensitive keys), `numeric_tolerance`, `set_overlap` (precision / recall / F1 over list-valued expected vs output). Each yields `score ∈ [0,1]`, `pass: boolean`, optional detail.
- FR-SC2 LLM-as-judge scorer: judge model, rubric prompt, structured output `{ score, pass, rationale }`. Judge sees input, expected, actual.
- FR-SC3 Scorers attach to a run at creation; a run can also be **re-scored** later with additional scorers without re-executing.
- FR-SC4 Aggregates per run per scorer: mean score, pass rate, count. Aggregates cached on the run.
- FR-SC5 Compare two runs (same dataset version): per-item side-by-side outputs and scores, delta of aggregates.

### 1.7 MCP (first-class client)

- FR-M1 Every capability above is reachable via MCP tools; tool descriptions are written for an LLM caller; results are compact JSON with pagination.
- FR-M2 MCP resources expose datasets/versions/runs as readable documents.
- FR-M3 MCP prompts for common workflows ("create an eval for X", "analyze run failures").
- FR-M4 Works from Claude Code via a one-line `claude mcp add` (stdio) or via the HTTP endpoint.

### 1.8 Non-functional

- Single user, local-first, no auth in v1 (bind to localhost; optional static bearer token for the HTTP MCP endpoint).
- Provider API keys only via env vars; never stored in DB or returned by API.
- All LLM calls go through one adapter so usage/cost capture is uniform.
- OpenAPI spec generated from route schemas; MCP tool schemas derived from the same Zod schemas.

---

## Part 2 — Technical design

### 2.1 Stack & versions (verified on npm, 2026-09-01)

| Layer             | Choice                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime / tooling | Node 22, pnpm 9 workspaces, TypeScript **5.x** (pin 5.9; TS 7 is the new Go-based compiler, avoid until tooling catches up), tsx, vitest 4, eslint + prettier       |
| Backend           | hono 4.13, @hono/node-server 2, @hono/zod-openapi 1.6 (Zod 4), zod 4.5                                                                                              |
| DB                | better-sqlite3 13, drizzle-orm 0.45, drizzle-kit 0.31 (WAL mode, `busy_timeout=5000`)                                                                               |
| LLM               | langchain 1.5 (`initChatModel` from `langchain/chat_models/universal`), @langchain/core 1.2, @langchain/anthropic 1.5, @langchain/openai 1.5, @langchain/ollama 1.3 |
| MCP               | @modelcontextprotocol/sdk 1.30 (Streamable HTTP at `/mcp` + stdio proxy)                                                                                            |
| Web               | vite 8, react 19, tailwindcss 4, @tanstack/react-query 5                                                                                                            |
| Misc              | p-limit (concurrency), ulid (ids), papaparse (CSV)                                                                                                                  |

Default models (env, overridable): `DEFAULT_MODEL=anthropic:claude-opus-5`, `JUDGE_MODEL=anthropic:claude-opus-5`, `GENERATION_MODEL=anthropic:claude-opus-5`.

### 2.2 Monorepo layout

```
llmEval/
  pnpm-workspace.yaml  tsconfig.base.json  package.json  .env.example  models.json  CLAUDE.md  README.md
  .github/workflows/ci.yml  .github/pull_request_template.md
  .claude/skills/{feature-start,feature-commit,feature-pr,feature-merge,feature-ship}/SKILL.md
  packages/
    shared/   Zod schemas + inferred DTO types, enums, AppError codes. Dep: zod only.
    core/     src/db (drizzle schema, migrations, client), src/services (datasets, items, versions,
              import, runs, scoring, generation), src/llm (initChatModel adapter, pricing, templating),
              src/runs/engine.ts (RunEngine + JobRunner), src/scoring/registry.ts, src/config.ts
  apps/
    server/   Hono app: /api (zod-openapi), /openapi.json, /mcp, serves web/dist in prod.
              src/mcp/{tools,resources,prompts,format}.ts ; bin/server.ts ; bin/mcp-stdio.ts
    web/      Vite SPA
```

- No separate `packages/db` or `apps/mcp`: exactly one process must own the SQLite file and the in-process job queue. The stdio binary is a ~60-line bridge (`StdioServerTransport` ↔ `StreamableHTTPClientTransport` → `http://localhost:PORT/mcp`) so runs started from Claude Code survive the session ending. Claude Code can also use `claude mcp add --transport http llmeval http://localhost:3000/mcp` directly.
- `shared` is the contract: REST routes, MCP `inputSchema`s and web types import the same Zod objects.

### 2.3 Data model (drizzle, `packages/core/src/db/schema.ts`)

Versioning approach: **logical items + immutable content revisions + join table**.

| Table              | Key columns                                                                                                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `datasets`         | id (ulid), name, description, tags JSON, input_schema JSON?, archived_at, created_at, updated_at                                                                                                                  |
| `items`            | id, dataset_id, **head_revision_id**, position, deleted_at, expected_source (`human                                                                                                                               | generated              | imported                                                                                                                      | null`), expected_model, expected_rationale, expected_reviewed_at                         |
| `item_revisions`   | id, item_id, dataset_id, **content_hash** (sha256 canonical JSON of input+expected+metadata), input JSON, expected JSON, metadata JSON, created_at. UNIQUE(item_id, content_hash)                                 |
| `dataset_versions` | id, dataset_id, **number**, label, notes, item_count, snapshot_hash, created_at. UNIQUE(dataset_id, number)                                                                                                       |
| `version_items`    | version_id, item_id, revision_id, position, expected_reviewed bool. PK(version_id, item_id)                                                                                                                       |
| `task_configs`     | id, name, dataset_id?, model (`provider:model`), params JSON, system_prompt, user_template, output_schema JSON                                                                                                    |
| `scorer_configs`   | id, name, type, config JSON                                                                                                                                                                                       |
| `runs`             | id, dataset_id, version_id, name, task_config_id?, **config_snapshot** JSON, **scorers** JSON, status, concurrency, triggered_by (`ui                                                                             | mcp                    | api`), total/completed/failed_items, input_tokens, output_tokens, cost_usd, max_cost_usd?, error, created/started/finished_at |
| `run_items`        | id, run_id, item_id, revision_id, status, attempt, rendered_messages JSON, output JSON, raw_response JSON, input_tokens, output_tokens, cost_usd, latency_ms, error, started/finished_at. UNIQUE(run_id, item_id) |
| `scores`           | id, run_item_id, **scorer_key**, scorer_type, scorer_config JSON, score REAL 0–1, passed, rationale, details JSON, judge_model, judge_tokens, judge_cost_usd, error. UNIQUE(run_item_id, scorer_key)              |
| `jobs`             | id, kind (`generate_items                                                                                                                                                                                         | generate_ground_truths | rescore                                                                                                                       | import`), dataset_id, status, params JSON, progress JSON, result JSON, error, timestamps |

Semantics:

- **Draft** = items with `deleted_at IS NULL`, content via `head_revision_id`. Edit = insert revision (no-op if hash exists), move head. Delete = soft. Published versions never change.
- **Publish** = copy `(item_id, head_revision_id)` into `version_items`; refuse if `snapshot_hash` equals latest version. Warn (not block) if unreviewed generated ground truths exist.
- **Diff** = set ops on `(item_id, revision_id)`: added / removed / changed. Pure SQL.
- Ground-truth provenance lives on `items` (workflow state), the `expected` value lives in the revision (test content) → scores against a version are reproducible.
- Runs snapshot config + scorers + version, so editing presets never changes history. Aggregates computed on read (`AVG`, pass rate `GROUP BY scorer_key`).
- **Decision**: `start_run` on a draft that differs from the latest version auto-publishes a new version first (reproducibility without friction). `delete_dataset` is blocked while runs exist unless `force`.

### 2.4 Item shape & templating

`Item = { id, input: Json, expected: Json | null, metadata: { tags?: string[], source: 'manual'|'imported'|'synthetic', ...} }`.

Executor input rules: (1) messages array → sent as-is, `system_prompt` prepended if absent, template ignored with a warning on the run_item; (2) string → `{{input}}` in template or used directly; (3) object → template rendered with dot paths (`{{customer.name}}`), non-strings rendered as JSON; no template → JSON-stringified. In-house ~40-line renderer (dot paths, `{{json x}}`, no escaping, no logic) in `packages/core/src/llm/template.ts`. If `output_schema` set → `withStructuredOutput(schema, {includeRaw:true})`, `output` is the parsed object. `expected` may be an **array of acceptable answers** for `exact_match`/`contains`.

### 2.5 Execution engine (`packages/core/src/runs/engine.ts`)

- `RunService.start` → transaction inserts `runs` + one `run_items` per `version_items` (status `pending`).
- `JobRunner` (shared with generation/rescore jobs): `AbortController` per job, `p-limit(concurrency)`, in-process `EventEmitter` for progress.
- Per item: render → `model.invoke(messages, {signal, timeout})` → store output, `usage_metadata`, trimmed `response_metadata`, latency → inline scoring → single UPDATE → emit `item_completed`. Item errors mark the item `failed` and continue. Own retries (LangChain `maxRetries: 0`): 2× exponential backoff on 429/5xx/timeouts, `attempt` recorded.
- Status: `pending → running → completed | failed | cancelled`. `completed` = all items terminal (failures counted); `failed` = run-level failure (model init, `max_cost_usd` exceeded). Cancel: in-flight → `cancelled`, run → `cancelled`; resume re-enqueues `pending`+`cancelled`.
- **Recovery on boot**: `run_items.status='running'` → `pending`; runs/jobs with `status='running'` re-executed (`AUTO_RESUME=true`) or marked `interrupted`.
- Progress: `GET /api/runs/:id/events` (Hono `streamSSE`, replays counts on connect); MCP polls `get_run`.
- Cost: LangChain v1 normalizes `AIMessage.usage_metadata` across providers. `packages/core/src/llm/pricing.ts` = built-in table merged with root `models.json` (`{ "anthropic:claude-opus-5": { inputPerMTok, outputPerMTok, cacheReadPerMTok } }`). Unknown model → `cost_usd = null`, never guessed.

### 2.6 Scoring (`packages/core/src/scoring/registry.ts`)

```ts
interface Scorer<C> {
  type: string;
  configSchema: z.ZodType<C>;
  description: string;
  score(ctx: {
    input;
    expected;
    output;
    config: C;
    signal;
  }): Promise<{ score: number; passed?: boolean; rationale?: string; details?: Json }>;
}
```

Registry: `exact_match` (trim, caseInsensitive, path), `contains`, `regex` (match or extract-group-then-compare), `json_equal` (path, ignoreKeyOrder, subset), `numeric_tolerance` (abs/rel, path), `llm_judge` (model, rubric, passThreshold 0.7; fixed grader system prompt; `withStructuredOutput({score, pass, rationale})`; judge tokens/cost on the score row and rolled into run cost).
Scoring is inline during execution so the UI shows scores live. **Re-score** = `jobs` row of kind `rescore` upserting on `(run_item_id, scorer_key)` and appending to `runs.scorers`. **Compare** joins two runs on `item_id` (works across versions; one-sided items flagged), returns per-item deltas and aggregate deltas.

### 2.7 Generation (`packages/core/src/services/generation/`)

Separate services sharing `JobRunner`, not the run tables.

- `generateItems({datasetId, description, count, seedItemIds?, inputSchema?, model?, tags?})`: batches of 10 via structured output `{items:[{input, expected?}]}` (item schema from `dataset.input_schema` when present; LangChain accepts raw JSON Schema). Prompt includes seeds + sample of existing inputs. Dedup by canonical-JSON hash of normalized input against existing revisions and within batch; stop after `count` or 3 all-duplicate batches. Lands in draft with `source: 'synthetic'`, `metadata.job_id`.
- `generateGroundTruths({datasetId, itemIds? (default: missing expected), instructions?, model?, outputSchema?})`: one call per item, writes new revision with `expected`, sets `expected_source='generated'`, `expected_model`, `expected_rationale`, `expected_reviewed_at=null`. Review via `update_item` (→ `human`) or `review_items(ids, approve)`.

### 2.8 MCP surface (`apps/server/src/mcp/`)

Principles: snake_case; descriptions written for an LLM ("Use when…", defaults, side effects); `inputSchema` = the shared Zod object; `list_*` return `{items, next_cursor}` with strings truncated to 200 chars; long ops return `job_id`/`run_id` immediately. Logic lives only in core services; REST route = `validate → service → c.json`, MCP tool = `same schema → same service → JSON.stringify`; `AppError(code)` maps to HTTP status or `isError: true`.

| Group      | Tools                                                                                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| datasets   | `list_datasets`, `create_dataset`, `get_dataset`, `update_dataset`, `delete_dataset`                                                                                                            |
| items      | `add_items`, `import_items` (json/jsonl/csv, content or path, mapping), `list_items` (version?, filter: missing_expected/unreviewed/tag, cursor), `update_item`, `review_items`, `delete_items` |
| versions   | `publish_version`, `list_versions`, `diff_versions`, `export_version`                                                                                                                           |
| generation | `generate_items`, `generate_ground_truths`, `get_job`, `cancel_job`                                                                                                                             |
| runs       | `list_models`, `start_run`, `get_run`, `list_runs`, `cancel_run`, `resume_run`                                                                                                                  |
| results    | `list_run_items` (status?, scorer_key?, max_score?, cursor), `get_run_item`, `score_run`, `compare_runs` (only_regressions?)                                                                    |

Resources: `llmeval://datasets/{id}`, `llmeval://datasets/{id}/versions/{n}/items` (JSONL), `llmeval://runs/{id}/summary`, `llmeval://runs/{id}/failures`.
Prompts: `build_eval` (task description → dataset + GT + run plan), `triage_run` (analyze failures, propose prompt fixes), `write_rubric` (draft an `llm_judge` rubric from a dataset).

### 2.9 REST surface (`apps/server/src/routes/`)

`/api/datasets` CRUD · `/api/datasets/:id/items` GET/POST, `POST …/import` · `/api/items/:id` PATCH/DELETE, `POST /api/items/review` · `/api/datasets/:id/versions` GET/POST, `GET …/versions/:n/items`, `GET …/versions/diff?from&to`, `GET …/versions/:n/export` · `POST /api/datasets/:id/generate/{items,ground-truths}` → 202 + job · `/api/jobs/:id` GET, `/cancel` · `/api/task-configs`, `/api/scorer-configs` CRUD · `/api/runs` GET/POST, `/api/runs/:id` GET, `/cancel`, `/resume`, `/items`, `/events` (SSE), `POST /scores` · `GET /api/runs/compare?a&b` · `/api/models` · `/openapi.json`.

### 2.10 Frontend pages (`apps/web/src/pages/`)

1. **Datasets** — table + create dialog.
2. **Dataset detail** — tabs _Items_ (draft table, inline edit, review toggles, import/generate dialogs), _Versions_ (publish, diff), _Runs_ (list + new-run form).
3. **Run detail** — status/progress via SSE, per-scorer aggregate cards, per-item table with filters, row drawer (messages, raw response, rationales), re-score button.
4. **Run compare** — aggregate deltas, per-item side-by-side, regression filter.
5. **Settings** — model registry + env-key presence (never values).

### 2.11 Config

`.env`: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_BASE_URL`, `PORT=3000`, `LLMEVAL_DB_PATH=./data/llmeval.sqlite`, `DEFAULT_MODEL`, `JUDGE_MODEL`, `GENERATION_MODEL`, `MAX_CONCURRENCY=4`, `AUTO_RESUME=true`, `ALLOW_UNLISTED_MODELS=false`, `MCP_BEARER_TOKEN?`. Parsed once with Zod in `packages/core/src/config.ts`. Model registry = built-in list merged with root `models.json`; `start_run` validates against it.

### 2.12 Delivery plan — one PR per slice, in order

| #   | Branch                               | Slice                                                                                                                           | Acceptance                                           |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | `feature/scaffolding`                | pnpm workspaces, tsconfig, eslint/prettier, vitest, empty packages, CI, PR template, `.claude/skills/*`, CLAUDE.md, README stub | CI green                                             |
| 2   | `feature/db-datasets-items`          | drizzle schema + migrations, `DatasetService`, `ItemService` (draft CRUD, revisions), unit tests                                | Tests create/edit/delete items                       |
| 3   | `feature/rest-api`                   | Hono app, zod-openapi routes for datasets/items, error mapping, `/openapi.json`                                                 | curl CRUD works, spec valid                          |
| 4   | `feature/mcp-server`                 | Streamable HTTP `/mcp`, stdio proxy, dataset/item tools, `list_models`                                                          | Claude Code creates a dataset + items                |
| 5   | `feature/versions`                   | publish/list/diff/export; REST + MCP                                                                                            | v1 → edit → v2, diff shows change                    |
| 6   | `feature/import`                     | JSON/JSONL/CSV/XLSX, mapping, dry-run, dedup; REST + MCP                                                                        | CSV and XLSX import visible in draft                 |
| 7   | `feature/run-engine`                 | LangChain adapter, templating, RunEngine/JobRunner, usage/cost, cancel/resume, recovery, SSE; REST + MCP                        | Run against Ollama/Anthropic; server restart resumes |
| 8   | `feature/deterministic-scoring`      | registry incl. `set_overlap`, inline scoring, aggregates, rescore job; REST + MCP                                               | Aggregates correct; rescore adds scorer              |
| 9   | `feature/llm-judge-compare`          | `llm_judge`, `compare_runs`; REST + MCP                                                                                         | Two runs compared with rationales                    |
| 10  | `feature/web-datasets`               | Vite app, pages 1–2 + settings, served by Hono in prod                                                                          | Manage dataset in browser                            |
| 11  | `feature/web-runs`                   | pages 3–4 with SSE                                                                                                              | Watch a run live; compare                            |
| 12  | `feature/ground-truth-generation`    | GT job, review flow, publish warning; REST/MCP/web                                                                              | Generate, edit one, approve rest, publish            |
| 13  | `feature/synthetic-items`            | item generation job with dedup + schema; REST/MCP/web                                                                           | 50 items from a description, no dupes                |
| 14  | `feature/mcp-resources-prompts-docs` | resources, 3 prompts, README with Claude Code setup, `models.json` docs                                                         | Fresh clone → eval driven from Claude Code           |

Slices 10–11 depend only on REST and can be interleaved with 7–9 if desired.

### 2.13 Risks to verify in slice 1

- `@hono/zod-openapi` 1.6 with Zod 4 import paths; MCP SDK Streamable HTTP under Hono's Node adapter (Fetch↔Node bridge); LangChain `withStructuredOutput({includeRaw:true})` + `usage_metadata` across all three providers (Ollama may return nulls).
- SQLite single-writer: keep writes short, never hold a transaction across an LLM call.
- Cost runaway: judge doubles calls; generation loops. `max_cost_usd`, pricing visible via `list_models`, unknown cost = null.
- Out of scope v1: multi-turn conversations and tool-using agents as system-under-test (messages-array input covers "prefix conversation, judge next turn"); auth beyond optional bearer token.

---

## Part 3 — Development workflow, skills, CI

### Branching & PR process

- `main` is protected in practice: nothing is committed to it directly. Every slice goes on `feature/<kebab-name>` (or `fix/…`, `chore/…`).
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`), imperative subject ≤ 72 chars, body explaining _why_ when non-obvious.
- PR title = conventional-commit style; PR body has `## Summary`, `## Changes`, `## Test plan`, `## Notes/Follow-ups`. PRs link the plan slice they implement.
- CI (GitHub Actions) must be green before merge: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- Merge = squash merge via `gh pr merge --squash --delete-branch`, then `git checkout main && git pull`.

### Project-scoped skills (live in the repo under `.claude/skills/`, so they ship with the code)

These adapt Davy's existing global skills (`global-start-new-feature`, `global-push-new-feature`) to this repo's conventions (pnpm, no GitHub issue per PR, auto-merge). Each is a `SKILL.md`.

| Skill            | Purpose                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feature-start`  | `git checkout main && git pull`, create `feature/<name>` from a short description, confirm clean tree.                                                              |
| `feature-commit` | Review `git status`/diff, group changes into one or more conventional commits with clear messages, never commit secrets/build output.                               |
| `feature-pr`     | Ensure branch pushed, run `pnpm lint typecheck test` locally, write PR body from the branch's commits + plan slice, `gh pr create`, watch CI in background, report. |
| `feature-merge`  | Verify CI green + no conflicts, `gh pr merge --squash --delete-branch`, sync `main`, delete local branch, report.                                                   |
| `feature-ship`   | Orchestrates commit → pr → wait CI → merge for a finished slice (the "happy path" one-shot).                                                                        |

Also add `CLAUDE.md` at repo root: stack summary, commands, conventions, the slice list with status, and "how to run the MCP server against Claude Code".

### Repo hygiene

- `.github/workflows/ci.yml`, `.github/pull_request_template.md`.
- `.env.example` with all provider keys; `.gitignore` for `.env`, `data/*.sqlite`, `dist`, `node_modules`.
- Root `README.md`: what it is, quickstart, MCP setup snippet.

---

## Part 4 — Verification

Per slice (enforced by CI and the `feature-pr` skill): `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green; vitest unit tests for services (in-memory SQLite via `:memory:` drizzle client), route tests via Hono's `app.request()`, scorer table tests.

End-to-end after slice 9 (repeat at slice 14 from a fresh clone following README):

1. `pnpm dev` starts server on :3000; `claude mcp add --transport http llmeval http://localhost:3000/mcp`.
2. From Claude Code: `create_dataset` → `add_items` (5 items with expected) → `publish_version` → `start_run` with `ollama:llama3.2` (or `anthropic:claude-opus-5`) and scorers `exact_match` + `llm_judge` → poll `get_run` until `completed` → `list_run_items` shows outputs, scores, tokens, cost → `score_run` adds `contains` → `compare_runs` between two runs.
3. Kill the server mid-run, restart, confirm the run resumes and finishes.
4. Browser: open dataset, watch a run progress live via SSE, open run compare.
5. `curl localhost:3000/openapi.json` validates; `.env` absent → server starts, `list_models` reports missing keys, `start_run` fails with a clear error.

## Part 5 — Reference use case: mailbox → SAP product codes

An agentic application scans a mailbox, and for each relevant mail must extract the SAP product
codes referenced in natural language. The customer supplied an Excel sheet of sample mails and the
codes they expect to be found. Mapping onto this system:

- **Dataset** `sap-product-codes`; item `input = { subject, body, sender }`,
  `expected = { productCodes: ["…", "…"] }`, `metadata.source = imported`,
  `expected_source = imported`. The sheet is loaded with the XLSX importer and a column mapping.
- **Task config**: system prompt describing the extraction task, `user_template` using
  `{{subject}}` / `{{body}}`, `output_schema` forcing `{ productCodes: string[] }`.
- **Scorers**: `set_overlap` (precision / recall / F1 on the code lists; `pass` when F1 ≥ threshold)
  as the primary metric, `json_equal` for strict correctness, `llm_judge` with a rubric to explain
  misses (wrong code family, hallucinated code, missed quantity variant, …).
- **Iteration loop from Claude Code**: `start_run` for prompt variant A and B on the same version,
  `compare_runs` with `only_regressions`, `triage_run` prompt to propose prompt fixes, publish a
  new version when the customer amends the sheet, re-run.
