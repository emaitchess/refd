import { describe, expect, test } from 'bun:test';
import { METRIC_INFO } from '@refd/core/metric-copy';
import {
  detectChanges,
  MIN_CELLS,
  POSITION_RANKS,
  RATE_PP,
  type RunSlice,
  SENTIMENT_PP,
  SOV_PP,
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

const slice = (
  runId: number,
  rows: ScoreRow[],
  hash: string | null = 'h',
): RunSlice => ({
  run: {
    runId,
    date: runId === 2 ? '2026-07-20' : '2026-07-19',
    trigger: 'cron',
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
  });

  test('stays silent under the material threshold', () => {
    const many = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const previous = slice(
      1,
      many.map((p) => row(1, p, { mentioned: p <= 5 })),
    );
    const latest = slice(
      2,
      many.map((p) => row(2, p, { mentioned: p <= 4 })),
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

describe('material-change glossary copy', () => {
  test('states the same thresholds the engine enforces', () => {
    const copy = `${METRIC_INFO.materialChange.definition} ${METRIC_INFO.materialChange.details}`;
    expect(copy).toContain(`${RATE_PP * 100} points`);
    expect(copy).toContain(`${SOV_PP * 100} points`);
    expect(copy).toContain(`${SENTIMENT_PP * 100} points`);
    expect(POSITION_RANKS).toBe(1);
    expect(copy).toContain('one full rank');
  });
});
