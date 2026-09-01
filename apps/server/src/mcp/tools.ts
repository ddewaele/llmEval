import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Services } from "@llmeval/core";
import {
  CreateDatasetSchema,
  DeleteItemsSchema,
  IdSchema,
  ItemFilterSchema,
  NewItemSchema,
  PublishVersionSchema,
  ReviewItemsSchema,
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

export function registerModelTools(server: McpServer, services: Services) {
  tool(
    server,
    "list_models",
    "List known models as `provider:model` ids with pricing (USD per million tokens, null if unknown) and whether the provider is configured. Use these ids for start_run and generation tools.",
    z.object({}),
    () => services.models.list(),
    { readOnly: true },
  );
}
