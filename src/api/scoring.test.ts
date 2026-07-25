/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { NormalizedAnswer } from './providers/types';
import { SCORING_VERSION, type ScorableEntity, scoreResult } from './scoring';

const entities: ScorableEntity[] = [
  { id: 1, name: 'mrmr', domains: ['getmrmr.com'], aliases: [], isBrand: true },
  {
    id: 2,
    name: 'Dottie',
    domains: ['dottie.ai'],
    aliases: [],
    isBrand: false,
  },
  {
    id: 3,
    name: 'Alter',
    domains: ['alterhq.com'],
    aliases: [{ value: 'AlterHQ' }],
    isBrand: false,
  },
];

const answer: NormalizedAnswer = {
  answerText: [
    'Dottie is the leading pick, while mrmr is a newer entrant.',
    '',
    '## Alternatives',
    '',
    '- Alter: great for teams ([details](https://alterhq.com/pricing))',
    '- Plenty of other niche options exist',
  ].join('\n'),
  sourceUrls: [
    'https://getmrmr.com/blog/launch#:~:text=carried%20fragment',
    'https://reviews.example.com/best-tools?utm_source=g&id=7',
    'https://t0.gstatic.com/faviconV2?url=x',
  ],
  answerPresent: true,
  raw: {},
};

const scoreOf = (result: ReturnType<typeof scoreResult>, entityId: number) => {
  const score = result.scores.find((s) => s.entityId === entityId);
  if (!score) {
    throw new Error(`no score for entity ${entityId}`);
  }
  return score;
};

describe('scoreResult — mentions', () => {
  const result = scoreResult(answer, entities);

  test('positions follow first-mention order', () => {
    expect(scoreOf(result, 2).position).toBe(1);
    expect(scoreOf(result, 1).position).toBe(2);
    expect(scoreOf(result, 3).position).toBe(3);
  });

  test('prominence reflects block structure', () => {
    expect(scoreOf(result, 2).prominence).toBe('lead');
    expect(scoreOf(result, 1).prominence).toBe('lead');
    expect(scoreOf(result, 3).prominence).toBe('list');
  });

  test('spans and counts are persisted atoms', () => {
    const dottie = scoreOf(result, 2);
    expect(dottie.mentionCount).toBe(1);
    expect(dottie.firstOffset).toBe(0);
    expect(dottie.spans).toEqual([{ start: 0, end: 6 }]);
    expect(dottie.scoringVersion).toBe(SCORING_VERSION);
  });

  test('a link destination alone is not a mention', () => {
    // Alter is mentioned via its name in the list item; the alterhq.com href
    // must not add a second span.
    expect(scoreOf(result, 3).mentionCount).toBe(1);
  });
});

describe('scoreResult — citations', () => {
  const result = scoreResult(answer, entities);

  test('source list is normalized, ranked, and attributed', () => {
    const own = result.citations.find((c) => c.entityId === 1);
    expect(own?.url).toBe('https://getmrmr.com/blog/launch');
    expect(own?.origin).toBe('source_list');
    expect(own?.rank).toBe(1);
    expect(own?.registrableDomain).toBe('getmrmr.com');
  });

  test('tracking params are stripped, third parties unattributed', () => {
    const third = result.citations.find(
      (c) => c.registrableDomain === 'example.com',
    );
    expect(third?.url).toBe('https://reviews.example.com/best-tools?id=7');
    expect(third?.entityId).toBeNull();
    expect(third?.rank).toBe(2);
  });

  test('asset URLs are filtered', () => {
    expect(result.citations.some((c) => c.url.includes('gstatic'))).toBe(false);
  });

  test('inline links are harvested with inline origin', () => {
    const inline = result.citations.find((c) => c.origin === 'inline');
    expect(inline?.url).toBe('https://alterhq.com/pricing');
    expect(inline?.entityId).toBe(3);
    expect(inline?.rank).toBeNull();
  });

  test('cited/citedCount aggregate per entity', () => {
    expect(scoreOf(result, 1).cited).toBe(true);
    expect(scoreOf(result, 1).citedCount).toBe(1);
    expect(scoreOf(result, 3).cited).toBe(true);
    expect(scoreOf(result, 2).cited).toBe(false);
  });

  test('totalUrls counts distinct kept citations', () => {
    expect(result.totalUrls).toBe(3);
  });
});

describe('scoreResult — fallbacks and absence', () => {
  test('deep-walk fires only when no source or inline URL exists', () => {
    const walked = scoreResult(
      {
        answerText: 'mrmr stands alone here.',
        sourceUrls: [],
        answerPresent: true,
        raw: { nested: { deep: 'https://getmrmr.com/hidden' } },
      },
      entities,
    );
    expect(walked.citations).toHaveLength(1);
    expect(walked.citations[0]?.origin).toBe('walk');
    expect(walked.citations[0]?.entityId).toBe(1);
  });

  test('an absent AIO scores nothing and never walks the raw payload', () => {
    const absent = scoreResult(
      {
        answerText: '',
        sourceUrls: [],
        answerPresent: false,
        raw: { organic: [{ link: 'https://example.com/organic-noise' }] },
      },
      entities,
    );
    expect(absent.citations).toHaveLength(0);
    expect(absent.totalUrls).toBe(0);
    expect(absent.scores.every((s) => !s.mentioned && !s.cited)).toBe(true);
    expect(absent.scores.every((s) => s.position === null)).toBe(true);
  });
});
