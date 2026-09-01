import { z } from "zod";
import { IdSchema } from "./common.js";
import { JsonObjectSchema, JsonValueSchema } from "./json.js";

export const JobKindSchema = z.enum([
  "generate_items",
  "generate_ground_truths",
  "rescore",
  "import",
]);
export const JobStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export const JobSchema = z.object({
  id: IdSchema,
  kind: JobKindSchema,
  datasetId: IdSchema.nullable(),
  status: JobStatusSchema,
  params: JsonObjectSchema,
  progress: JsonObjectSchema.describe("e.g. {done, total}"),
  result: JsonValueSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type Job = z.infer<typeof JobSchema>;
