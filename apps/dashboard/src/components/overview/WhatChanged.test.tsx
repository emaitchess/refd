import { expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import type { ChangeEvent, ChangesResponse } from '@/lib/types';

let response: ChangesResponse;
const realApi = await import('@/lib/api');
await mock.module('@/lib/api', () => ({
  ...realApi,
  useQuery: () => ({
    data: response,
    error: null,
    loading: false,
    refetch: () => undefined,
  }),
}));

const { WhatChanged } = await import('./WhatChanged');

const event = (over: Partial<ChangeEvent> = {}): ChangeEvent => ({
  type: 'mention_rate',
  span: 'shift',
  scope: 'overall',
  entity: 'mrmr',
  direction: 'down',
  good: false,
  unit: 'share',
  current: 0.4,
  previous: 0.75,
  delta: -0.35,
  severity: 0.35,
  subject: 'Mention rate',
  headline: 'Mention rate fell 35 pts',
  question: 'Mention rate fell from 75% to 40%. What drove the drop?',
  ...over,
});

const report = (over: Partial<ChangesResponse> = {}): ChangesResponse => ({
  status: 'ok',
  windowDays: 7,
  latest: {
    from: '2026-07-24',
    to: '2026-07-30',
    runs: 7,
    answers: 1274,
    entitySetHash: 'h',
  },
  previous: {
    from: '2026-07-17',
    to: '2026-07-23',
    runs: 7,
    answers: 1301,
    entitySetHash: 'h',
  },
  cells: 42,
  promptCount: 10,
  surfaceCount: 5,
  entitySetChanged: false,
  events: [event()],
  ...over,
});

const render = (data: ChangesResponse): string => {
  response = data;
  return renderToStaticMarkup(
    <MemoryRouter>
      <WhatChanged />
    </MemoryRouter>,
  );
};

// A sparse grid is the normal case: google_aio answers only ~15-20% of
// prompts, and an absent answer leaves no cell to compare. Reporting
// prompts × surfaces would claim a scope the comparison never measured.
test('header reports the cells compared, not prompts times surfaces', () => {
  const html = render(report());
  expect(html).toContain('42 cells across 10 prompts and 5 surfaces');
  expect(html).not.toContain('10 prompts × 5 surfaces');
});

test('the header names both ends of each window', () => {
  expect(render(report())).toContain('07/17-07/23 → 07/24-07/30');
});

// A workspace with one run in the window has nothing to span, and a label
// reading "07/30-07/30" would imply a range that is really a single day.
test('a single-day window collapses to one date', () => {
  const html = render(
    report({
      latest: {
        from: '2026-07-30',
        to: '2026-07-30',
        runs: 1,
        answers: 100,
        entitySetHash: 'h',
      },
    }),
  );
  expect(html).toContain('07/17-07/23 → 07/30');
});

// Shift and drift rows sit in one list at different scales, so the wider one
// has to say so or its delta reads as a week's move.
test('a narrower trend scope is disclosed, and only when it differs', () => {
  const drift = [event({ span: 'drift' })];
  expect(render(report({ events: drift, trendCells: 30 }))).toContain(
    'trend rows compare 30 cells',
  );
  expect(render(report({ events: drift, trendCells: 42 }))).not.toContain(
    'trend rows compare',
  );
  expect(render(report({ trendCells: 30 }))).not.toContain(
    'trend rows compare',
  );
});

test('a trend row is marked as one', () => {
  const html = render(report({ events: [event({ span: 'drift' })] }));
  expect(html).toContain('trend');
  expect(render(report())).not.toContain('trend');
});

test('a row states the magnitude once: subject plus delta chip', () => {
  const html = render(report());
  expect(html).toContain('Mention rate');
  expect(html).not.toContain('Mention rate fell 35 pts');
  expect(html).toContain('↓ 35pp');
  expect(html).toContain('75% → 40%');
});

test('a rank delta carries its unit', () => {
  const html = render(
    report({
      events: [
        event({
          type: 'position',
          unit: 'rank',
          direction: 'up',
          current: 3,
          previous: 1,
          delta: 2,
          subject: 'Average position',
          headline: 'Average position slipped 2 ranks',
        }),
      ],
    }),
  );
  expect(html).toContain('↑ 2 ranks');
  expect(html).toContain('#1.0 → #3.0');
});

test('a quiet comparison still reports itself', () => {
  const html = render(report({ events: [] }));
  expect(html).toContain('No material changes in the last 7 days.');
});

test('renders nothing until two comparable windows exist', () => {
  expect(render({ status: 'needs-runs' })).toBe('');
  expect(render({ needsSetup: true })).toBe('');
  expect(render(report({ status: 'thin-overlap' }))).toBe('');
});
