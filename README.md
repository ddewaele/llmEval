# llmEval

A minimalistic, LLM-first evaluation harness for LLM applications, written in TypeScript.

Build test datasets (by hand, by importing a spreadsheet, or synthetically), attach ground truths,
run them against any model (Anthropic, OpenAI, Ollama through LangChain.js), capture outputs with
token usage and cost, score with deterministic scorers or an LLM judge, and compare runs. Every
capability is exposed over **MCP** so Claude Code can drive it; a small web UI sits on the same API.

## Quickstart

```bash
pnpm install
cp .env.example .env          # add ANTHROPIC_API_KEY / OPENAI_API_KEY, or point OLLAMA_BASE_URL at Ollama
pnpm build                    # builds the web app (served by the API)
pnpm dev                      # API + MCP + web UI on http://localhost:3000
```

- Web UI: <http://localhost:3000/> (or `pnpm dev:web` for Vite with hot reload on :5173)
- REST API: `http://localhost:3000/api/...`, OpenAPI at `/openapi.json`
- MCP: `http://localhost:3000/mcp` (Streamable HTTP, stateless)

Data lives in a single SQLite file (`LLMEVAL_DB_PATH`, default `./data/llmeval.sqlite`).

## Use it from Claude Code

```bash
claude mcp add --transport http llmeval http://localhost:3000/mcp
```

Then, in Claude Code, for example:

> Use llmeval to create a dataset "sap-product-codes", import `~/Downloads/samples.xlsx`
> (input = Subject + Body columns, expected = Codes split on ","), publish it, run it against
> `anthropic:claude-opus-5` with a `set_overlap` scorer on `productCodes` and an `llm_judge`,
> then show me the failing items.

The server also ships MCP **resources** (`llmeval://datasets/{id}`, `llmeval://runs/{id}/failures`, …)
and **prompts** (`build_eval`, `triage_run`, `write_rubric`). A stdio bridge exists for clients
without HTTP support: `claude mcp add llmeval -- pnpm --filter @llmeval/server exec tsx bin/mcp-stdio.ts`
(the HTTP server must be running; it owns the database and background jobs).

Set `MCP_BEARER_TOKEN` in `.env` to protect `/api` and `/mcp`; pass it as `Authorization: Bearer …`.

## Concepts

| Concept                     | Meaning                                                                                                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dataset**                 | A named collection of test items with an editable **draft** and immutable **versions** (v1, v2, …).                                                                                                                                                        |
| **Item**                    | `{ input, expected, metadata }`. `input` is a prompt string, an object of template variables, or a chat-messages array. `expected` is the ground truth (any JSON; an array means "any of these" for exact/contains scorers).                               |
| **Ground truth provenance** | `expected` is `human`, `imported` or `generated`; generated truths stay _unreviewed_ until approved or edited, and publishing warns about them.                                                                                                            |
| **Version**                 | A frozen snapshot of the draft (item + revision pointers). Runs always execute a version; starting a run on a changed draft auto-publishes one.                                                                                                            |
| **Run**                     | Executes a version against a `provider:model` with a system prompt, a `{{field}}` user template and an optional JSON output schema; captures output, tokens, cost, latency and provider metadata per item. Cancel/resume, restart-safe, optional cost cap. |
| **Scorer**                  | `exact_match`, `contains`, `regex`, `json_equal`, `numeric_tolerance`, `set_overlap` (precision/recall/F1 for lists) and `llm_judge` (rubric → score, pass, rationale). Scorers run inline and can be added to a finished run later.                       |
| **Compare**                 | Two runs side by side: per-scorer aggregate deltas, per-item deltas, regressions and improvements.                                                                                                                                                         |
| **Jobs**                    | Background work with progress: ground-truth generation, synthetic item generation, re-scoring.                                                                                                                                                             |

## Reference use case: mailbox → SAP product codes

The customer supplies an Excel sheet of sample e-mails and the product codes each should yield.

1. `import_items` (or the Import dialog) with `format: xlsx`, mapping `input: ["Subject", "Body"]`,
   `expected: "Codes"`, `expectedSplit: ","`. Dry-run first to see columns and a preview.
2. `publish_version`.
3. `start_run` with `outputSchema: { type: "object", properties: { productCodes: { type: "array", items: { type: "string" } } } }`,
   `userTemplate: "Subject: {{Subject}}\nBody: {{Body}}"`, scorers
   `set_overlap` (`path: "productCodes"`), `json_equal`, and `llm_judge` with a rubric.
4. Iterate on the prompt: start a second run, `compare_runs(a, b, onlyRegressions=true)`.
5. When the customer amends the sheet, import again (duplicates are skipped), review, publish v2.

## Configuration

`.env` (see `.env.example`): `PORT`, `LLMEVAL_DB_PATH`, `MCP_BEARER_TOKEN`, `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `OLLAMA_BASE_URL`, `DEFAULT_MODEL`, `JUDGE_MODEL`, `GENERATION_MODEL`,
`MAX_CONCURRENCY`, `AUTO_RESUME`, `ALLOW_UNLISTED_MODELS`.

**Model registry.** `list_models` / Settings show known `provider:model` ids with reference
pricing (USD per million tokens) and whether the provider is configured. Add or override models
by copying `models.example.json` to `models.json` at the repo root. Unknown models are rejected
unless `ALLOW_UNLISTED_MODELS=true`; unknown pricing yields a `null` cost rather than a guess.

## Architecture

```
packages/shared   Zod schemas + types shared by API, MCP and web
packages/core     SQLite (libsql + drizzle), services, run engine, scorers, LangChain adapter
apps/server       Hono: /api (OpenAPI), /mcp (MCP over Streamable HTTP), static web
apps/web          Vite + React + Tailwind SPA
```

All business logic lives in `packages/core` services; REST routes and MCP tools are thin adapters
over the same services using the same schemas. See `docs/PLAN.md` for the full design and
`CLAUDE.md` for development conventions.

## Development

```bash
pnpm verify        # lint + format check + typecheck + tests + build (same as CI)
pnpm test:watch
```

One plan slice = one feature branch = one PR, squash-merged after CI is green
(`.claude/skills/` contains the `feature-*` workflow skills for Claude Code).
