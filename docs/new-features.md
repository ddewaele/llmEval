# llmEval — proposed new features

Status: proposal for discussion (2026-09-08). The 14 slices of `docs/PLAN.md` are done; this
document collects what would make llmEval more useful next, grouped by theme, with a recommended
order. Each feature lists the problem it solves, the smallest useful version, design notes that
respect the current architecture (core services → thin REST/MCP/web adapters, shared Zod schemas),
an effort estimate (S ≈ one PR of a day, M ≈ 2–3 PRs, L ≈ a week+), and acceptance criteria.

Recommended order (why: they compound on the mailbox → SAP use case and on daily use):

| Priority | Feature                                                                      | Effort |
| -------- | ---------------------------------------------------------------------------- | ------ |
| Now      | F1 Dataset templates                                                         | S      |
| Now      | F2 Evaluate an external system under test (HTTP endpoint)                    | M      |
| Now      | F3 Task & scorer presets, clone-and-tweak runs                               | S      |
| Next     | F4 Score trends, thresholds and CI mode (CLI + GitHub Action)                | M      |
| Next     | F5 Slices: per-tag aggregates and comparisons                                | S      |
| Next     | F6 Human review queue and judge calibration                                  | M      |
| Next     | F7 More scorers: semantic similarity, schema validity, latency/cost, webhook | M      |
| Later    | F8 Multi-turn and tool-call evaluation                                       | L      |
| Later    | F9 Capture production traffic into datasets                                  | M      |
| Later    | F10 Output cache and budget controls                                         | S      |
| Later    | F11 Reports and sharing                                                      | S      |
| Later    | F12 MCP: run_and_wait, progress notifications, an `/eval` skill              | S      |
| Later    | F13 Browser tests and dialog screenshots                                     | S      |
| Later    | F14 Deployment: Docker image, Postgres option, multi-user auth               | M      |

---

## Theme A — Getting a good dataset faster

### F1. Dataset templates (already queued)

**Problem.** An empty "New dataset" form gives no starting point; users don't know which input
shape, expected shape and scorers fit their task.

**Proposal.** A catalogue of ten templates, each with name, description, generation brief, input
JSON schema, 3–5 seed items, a suggested task config (system prompt, template, output schema) and
suggested scorers with rubric. Areas: email classification (with filter categories), sentiment
analysis, coding patterns (bug/anti-pattern detection in snippets), tool/function selection for
agents, grounded RAG question answering (faithfulness to a provided context), intent routing for
assistants, structured entity extraction (the SAP product-code case), summarisation, instruction and
constraint following, safety and prompt-injection handling.

**Design.** `packages/core/src/templates/*.ts` typed by a shared `DatasetTemplate` schema;
`GET /api/dataset-templates`; `create_dataset({ templateId })` seeds brief, schema, items and stores
the suggested run config on the dataset so the new-run form and MCP `start_run` can prefill it. Web:
a template picker in the create dialog with a preview.

**Acceptance.** Pick "structured extraction", create, publish, start run with one click each; the
run uses the template's scorers.

### F5. Slices: per-tag aggregates and comparisons

**Problem.** A single mean hides that the model fails on one category (e.g. invoices) and shines on
another.

**Proposal.** Treat item tags as slices. Run aggregates and compare show scores per tag; the run page
gets a "by tag" table; `compare_runs` reports per-tag deltas; `list_run_items(tag=…)`.

**Design.** Tags already live in item metadata; aggregate in SQL via `json_each(metadata, '$.tags')`.
No schema change. Effort S.

**Acceptance.** Seed data shows exact-match pass rate per tag on the email dataset.

### F9. Capture production traffic into datasets

**Problem.** The best test items are real inputs. Today they must be exported and imported by hand.

