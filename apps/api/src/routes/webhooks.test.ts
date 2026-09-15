import { describe, expect, test } from 'bun:test';
import type { AppEnv } from '../env';
import type { IngestMessage, RunPrompt } from '../ingest/messages';
import { createWebhookRoutes, secretsEqual } from './webhooks';

type SnapshotFixture = {
  id: number;
  runId: number;
  workspaceId: number;
  surface: string;
  sample: number;
  chunk: number;
  status: 'triggered' | 'ready' | 'failed';
  promptIds: number[];
  promptSnapshot: RunPrompt[];
  polls: number | null;
};

const snapshot: SnapshotFixture = {
  id: 12,
  runId: 34,
  workspaceId: 56,
  surface: 'chatgpt',
  sample: 2,
  chunk: 3,
  status: 'triggered' as const,
  promptIds: [78],
  promptSnapshot: [{ id: 78, text: 'best tools' }],
  polls: null,
};

const request = (
  routes: ReturnType<typeof createWebhookRoutes>,
  env: AppEnv,
  body: unknown,
  authorization = 'callback-secret',
  headers: Record<string, string> = {},
) =>
  routes.request(
    'http://local/brightdata',
    {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    },
    env,
  );

const deliveryRequest = (
  routes: ReturnType<typeof createWebhookRoutes>,
  env: AppEnv,
  body: Uint8Array | string,
  headers: Record<string, string> = {},
  authorization = 'callback-secret',
) =>
  routes.request(
    'http://local/brightdata',
    {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body === undefined ? null : (body as BodyInit),
    },
    env,
  );

const setup = (
  overrides: { found?: SnapshotFixture | null; secret?: string } = {},
) => {
  const sent: IngestMessage[] = [];
  const failed: { batch: RunPrompt[]; snapshotId: string }[] = [];
  const stashed: { key: string; meta?: unknown }[] = [];
  let lookups = 0;
  const found = overrides.found === undefined ? snapshot : overrides.found;
  const routes = createWebhookRoutes({
    findSnapshot: async () => {
      lookups += 1;
      return found;
    },
    loadLegacyPrompts: async () => [],
    failSnapshot: async (_env, _snapshot, batch, snapshotId) => {
      failed.push({ batch, snapshotId });
    },
  });
  const env = {
    BRIGHTDATA_WEBHOOK_SECRET:
      overrides.secret === undefined ? 'callback-secret' : overrides.secret,
    INGEST: {
      send: async (message: IngestMessage) => {
        sent.push(message);
      },
    },
    RAW: {
      put: async (key: string, _body: ReadableStream, meta?: unknown) => {
        stashed.push({ key, meta });
      },
    },
  } as unknown as AppEnv;
  return { env, failed, lookups: () => lookups, routes, sent, stashed };
};

describe('BrightData webhook', () => {
  test('a ready callback enqueues a direct fetch from the frozen prompt batch', async () => {
    const state = setup();
    const response = await request(state.routes, state.env, {
      snapshot_id: 'snap_1',
      status: 'ready',
      result_url: 'https://example.invalid/result',
    });

    expect(response.status).toBe(200);
    expect(state.sent).toEqual([
      {
        kind: 'brightdata_fetch',
        runId: 34,
        workspaceId: 56,
        surface: 'chatgpt',
        sample: 2,
        chunk: 3,
        snapshotId: 'snap_1',
        prompts: [{ id: 78, text: 'best tools' }],
      },
    ]);
  });

  test('a failed callback marks the provider snapshot failed', async () => {
    const state = setup();
    const response = await request(state.routes, state.env, {
      snapshot_id: 'snap_failed',
      status: 'failed',
    });

    expect(response.status).toBe(200);
    expect(state.sent).toEqual([]);
    expect(state.failed).toEqual([
      {
        batch: [{ id: 78, text: 'best tools' }],
        snapshotId: 'snap_failed',
      },
    ]);
  });

  test('rejects a bad secret before looking up a snapshot', async () => {
    const state = setup();
    const response = await request(
      state.routes,
      state.env,
      { snapshot_id: 'snap_1', status: 'ready' },
      'wrong-secret',
    );

    expect(response.status).toBe(401);
    expect(state.lookups()).toBe(0);
    expect(state.sent).toEqual([]);
  });

  test('returns not found when webhook delivery is not configured', async () => {
    const state = setup({ secret: '' });
    const response = await request(state.routes, state.env, {
      snapshot_id: 'snap_1',
      status: 'ready',
    });

    expect(response.status).toBe(404);
    expect(state.lookups()).toBe(0);
  });

  test('acks an unknown snapshot without enqueuing work', async () => {
    const state = setup({ found: null });
    const response = await request(state.routes, state.env, {
      snapshot_id: 'unknown',
      status: 'ready',
    });

    expect(response.status).toBe(200);
    expect(state.sent).toEqual([]);
  });

  test('rejects malformed JSON after authentication', async () => {
    const state = setup();
    const response = await state.routes.request(
      'http://local/brightdata',
      {
        method: 'POST',
        headers: {
          Authorization: 'callback-secret',
          'Content-Type': 'application/json',
        },
        body: '{',
      },
      state.env,
    );

    expect(response.status).toBe(400);
    expect(state.lookups()).toBe(0);
  });

  test('terminal snapshots and running notifications are idempotent no-ops', async () => {
    const terminal = setup({
      found: { ...snapshot, status: 'ready' },
    });
    const terminalResponse = await request(terminal.routes, terminal.env, {
      snapshot_id: 'snap_1',
      status: 'ready',
    });
    const running = setup();
    const runningResponse = await request(running.routes, running.env, {
      snapshot_id: 'snap_2',
      status: 'running',
    });

    expect(terminalResponse.status).toBe(200);
    expect(runningResponse.status).toBe(200);
    expect(terminal.sent).toEqual([]);
    expect(running.sent).toEqual([]);
  });
});

