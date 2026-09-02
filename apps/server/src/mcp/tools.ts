import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Services } from "@llmeval/core";
import {
  CompareRunsQuerySchema,
  CreateDatasetSchema,
  DeleteItemsSchema,
  GenerateGroundTruthsSchema,
  GenerateItemsSchema,
  IdSchema,
  ImportRequestSchema,
  ItemFilterSchema,
  NewItemSchema,
  PublishVersionSchema,
  ReviewItemsSchema,
  RunItemStatusSchema,
  RunStatusSchema,
  ScorerSpecSchema,
  StartRunSchema,
  UpdateDatasetSchema,
  UpdateItemSchema,
  VersionRefSchema,
} from "@llmeval/shared";
import { errorResult, jsonResult } from "./format.js";

const LIST_TRUNCATE = 200;

type ToolFn<T> = (args: T) => Promise<unknown> | unknown;

/** Register a tool whose handler returns plain data; errors become isError results. */
function tool<S extends z.ZodObject>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: S,
  fn: ToolFn<z.infer<S>>,
  opts: { truncate?: number; readOnly?: boolean; destructive?: boolean } = {},
) {
  server.registerTool(
    name,
    {
      description,
      inputSchema,
      annotations: {
        readOnlyHint: opts.readOnly ?? false,
        destructiveHint: opts.destructive ?? false,
      },
    },
    (async (args: unknown): Promise<CallToolResult> => {
      try {
        return jsonResult(await fn(args as z.infer<S>), { truncate: opts.truncate });
      } catch (err) {
        return errorResult(err);
      }
    }) as unknown as ToolCallback<S>,
  );
}

export function registerDatasetTools(server: McpServer, services: Services) {
  tool(
    server,
    "list_datasets",
    "List evaluation datasets with draft item counts, latest version number and unreviewed ground-truth counts. Use first to discover ids.",
    z.object({ includeArchived: z.boolean().default(false) }),
    (a) => services.datasets.list(a),
    { readOnly: true },
  );

  tool(
    server,
    "create_dataset",
    "Create a new, empty evaluation dataset. Returns the dataset with its id; add items next with add_items or import_items, then publish_version before running.",
    CreateDatasetSchema,
    (a) => services.datasets.create(a),
  );

  tool(
    server,
    "get_dataset",
    "Get one dataset with summary counts (draft items, versions, unreviewed ground truths).",
    z.object({ id: IdSchema }),
    (a) => services.datasets.get(a.id),
    { readOnly: true },
  );

  tool(
    server,
    "update_dataset",
    "Rename a dataset or change its description, tags or input JSON schema. Omitted fields are left unchanged; pass null to clear description/inputSchema.",
    UpdateDatasetSchema.extend({ id: IdSchema }),
    ({ id, ...patch }) => services.datasets.update(id, patch),
  );

  tool(
    server,
    "archive_dataset",
    "Archive (hide) or unarchive a dataset without deleting anything.",
    z.object({ id: IdSchema, archived: z.boolean().default(true) }),
    (a) => services.datasets.archive(a.id, a.archived),
  );

  tool(
    server,
    "delete_dataset",
    "Permanently delete a dataset with all items, versions and runs. Refused while runs exist unless force=true. Prefer archive_dataset.",
    z.object({ id: IdSchema, force: z.boolean().default(false) }),
    async (a) => {
      await services.datasets.delete(a.id, { force: a.force });
      return { deleted: true, id: a.id };
    },
    { destructive: true },
  );
}