**Proposal.** (a) Import from common trace formats (OpenTelemetry GenAI spans, LangSmith/Langfuse
JSONL) mapping prompt → input and completion → candidate expected. (b) A capture endpoint
`POST /api/datasets/{id}/capture` that an application calls with `{ input, output, metadata }`;
captured items land in the draft with `source: "captured"` and the output stored as an unreviewed
ground-truth candidate. (c) Optional sampling rate and PII scrubbing rules (regex list) on the
dataset.

**Design.** New `ItemSource` value `captured`; importer parsers; capture route guarded by the bearer
token. Effort M.

**Acceptance.** Point a small script at the capture endpoint; 100 requests → 100 draft items with
candidates, reviewable in the UI.

---

## Theme B — Evaluating the real system, not just a bare model

### F2. External system under test (HTTP endpoint)

**Problem.** The mailbox → SAP application is an agent with retrieval and tools, not a single model
call. Today llmEval can only prompt a model directly, so results don't reflect the real system.

**Proposal.** A new "provider" kind `endpoint`: the run posts each item's input to a configured URL
and treats the response as the output. Configure URL, method, headers (with `${ENV_VAR}`
substitution so secrets stay in `.env`), request body template (same `{{field}}` engine), a JSON path
to extract the output, a timeout, and optional response fields for tokens/cost/latency reporting.
Endpoints are registered in the model catalogue as `endpoint:<name>` so `start_run`, compare and
the judge work unchanged.

**Design.** `endpoints` table (or entries in `models.json`), `EndpointChatModel` implementing the
existing `ChatModel` interface (`invoke` / `invokeStructured` both POST; structured mode validates
the extracted JSON against the schema). Web: Settings → Endpoints CRUD with a "test with an item"
button. MCP: `list_models` shows endpoints; `add_endpoint` tool. Effort M.

**Acceptance.** Register the SAP agent's `/extract` endpoint, run the customer sheet against it,
compare two deployments of the agent side by side.

### F8. Multi-turn and tool-call evaluation

**Problem.** Agent quality often hinges on _which tool it calls with which arguments_ and on
behaviour across turns, not only on the final text.

**Proposal.** (a) Items whose `expected` describes tool calls (`{ tool: "sap_lookup", args: {…} }`)
and a `tool_call_match` scorer (name match, argument subset/equality, order-insensitive). (b) Runs
that expose the dataset's declared tools to the model (LangChain `bindTools`) and record the
returned tool calls as the output without executing them ("dry-run agent step"). (c) Multi-turn
items: input is a conversation prefix; optional "simulated user" model that continues the
conversation for N turns following a persona, with the judge grading the whole transcript.

**Design.** Tool definitions on the dataset (JSON Schema per tool); output shape for tool-call runs
`{ toolCalls: [...], text }`; a transcript viewer in the item drawer. Effort L; ship (a)+(b) first.

**Acceptance.** Dataset "tool selection" from F1 runs and reports tool-choice accuracy per item.

---

## Theme C — Trusting the scores

### F6. Human review queue and judge calibration

**Problem.** `llm_judge` is only as good as its rubric; nobody knows how often it agrees with a
human.

**Proposal.** (a) Review queue: a page that walks through run items one by one (keyboard shortcuts),
shows input, expected, output and the judge's verdict, and records a human score/pass plus a note as
a `human` score row. (b) Calibration report per run: agreement rate, Cohen's kappa and a confusion
matrix between `llm_judge` and human labels; disagreements listed first. (c) "Promote to ground
truth": one click turns a good output into the item's expected value.

**Design.** Human scores reuse the `scores` table with `scorerType: "human"`; aggregates already
group by key. Effort M.

**Acceptance.** Review 20 items, see kappa; adjusting the rubric and re-scoring shows a higher
agreement.

### F7. More scorers

- `semantic_similarity`: embedding cosine similarity (Ollama/OpenAI embeddings via LangChain) with a
  threshold; for paraphrase-tolerant text answers.
- `json_schema_valid`: output validates against a schema (format compliance without ground truth).
- `latency_under` / `cost_under`: treat performance budgets as pass/fail scorers so they show up in
  compare and CI thresholds.
