import { z } from "zod";

export const IdSchema = z.string().min(1).max(64);
export const TimestampSchema = z.string().datetime({ offset: true }).or(z.string().min(1));

export const PaginationQuerySchema = z.object({
  cursor: z.string().optional(),
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
