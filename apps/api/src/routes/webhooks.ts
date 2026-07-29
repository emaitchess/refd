import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../db/client';
import { prompts, runs, type SnapshotPrompt, snapshots } from '../db/schema';
import type { AppBindings, AppEnv } from '../env';
import { failWholeSnapshot } from '../ingest/consumer';
import {
  ingestMessageSchema,
  type RunPrompt,
  runPromptSchema,
} from '../ingest/messages';

const webhookBodySchema = z.object({
  snapshot_id: z.string().min(1).max(256),
  status: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .transform((status) => status.toLowerCase()),
});

interface WebhookSnapshot {
  id: number;
  runId: number;
  workspaceId: number;
  surface: string;
  sample: number;
  chunk: number;
  status: 'triggered' | 'ready' | 'failed';
  promptIds: number[] | null;
  promptSnapshot: SnapshotPrompt[] | null;
  polls: number | null;
}

interface WebhookDependencies {
  findSnapshot: (
    env: AppEnv,
    snapshotId: string,
  ) => Promise<WebhookSnapshot | null>;
  loadLegacyPrompts: (
    env: AppEnv,
    snapshot: WebhookSnapshot,
  ) => Promise<RunPrompt[]>;
  failSnapshot: (
    env: AppEnv,
    snapshot: WebhookSnapshot,
    batch: RunPrompt[],
    snapshotId: string,
  ) => Promise<void>;
}

const findSnapshot = async (
  env: AppEnv,
  snapshotId: string,
): Promise<WebhookSnapshot | null> => {
  const row = (
    await getDb(env)
      .select({
        id: snapshots.id,
        runId: snapshots.runId,
        workspaceId: runs.workspaceId,
        surface: snapshots.surface,
        sample: snapshots.sample,
        chunk: snapshots.chunk,
        status: snapshots.status,
        promptIds: snapshots.promptIds,
        promptSnapshot: snapshots.promptSnapshot,
        polls: snapshots.polls,
      })
      .from(snapshots)
      .innerJoin(runs, eq(runs.id, snapshots.runId))
      .where(
        and(
          eq(snapshots.externalId, snapshotId),
          eq(snapshots.provider, 'brightdata'),
        ),
      )
  )[0];
  return row ?? null;
};

const loadLegacyPrompts = async (
  env: AppEnv,
  snapshot: WebhookSnapshot,
): Promise<RunPrompt[]> => {
  const ids = z.array(z.number().int()).safeParse(snapshot.promptIds);
  if (!ids.success || ids.data.length === 0) {
    return [];
  }
  const rows = await getDb(env)
    .select({ id: prompts.id, text: prompts.text })
    .from(prompts)
    .where(
      and(
        inArray(prompts.id, ids.data),
        eq(prompts.workspaceId, snapshot.workspaceId),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row.text]));
  return ids.data.flatMap((id) => {
    const text = byId.get(id);
    return text === undefined ? [] : [{ id, text }];
  });
};

const failSnapshot = async (
  env: AppEnv,
  snapshot: WebhookSnapshot,
  batch: RunPrompt[],
  snapshotId: string,
): Promise<void> => {
  const parsed = ingestMessageSchema.safeParse({
    kind: 'brightdata_fetch',
    runId: snapshot.runId,
    workspaceId: snapshot.workspaceId,
    surface: snapshot.surface,
    sample: snapshot.sample,
    chunk: snapshot.chunk,
    snapshotId,
    prompts: batch,
  });
  if (!parsed.success || parsed.data.kind !== 'brightdata_fetch') {
    console.error(
      'brightdata webhook: invalid failed-snapshot context',
      parsed.success ? [] : parsed.error.issues,
    );
    return;
  }
  await failWholeSnapshot(
    env,
    parsed.data.runId,
    parsed.data.surface,
    parsed.data.sample,
    parsed.data.chunk,
    parsed.data.prompts,
    `snapshot ${snapshotId} failed at provider`,
    snapshot.polls,
  );
};

