import { z } from '../zod';

/** Cursor pagination query shared by list endpoints. */
export const PaginationQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().optional(),
  })
  .openapi('PaginationQuery');

export type PaginationQueryDto = z.infer<typeof PaginationQuerySchema>;

/** Builds a schema for a cursor-paginated page of `item`. */
export function pageOf<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}
