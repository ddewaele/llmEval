import { z } from "zod";

export const IdSchema = z.string().min(1).max(64);

/** Boolean that also accepts query-string forms ("true", "1", "false", "0"). */
export const BoolLikeSchema = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : ["1", "true", "yes"].includes(v.toLowerCase())));

export const PaginationQuerySchema = z.object({
  cursor: z.string().optional().describe("Opaque cursor from a previous page's nextCursor"),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export function pageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}
export type Page<T> = { items: T[]; nextCursor: string | null };

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
