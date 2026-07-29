import type { z } from 'zod';

// safeParse wrapper for values that are already parsed (external API responses,
// queue message bodies). Returns the validated data or null so callers decide
// how to degrade — never a bare `as` cast at a trust boundary. For raw model
// text (locate + parse the JSON first) use `parseJson` in lib/llm.ts.
export const validate = <T>(value: unknown, schema: z.ZodType<T>): T | null => {
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
};
