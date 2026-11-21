import { z } from "zod";
import { uuidSchema } from "./primitives";

export const sortDirSchema = z.enum(["asc", "desc"]);

export const catalogQuery = z.object({
  q: z.string().trim().max(255).default(""),
  after: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  sortBy: z.string().trim().max(64).optional(),
  sortDir: sortDirSchema.optional(),
});

export type CatalogQuery = z.output<typeof catalogQuery>;

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
};
