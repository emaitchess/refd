import { workspaceLimitMessage } from '@refd/core/config';
import { defaultMonitoringTier } from '@refd/core/workspaces';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { configForUser } from './user-config';

const createdWorkspaceSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
});

export type ProvisionedWorkspace =
  | { ok: true; id: number; name: string }
  | { ok: false; error: string };

// The single workspace-creation path for the dashboard and OAuth consent:
// atomic entitlement guard, monitoring-tier default, and an optional
// provisioning key that makes duplicate submissions resolve to one workspace.
export const provisionWorkspace = async (
  env: AppEnv,
  user: { id: number; email: string },
  name: string,
  provisioningKey: string | null,
): Promise<ProvisionedWorkspace> => {
  const config = configForUser(user.email, env.ADMIN_EMAILS);
  const limit = config.limits.maxWorkspaces;
  const tier = defaultMonitoringTier(config.isAdmin);
  const keyClause = provisioningKey
    ? 'not exists (select 1 from workspaces where provisioning_key = ?)'
    : '? is null';
  const keyBindings = provisioningKey ? [provisioningKey] : [];
  // Keep the count guard and insert in one statement so concurrent requests
  // cannot both pass a stale preflight count.
  const row = await env.DB.prepare(
    `insert into workspaces (name, owner_user_id, monitoring_tier, provisioning_key)
     select ?, ?, ?, ?
     where (${keyClause}) and (? is null or (
       select count(*) from workspaces where owner_user_id = ?
     ) < ?)
     returning id, name`,
  )
    .bind(
      name,
      user.id,
      tier,
      provisioningKey,
      ...keyBindings,
      limit,
      user.id,
      limit,
    )
    .first();
  if (row === null) {
    if (provisioningKey) {
      // Either a concurrent submission with the same key won, or the
      // entitlement ran out — the key decides which.
      const raced = await env.DB.prepare(
        'select id, name from workspaces where provisioning_key = ?',
      )
        .bind(provisioningKey)
        .first();
      const parsed = createdWorkspaceSchema.safeParse(raced);
      if (parsed.success) {
        return { ok: true, ...parsed.data };
      }
    }
    if (limit === null) {
      throw new Error('unlimited workspace insert returned no row');
    }
    return { ok: false, error: workspaceLimitMessage(limit) };
  }
  const inserted = createdWorkspaceSchema.safeParse(row);
  if (!inserted.success) {
    throw new Error('workspace insert returned an invalid row');
  }
  return { ok: true, ...inserted.data };
};
