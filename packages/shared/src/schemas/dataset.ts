import { z } from "zod";
import { IdSchema } from "./common.js";
import { JsonObjectSchema } from "./json.js";

export const DatasetSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(5000).nullable(),
  tags: z.array(z.string().min(1).max(64)),
  /** Optional JSON Schema describing the shape of item `input`. Used by generation. */
  inputSchema: JsonObjectSchema.nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Dataset = z.infer<typeof DatasetSchema>;

export const DatasetSummarySchema = DatasetSchema.extend({
  draftItemCount: z.number().int(),
  latestVersion: z.number().int().nullable(),
  versionCount: z.number().int(),
  unreviewedGroundTruths: z.number().int(),
});
export type DatasetSummary = z.infer<typeof DatasetSummarySchema>;

export const CreateDatasetSchema = z.object({
  name: z.string().min(1).max(200).describe("Human readable dataset name, unique per workspace"),
  description: z.string().max(5000).optional().describe("What this dataset evaluates"),
  tags: z.array(z.string().min(1).max(64)).optional(),
  inputSchema: JsonObjectSchema.optional().describe(
    "Optional JSON Schema for item input objects; used to guide synthetic generation",
  ),
});
export type CreateDataset = z.infer<typeof CreateDatasetSchema>;

export const UpdateDatasetSchema = CreateDatasetSchema.partial().extend({
  description: z.string().max(5000).nullable().optional(),
  inputSchema: JsonObjectSchema.nullable().optional(),
});
export type UpdateDataset = z.infer<typeof UpdateDatasetSchema>;

export const ListDatasetsQuerySchema = z.object({
  includeArchived: z.coerce.boolean().default(false),
});
