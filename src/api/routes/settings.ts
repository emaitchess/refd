import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { surfaceLimitMessage } from '../../shared/config';
import type { WorkspaceBindings } from '../auth/middleware';
import { getDb } from '../db/client';
import { workspaces } from '../db/schema';
import { parseBody } from '../lib/http';
import { configForUser } from '../lib/user-config';
import { enabledSurfaces, SURFACES } from '../providers/types';

export const settingsRoutes = new Hono<WorkspaceBindings>();

// Workspace-level run settings. Currently just the enabled AI surfaces; shared
// by the onboarding prompts step and the dashboard Settings page.
settingsRoutes.get('/', async (c) => {
  const db = getDb(c.env);
  const maxSurfaces = configForUser(c.get('user').email, c.env.ADMIN_EMAILS)
    .limits.maxEnabledSurfacesPerWorkspace;
  const ws = (
    await db
      .select({ surfaces: workspaces.surfaces })
      .from(workspaces)
      .where(eq(workspaces.id, c.get('workspace').id))
  )[0];
  return c.json({
    surfaces: enabledSurfaces(ws?.surfaces ?? null, maxSurfaces),
    available: SURFACES,
  });
});

const surfacesSchema = z.object({
  surfaces: z.array(z.enum(SURFACES)).min(1).max(SURFACES.length),
});

settingsRoutes.patch('/', async (c) => {
  const data = await parseBody(c, surfacesSchema);
  const db = getDb(c.env);
  // Dedupe + store in canonical SURFACES order.
  const set = new Set(data.surfaces);
  const surfaces = SURFACES.filter((s) => set.has(s));
  const maxSurfaces = configForUser(c.get('user').email, c.env.ADMIN_EMAILS)
    .limits.maxEnabledSurfacesPerWorkspace;
  if (surfaces.length > maxSurfaces) {
    return c.json({ error: surfaceLimitMessage(maxSurfaces) }, 409);
  }
  await db
    .update(workspaces)
    .set({ surfaces })
    .where(eq(workspaces.id, c.get('workspace').id));
  return c.json({ surfaces });
});
