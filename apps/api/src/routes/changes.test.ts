import { describe, expect, test } from 'bun:test';
import { METRIC_INFO } from '@refd/core/metric-copy';
import {
  detectChanges,
  detectDrift,
  MIN_CELLS,
  mergeEvents,
  POSITION_RANKS,
  RATE_PP,
  SENTIMENT_PP,
  SOV_PP,
  TREND_WINDOWS,
  type WindowSlice,
} from './changes';
import type { EntityInfo, ScoreRow } from './metrics';

const BRAND = 1;
const COMP = 2;

const brand: EntityInfo = {
  id: BRAND,
  name: 'mrmr',
  domains: [],
  aliases: [],
  isBrand: true,
  sortOrder: 0,
};
const comp: EntityInfo = {
  id: COMP,
  name: 'Rival',
  domains: [],
  aliases: [],
  isBrand: false,
  sortOrder: 1,
};
const entities = [brand, comp];

const row = (
  runId: number,
  promptId: number,
  over: Partial<ScoreRow> = {},
): ScoreRow => ({
  runId,
  date: runId === 2 ? '2026-07-20' : '2026-07-19',
  entitySetHash: 'h',
  promptId,
  surface: 'chatgpt',
  sample: 1,
  entityId: BRAND,
  mentioned: false,
  cited: false,
  position: null,
  prominence: null,
  sentiment: null,
  ...over,
});

// One comparison window. The tests drive detectChanges directly, so a window
// stands in for whatever span of runs the loader pooled into it.
const slice = (
  runId: number,
  rows: ScoreRow[],
  hash: string | null = 'h',
): WindowSlice => ({
  window: {
    from: runId === 2 ? '2026-07-20' : '2026-07-14',
    to: runId === 2 ? '2026-07-26' : '2026-07-19',
    runs: 7,
    answers: rows.length,
    entitySetHash: hash,
  },
  rows,
});

const prompts = [1, 2, 3, 4];

