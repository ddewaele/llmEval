import { z } from "zod";
import { ItemSchema } from "./item.js";

export const ImportFormatSchema = z.enum(["json", "jsonl", "csv", "xlsx"]);
export type ImportFormat = z.infer<typeof ImportFormatSchema>;

/** How tabular columns (CSV/XLSX) map onto item fields. */
export const ImportMappingSchema = z.object({
  input: z
    .union([z.string(), z.array(z.string()).min(1)])
    .optional()
    .describe(
      "Column holding the input, or several columns to combine into an input object. Default: a column named 'input', else every column not used elsewhere",
    ),
  expected: z
    .union([z.string(), z.array(z.string()).min(1)])
    .optional()
    .describe("Column(s) holding the ground truth. Default: a column named 'expected' if present"),
  expectedSplit: z
    .string()
    .min(1)
    .optional()
    .describe("Delimiter to split a single expected column into an array, e.g. ',' for code lists"),
  tags: z.string().optional().describe("Column holding comma-separated tags"),
  parseJson: z
    .boolean()
    .default(true)
    .describe("Parse cells that look like JSON objects/arrays instead of keeping them as text"),
});
export type ImportMapping = z.infer<typeof ImportMappingSchema>;

export const ImportRequestSchema = z.object({
  format: ImportFormatSchema,
  content: z
    .string()
    .optional()
    .describe("File content. Text for json/jsonl/csv; base64 for xlsx. Alternative to path"),
  path: z
    .string()
    .optional()
    .describe("Server-local file path to read instead of content (handy from Claude Code)"),
  sheet: z.string().optional().describe("xlsx only: worksheet name (default: first sheet)"),
  mapping: ImportMappingSchema.optional(),
  tags: z.array(z.string().min(1)).optional().describe("Tags added to every imported item"),
  dedupe: z
    .boolean()
    .default(true)
    .describe("Skip rows whose input already exists in the draft or earlier in the file"),
  dryRun: z.boolean().default(false).describe("Validate and preview without writing anything"),
});
export type ImportRequest = z.infer<typeof ImportRequestSchema>;

export const ImportRowErrorSchema = z.object({
  row: z.number().int().describe("1-based data row number (header excluded)"),
  message: z.string(),
});

export const ImportResultSchema = z.object({
  dryRun: z.boolean(),
  format: ImportFormatSchema,
  totalRows: z.number().int(),
  added: z.number().int(),
  skippedDuplicates: z.number().int(),
  errors: z.array(ImportRowErrorSchema),
  columns: z.array(z.string()).optional().describe("Detected columns for tabular formats"),
  preview: z.array(ItemSchema.pick({ input: true, expected: true, metadata: true })),
  items: z.array(ItemSchema).optional().describe("Created items (not on dry run)"),
});
export type ImportResult = z.infer<typeof ImportResultSchema>;
