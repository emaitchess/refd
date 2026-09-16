import type { AppEnv } from '../env';

const RAW_WRITE_STALE_MS = 10 * 60 * 1000;
const RAW_CLEANUP_LEASE_MS = 10 * 60 * 1000;

export class RawWriteBusyError extends Error {}

const deleteKeys = async (
  bucket: R2Bucket,
  keys: Set<string>,
): Promise<void> => {
  const values = [...keys];
  for (let start = 0; start < values.length; start += 1000) {
    await bucket.delete(values.slice(start, start + 1000));
  }
};

export const deleteRunRawObjects = async (
  env: AppEnv,
  runIds: number[],
  knownKeys: (string | null)[],
): Promise<void> => {
  const keys = new Set(knownKeys.flatMap((key) => (key ? [key] : [])));
  for (const runId of runIds) {
    let cursor: string | undefined;
    do {
      const page = await env.RAW.list({
        prefix: `raw/${runId}/`,
        ...(cursor ? { cursor } : {}),
      });
      for (const object of page.objects) {
        keys.add(object.key);
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  await deleteKeys(env.RAW, keys);
};

export const registerRawWrite = async (
  env: AppEnv,
  key: string,
): Promise<string> => {
  const now = Date.now();
  const token = crypto.randomUUID();
  const row = await env.DB.prepare(
    `insert into raw_cleanup_tasks
       (key, available_at, token, lease_expires_at)
     values (?, ?, ?, ?)
     on conflict(key) do update set
       available_at = excluded.available_at,
       token = excluded.token,
       lease_expires_at = excluded.lease_expires_at,
       attempts = 0,
       last_error = null
     where raw_cleanup_tasks.lease_expires_at is null
        or raw_cleanup_tasks.lease_expires_at <= ?
     returning token`,
  )
    .bind(key, now + RAW_WRITE_STALE_MS, token, now + RAW_CLEANUP_LEASE_MS, now)
    .first<{ token: string }>();
  if (row?.token !== token) {
    throw new RawWriteBusyError('raw object write is already in progress');
  }
  return token;
};

export const clearRawCleanup = async (
  env: AppEnv,
  key: string,
  token: string,
): Promise<void> => {
  await env.DB.prepare(
    'delete from raw_cleanup_tasks where key = ? and token = ?',
  )
    .bind(key, token)
    .run();
};

export const cleanRawObject = async (
  env: AppEnv,
  key: string,
  token: string,
): Promise<boolean> => {
  const owned = await env.DB.prepare(
    `update raw_cleanup_tasks set lease_expires_at = ?
     where key = ? and token = ? returning key`,
  )
    .bind(Date.now() + RAW_CLEANUP_LEASE_MS, key, token)
    .first<{ key: string }>();
  if (!owned) {
    return false;
  }
  await env.RAW.delete(key);
  await clearRawCleanup(env, key, token);
  return true;
};

export const processRawCleanupTasks = async (
  env: AppEnv,
  limit = 100,
): Promise<number> => {
  const rows = await env.DB.prepare(
    `select key from raw_cleanup_tasks
     where available_at <= ? order by available_at limit ?`,
  )
    .bind(Date.now(), limit)
    .all<{ key: string }>();
  let cleaned = 0;
  for (const row of rows.results) {
    const now = Date.now();
    const token = crypto.randomUUID();
    const claimed = await env.DB.prepare(
      `update raw_cleanup_tasks set token = ?, lease_expires_at = ?
       where key = ? and available_at <= ?
         and (lease_expires_at is null or lease_expires_at <= ?)
       returning key`,
    )
      .bind(token, now + RAW_CLEANUP_LEASE_MS, row.key, now, now)
      .first<{ key: string }>();
    if (!claimed) {
      continue;
    }
    const activeReference = await env.DB.prepare(
      `select 1 from results
       join runs on results.run_id = runs.id
       join workspaces on runs.workspace_id = workspaces.id
       join users on workspaces.owner_user_id = users.id
       where results.r2_key = ? and workspaces.deleting_at is null
         and users.deleting_at is null limit 1`,
    )
      .bind(row.key)
      .first();
    if (activeReference) {
      await clearRawCleanup(env, row.key, token);
      continue;
    }
    try {
      if (await cleanRawObject(env, row.key, token)) {
        cleaned += 1;
      }
    } catch (error) {
      await env.DB.prepare(
        `update raw_cleanup_tasks
         set attempts = attempts + 1, last_error = ?, available_at = ?,
             token = null, lease_expires_at = null
         where key = ? and token = ?`,
      )
        .bind(String(error).slice(0, 500), Date.now() + 60_000, row.key, token)
        .run();
    }
  }
  return cleaned;
};