describe('detectChanges', () => {
  test('reports a material brand mention drop', () => {
    const previous = slice(
      1,
      prompts.map((p) => row(1, p, { mentioned: true })),
    );
    const latest = slice(
      2,
      prompts.map((p) => row(2, p)),
    );
    const report = detectChanges(latest, previous, entities, brand);
    expect(report.status).toBe('ok');
    const event = report.events[0];
    expect(event?.type).toBe('mention_rate');
    expect(event?.scope).toBe('overall');
    expect(event?.direction).toBe('down');
    expect(event?.good).toBe(false);
    expect(event?.delta).toBe(-1);
    expect(event?.headline).toContain('Mention rate');
    expect(event?.question).toContain('100%');
    expect(event?.span).toBe('shift');
    expect(event?.question).toContain('7 days');
  });

  test('stays silent under the material threshold', () => {
    const many = Array.from({ length: 50 }, (_, i) => i + 1);
    const previous = slice(
      1,
      many.map((p) => row(1, p, { mentioned: p <= 25 })),
    );
    const latest = slice(
      2,
      many.map((p) => row(2, p, { mentioned: p <= 24 })),
    );
    const report = detectChanges(latest, previous, entities, brand);
    expect(report.status).toBe('ok');
    expect(report.events).toHaveLength(0);
  });

  test('a subset run cannot fabricate a change: only shared cells compare', () => {
    // Previous run: prompts 1-4 unmentioned, 5-8 mentioned (overall 50%).
    // Latest is a subset run covering only 5-8, all mentioned (its own 100%).
    // Naive comparison would report a 50pt rise; the intersection knows the
    // shared cells did not move.
    const previous = slice(1, [
      ...prompts.map((p) => row(1, p)),
      ...prompts.map((p) => row(1, p + 4, { mentioned: true })),
    ]);
    const latest = slice(
      2,
      prompts.map((p) => row(2, p + 4, { mentioned: true })),
    );
    const report = detectChanges(latest, previous, entities, brand);
    expect(report.status).toBe('ok');
    expect(report.promptCount).toBe(4);
    expect(report.events).toHaveLength(0);
  });

  test('too few shared cells reports thin-overlap and no events', () => {
    const previous = slice(1, [
      row(1, 1, { mentioned: true }),
      row(1, 2, { mentioned: true }),
    ]);
    const latest = slice(2, [row(2, 1), row(2, 2)]);
    const report = detectChanges(latest, previous, entities, brand);
    expect(report.status).toBe('thin-overlap');
    expect(report.cells).toBeLessThan(MIN_CELLS);
    expect(report.events).toHaveLength(0);
  });

  test('an entity-set change suppresses relative events but keeps rate events', () => {
    // Brand mention drop (absolute, should survive) + huge position and
    // competitor movement (relative, must be suppressed) across a set change.
    const previous = slice(
      1,
      prompts.flatMap((p) => [
        row(1, p, { mentioned: true, position: 1 }),
        row(1, p, { entityId: COMP }),
      ]),
    );
    const latest = slice(
      2,
      prompts.flatMap((p) => [
        row(2, p, { mentioned: p === 1, position: p === 1 ? 3 : null }),
        row(2, p, { entityId: COMP, mentioned: true, position: 1 }),
      ]),
      'h2',
    );
    const report = detectChanges(latest, previous, entities, brand);
    expect(report.entitySetChanged).toBe(true);
    expect(report.events.map((e) => e.type)).toEqual(['mention_rate']);
  });

  test('reports a competitor appearing across shared cells', () => {
    const previous = slice(
      1,
      prompts.flatMap((p) => [
        row(1, p, { mentioned: true }),
        row(1, p, { entityId: COMP }),
      ]),
    );
    const latest = slice(
      2,
      prompts.flatMap((p) => [
        row(2, p, { mentioned: true }),
        row(2, p, { entityId: COMP, mentioned: true }),
      ]),
    );
    const report = detectChanges(latest, previous, entities, brand);
    const event = report.events.find((e) => e.type === 'competitor');
    expect(event?.entity).toBe('Rival');
    expect(event?.direction).toBe('up');
    expect(event?.good).toBe(false);
    // The mirror move never fires: competitor fades are dashboard material,
    // not alerts.
    const faded = detectChanges(previous, latest, entities, brand);
    expect(faded.events.find((e) => e.type === 'competitor')).toBeUndefined();
  });

  test('reports a sentiment shift on the larger-moving share', () => {
    const previous = slice(
      1,
      prompts.map((p) =>
        row(1, p, { mentioned: true, sentiment: p === 4 ? null : 'neutral' }),
      ),
    );
    const latest = slice(
      2,
      prompts.map((p) =>
        row(2, p, { mentioned: true, sentiment: p === 4 ? null : 'negative' }),
      ),
    );
    const report = detectChanges(latest, previous, entities, brand);
    const event = report.events.find((e) => e.type === 'sentiment');
    expect(event?.headline).toContain('Negative sentiment');
    expect(event?.direction).toBe('up');
    expect(event?.good).toBe(false);
  });

  test('needs enough classified mentions on both sides for sentiment', () => {
    const previous = slice(1, [
      ...prompts.map((p) =>
        row(1, p, { mentioned: true, sentiment: p <= 2 ? 'positive' : null }),
      ),
    ]);
    const latest = slice(
      2,
      prompts.map((p) =>
        row(2, p, { mentioned: true, sentiment: p <= 2 ? 'negative' : null }),
      ),
    );
    const report = detectChanges(latest, previous, entities, brand);
    expect(report.events.find((e) => e.type === 'sentiment')).toBeUndefined();
  });

  test('reports a position slip in ranks', () => {
    const previous = slice(
      1,
      prompts.map((p) => row(1, p, { mentioned: true, position: 1 })),
    );
    const latest = slice(
      2,
      prompts.map((p) => row(2, p, { mentioned: true, position: 3 })),
    );
    const report = detectChanges(latest, previous, entities, brand);
    const event = report.events.find((e) => e.type === 'position');
    expect(event?.unit).toBe('rank');
    expect(event?.direction).toBe('up');
    expect(event?.good).toBe(false);
    expect(event?.headline).toContain('slipped');
    expect(event?.question).toContain('#1.0');
  });

  test('surface-level events fire only when the overall delta is quiet', () => {
    // ChatGPT collapses, Perplexity surges: overall is flat, both surface
    // stories surface individually.
    const masked = detectChanges(
      slice(2, [
        ...prompts.map((p) => row(2, p)),
        ...prompts.map((p) =>
          row(2, p, { surface: 'perplexity', mentioned: true }),
        ),
      ]),
      slice(1, [
        ...prompts.map((p) => row(1, p, { mentioned: true })),
        ...prompts.map((p) => row(1, p, { surface: 'perplexity' })),
      ]),
      entities,
      brand,
    );
    const mentionEvents = masked.events.filter(
      (e) => e.type === 'mention_rate',
    );
    expect(mentionEvents.map((e) => e.scope).sort()).toEqual([
      'chatgpt',
      'perplexity',
    ]);

    // When everything drops, one overall event speaks for all surfaces.
    const uniform = detectChanges(
      slice(2, [
        ...prompts.map((p) => row(2, p)),
        ...prompts.map((p) => row(2, p, { surface: 'perplexity' })),
      ]),
      slice(1, [
        ...prompts.map((p) => row(1, p, { mentioned: true })),
        ...prompts.map((p) =>
          row(1, p, { surface: 'perplexity', mentioned: true }),
        ),
      ]),
      entities,
      brand,
    );
    const overall = uniform.events.filter((e) => e.type === 'mention_rate');
    expect(overall).toHaveLength(1);
    expect(overall[0]?.scope).toBe('overall');
    expect(overall[0]?.headline).not.toContain('ChatGPT');
  });

  test('subject names what moved without the magnitude the card also shows', () => {
    // The Overview card renders `subject` beside its own delta chip, so the
    // magnitude must live only in `headline` (which MCP renders alone).
    const previous = slice(
      1,
      prompts.map((p) => row(1, p, { mentioned: true, position: 1 })),
    );
    const latest = slice(
      2,
      prompts.map((p) => row(2, p, { mentioned: true, position: 3 })),
    );
    const report = detectChanges(latest, previous, entities, brand);
    expect(report.events.length).toBeGreaterThan(0);
    for (const event of report.events) {
      expect(event.subject).not.toMatch(/\d/);
      expect(event.headline).toMatch(/\d/);
      expect(event.headline.startsWith(event.subject)).toBe(true);
    }
    const positionEvent = report.events.find((e) => e.type === 'position');
    expect(positionEvent?.subject).toBe('Average position');
  });

  test('subject keeps the surface for a per-surface event', () => {
    const report = detectChanges(
      slice(2, [
        ...prompts.map((p) => row(2, p)),
        ...prompts.map((p) =>
          row(2, p, { surface: 'perplexity', mentioned: true }),
        ),
      ]),
      slice(1, [
        ...prompts.map((p) => row(1, p, { mentioned: true })),
        ...prompts.map((p) => row(1, p, { surface: 'perplexity' })),
      ]),
      entities,
      brand,
    );
    const subjects = report.events.map((e) => e.subject).sort();
    expect(subjects).toEqual([
      'Mention rate on ChatGPT',
      'Mention rate on Perplexity',
    ]);
  });

  test('orders events by severity, worst first', () => {
    const previous = slice(
      1,
      prompts.map((p) => row(1, p, { mentioned: true, cited: p <= 2 })),
    );
    const latest = slice(
      2,
      prompts.map((p) => row(2, p, { cited: p === 1 })),
    );
    const report = detectChanges(latest, previous, entities, brand);
    expect(report.events.map((e) => e.type)).toEqual([
      'mention_rate',
      'citation_rate',
    ]);
    expect(report.events[0]?.severity).toBeGreaterThan(
      report.events[1]?.severity ?? 0,
    );
  });
});