export function registerItemTools(server: McpServer, services: Services) {
  tool(
    server,
    "add_items",
    "Add test items to a dataset's draft. Each item has an `input` (prompt string, object of template variables, or chat messages array), optional `expected` ground truth and optional metadata (tags, source, notes). Returns the created items with ids. Changes only affect the draft until publish_version.",
    z.object({ datasetId: IdSchema, items: z.array(NewItemSchema).min(1).max(1000) }),
    async (a) => {
      const items = await services.items.add(a.datasetId, a.items);
      return { added: items.length, items };
    },
    { truncate: LIST_TRUNCATE },
  );

  tool(
    server,
    "import_items",
    "Import items into a dataset's draft from a file. Formats: json (array of {input, expected?, tags?} or bare values), jsonl, csv, xlsx. Pass `path` (server-local file, easiest from Claude Code) or `content` (text; base64 for xlsx). For csv/xlsx give `mapping` ({input: column | columns[], expected: column, expectedSplit: ','}) or rely on columns named input/expected. Duplicate inputs are skipped. Use dryRun=true first to see detected columns, a preview and row errors.",
    ImportRequestSchema.extend({ datasetId: IdSchema }),
    ({ datasetId, ...request }) => services.imports.import(datasetId, request),
    { truncate: LIST_TRUNCATE },
  );

  tool(
    server,
    "list_items",
    "List items of a dataset, cursor-paginated. By default lists the editable draft; pass versionNumber to list the items frozen in a published version (filters other than cursor/limit are ignored then). Filters: missing_expected (no ground truth yet), unreviewed (generated ground truth awaiting review), reviewed, tag, search (substring of input JSON). Long strings are truncated; use get_item for full content.",
    z.object({
      datasetId: IdSchema,
      versionNumber: z.number().int().positive().optional(),
      filter: ItemFilterSchema.default("all"),
      tag: z.string().optional(),
      search: z.string().max(200).optional(),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(25),
    }),
    ({ datasetId, versionNumber, ...query }) =>
      versionNumber === undefined
        ? services.items.list(datasetId, query)
        : services.versions.listItems(datasetId, versionNumber, query),
    { readOnly: true, truncate: LIST_TRUNCATE },
  );

  tool(
    server,
    "get_item",
    "Get one draft item in full (input, expected, metadata, ground-truth provenance).",
    z.object({ id: IdSchema }),
    (a) => services.items.get(a.id),
    { readOnly: true },
  );

  tool(
    server,
    "update_item",
    "Edit a draft item's input, expected or metadata. Creates a new immutable revision; published versions are unaffected. Setting `expected` marks the ground truth as human-provided and reviewed.",
    UpdateItemSchema.extend({ id: IdSchema }),
    ({ id, ...patch }) => services.items.update(id, patch),
  );

  tool(
    server,
    "review_items",
    "Mark generated ground truths as reviewed/approved (approve=true) or clear the flag (approve=false) for the given item ids.",
    ReviewItemsSchema,
    (a) => services.items.review(a.ids, a.approve),
  );

  tool(
    server,
    "delete_items",
    "Remove items from the dataset draft (soft delete). Items already captured in a published version remain there.",
    DeleteItemsSchema,
    (a) => services.items.delete(a.ids),
    { destructive: true },
  );
}

export function registerGenerationTools(server: McpServer, services: Services) {
  tool(
    server,
    "generate_items",
    "Create synthetic test items in a dataset's draft from a natural-language description of the task, optionally guided by seed items (few-shot) and a JSON Schema for inputs. By default each item also gets a drafted ground truth marked generated/unreviewed. Duplicates of existing or earlier items are dropped. Runs in the background: returns a job, poll get_job (result lists itemIds). Review with list_items(filter='unreviewed'), then publish_version.",
    GenerateItemsSchema,
    (a) => services.itemGenerator.generateItems(a),
  );

  tool(
    server,
    "generate_ground_truths",
    "Use a model to draft the expected answer for draft items that have none (or for given itemIds; overwrite=true to redo existing ones). Provide instructions describing what a correct answer is and, for structured answers, an outputSchema. Runs in the background: returns a job, poll get_job. Generated truths are marked unreviewed; review with list_items(filter='unreviewed') then review_items or update_item.",
    GenerateGroundTruthsSchema,
    (a) => services.generation.generateGroundTruths(a),
  );
}

export function registerVersionTools(server: McpServer, services: Services) {
  tool(
    server,
    "publish_version",
    "Freeze the dataset's current draft as the next immutable version (v1, v2, …). Runs always execute against a version. Refused when the draft is empty or identical to the latest version. Returns the version plus warnings (missing or unreviewed ground truths).",
    PublishVersionSchema.extend({ datasetId: IdSchema }),
    ({ datasetId, ...input }) => services.versions.publish(datasetId, input),
  );

  tool(
    server,
    "list_versions",
    "List a dataset's published versions, newest first, with item counts and notes.",
    z.object({ datasetId: IdSchema }),
    (a) => services.versions.list(a.datasetId),
    { readOnly: true },
  );

  tool(
    server,
    "diff_versions",
    "Compare two versions of a dataset, or a version against the current draft (to='draft', the default), returning added, removed and changed items. Use before publishing to review pending changes.",
    z.object({
      datasetId: IdSchema,
      from: VersionRefSchema,
      to: VersionRefSchema.default("draft"),
    }),
    (a) => services.versions.diff(a.datasetId, a.from, a.to),
    { readOnly: true, truncate: LIST_TRUNCATE },
  );

  tool(
    server,
    "export_version",
    "Export the items of a version as JSON Lines text (one {id, input, expected, metadata} per line).",
    z.object({ datasetId: IdSchema, versionNumber: z.number().int().positive() }),
    async (a) => ({ jsonl: await services.versions.exportJsonl(a.datasetId, a.versionNumber) }),
    { readOnly: true },
  );
}

