import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { WorkspaceBindings } from '../auth/middleware';
import { getDb } from '../db/client';
import { workspaces } from '../db/schema';
import { parseBody } from '../lib/http';
import { enabledSurfaces, SURFACES } from '../providers/types';

export const settingsRoutes = new Hono<WorkspaceBindings>();

// Workspace-level run settings. Currently just the enabled AI surfaces; shared
// by the onboarding prompts step and the dashboard Settings page.
settingsRoutes.get('/', async (c) => {
  const db = getDb(c.env);
  const ws = (
    await db
      .select({ surfaces: workspaces.surfaces })
      .from(workspaces)
      .where(eq(workspaces.id, c.get('workspace').id))
  )[0];
  return c.json({
    surfaces: enabledSurfaces(ws?.surfaces ?? null),
    available: SURFACES,
  });
});

const surfacesSchema = z.object({
  surfaces: z.array(z.enum(SURFACES)).min(1),
});

settingsRoutes.patch('/', async (c) => {
  const data = await parseBody(c, surfacesSchema);
  const db = getDb(c.env);
  // Dedupe + store in canonical SURFACES order.
  const set = new Set(data.surfaces);
  const surfaces = SURFACES.filter((s) => set.has(s));
  await db
    .update(workspaces)
    .set({ surfaces })
    .where(eq(workspaces.id, c.get('workspace').id));
  return c.json({ surfaces });
});
