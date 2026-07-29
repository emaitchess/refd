/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { bestTier, blockTiers } from './blocks';

const tierAt = (markdown: string, needle: string) => {
  const start = markdown.indexOf(needle);
  if (start === -1) {
    throw new Error(`needle not in markdown: ${needle}`);
  }
  return bestTier([{ start }], blockTiers(markdown));
};

describe('blockTiers', () => {
  const doc = [
    'Ahrefs is the most complete tool.',
    '',
    '## Alternatives',
    '',
    'Semrush covers similar ground.',
    '',
    '- Moz for beginners',
    '- Majestic for links',
  ].join('\n');

  test('first paragraph is lead', () => {
    expect(tierAt(doc, 'Ahrefs')).toBe('lead');
  });

  test('later prose is body', () => {
    expect(tierAt(doc, 'Semrush')).toBe('body');
    expect(tierAt(doc, 'Alternatives')).toBe('body');
  });

  test('list items are list', () => {
    expect(tierAt(doc, 'Moz')).toBe('list');
    expect(tierAt(doc, 'Majestic')).toBe('list');
  });

  test('a heading before the first paragraph does not disqualify lead', () => {
    const headed = '## Best tools\n\nAhrefs leads the pack.';
    expect(tierAt(headed, 'Ahrefs')).toBe('lead');
  });

  test('a document that opens with a list has no lead', () => {
    const listFirst = '- Ahrefs\n- Semrush\n\nBoth are solid.';
    expect(tierAt(listFirst, 'Ahrefs')).toBe('list');
    expect(tierAt(listFirst, 'Both')).toBe('body');
  });

  test('GFM table rows are list tier', () => {
    const table = 'Intro.\n\n| tool | price |\n| --- | --- |\n| Ahrefs | $99 |';
    expect(tierAt(table, 'Ahrefs')).toBe('list');
  });
});

describe('bestTier', () => {
  const doc = 'Lead here.\n\nBody text.\n\n- item';

  test('picks the most prominent tier across spans', () => {
    const ranges = blockTiers(doc);
    const body = doc.indexOf('Body');
    const item = doc.indexOf('item');
    expect(bestTier([{ start: item }, { start: body }], ranges)).toBe('body');
    expect(bestTier([{ start: 0 }, { start: item }], ranges)).toBe('lead');
  });

  test('no spans means no tier', () => {
    expect(bestTier([], blockTiers(doc))).toBe(null);
  });
});
