import { z } from "zod";
import { IdSchema, PaginationQuerySchema } from "./common.js";
import { JsonValueSchema } from "./json.js";

export const ItemSourceSchema = z.enum(["manual", "imported", "synthetic"]);
export type ItemSource = z.infer<typeof ItemSourceSchema>;

export const ExpectedSourceSchema = z.enum(["human", "generated", "imported"]);
export type ExpectedSource = z.infer<typeof ExpectedSourceSchema>;

export const ItemMetadataSchema = z
  .object({
    tags: z.array(z.string().min(1).max(64)).optional(),
    source: ItemSourceSchema.default("manual"),
    notes: z.string().max(5000).optional(),
  })
  .catchall(JsonValueSchema);
export type ItemMetadata = z.infer<typeof ItemMetadataSchema>;

export const ItemSchema = z.object({
  id: IdSchema,
  datasetId: IdSchema,
  revisionId: IdSchema,
  position: z.number().int(),
  input: JsonValueSchema,
  expected: JsonValueSchema.nullable(),
  metadata: ItemMetadataSchema,
  expectedSource: ExpectedSourceSchema.nullable(),
  expectedModel: z.string().nullable(),
  expectedRationale: z.string().nullable(),
  expectedReviewedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Item = z.infer<typeof ItemSchema>;

export const NewItemSchema = z.object({
  input: JsonValueSchema.describe(
    "The test input: a prompt string, an object of template variables, or a chat messages array",
  ),
  expected: JsonValueSchema.optional().describe(
    "Ground truth. A single value, or an array of acceptable values for exact_match/contains",
  ),
  metadata: ItemMetadataSchema.partial().optional(),
  expectedSource: ExpectedSourceSchema.optional().describe(
    "Provenance of `expected`. Defaults to `human` when expected is given",
  ),
});
export type NewItem = z.infer<typeof NewItemSchema>;

export const AddItemsSchema = z.object({
  items: z.array(NewItemSchema).min(1).max(5000),
});

export const UpdateItemSchema = z.object({
  input: JsonValueSchema.optional(),
  expected: JsonValueSchema.nullable().optional(),
  metadata: ItemMetadataSchema.partial().optional(),
});
export type UpdateItem = z.infer<typeof UpdateItemSchema>;

export const ItemFilterSchema = z.enum(["all", "missing_expected", "unreviewed", "reviewed"]);

export const ListItemsQuerySchema = PaginationQuerySchema.extend({
  filter: ItemFilterSchema.default("all"),
  tag: z.string().optional(),
  search: z.string().max(200).optional().describe("Substring match over the JSON of input"),
});
export type ListItemsQuery = z.infer<typeof ListItemsQuerySchema>;

export const ReviewItemsSchema = z.object({
  ids: z.array(IdSchema).min(1).max(5000),
  approve: z.boolean().describe("true marks the ground truths reviewed, false clears the flag"),
});

export const DeleteItemsSchema = z.object({
  ids: z.array(IdSchema).min(1).max(5000),
});
