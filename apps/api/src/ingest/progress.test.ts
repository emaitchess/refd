import { describe, expect, test } from 'bun:test';
import { buildRunDispatchPlan } from './dispatch';
import { runProgress, SNAPSHOT_HEALTHY_MS } from './progress';

const NOW = 1_800_000_000_000;

const plan = (prompts: number, surfaces: string[], samples = 1) =>
  buildRunDispatchPlan({
    prompts: Array.from({ length: prompts }, (_, index) => ({
      id: index + 1,
      text: `prompt ${index + 1}`,
    })),
    surfaces: surfaces as never,
    samples,
    promptBatchSize: 5,
  });

const cells = (surface: string, count: number, ok = count) =>
  Array.from({ length: count }, () => ({ surface, ok: true })).map((row, i) =>
    i < ok ? row : { surface, ok: false },
  );

describe('runProgress', () => {
  test('a settled run reports no gap and names its population', () => {
    const p = plan(4, ['chatgpt', 'gemini']);
    const result = runProgress({
      plan: p,
      totalCount: 8,
      results: [...cells('chatgpt', 4), ...cells('gemini', 4)],
      triggered: [],
      now: NOW,
    });

    expect(result.settled).toBe(true);
    expect(result.missing).toBe(0);
    expect(result.surfaces).toEqual([
      {
        surface: 'chatgpt',
        expected: 4,
        stored: 4,
        ok: 4,
        failed: 0,
        missing: 0,
      },
      {
        surface: 'gemini',
        expected: 4,
        stored: 4,
        ok: 4,
        failed: 0,
        missing: 0,
      },
    ]);
  });

  // The 2026-09-27 case: the run ended `complete` on row count while one
  // surface had lost 8 of 12 batches. Every cell has a row, so `missing` is 0
  // and the shortfall only shows as failed cells per surface.
  test('separates failed cells from missing cells, per surface', () => {
    const p = plan(4, ['chatgpt', 'google_ai_mode']);
    const result = runProgress({
      plan: p,
      totalCount: 8,
      results: [
        ...cells('chatgpt', 4),
        ...cells('google_ai_mode', 1),
        ...cells('google_ai_mode', 3, 0),
      ],
      triggered: [],
      now: NOW,
    });

    expect(result.settled).toBe(true);
    expect(result.missing).toBe(0);
    expect(result.surfaces.find((s) => s.surface === 'google_ai_mode')).toEqual(
      {
        surface: 'google_ai_mode',
        expected: 4,
        stored: 4,
        ok: 1,
        failed: 3,
        missing: 0,
      },
    );
  });

  test('counts an unstarted cell as missing while the run is still going', () => {
    const p = plan(4, ['chatgpt', 'gemini']);
    const result = runProgress({
      plan: p,
      totalCount: 8,
      results: cells('chatgpt', 4),
      triggered: [
        {
          surface: 'gemini',
          sample: 1,
          chunk: 0,
          polls: null,
          createdAt: NOW - 600_000,
        },
      ],
      now: NOW,
    });

    expect(result.settled).toBe(false);
    expect(result.missing).toBe(4);
    const gemini = result.surfaces.find((s) => s.surface === 'gemini');
    expect(gemini?.missing).toBe(4);
  });

  test('surfaces in-flight batches oldest first so a stall is readable', () => {
    const p = plan(4, ['google_ai_mode']);
    const result = runProgress({
      plan: p,
      totalCount: 4,
      results: [],
      triggered: [
        {
          surface: 'google_ai_mode',
          sample: 1,
          chunk: 2,
          polls: 12,
          createdAt: NOW - 120_000,
        },
        {
          surface: 'google_ai_mode',
          sample: 1,
          chunk: 0,
          polls: 58,
          createdAt: NOW - 2_820_000,
        },
        {
          surface: 'google_ai_mode',
          sample: 1,
          chunk: 1,
          polls: 30,
          createdAt: NOW - 900_000,
        },
      ],
      now: NOW,
    });

    expect(result.inFlight.map((b) => b.chunk)).toEqual([0, 1, 2]);
    expect(result.oldestWaitMs).toBe(2_820_000);
    expect(result.inFlight[0]?.polls).toBe(58);
  });

  test('marks a batch slow past the healthy window, using the shared constant', () => {
    const p = plan(4, ['google_ai_mode']);
    const result = runProgress({
      plan: p,
      totalCount: 4,
      results: [],
      triggered: [
        {
          surface: 'google_ai_mode',
          sample: 1,
          chunk: 0,
          polls: 3,
          createdAt: NOW - (SNAPSHOT_HEALTHY_MS - 1_000),
        },
        {
          surface: 'google_ai_mode',
          sample: 1,
          chunk: 1,
          polls: 40,
          createdAt: NOW - (SNAPSHOT_HEALTHY_MS + 60_000),
        },
      ],
      now: NOW,
    });

    expect(result.healthyMs).toBe(SNAPSHOT_HEALTHY_MS);
    expect(result.inFlight.map((b) => b.slow)).toEqual([true, false]);
  });

  test('reports no in-flight batches as no wait rather than zero', () => {
    const p = plan(2, ['chatgpt']);
    const result = runProgress({
      plan: p,
      totalCount: 2,
      results: cells('chatgpt', 2),
      triggered: [],
      now: NOW,
    });

    expect(result.inFlight).toEqual([]);
    expect(result.oldestWaitMs).toBeNull();
  });

  // A pre-plan run cannot prove what it promised, so per-surface expectations
  // stay null rather than being back-filled from a guess.
  test('leaves per-surface expectations unknown for a run with no dispatch plan', () => {
    const result = runProgress({
      plan: null,
      totalCount: 6,
      results: cells('chatgpt', 4),
      triggered: [],
      now: NOW,
    });

    expect(result.expected).toBe(6);
    expect(result.missing).toBe(2);
    expect(result.surfaces).toEqual([
      {
        surface: 'chatgpt',
        expected: null,
        stored: 4,
        ok: 4,
        failed: 0,
        missing: null,
      },
    ]);
  });

  test('clamps a negative gap when a run stored more rows than it promised', () => {
    const p = plan(2, ['chatgpt']);
    const result = runProgress({
      plan: p,
      totalCount: 2,
      results: cells('chatgpt', 5),
      triggered: [],
      now: NOW,
    });

    expect(result.missing).toBe(0);
    expect(result.surfaces[0]?.missing).toBe(0);
  });

  test('orders surfaces canonically regardless of arrival order', () => {
    const p = plan(2, ['chatgpt', 'gemini', 'google_ai_mode']);
    const result = runProgress({
      plan: p,
      totalCount: 6,
      results: [
        ...cells('google_ai_mode', 2),
        ...cells('gemini', 2),
        ...cells('chatgpt', 2),
      ],
      triggered: [],
      now: NOW,
    });

    expect(result.surfaces.map((s) => s.surface)).toEqual([
      'chatgpt',
      'gemini',
      'google_ai_mode',
    ]);
  });
});
