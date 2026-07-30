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
  latest: {
    runId: 2,
    date: '2026-07-30',
    trigger: 'cron',
    completedAt: Date.UTC(2026, 6, 30, 6, 42),
  },
  previous: {
    runId: 1,
    date: '2026-07-29',
    trigger: 'cron',
    completedAt: Date.UTC(2026, 6, 29, 6, 31),
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

test('runs sharing a date are told apart by completion time', () => {
  const html = render(
    report({
      latest: {
        runId: 2,
        date: '2026-07-29',
        trigger: 'cron',
        completedAt: Date.UTC(2026, 6, 29, 14, 5),
      },
    }),
  );
  expect(html).toContain('07/29 06:31 → 07/29 14:05');
});

test('runs on different dates stay date-only', () => {
  expect(render(report())).toContain('07/29 → 07/30');
});

test('a legacy run without a completion time falls back to the date', () => {
  const html = render(
    report({
      latest: {
        runId: 2,
        date: '2026-07-29',
        trigger: 'import',
        completedAt: null,
      },
    }),
  );
  expect(html).toContain('07/29 → 07/29');
  expect(html).not.toContain('06:31');
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
  expect(html).toContain('No material changes between the last two runs.');
});

test('renders nothing until two comparable runs exist', () => {
  expect(render({ status: 'needs-runs' })).toBe('');
  expect(render({ needsSetup: true })).toBe('');
  expect(render(report({ status: 'thin-overlap' }))).toBe('');
});
