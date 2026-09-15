import { and, eq, inArray } from 'drizzle-orm';
import { Hono, type HonoRequest } from 'hono';
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

// BrightData pushes the scraped records themselves to the endpoint: gzipped
// (default) JSON with the snapshot id in the dca-collection-id header, and its
// docs are explicit that endpoint deliveries are the data, not a status note.
// The bytes are stashed in R2 under a deterministic key and processed on the
// queue — the handler must return within 30s, and queue messages cap far
// below a delivery's size. Overwrites converge: redeliveries rewrite the same
// object and per-prompt identity dedupes stored results.
const handleDataDelivery = async (
  env: AppEnv,
  req: HonoRequest,
  snapshotId: string,
): Promise<string> => {
  const filename = (req.header('dca-filename') ?? 'data').replace(
    /[^A-Za-z0-9._-]/g,
    '_',
  );
  const key = `deliveries/${snapshotId}/${filename}`;
  await env.RAW.put(key, req.raw.body, {
    httpMetadata: {
      contentType: req.header('content-type') ?? 'application/json',
      ...(req.header('content-encoding')
        ? { contentEncoding: req.header('content-encoding') }
        : {}),
    },
  });
  console.log(`brightdata webhook: stashed delivery ${key}`);
  return key;
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

    const raw = new Uint8Array(await c.req.arrayBuffer());
    // Route by what the payload really is. BrightData's data deliveries are
    // gzipped (default) JSON with the snapshot id only in the
    // dca-collection-id header; status envelopes are plain JSON objects.
    // A parse that yields {snapshot_id, status} is a status envelope no matter
    // what headers say; everything else routes as data (gzip magic or an array
    // body qualifies, and an ndjson body relying on the header).
    const gzip = raw.length > 1 && raw[0] === 0x1f && raw[1] === 0x8b;
    let envelope: z.infer<typeof webhookBodySchema> | null = null;
    if (!gzip) {
      try {
        const parsed = webhookBodySchema.safeParse(
          JSON.parse(new TextDecoder().decode(raw)),
        );
        if (parsed.success) {
          envelope = parsed.data;
        }
      } catch {
        // Not JSON: records (ndjson) route via the header below.
      }
    }

    if (envelope === null) {
      const snapshotId = c.req.header('dca-collection-id');
      if (!snapshotId) {
        return c.json({ error: 'invalid payload' }, 400);
      }
      const snapshot = await dependencies.findSnapshot(c.env, snapshotId);
      if (!snapshot) {
        console.warn(`brightdata webhook: unknown snapshot ${snapshotId}`);
        return c.json({ ok: true });
      }
      if (snapshot.status !== 'triggered') {
        return c.json({ ok: true });
      }
      const batch = await frozenBatch(c.env, snapshot, dependencies);
      if (batch.length === 0) {
        console.error(
          `brightdata webhook: snapshot ${snapshot.id} has no usable prompts`,
        );
        return c.json({ ok: true });
      }
      const key = await handleDataDelivery(c.env, c.req, snapshotId);
      const message = ingestMessageSchema.safeParse({
        kind: 'brightdata_delivered',
        runId: snapshot.runId,
        workspaceId: snapshot.workspaceId,
        surface: snapshot.surface,
        sample: snapshot.sample,
        chunk: snapshot.chunk,
        snapshotId,
        deliveryKey: key,
        prompts: batch,
      });
      if (!message.success || message.data.kind !== 'brightdata_delivered') {
        console.error(
          'brightdata webhook: invalid delivery context',
          message.success ? [] : message.error.issues,
        );
        return c.json({ ok: true });
      }
      await c.env.INGEST.send(message.data);
      return c.json({ ok: true });
    }

    const snapshot = await dependencies.findSnapshot(
      c.env,
      envelope.snapshot_id,
    );
    if (!snapshot) {
      console.warn(
        `brightdata webhook: unknown snapshot ${envelope.snapshot_id}`,
      );
      return c.json({ ok: true });
    }
    if (snapshot.status !== 'triggered') {
      return c.json({ ok: true });
    }
    if (envelope.status !== 'ready' && envelope.status !== 'failed') {
      return c.json({ ok: true });
    }

    const batch = await frozenBatch(c.env, snapshot, dependencies);
    if (batch.length === 0) {
      console.error(
        `brightdata webhook: snapshot ${snapshot.id} has no usable prompts`,
      );
      return c.json({ ok: true });
    }

    if (envelope.status === 'failed') {
      await dependencies.failSnapshot(
        c.env,
        snapshot,
        batch,
        envelope.snapshot_id,
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
      snapshotId: envelope.snapshot_id,
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
