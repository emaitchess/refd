import { and, desc, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { promptLimitMessage } from '../../shared/config';
import type { WorkspaceBindings } from '../auth/middleware';
import { getDb } from '../db/client';
import { prompts, results, runs } from '../db/schema';
import { parseBody, parseId } from '../lib/http';
import { insertActivePrompt } from '../lib/prompt-limit';
import { parseRange } from '../lib/range';
import { multiLineText, singleLineText } from '../lib/sanitize';
import { configForUser } from '../lib/user-config';
import {
  answerCount,
  cellRate,
  loadEntitiesWithBrand,
  loadScoreRows,
  sentimentDist,
} from './metrics';

export const promptRoutes = new Hono<WorkspaceBindings>();

promptRoutes.get('/', async (c) => {
  const { range, from } = parseRange(c.req.query('range'));
  const db = getDb(c.env);
  const ws = c.get('workspace').id;

  const { brand } = await loadEntitiesWithBrand(db, ws);
  if (!brand) {
    return c.json({ needsSetup: true });
  }

  const allPrompts = await db
    .select()
    .from(prompts)
    .where(eq(prompts.workspaceId, ws))
    .orderBy(prompts.id);

  // One atom fetch; per-prompt scopes are filters over it (v2 cell math —
  // rates average per-run cells, never blend runs).
  const rows = (await loadScoreRows(db, ws, from)).filter(
    (r) => r.entityId === brand.id,
  );

  return c.json({
    range,
    prompts: allPrompts.map((p) => {
      const mine = rows.filter((r) => r.promptId === p.id);
      const runIds = [...new Set(mine.map((r) => r.runId))];
      return {
        id: p.id,
        text: p.text,
        tags: p.tags,
        active: p.active,
        sentiment: sentimentDist(mine, brand.id),
        surfaces: [...new Set(mine.map((r) => r.surface))].sort().map((s) => {
          const scope = mine.filter((r) => r.surface === s);
          return {
            surface: s,
            mentionRate: cellRate(scope, brand.id, 'mentioned'),
            citationRate: cellRate(scope, brand.id, 'cited'),
            answers: answerCount(scope),
          };
        }),
        trend: runIds
          .map((runId) => {
            const scope = mine.filter((r) => r.runId === runId);
            return {
              runId,
              date: scope[0]?.date ?? '',
              mentionRate: cellRate(scope, brand.id, 'mentioned'),
            };
          })
          .sort((a, b) =>
            a.date === b.date ? a.runId - b.runId : a.date < b.date ? -1 : 1,
          ),
      };
    }),
  });
});

const createSchema = z.object({
  text: multiLineText(8, 500),
  tags: z.array(singleLineText(1, 40)).max(10).default([]),
});
const insertedPromptSchema = z.object({ id: z.number().int().positive() });

promptRoutes.post('/', async (c) => {
  const data = await parseBody(c, createSchema);
  const db = getDb(c.env);
  const workspaceId = c.get('workspace').id;
  const limit = configForUser(c.get('user').email, c.env.ADMIN_EMAILS).limits
    .maxActivePromptsPerWorkspace;
  const insertedId = await insertActivePrompt(
    c.env,
    workspaceId,
    data.text,
    data.tags,
    limit,
  );
  if (insertedId === null) {
    const duplicate = await db
      .select({ id: prompts.id })
      .from(prompts)
      .where(
        and(eq(prompts.workspaceId, workspaceId), eq(prompts.text, data.text)),
      )
      .limit(1);
    if (duplicate[0]) {
      return c.json({ error: 'prompt already exists' }, 409);
    }
    if (limit === null) {
      throw new Error('unlimited prompt insert returned no row');
    }
    return c.json({ error: promptLimitMessage(limit) }, 409);
  }
  const created = await db
    .select()
    .from(prompts)
    .where(eq(prompts.id, insertedId))
    .limit(1);
  if (!created[0]) {
    throw new Error('inserted prompt not found');
  }
  return c.json(created[0], 201);
});

const updateSchema = z.object({
  text: multiLineText(8, 500).optional(),
  tags: z.array(singleLineText(1, 40)).max(10).optional(),
  active: z.boolean().optional(),
});

const reactivatePrompt = async (
  c: Context<WorkspaceBindings>,
  id: number,
  data: z.infer<typeof updateSchema>,
) => {
  const workspaceId = c.get('workspace').id;
  const limit = configForUser(c.get('user').email, c.env.ADMIN_EMAILS).limits
    .maxActivePromptsPerWorkspace;
  const assignments: string[] = [];
  const values: unknown[] = [];
  if (data.text !== undefined) {
    assignments.push('text = ?');
    values.push(data.text);
  }
  if (data.tags !== undefined) {
    assignments.push('tags = ?');
    values.push(JSON.stringify(data.tags));
  }
  assignments.push('active = 1');
  const row = await c.env.DB.prepare(
    `update prompts
     set ${assignments.join(', ')}
     where id = ? and workspace_id = ?
       and (
         active = 1 or ? is null or (
           select count(*) from prompts
           where workspace_id = ? and active = 1
         ) < ?
       )
     returning id`,
  )
    .bind(...values, id, workspaceId, limit, workspaceId, limit)
    .first();
  if (row === null) {
    const owned = await getDb(c.env)
      .select({ id: prompts.id })
      .from(prompts)
      .where(and(eq(prompts.id, id), eq(prompts.workspaceId, workspaceId)))
      .limit(1);
    if (!owned[0]) {
      return c.json({ error: 'not found' }, 404);
    }
    if (limit === null) {
      throw new Error('unlimited prompt activation returned no row');
    }
    return c.json({ error: promptLimitMessage(limit) }, 409);
  }
  const updatedId = insertedPromptSchema.safeParse(row);
  if (!updatedId.success) {
    throw new Error('prompt activation returned an invalid row');
  }
  const updated = await getDb(c.env)
    .select()
    .from(prompts)
    .where(eq(prompts.id, updatedId.data.id))
    .limit(1);
  if (!updated[0]) {
    throw new Error('activated prompt not found');
  }
  return c.json(updated[0]);
};

promptRoutes.patch('/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid id' }, 400);
  }
  const data = await parseBody(c, updateSchema);
  if (data.active === true) {
    return reactivatePrompt(c, id, data);
  }
  const db = getDb(c.env);
  const updated = await db
    .update(prompts)
    .set(data)
    .where(
      and(eq(prompts.id, id), eq(prompts.workspaceId, c.get('workspace').id)),
    )
    .returning();
  if (!updated[0]) {
    return c.json({ error: 'not found' }, 404);
  }
  return c.json(updated[0]);
});