const defaultDependencies: WebhookDependencies = {
  findSnapshot,
  loadLegacyPrompts,
  failSnapshot,
};

export const secretsEqual = async (
  incoming: string,
  expected: string,
): Promise<boolean> => {
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (
      left: ArrayBuffer | ArrayBufferView,
      right: ArrayBuffer | ArrayBufferView,
    ) => boolean;
  };
  const encoder = new TextEncoder();
  const [incomingDigest, expectedDigest] = await Promise.all([
    subtle.digest('SHA-256', encoder.encode(incoming)),
    subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  if (typeof subtle.timingSafeEqual === 'function') {
    return subtle.timingSafeEqual(incomingDigest, expectedDigest);
  }
  // Bun's test WebCrypto omits workerd's timingSafeEqual extension. Both
  // digests are fixed-length, so this fallback still performs every compare.
  const left = new Uint8Array(incomingDigest);
  const right = new Uint8Array(expectedDigest);
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return mismatch === 0;
};

const frozenBatch = async (
  env: AppEnv,
  snapshot: WebhookSnapshot,
  dependencies: WebhookDependencies,
): Promise<RunPrompt[]> => {
  const frozen = z.array(runPromptSchema).safeParse(snapshot.promptSnapshot);
  if (frozen.success && frozen.data.length > 0) {
    return frozen.data;
  }
  console.warn(
    `brightdata webhook: snapshot ${snapshot.id} has no frozen prompt batch; using live prompt fallback`,
  );
  return dependencies.loadLegacyPrompts(env, snapshot);
};

export const createWebhookRoutes = (
  dependencies: WebhookDependencies = defaultDependencies,
) => {
  const routes = new Hono<AppBindings>();

  routes.post('/brightdata', async (c) => {
    const secret = c.env.BRIGHTDATA_WEBHOOK_SECRET;
    if (!secret) {
      return c.json({ error: 'not found' }, 404);
    }
    const authorized = await secretsEqual(
      c.req.header('Authorization') ?? '',
      secret,
    );
    if (!authorized) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const body = webhookBodySchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) {
      return c.json({ error: 'invalid payload' }, 400);
    }

    const snapshot = await dependencies.findSnapshot(
      c.env,
      body.data.snapshot_id,
    );
    if (!snapshot) {
      console.warn(
        `brightdata webhook: unknown snapshot ${body.data.snapshot_id}`,
      );
      return c.json({ ok: true });
    }
    if (snapshot.status !== 'triggered') {
      return c.json({ ok: true });
    }
    if (body.data.status !== 'ready' && body.data.status !== 'failed') {
      return c.json({ ok: true });
    }

    const batch = await frozenBatch(c.env, snapshot, dependencies);
    if (batch.length === 0) {
      console.error(
        `brightdata webhook: snapshot ${snapshot.id} has no usable prompts`,
      );
      return c.json({ ok: true });
    }

    if (body.data.status === 'failed') {
      await dependencies.failSnapshot(
        c.env,
        snapshot,
        batch,
        body.data.snapshot_id,
      );
      return c.json({ ok: true });
    }

    const message = ingestMessageSchema.safeParse({
      kind: 'brightdata_fetch',
      runId: snapshot.runId,
      workspaceId: snapshot.workspaceId,
      surface: snapshot.surface,
      sample: snapshot.sample,
      chunk: snapshot.chunk,
      snapshotId: body.data.snapshot_id,
      prompts: batch,
    });
    if (!message.success || message.data.kind !== 'brightdata_fetch') {
      console.error(
        'brightdata webhook: invalid snapshot context',
        message.success ? [] : message.error.issues,
      );
      return c.json({ ok: true });
    }
    await c.env.INGEST.send(message.data);
    return c.json({ ok: true });
  });

  return routes;
};

export const webhookRoutes = createWebhookRoutes();
