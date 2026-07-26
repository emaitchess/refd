import { z } from 'zod';
import type { Limit } from '../../shared/config';
import type { AppEnv } from '../env';

const insertedPromptSchema = z.object({ id: z.number().int().positive() });

export const insertActivePrompt = async (
  env: AppEnv,
  workspaceId: number,
  text: string,
  tags: string[],
  limit: Limit,
): Promise<number | null> => {
  const row = await env.DB.prepare(
    `insert into prompts (workspace_id, text, tags)
     select ?, ?, ?
     where ? is null or (
       select count(*) from prompts
       where workspace_id = ? and active = 1
     ) < ?
     on conflict (workspace_id, text) do nothing
     returning id`,
  )
    .bind(workspaceId, text, JSON.stringify(tags), limit, workspaceId, limit)
    .first();
  if (row === null) {
    return null;
  }
  const inserted = insertedPromptSchema.safeParse(row);
  if (!inserted.success) {
    throw new Error('prompt insert returned an invalid row');
  }
  return inserted.data.id;
};
