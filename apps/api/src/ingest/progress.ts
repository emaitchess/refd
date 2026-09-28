import type { RunDispatchPlan } from '../db/schema';
import { SURFACES } from '../providers/types';

// A healthy batch is ready ~25-27m after its trigger. Past this a batch is not
// merely young, it is the provider crawling, and saying so is the whole point of
// surfacing the wait. One definition, shared by the poll backoff and this report,
// so the two can never disagree about what counts as slow.
export const SNAPSHOT_HEALTHY_MS = 30 * 60 * 1000;

export interface RunSurfaceProgress {
  surface: string;
  // Null when the run predates the dispatch plan, so the promised population is
  // unprovable rather than absent. Guessing it would make a legacy run look
  // complete or short on evidence that does not exist.
  expected: number | null;
  stored: number;
  ok: number;
  failed: number;
  missing: number | null;
}

export interface RunInFlightBatch {
  surface: string;
  sample: number;
  chunk: number;
  polls: number | null;
  waitingMs: number;
  slow: boolean;
}

export interface RunProgress {
  expected: number;
  stored: number;
  missing: number;
  settled: boolean;
  healthyMs: number;
  surfaces: RunSurfaceProgress[];
  inFlight: RunInFlightBatch[];
  oldestWaitMs: number | null;
}

export interface RunProgressInput {
  plan: RunDispatchPlan | null;
  totalCount: number;
  results: { surface: string; ok: boolean }[];
  triggered: {
    surface: string;
    sample: number;
    chunk: number;
    polls: number | null;
    createdAt: number;
  }[];
  now: number;
}

const surfaceOrder = (surface: string): number => {
  const index = (SURFACES as readonly string[]).indexOf(surface);
  return index === -1 ? SURFACES.length : index;
};

// Why this exists: a run is `complete` on row count, so a surface that lost
// batches used to end the run quietly short, and the only number on the page
// (okCount/totalCount) could not say which surface was missing what, or whether
// the gap was still in flight or already lost. This makes the shortfall legible
// without changing what `complete` means.
export const runProgress = (input: RunProgressInput): RunProgress => {
  const surfaces = new Set<string>([
    ...(input.plan?.surfaces ?? []),
    ...input.results.map((row) => row.surface),
    ...input.triggered.map((batch) => batch.surface),
  ]);
  const perSurfaceExpected = input.plan
    ? input.plan.prompts.length * input.plan.samples
    : null;

  const bySurface: RunSurfaceProgress[] = [...surfaces]
    .map((surface) => {
      const rows = input.results.filter((row) => row.surface === surface);
      const ok = rows.filter((row) => row.ok).length;
      const expected =
        perSurfaceExpected === null
          ? null
          : input.plan?.surfaces.includes(surface as (typeof SURFACES)[number])
            ? perSurfaceExpected
            : null;
      return {
        surface,
        expected,
        stored: rows.length,
        ok,
        failed: rows.length - ok,
        missing: expected === null ? null : Math.max(0, expected - rows.length),
      };
    })
    .sort((a, b) => surfaceOrder(a.surface) - surfaceOrder(b.surface));

  const inFlight = input.triggered
    .map((batch) => {
      const waitingMs = Math.max(0, input.now - batch.createdAt);
      return {
        surface: batch.surface,
        sample: batch.sample,
        chunk: batch.chunk,
        polls: batch.polls,
        waitingMs,
        slow: waitingMs >= SNAPSHOT_HEALTHY_MS,
      };
    })
    .sort(
      (a, b) =>
        b.waitingMs - a.waitingMs ||
        surfaceOrder(a.surface) - surfaceOrder(b.surface) ||
        a.chunk - b.chunk,
    );

  const stored = input.results.length;
  return {
    expected: input.totalCount,
    stored,
    missing: Math.max(0, input.totalCount - stored),
    settled: stored >= input.totalCount,
    healthyMs: SNAPSHOT_HEALTHY_MS,
    surfaces: bySurface,
    inFlight,
    oldestWaitMs:
      inFlight.length === 0 ? null : (inFlight[0]?.waitingMs ?? null),
  };
};
