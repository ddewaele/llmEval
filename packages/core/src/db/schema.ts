import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { ExpectedSource, ItemMetadata, JsonObject, JsonValue } from "@llmeval/shared";

// ---------------------------------------------------------------------------
// Datasets, items, revisions, versions
// ---------------------------------------------------------------------------

export const datasets = sqliteTable("datasets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
  inputSchema: text("input_schema", { mode: "json" }).$type<JsonObject>(),
  /** Reusable description of the task used to seed synthetic items and ground-truth instructions. */
  generationBrief: text("generation_brief"),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const items = sqliteTable(
  "items",
  {
    id: text("id").primaryKey(),
    datasetId: text("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    /** Current draft content. Null only transiently during creation. */
    headRevisionId: text("head_revision_id"),
    position: integer("position").notNull(),
    deletedAt: text("deleted_at"),
    expectedSource: text("expected_source").$type<ExpectedSource>(),
    expectedModel: text("expected_model"),
    expectedRationale: text("expected_rationale"),
    expectedReviewedAt: text("expected_reviewed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("items_dataset_position_idx").on(t.datasetId, t.position)],
);

export const itemRevisions = sqliteTable(
  "item_revisions",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    datasetId: text("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    contentHash: text("content_hash").notNull(),
    input: text("input", { mode: "json" }).$type<JsonValue>().notNull(),
    expected: text("expected", { mode: "json" }).$type<JsonValue>(),
    metadata: text("metadata", { mode: "json" }).$type<ItemMetadata>().notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("item_revisions_item_hash_uq").on(t.itemId, t.contentHash),
    index("item_revisions_dataset_hash_idx").on(t.datasetId, t.contentHash),
  ],
);

export const datasetVersions = sqliteTable(
  "dataset_versions",
  {
    id: text("id").primaryKey(),
    datasetId: text("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    label: text("label"),
    notes: text("notes"),
    itemCount: integer("item_count").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("dataset_versions_dataset_number_uq").on(t.datasetId, t.number)],
);

export const versionItems = sqliteTable(
  "version_items",
  {
    versionId: text("version_id")
      .notNull()
      .references(() => datasetVersions.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    revisionId: text("revision_id")
      .notNull()
      .references(() => itemRevisions.id),
    position: integer("position").notNull(),
    expectedReviewed: integer("expected_reviewed", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.itemId] })],
);

// ---------------------------------------------------------------------------
// Task / scorer presets
// ---------------------------------------------------------------------------

export const taskConfigs = sqliteTable("task_configs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  datasetId: text("dataset_id").references(() => datasets.id, { onDelete: "set null" }),
  model: text("model").notNull(),
  params: text("params", { mode: "json" }).$type<JsonObject>().notNull().default({}),
  systemPrompt: text("system_prompt"),
  userTemplate: text("user_template"),
  outputSchema: text("output_schema", { mode: "json" }).$type<JsonObject>(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const scorerConfigs = sqliteTable("scorer_configs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  config: text("config", { mode: "json" }).$type<JsonObject>().notNull().default({}),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ---------------------------------------------------------------------------
// Runs, results, scores
// ---------------------------------------------------------------------------

export type RunStatus =
  "pending" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
export type RunItemStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    datasetId: text("dataset_id")
      .notNull()
      .references(() => datasets.id),
    versionId: text("version_id")
      .notNull()
      .references(() => datasetVersions.id),
    name: text("name"),
    taskConfigId: text("task_config_id").references(() => taskConfigs.id, { onDelete: "set null" }),
    configSnapshot: text("config_snapshot", { mode: "json" }).$type<JsonObject>().notNull(),
    scorers: text("scorers", { mode: "json" }).$type<JsonObject[]>().notNull().default([]),
    status: text("status").$type<RunStatus>().notNull().default("pending"),
    concurrency: integer("concurrency").notNull().default(4),
    triggeredBy: text("triggered_by").notNull().default("api"),
    totalItems: integer("total_items").notNull().default(0),
    completedItems: integer("completed_items").notNull().default(0),
    failedItems: integer("failed_items").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: real("cost_usd"),
    maxCostUsd: real("max_cost_usd"),
    error: text("error"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (t) => [index("runs_dataset_idx").on(t.datasetId, t.createdAt)],
);

export const runItems = sqliteTable(
  "run_items",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    revisionId: text("revision_id")
      .notNull()
      .references(() => itemRevisions.id),
    status: text("status").$type<RunItemStatus>().notNull().default("pending"),
    attempt: integer("attempt").notNull().default(0),
    renderedMessages: text("rendered_messages", { mode: "json" }).$type<JsonValue>(),
    output: text("output", { mode: "json" }).$type<JsonValue>(),
    rawResponse: text("raw_response", { mode: "json" }).$type<JsonValue>(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: real("cost_usd"),
    latencyMs: integer("latency_ms"),
    error: text("error"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (t) => [
    uniqueIndex("run_items_run_item_uq").on(t.runId, t.itemId),
    index("run_items_run_status_idx").on(t.runId, t.status),
  ],
);

export const scores = sqliteTable(
  "scores",
  {
    id: text("id").primaryKey(),
    runItemId: text("run_item_id")
      .notNull()
      .references(() => runItems.id, { onDelete: "cascade" }),
    scorerKey: text("scorer_key").notNull(),
    scorerType: text("scorer_type").notNull(),
    scorerConfig: text("scorer_config", { mode: "json" }).$type<JsonObject>().notNull().default({}),
    score: real("score"),
    passed: integer("passed", { mode: "boolean" }),
    rationale: text("rationale"),
    details: text("details", { mode: "json" }).$type<JsonValue>(),
    judgeModel: text("judge_model"),
    judgeTokens: integer("judge_tokens"),
    judgeCostUsd: real("judge_cost_usd"),
    error: text("error"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("scores_run_item_scorer_uq").on(t.runItemId, t.scorerKey)],
);

// ---------------------------------------------------------------------------
// Background jobs (generation, rescoring, import)
// ---------------------------------------------------------------------------

export type JobKind = "generate_items" | "generate_ground_truths" | "rescore" | "import";
export type JobStatus =
  "pending" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<JobKind>().notNull(),
    datasetId: text("dataset_id").references(() => datasets.id, { onDelete: "cascade" }),
    status: text("status").$type<JobStatus>().notNull().default("pending"),
    params: text("params", { mode: "json" }).$type<JsonObject>().notNull().default({}),
    progress: text("progress", { mode: "json" }).$type<JsonObject>().notNull().default({}),
    result: text("result", { mode: "json" }).$type<JsonValue>(),
    error: text("error"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (t) => [index("jobs_status_idx").on(t.status, t.createdAt)],
);