promptRoutes.delete('/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid id' }, 400);
  }
  const db = getDb(c.env);
  const owned = (
    await db
      .select({ id: prompts.id })
      .from(prompts)
      .where(
        and(eq(prompts.id, id), eq(prompts.workspaceId, c.get('workspace').id)),
      )
  )[0];
  if (!owned) {
    return c.json({ error: 'not found' }, 404);
  }
  const used = await db
    .select({ id: results.id })
    .from(results)
    .where(eq(results.promptId, id))
    .limit(1);
  if (used.length > 0) {
    // History references it — retire instead of destroying trend data.
    return c.json(
      { error: 'prompt has results; set active=false instead' },
      409,
    );
  }
  const deleted = await db
    .delete(prompts)
    .where(eq(prompts.id, id))
    .returning();
  if (!deleted[0]) {
    return c.json({ error: 'not found' }, 404);
  }
  return c.json({ ok: true });
});

// Latest run's raw status per surface for one prompt (drill-down).
promptRoutes.get('/:id/latest', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid id' }, 400);
  }
  const db = getDb(c.env);
  // Latest run that contains this prompt — subset runs (onboarding split,
  // promptIds manual runs) don't cover every prompt, so the workspace's
  // newest run may legitimately have no rows for it.
  const latestRun = await db
    .select({ id: runs.id, date: runs.date })
    .from(runs)
    .innerJoin(results, eq(results.runId, runs.id))
    .where(
      and(
        eq(runs.workspaceId, c.get('workspace').id),
        eq(results.promptId, id),
      ),
    )
    .orderBy(desc(runs.id))
    .limit(1);
  if (!latestRun[0]) {
    return c.json({ results: [] });
  }
  const rows = await db
    .select()
    .from(results)
    .where(and(eq(results.runId, latestRun[0].id), eq(results.promptId, id)));
  return c.json({
    runId: latestRun[0].id,
    date: latestRun[0].date,
    results: rows,
  });
});