describe('detectDrift', () => {
  const wide = Array.from({ length: 50 }, (_, i) => i + 1);
  // Citation rate slides 20% -> 18% -> 14% -> 10%. No adjacent pair clears
  // the 5-point threshold, so only the trend comparison can see it.
  const sliding = [10, 9, 7, 5].map((cut, i) =>
    slice(
      i,
      wide.map((p) => row(i, p, { mentioned: true, cited: p <= cut })),
    ),
  );

  test('reports a slide no single step would report', () => {
    const adjacent = detectChanges(
      sliding[3] as WindowSlice,
      sliding[2] as WindowSlice,
      entities,
      brand,
    );
    expect(adjacent.events).toHaveLength(0);

    const { events } = detectDrift(sliding, entities, brand);
    const drift = events.find((e) => e.type === 'citation_rate');
    expect(drift?.span).toBe('drift');
    expect(drift?.direction).toBe('down');
    expect(drift?.previous).toBeCloseTo(0.2, 5);
    expect(drift?.current).toBeCloseTo(0.1, 5);
    expect(drift?.headline).toContain('28 days');
  });

  test('a bounce is not a trend', () => {
    const bouncing = [10, 5, 10, 5].map((cut, i) =>
      slice(
        i,
        wide.map((p) => row(i, p, { mentioned: true, cited: p <= cut })),
      ),
    );
    expect(detectDrift(bouncing, entities, brand).events).toHaveLength(0);
  });

  test('needs the full trend span before it will call anything a trend', () => {
    expect(detectDrift(sliding.slice(1), entities, brand).events).toHaveLength(
      0,
    );
    expect(TREND_WINDOWS).toBe(4);
  });

  test('only cells present in every window compare', () => {
    // The newest window covers only prompts that were never cited in any
    // window. Comparing raw window rates would read 20% -> 0% and call it a
    // collapse; over the shared cells nothing moved.
    const truncated = [
      ...sliding.slice(0, 3),
      slice(
        3,
        wide.filter((p) => p > 10).map((p) => row(3, p, { mentioned: true })),
      ),
    ];
    const { events } = detectDrift(truncated, entities, brand);
    expect(events.find((e) => e.type === 'citation_rate')).toBeUndefined();
  });

  test('an entity-set change anywhere in the span pauses relative metrics', () => {
    const mixed = sliding.map((w, i) =>
      i === 1 ? slice(i, w.rows, 'other') : w,
    );
    const { events } = detectDrift(mixed, entities, brand);
    expect(events.every((e) => e.type !== 'sov')).toBe(true);
    expect(events.some((e) => e.type === 'citation_rate')).toBe(true);
  });
});

describe('mergeEvents', () => {
  const previous = slice(
    1,
    prompts.map((p) => row(1, p, { mentioned: true })),
  );
  const latest = slice(
    2,
    prompts.map((p) => row(2, p)),
  );
  const shift = detectChanges(latest, previous, entities, brand).events;

  test('one metric is one story: the wider reading wins', () => {
    const drift = shift.map((e) => ({
      ...e,
      span: 'drift' as const,
      severity: e.severity + 1,
    }));
    const merged = mergeEvents(shift, drift);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.span).toBe('drift');
  });

  test('a shift the trend never saw survives the merge', () => {
    expect(mergeEvents(shift, [])).toEqual(shift);
  });
});

describe('material-change glossary copy', () => {
  test('states the same thresholds the engine enforces', () => {
    const copy = `${METRIC_INFO.materialChange.definition} ${METRIC_INFO.materialChange.details}`;
    expect(copy).toContain(`${RATE_PP * 100} points`);
    expect(copy).toContain(`${SOV_PP * 100} points`);
    expect(copy).toContain(`${SENTIMENT_PP * 100} points`);
    expect(POSITION_RANKS).toBe(0.25);
    expect(copy).toContain('a quarter of a rank');
  });
});
