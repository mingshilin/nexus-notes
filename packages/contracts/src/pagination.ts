import { z } from "zod";

export const OpaqueCursorSchema = z.string().trim().min(1);

export interface CursorPage<T> {
  items: T[];
  next_cursor: string | null;
}

export function createCursorPageSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    next_cursor: OpaqueCursorSchema.nullable(),
  });
}
