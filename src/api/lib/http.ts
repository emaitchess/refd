import type { Context, Env } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';

// Parse a numeric path param; null when absent or non-numeric.
export const parseId = (raw: string | undefined): number | null => {
  const id = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(id) ? id : null;
};

// Validate a JSON body against a schema, or abort with a 400 whose message is the
// first schema issue. Throwing (caught by Hono) keeps each route to one line.
export const parseBody = async <T, E extends Env>(
  c: Context<E>,
  schema: z.ZodType<T>,
): Promise<T> => {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new HTTPException(400, {
      res: c.json(
        { error: parsed.error.issues[0]?.message ?? 'invalid input' },
        400,
      ),
    });
  }
  return parsed.data;
};
