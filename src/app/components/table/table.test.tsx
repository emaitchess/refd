import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { METRIC_INFO } from '@/lib/metric-copy';
import { fitColumnWidths, Th } from './table';

test('keeps the full metric header available for measurement', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <table>
        <thead>
          <tr>
            <Th
              label="Answers citing"
              info={METRIC_INFO.answersCiting}
              sortKey="answers"
              sort={{ key: 'answers', dir: 'desc' }}
              onToggle={() => undefined}
              align="right"
            />
          </tr>
        </thead>
      </table>
    </MemoryRouter>,
  );

  expect(html).toContain('data-table-header-content="true"');
  expect(html).toContain('Answers citing');
  expect(html).not.toContain('truncate');
  expect(html).toContain('size-5 shrink-0');
});

test('moves space from flexible columns to a constrained header', () => {
  const widths = fitColumnWidths(
    480,
    [
      { key: 'domain', min: 260, fraction: 0.78 },
      { key: 'answers', min: 120, fraction: 0.22 },
    ],
    { domain: 374.4, answers: 105.6 },
    { domain: 80, answers: 152 },
  );

  expect(widths.answers).toBe(152);
  expect(widths.domain).toBe(328);
});

test('expands to the combined minimum when the table cannot fit', () => {
  const widths = fitColumnWidths(
    300,
    [
      { key: 'domain', min: 260 },
      { key: 'answers', min: 120 },
    ],
    { domain: 200, answers: 100 },
    { answers: 152 },
  );

  expect(widths).toEqual({ domain: 260, answers: 152 });
});
