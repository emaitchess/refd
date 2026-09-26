import { promptLimitMessage } from '@refd/core/config';
import { and, desc, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import type { WorkspaceBindings } from '../auth/middleware';
import { getDb } from '../db/client';
import { prompts, results, runs } from '../db/schema';
import { parseBody, parseId } from '../lib/http';
import {
  createPrompt,
  removePrompt,
  setPromptActive,
  updatePromptFields,
} from '../lib/prompt-store';
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

promptRoutes.post('/', async (c) => {
  const data = await parseBody(c, createSchema);
  const workspaceId = c.get('workspace').id;
  const limit = configForUser(c.get('user').email, c.env.ADMIN_EMAILS).limits
    .maxActivePromptsPerWorkspace;
  const created = await createPrompt(
    c.env,
    workspaceId,
    data.text,
    data.tags,
    limit,
  );
  if (!created.ok) {
    return c.json({ error: promptLimitMessage(created.limit) }, 409);
  }
  if (created.duplicated) {
    return c.json({ error: 'prompt already exists' }, 409);
  }
  return c.json(created.prompt, 201);
});

const updateSchema = z.object({
  text: multiLineText(8, 500).optional(),
  tags: z.array(singleLineText(1, 40)).max(10).optional(),
  active: z.boolean().optional(),
});

const promptUpdateResponses = (
  c: Context<WorkspaceBindings>,
  result:
    | { ok: true; prompt: unknown }
    | { ok: false; reason: 'not-found' }
    | { ok: false; reason: 'duplicate' }
    | { ok: false; reason: 'limit'; limit: number },
) => {
  if (!result.ok) {
    if (result.reason === 'not-found') {
      return c.json({ error: 'not found' }, 404);
    }
    if (result.reason === 'duplicate') {
      return c.json({ error: 'prompt already exists' }, 409);
    }
    return c.json({ error: promptLimitMessage(result.limit) }, 409);
  }
  return c.json(result.prompt);
};

promptRoutes.patch('/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid id' }, 400);
  }
  const data = await parseBody(c, updateSchema);
  const workspaceId = c.get('workspace').id;
  const limit = configForUser(c.get('user').email, c.env.ADMIN_EMAILS).limits
    .maxActivePromptsPerWorkspace;
  const patch = { text: data.text, tags: data.tags };
  const result =
    data.active === undefined
      ? await updatePromptFields(c.env, id, workspaceId, patch)
      : await setPromptActive(
          c.env,
          id,
          workspaceId,
          data.active,
          limit,
          patch,
        );
  return promptUpdateResponses(c, result);
});

promptRoutes.delete('/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid id' }, 400);
  }
  const removed = await removePrompt(c.env, id, c.get('workspace').id, {
    retireWhenUsed: false,
  });
  if (!removed.ok) {
    if (removed.reason === 'has-results') {
      return c.json(
        { error: 'prompt has results; set active=false instead' },
        409,
      );
    }
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
