import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { getDb } from '../db/client';
import { users, workspaces } from '../db/schema';
import type { AppEnv } from '../env';
import { parseId } from '../lib/http';
import { issueSession, readSession, shouldRenew } from './session';

export interface AuthUser {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export type AuthedBindings = {
  Bindings: AppEnv;
  Variables: { user: AuthUser };
};

export const requireAuth = createMiddleware<AuthedBindings>(async (c, next) => {
  const claims = await readSession(c);
  if (!claims) {
    return c.json({ error: 'unauthenticated' }, 401);
  }
  const db = getDb(c.env);
  const row = await db.select().from(users).where(eq(users.id, claims.sub));
  const user = row[0];
  // tokenVersion mismatch = session revoked (password change, forced logout).
  if (!user || user.tokenVersion !== claims.tv) {
    return c.json({ error: 'unauthenticated' }, 401);
  }
  if (shouldRenew(claims)) {
    await issueSession(c, user);
  }
  c.set('user', {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
  });
  await next();
});

export interface WorkspaceInfo {
  id: number;
  name: string;
}

export type WorkspaceBindings = {
  Bindings: AppEnv;
  Variables: { user: AuthUser; workspace: WorkspaceInfo };
};

// Owner-only access: a workspace URL for someone else's workspace 404s
// (indistinguishable from nonexistent — no tenancy probing).
export const requireWorkspace = createMiddleware<WorkspaceBindings>(
  async (c, next) => {
    const id = parseId(c.req.param('workspaceId'));
    if (id === null) {
      return c.json({ error: 'invalid workspace' }, 400);
    }
    const db = getDb(c.env);
    const workspace = (
      await db.select().from(workspaces).where(eq(workspaces.id, id))
    )[0];
    if (!workspace || workspace.ownerUserId !== c.get('user').id) {
      return c.json({ error: 'workspace not found' }, 404);
    }
    c.set('workspace', { id: workspace.id, name: workspace.name });
    await next();
  },
);

// CSRF hardening: state-changing requests must carry a JSON content type —
// cross-site HTML forms cannot send application/json.
export const requireJsonForMutations = createMiddleware(async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (
    method === 'POST' ||
    method === 'PUT' ||
    method === 'PATCH' ||
    method === 'DELETE'
  ) {
    const contentType = c.req.header('Content-Type') ?? '';
    if (!contentType.includes('application/json')) {
      return c.json({ error: 'expected application/json' }, 415);
    }
  }
  await next();
});
