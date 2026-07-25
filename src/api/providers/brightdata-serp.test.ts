import { describe, expect, spyOn, test } from 'bun:test';
import { parseAioNode } from './brightdata-serp';

// Fixture mirrors a real brd_ai_overview=2 payload (2026-07): recursive
// blocks under `texts`, `references` with href/title/index. If BrightData
// drifts the shape again, the structured parse falls back to the walk and
// these assertions catch it.
const realShape = {
  texts: [
    {
      type: 'list',
      list: [
        {
          type: 'paragraph',
          snippet:
            'Windows: Press Win + H to open the built-in voice typing tool.',
        },
        {
          type: 'paragraph',
          snippet: 'macOS: Use built-in Apple Dictation.',
          links: [{ link: 'https://example.com/inline-chip' }],
        },
        {
          type: 'list',
          title: 'Third-party tools',
          list: [{ type: 'paragraph', snippet: 'Dedicated dictation apps.' }],
        },
      ],
    },
  ],
  references: [
    {
      href: 'https://second.example.com/post',
      title: 'Second title',
      index: 1,
    },
    {
      href: 'https://first.example.com/guide',
      title: 'BrandInTitle guide',
      index: 0,
    },
    { href: 'https://second.example.com/post', title: 'Duplicate', index: 2 },
  ],
  rank: 1,
  global_rank: 1,
};

describe('parseAioNode', () => {
  test('renders list blocks as markdown bullets, nested lists indented', () => {
    const { answerText } = parseAioNode(realShape);
    expect(answerText).toContain(
      '- Windows: Press Win + H to open the built-in voice typing tool.',
    );
    expect(answerText).toContain('- macOS: Use built-in Apple Dictation.');
    expect(answerText).toContain('- Third-party tools');
    expect(answerText).toContain('  - Dedicated dictation apps.');
  });

  test('reference titles never enter the answer text', () => {
    const { answerText } = parseAioNode(realShape);
    expect(answerText).not.toContain('BrandInTitle');
  });

  test('sources come from references in index order, deduped', () => {
    const { sourceUrls } = parseAioNode(realShape);
    expect(sourceUrls).toEqual([
      'https://first.example.com/guide',
      'https://second.example.com/post',
    ]);
  });

  test('top-level paragraph block stays a paragraph', () => {
    const { answerText } = parseAioNode({
      texts: [{ type: 'paragraph', snippet: 'A lead sentence.' }],
      references: [],
    });
    expect(answerText).toBe('A lead sentence.');
  });

  test('title + snippet join with a colon', () => {
    const { answerText } = parseAioNode({
      texts: [
        {
          type: 'list',
          list: [{ title: 'Tool', snippet: 'does a thing', type: 'paragraph' }],
        },
      ],
      references: [],
    });
    expect(answerText).toBe('- Tool: does a thing');
  });

  test('whitespace collapses inside a bullet so the list survives remark', () => {
    const { answerText } = parseAioNode({
      texts: [
        {
          type: 'list',
          list: [{ snippet: 'line one\n\nline two', type: 'paragraph' }],
        },
      ],
      references: [],
    });
    expect(answerText).toBe('- line one line two');
  });

  test('unrecognized shape falls back to the deep walk', () => {
    const { answerText } = parseAioNode({ mystery_field: 'walked text' });
    expect(answerText).toContain('walked text');
  });

  test('an unknown block shape warns but never drops its neighbours', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const { answerText } = parseAioNode({
      texts: [
        { type: 'table', rows: [['cell']] },
        { type: 'paragraph', snippet: 'Still here.' },
      ],
      references: [],
    });
    expect(answerText).toBe('Still here.');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
