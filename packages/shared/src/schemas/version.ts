import { z } from "zod";
import { IdSchema } from "./common.js";
import { ItemMetadataSchema } from "./item.js";
import { JsonValueSchema } from "./json.js";

export const DatasetVersionSchema = z.object({
  id: IdSchema,
  datasetId: IdSchema,
  number: z.number().int().positive(),
  label: z.string().nullable(),
  notes: z.string().nullable(),
  itemCount: z.number().int(),
  snapshotHash: z.string(),
  createdAt: z.string(),
});
export type DatasetVersion = z.infer<typeof DatasetVersionSchema>;

export const PublishVersionSchema = z.object({
  label: z.string().max(200).optional().describe("Short human label, e.g. 'customer sheet v2'"),
  notes: z.string().max(5000).optional().describe("Changelog: what changed and why"),
});
export type PublishVersion = z.infer<typeof PublishVersionSchema>;

export const PublishResultSchema = z.object({
  version: DatasetVersionSchema,
  warnings: z.array(z.string()),
});
export type PublishResult = z.infer<typeof PublishResultSchema>;

/** Item content as frozen in a version. Workflow fields of the live item are not included. */
export const VersionItemSchema = z.object({
  itemId: IdSchema,
  revisionId: IdSchema,
  position: z.number().int(),
  input: JsonValueSchema,
  expected: JsonValueSchema.nullable(),
  metadata: ItemMetadataSchema,
  expectedReviewed: z.boolean(),
});
export type VersionItem = z.infer<typeof VersionItemSchema>;

/** A version number, or "draft" for the current unpublished working set. */
export const VersionRefSchema = z.union([z.coerce.number().int().positive(), z.literal("draft")]);
export type VersionRef = z.infer<typeof VersionRefSchema>;

export const VersionDiffSchema = z.object({
  from: VersionRefSchema,
  to: VersionRefSchema,
  added: z.array(VersionItemSchema),
  removed: z.array(VersionItemSchema),
  changed: z.array(z.object({ itemId: IdSchema, from: VersionItemSchema, to: VersionItemSchema })),
  unchanged: z.number().int(),
});
export type VersionDiff = z.infer<typeof VersionDiffSchema>;

export const DiffQuerySchema = z.object({
  from: VersionRefSchema,
  to: VersionRefSchema.default("draft"),
});
