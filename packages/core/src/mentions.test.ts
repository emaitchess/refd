/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import {
  composeAliases,
  findMentionSpans,
  findMentions,
  type MatchEntity,
} from './mentions';

const entity = (
  id: number,
  ...aliases: MatchEntity['aliases']
): MatchEntity => ({
  id,
  aliases,
});

const spansOf = (text: string, entities: MatchEntity[], entityId: number) =>
  findMentionSpans(text, entities)
    .filter((s) => s.entityId === entityId)
    .map((s) => text.slice(s.start, s.end));

describe('findMentionSpans — boundaries', () => {
  const ahrefs = [entity(1, { value: 'Ahrefs' })];

  test('word boundaries only', () => {
    expect(spansOf('We recommend Ahrefs for links', ahrefs, 1)).toEqual([
      'Ahrefs',
    ]);
    expect(spansOf('try ahrefs.', ahrefs, 1)).toEqual(['ahrefs']);
    expect(spansOf('(Ahrefs)', ahrefs, 1)).toEqual(['Ahrefs']);
    expect(spansOf('Ahrefsx is different', ahrefs, 1)).toEqual([]);
    expect(spansOf('superAhrefs', ahrefs, 1)).toEqual([]);
  });

  test('possessives match, span excludes the apostrophe', () => {
    expect(spansOf("Ahrefs' index is big", ahrefs, 1)).toEqual(['Ahrefs']);
    expect(spansOf("Ahrefs's data", ahrefs, 1)).toEqual(['Ahrefs']);
  });

  test('adjacent mentions both match', () => {
    expect(spansOf('Ahrefs Ahrefs', ahrefs, 1)).toHaveLength(2);
  });

  test('regex metacharacters in aliases are literal', () => {
    const cpp = [entity(1, { value: 'C++' })];
    expect(spansOf('learn C++ today', cpp, 1)).toEqual(['C++']);
  });
});

describe('findMentionSpans — case and diacritics', () => {
  test('default lane is case-insensitive', () => {
    const e = [entity(1, { value: 'Ahrefs' })];
    expect(spansOf('AHREFS wins', e, 1)).toEqual(['AHREFS']);
  });

  test('caseSensitive aliases require exact casing', () => {
    const notion = [entity(1, { value: 'Notion', caseSensitive: true })];
    expect(spansOf('use Notion databases', notion, 1)).toEqual(['Notion']);
    expect(spansOf('the notion that tools help', notion, 1)).toEqual([]);
    // Sentence-initial dictionary word: accepted false positive by design.
    expect(spansOf('Notion of trust matters', notion, 1)).toEqual(['Notion']);
  });

  test('diacritics fold both ways', () => {
    const cafe = [entity(1, { value: 'Café Nero' })];
    expect(spansOf('at cafe nero yesterday', cafe, 1)).toEqual(['cafe nero']);
    const plain = [entity(1, { value: 'cafe' })];
    expect(spansOf('un café parfait', plain, 1)).toEqual(['café']);
  });
});

describe('findMentionSpans — separators', () => {
  test('token separators are equivalent', () => {
    const coca = [entity(1, { value: 'Coca-Cola' })];
    expect(spansOf('drink Coca Cola now', coca, 1)).toEqual(['Coca Cola']);
    expect(spansOf('drink coca.cola now', coca, 1)).toEqual(['coca.cola']);
    expect(spansOf('drink Coca-Cola now', coca, 1)).toEqual(['Coca-Cola']);
  });

  test('domain aliases match in prose', () => {
    const e = [entity(1, { value: 'monday.com' })];
    expect(spansOf('monday.com is a work OS', e, 1)).toEqual(['monday.com']);
    expect(spansOf('on monday commerce boomed', e, 1)).toEqual([]);
  });
});

describe('findMentionSpans — markdown link handling', () => {
  const ahrefs = [entity(1, { value: 'Ahrefs' }, { value: 'ahrefs.com' })];

  test('link destinations never match', () => {
    expect(
      spansOf('see [best tools](https://ahrefs.com/blog) here', ahrefs, 1),
    ).toEqual([]);
  });

  test('anchor text still matches', () => {
    expect(
      spansOf('see [Ahrefs review](https://example.com) here', ahrefs, 1),
    ).toEqual(['Ahrefs']);
  });

  test('bare domains in prose match', () => {
    expect(spansOf('just try ahrefs.com today', ahrefs, 1)).toEqual([
      'ahrefs.com',
    ]);
  });
});

describe('findMentionSpans — cross-entity overlap', () => {
  const google = entity(1, { value: 'Google' });
  const ga = entity(2, { value: 'Google Analytics' });

  test('longest match wins at a position', () => {
    const text = 'use Google Analytics for tracking';
    expect(spansOf(text, [google, ga], 2)).toEqual(['Google Analytics']);
    expect(spansOf(text, [google, ga], 1)).toEqual([]);
  });

  test('the shorter entity still matches elsewhere', () => {
    const text = 'Google ships Google Analytics';
    expect(spansOf(text, [google, ga], 1)).toEqual(['Google']);
    expect(spansOf(text, [google, ga], 2)).toEqual(['Google Analytics']);
  });
});

describe('findMentions', () => {
  test('aggregates per entity with reading-order firstOffset', () => {
    const entities = [
      entity(1, { value: 'Semrush' }),
      entity(2, { value: 'Ahrefs' }),
      entity(3, { value: 'Moz' }),
    ];
    const text = 'Ahrefs and Semrush lead; Ahrefs again.';
    const result = findMentions(text, entities);
    expect(result[0]).toMatchObject({
      entityId: 1,
      mentioned: true,
      mentionCount: 1,
    });
    expect(result[1]).toMatchObject({
      entityId: 2,
      mentioned: true,
      mentionCount: 2,
      firstOffset: 0,
    });
    expect(result[2]).toMatchObject({
      entityId: 3,
      mentioned: false,
      mentionCount: 0,
      firstOffset: null,
    });
    expect((result[0]?.firstOffset ?? 0) > 0).toBe(true);
  });

  test('empty and whitespace aliases never match', () => {
    const e = [entity(1, { value: '  ' }, { value: '' })];
    expect(findMentions('anything at all', e)[0]?.mentioned).toBe(false);
  });
});

describe('composeAliases', () => {
  test('name first, then aliases, then domains, deduped case-insensitively', () => {
    const composed = composeAliases(
      'Ahrefs',
      ['ahrefs.com'],
      [{ value: 'ahrefs' }, { value: 'AWT' }],
    );
    expect(composed.map((a) => a.value)).toEqual([
      'Ahrefs',
      'AWT',
      'ahrefs.com',
    ]);
  });

  test('keeps caseSensitive flags on curated aliases', () => {
    const composed = composeAliases(
      'Notion Labs',
      ['notion.so'],
      [{ value: 'Notion', caseSensitive: true }],
    );
    expect(composed.find((a) => a.value === 'Notion')?.caseSensitive).toBe(
      true,
    );
  });
});