- `webhook`: POST `{input, expected, output}` to a URL and accept `{score, passed, rationale}` — the
  escape hatch for domain-specific checks (e.g. "does this code exist in SAP?").
- `pairwise_judge`: judge two runs' outputs against each other directly (A/B preference) for tasks
  without a single correct answer; surfaces in compare.

**Design.** All plug into the existing `Scorer` interface and registry; embeddings need a small
`EmbeddingsFactory` beside `ChatModelFactory`. Effort M in total; each scorer S.

---

## Theme D — Making evaluation routine

### F3. Task & scorer presets, clone-and-tweak runs

**Problem.** Every new run re-enters the same prompt and scorer JSON; comparing variants means
retyping.

**Proposal.** Save a run's config as a named **task preset** and a scorer list as a **scorer
preset** (tables exist already). New-run form: pick a preset, or **Clone** from an existing run
and edit only the field you're testing; the run records `basedOnRunId` so compare can default to
"vs. parent". MCP: `list_presets`, `save_preset`, `start_run({ presetId, overrides })`.

**Design.** `task_configs` / `scorer_configs` CRUD services + routes; `runs.basedOnRunId` column.
Effort S.

### F4. Score trends, thresholds and CI mode

**Problem.** Evaluations are run by hand; regressions are noticed late.

**Proposal.** (a) Dataset page → Trends: score per scorer over time across runs (by model/preset).
(b) Run thresholds: `start_run({ thresholds: { codes: { passRate: 0.9 } } })` → run gets a
`verdict: pass|fail` and the UI shows it. (c) `llmeval` CLI (`apps/cli`, thin over the REST API):
`llmeval run --dataset X --preset Y --wait --fail-below codes=0.9 --report junit.xml|md`,
plus `import`, `compare`, `export`. (d) A reusable GitHub Action that starts the server with a
seeded or committed dataset and runs the CLI, failing the workflow on regression.

**Design.** Thresholds stored on the run; verdict computed at finish; CLI uses the OpenAPI client
generated from `/openapi.json`. Effort M.

**Acceptance.** A PR that changes the agent's prompt shows a red check with the failing items in
the job summary.

### F10. Output cache and budget controls

**Problem.** Re-running the same version + config + model re-pays for identical outputs; judge
costs add up unnoticed.

**Proposal.** Content-addressed cache of model outputs keyed by (model, params, rendered messages,
schema); "reuse cached outputs" toggle on new runs (default on for re-scoring experiments). Budget:
monthly cap in `.env`, cost breakdown page (runs vs judge vs generation), warning banners.

**Design.** `model_cache` table; engine checks it before calling the model. Effort S.

### F11. Reports and sharing

**Proposal.** Export a run or a comparison as a self-contained Markdown/HTML report (aggregates,
per-tag table, worst items with rationales) for stakeholders who don't open the app; MCP resource
`llmeval://runs/{id}/report`.

---

## Theme E — Platform

### F12. MCP ergonomics

`run_and_wait` (blocks with progress notifications until the run finishes, with a max wait),
`compare` resource, `start_run` accepting a preset, and a Claude Code skill `/eval` in the repo that
encodes the loop "change prompt → run → compare → triage" so it can be driven with one command.

### F13. Browser tests and dialog screenshots

Add Playwright with a seeded database: smoke tests for the main flows (create → import → publish →
run → compare) and automated screenshots including open dialogs, replacing the manual's static
images with generated ones.

### F14. Deployment

A Dockerfile (single image: API + built web), a Postgres driver option behind the same drizzle
schema for shared team use, and multi-user auth (OIDC) once more than one person uses an instance.

---

## Open questions for Davy

1. Is the primary system under test the bare model or the deployed agent? If the agent, F2 should
   come before F1.
2. Do you want humans in the loop regularly (F6) or is the LLM judge plus spot checks enough?
3. Where would CI run (GitHub Actions) and against which model, given cost and keys?
4. Single-user local tool for the foreseeable future, or shared instance (drives F14)?