describe('BrightData data delivery', () => {
  const records = [
    { prompt: 'best tools', answer_text: 'A' },
    { prompt: 'more tools', answer_text: 'B' },
  ];

  test('a JSON array body is stashed in R2 and enqueued as a delivered message', async () => {
    const state = setup();
    const response = await deliveryRequest(
      state.routes,
      state.env,
      JSON.stringify(records),
      { 'dca-collection-id': 'snap_delivered', 'dca-filename': 'part-1.json' },
    );

    expect(response.status).toBe(200);
    expect(state.stashed).toEqual([
      { key: 'deliveries/snap_delivered/part-1.json', meta: expect.anything() },
    ]);
    expect(state.sent).toEqual([
      {
        kind: 'brightdata_delivered',
        runId: 34,
        workspaceId: 56,
        surface: 'chatgpt',
        sample: 2,
        chunk: 3,
        snapshotId: 'snap_delivered',
        deliveryKey: 'deliveries/snap_delivered/part-1.json',
        prompts: [{ id: 78, text: 'best tools' }],
      },
    ]);
  });

  test('a gzip body routes as data even when its decompressed shape would not parse as JSON', async () => {
    const state = setup();
    // A gzip header on arbitrary bytes routes to the delivery path: the
    // snapshot lookup happens before the stash.
    const key = 'deliveries/snap_delivered/binary';
    const bytes = new Uint8Array([0x1f, 0x8b, 0x00]);
    const response = await deliveryRequest(state.routes, state.env, bytes, {
      'dca-collection-id': 'snap_delivered',
      'dca-filename': 'binary',
    });

    expect(response.status).toBe(200);
    expect(state.stashed).toEqual([
      { key: 'deliveries/snap_delivered/binary', meta: expect.anything() },
    ]);
    expect(state.sent[0]?.kind).toBe('brightdata_delivered');
    expect(key.startsWith('deliveries/snap_delivered/')).toBe(true);
  });

  test('an unknown snapshot is acknowledged without stashing', async () => {
    const state = setup({ found: null });
    const response = await deliveryRequest(
      state.routes,
      state.env,
      JSON.stringify(records),
      { 'dca-collection-id': 'unknown' },
    );

    expect(response.status).toBe(200);
    expect(state.stashed).toEqual([]);
    expect(state.sent).toEqual([]);
  });

  test('a terminal snapshot does not stash or enqueue', async () => {
    const state = setup({ found: { ...snapshot, status: 'ready' } });
    const response = await deliveryRequest(
      state.routes,
      state.env,
      JSON.stringify(records),
      { 'dca-collection-id': 'snap_delivered' },
    );

    expect(response.status).toBe(200);
    expect(state.stashed).toEqual([]);
    expect(state.sent).toEqual([]);
  });

  test('a data-shaped body without a dca-collection-id header is refused', async () => {
    const state = setup();
    const response = await deliveryRequest(
      state.routes,
      state.env,
      JSON.stringify(records),
    );

    expect(response.status).toBe(400);
    expect(state.stashed).toEqual([]);
    expect(state.sent).toEqual([]);
  });

  test('unauthenticated deliveries are refused before any lookup', async () => {
    const state = setup();
    const response = await deliveryRequest(
      state.routes,
      state.env,
      JSON.stringify(records),
      { 'dca-collection-id': 'snap_delivered' },
      'wrong-secret',
    );

    expect(response.status).toBe(401);
    expect(state.lookups()).toBe(0);
    expect(state.stashed).toEqual([]);
  });
});

describe('secretsEqual', () => {
  test('compares webhook secrets without early-returning on content', async () => {
    await expect(secretsEqual('same', 'same')).resolves.toBe(true);
    await expect(secretsEqual('different', 'same')).resolves.toBe(false);
  });
});
