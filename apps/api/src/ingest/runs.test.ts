import { describe, expect, test } from 'bun:test';
import type { AppEnv } from '../env';
import {
  buildRunDispatchPlan,
  chunk,
  dispatchMessageBatches,
  messagesForRun,
  runDispatchPlanSchema,
} from './dispatch';
import { promptBatchSize, samplesFor } from './runs';

describe('chunk', () => {
  test('splits into fixed-size batches, last one smaller', () => {
    expect(chunk([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7],
    ]);
  });

  test('an exact multiple has no short trailing batch', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  test('a size larger than the input is a single batch', () => {
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
  });

  test('empty input yields no batches', () => {
    expect(chunk([], 5)).toEqual([]);
  });

  test('a non-positive size falls back to 1 rather than looping forever', () => {
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
  });
});

describe('promptBatchSize', () => {
  const env = (value: string | undefined) =>
    ({ PROMPT_BATCH_SIZE: value }) as unknown as AppEnv;

  test('parses the configured value', () => {
    expect(promptBatchSize(env('5'))).toBe(5);
    expect(promptBatchSize(env('10'))).toBe(10);
  });

  test('defaults to 5 when missing, invalid, or non-positive', () => {
    expect(promptBatchSize(env(undefined))).toBe(5);
    expect(promptBatchSize(env('abc'))).toBe(5);
    expect(promptBatchSize(env('0'))).toBe(5);
    expect(promptBatchSize(env('-3'))).toBe(5);
  });
});

describe('samplesFor', () => {
  const env = (value: string | undefined) =>
    ({ SAMPLES: value }) as unknown as AppEnv;

  test('parses an explicit positive sample count', () => {
    expect(samplesFor(env('1'))).toBe(1);
    expect(samplesFor(env('3'))).toBe(3);
  });

  test('defaults to 1 when missing, invalid, or non-positive', () => {
    expect(samplesFor(env(undefined))).toBe(1);
    expect(samplesFor(env('abc'))).toBe(1);
    expect(samplesFor(env('0'))).toBe(1);
    expect(samplesFor(env('-3'))).toBe(1);
  });
});

describe('run dispatch plans', () => {
  test('reconstructs the complete deterministic message order', () => {
    const plan = buildRunDispatchPlan({
      prompts: [
        { id: 10, text: 'first prompt' },
        { id: 20, text: 'second prompt' },
      ],
      surfaces: ['chatgpt', 'google_aio'],
      samples: 2,
      promptBatchSize: 1,
    });

    expect(plan.expectedMessages).toBe(8);
    expect(messagesForRun(plan, 30, 40)).toEqual([
      {
        kind: 'brightdata_trigger',
        runId: 30,
        workspaceId: 40,
        surface: 'chatgpt',
        sample: 1,
        chunk: 0,
        prompts: [{ id: 10, text: 'first prompt' }],
      },
      {
        kind: 'brightdata_trigger',
        runId: 30,
        workspaceId: 40,
        surface: 'chatgpt',
        sample: 1,
        chunk: 1,
        prompts: [{ id: 20, text: 'second prompt' }],
      },
      {
        kind: 'serp_aio_fetch',
        runId: 30,
        workspaceId: 40,
        prompt: { id: 10, text: 'first prompt' },
        sample: 1,
      },
      {
        kind: 'serp_aio_fetch',
        runId: 30,
        workspaceId: 40,
        prompt: { id: 20, text: 'second prompt' },
        sample: 1,
      },
      {
        kind: 'brightdata_trigger',
        runId: 30,
        workspaceId: 40,
        surface: 'chatgpt',
        sample: 2,
        chunk: 0,
        prompts: [{ id: 10, text: 'first prompt' }],
      },
      {
        kind: 'brightdata_trigger',
        runId: 30,
        workspaceId: 40,
        surface: 'chatgpt',
        sample: 2,
        chunk: 1,
        prompts: [{ id: 20, text: 'second prompt' }],
      },
      {
        kind: 'serp_aio_fetch',
        runId: 30,
        workspaceId: 40,
        prompt: { id: 10, text: 'first prompt' },
        sample: 2,
      },
      {
        kind: 'serp_aio_fetch',
        runId: 30,
        workspaceId: 40,
        prompt: { id: 20, text: 'second prompt' },
        sample: 2,
      },
    ]);
  });

  test('rejects duplicate or non-canonical surfaces', () => {
    const base = {
      version: 1 as const,
      prompts: [{ id: 1, text: 'a prompt' }],
      samples: 1,
      promptBatchSize: 5,
      expectedMessages: 2,
    };
    expect(
      runDispatchPlanSchema.safeParse({
        ...base,
        surfaces: ['chatgpt', 'chatgpt'],
      }).success,
    ).toBe(false);
    expect(
      runDispatchPlanSchema.safeParse({
        ...base,
        surfaces: ['google_aio', 'chatgpt'],
      }).success,
    ).toBe(false);
  });

  test('rejects a stored expected count that does not match the plan', () => {
    expect(
      runDispatchPlanSchema.safeParse({
        version: 1,
        prompts: [{ id: 1, text: 'a prompt' }],
        surfaces: ['chatgpt'],
        samples: 1,
        promptBatchSize: 5,
        expectedMessages: 2,
      }).success,
    ).toBe(false);
  });

  test('rejects a launch plan too large for one D1 row', () => {
    expect(() =>
      buildRunDispatchPlan({
        prompts: Array.from({ length: 2_100 }, (_, index) => ({
          id: index + 1,
          text: 'x'.repeat(500),
        })),
        surfaces: ['chatgpt'],
        samples: 1,
        promptBatchSize: 5,
      }),
    ).toThrow('dispatch plan exceeds the persisted size limit');
  });
});

describe('dispatchMessageBatches', () => {
  const messages = messagesForRun(
    buildRunDispatchPlan({
      prompts: Array.from({ length: 205 }, (_, index) => ({
        id: index + 1,
        text: `prompt ${index + 1}`,
      })),
      surfaces: ['google_aio'],
      samples: 1,
      promptBatchSize: 5,
    }),
    1,
    2,
  );

  test('resumes at the persisted cursor and advances after each accepted batch', async () => {
    const sent: number[] = [];
    const cursors: number[] = [];
    await dispatchMessageBatches(
      messages,
      100,
      async (batch) => {
        sent.push(batch.length);
      },
      async (cursor) => {
        cursors.push(cursor);
      },
    );
    expect(sent).toEqual([100, 5]);
    expect(cursors).toEqual([200, 205]);
  });

  test('does not advance past a batch the queue rejected', async () => {
    let sends = 0;
    const cursors: number[] = [];
    await expect(
      dispatchMessageBatches(
        messages,
        0,
        async () => {
          sends += 1;
          if (sends === 2) {
            throw new Error('queue unavailable');
          }
        },
        async (cursor) => {
          cursors.push(cursor);
        },
      ),
    ).rejects.toThrow('queue unavailable');
    expect(cursors).toEqual([100]);
  });

  test('rejects a cursor outside the frozen message list', async () => {
    await expect(
      dispatchMessageBatches(
        messages,
        206,
        async () => {},
        async () => {},
      ),
    ).rejects.toThrow('invalid run dispatch cursor');
  });

  test('rejects a message too large for Cloudflare Queues', async () => {
    const oversizedMessages = messagesForRun(
      buildRunDispatchPlan({
        prompts: Array.from({ length: 300 }, (_, index) => ({
          id: index + 1,
          text: 'x'.repeat(500),
        })),
        surfaces: ['chatgpt'],
        samples: 1,
        promptBatchSize: 300,
      }),
      1,
      2,
    );
    let sent = false;
    await expect(
      dispatchMessageBatches(
        oversizedMessages,
        0,
        async () => {
          sent = true;
        },
        async () => {},
      ),
    ).rejects.toThrow('run dispatch message exceeds the queue size limit');
    expect(sent).toBe(false);
  });
});