export function registerRunTools(server: McpServer, services: Services) {
  tool(
    server,
    "start_run",
    "Execute a dataset version against a model. Runs in the background: returns immediately with the run id; poll get_run until status is completed/failed/cancelled, then read results with list_run_items. Defaults: latest version (unpublished draft changes are auto-published first), DEFAULT_MODEL, concurrency from config. Provide systemPrompt and userTemplate ({{field}} placeholders over the item input, {{input}} for string inputs), optional outputSchema (JSON Schema) for structured output, and scorers ([{key, type, config}]). Set maxCostUsd to cap spend.",
    StartRunSchema.omit({ triggeredBy: true }),
    (a) => services.runs.start({ ...a, triggeredBy: "mcp" }),
  );

  tool(
    server,
    "get_run",
    "Get a run's status and progress (completedItems/failedItems/totalItems), token usage, estimated cost and the config snapshot it executed with.",
    z.object({ id: IdSchema }),
    (a) => services.runs.get(a.id),
    { readOnly: true },
  );

  tool(
    server,
    "list_runs",
    "List runs, newest first, optionally filtered by dataset or status.",
    z.object({
      datasetId: IdSchema.optional(),
      status: RunStatusSchema.optional(),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }),
    (a) => services.runs.list(a),
    { readOnly: true },
  );

  tool(
    server,
    "list_run_items",
    "List per-item results of a run (input, expected, output, scores, tokens, latency, error), cursor-paginated. Filter by status (completed/failed/pending/…), or by scorerKey to get only items that failed that scorer (optionally score <= maxScore). Long strings truncated; use get_run_item for full content.",
    z.object({
      runId: IdSchema,
      status: RunItemStatusSchema.optional(),
      scorerKey: z.string().optional(),
      maxScore: z.number().min(0).max(1).optional(),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(25),
    }),
    ({ runId, ...query }) => services.runs.listItems(runId, query),
    { readOnly: true, truncate: LIST_TRUNCATE },
  );

  tool(
    server,
    "get_run_item",
    "Get one run item in full: rendered messages sent to the model, output, raw provider metadata, usage and error.",
    z.object({ id: IdSchema }),
    (a) => services.runs.getItem(a.id),
    { readOnly: true },
  );

  tool(
    server,
    "cancel_run",
    "Cancel a running run. In-flight items become cancelled, pending items stay pending; resume_run continues later.",
    z.object({ id: IdSchema }),
    (a) => services.runs.cancel(a.id),
  );

  tool(
    server,
    "resume_run",
    "Resume a cancelled, interrupted or failed run: re-enqueues its pending and cancelled items without redoing completed ones.",
    z.object({ id: IdSchema }),
    (a) => services.runs.resume(a.id),
  );
}

export function registerScoringTools(server: McpServer, services: Services) {
  tool(
    server,
    "compare_runs",
    "Compare two runs of the same dataset (a = baseline, b = candidate): aggregate score/pass-rate deltas per scorer, latency and cost deltas, and per-item side-by-side outputs with deltas. Set onlyRegressions=true to list just the items that got worse; scorerKey restricts to one scorer. Works across dataset versions (items missing on one side are counted).",
    CompareRunsQuerySchema.extend({ limit: z.number().int().min(1).max(200).default(50) }),
    (a) => services.compare.compare(a),
    { readOnly: true, truncate: LIST_TRUNCATE },
  );

  tool(
    server,
    "list_scorers",
    "List scorer types with descriptions and config JSON schemas. Deterministic: exact_match, contains, regex, json_equal, numeric_tolerance, set_overlap (precision/recall/F1 for code lists). Pass scorers to start_run as [{key, type, config}].",
    z.object({}),
    () => services.scorers.list(),
    { readOnly: true },
  );

  tool(
    server,
    "score_run",
    "Add a scorer to an existing run and score its completed items in the background without re-running the model. Returns a job; poll get_job. Use overwrite=true to replace a scorer with the same key.",
    z.object({ runId: IdSchema, scorer: ScorerSpecSchema, overwrite: z.boolean().default(false) }),
    (a) => services.scoring.scoreRun(a.runId, a.scorer, { overwrite: a.overwrite }),
  );

  tool(
    server,
    "get_job",
    "Get a background job (rescore, generation, import): status, progress {done,total}, result or error.",
    z.object({ id: IdSchema }),
    (a) => services.jobs$.get(a.id),
    { readOnly: true },
  );

  tool(server, "cancel_job", "Cancel a running background job.", z.object({ id: IdSchema }), (a) =>
    services.jobs$.cancel(a.id),
  );
}

export function registerModelTools(server: McpServer, services: Services) {
  tool(
    server,
    "list_models",
    "List known models as `provider:model` ids with pricing (USD per million tokens, null if unknown) and whether each is usable now, plus the effective default model per purpose (default run model, judge, generation; a configured default whose provider has no key falls back to an available model, local Ollama first) and Ollama status. refresh=true re-discovers installed Ollama models. Use these ids for start_run and generation tools.",
    z.object({ refresh: z.boolean().default(false) }),
    async (a) => {
      if (a.refresh) await services.models.discoverOllama();
      return services.models.catalog();
    },
    { readOnly: true },
  );
}
