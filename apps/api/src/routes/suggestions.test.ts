import { describe, expect, test } from 'bun:test';
import type { ChangeEvent } from './changes';
import type { DigestSections } from './digest';
import {
  buildSuggestions,
  rankSuggestions,
  type Suggestion,
} from './suggestions';

const sections = (over: Partial<DigestSections> = {}): DigestSections => ({
  overview: {
    mentionRate: 0.134,
    citationRate: 0.176,
    sov: 0.208,
    avgPosition: 1.276,
    sentiment: { positive: 579, neutral: 205, negative: 60 },
    answers: 6593,
  },
  surfaces: [
    {
      surface: 'chatgpt',
      mentionRate: 0.115,
      citationRate: 0.2,
      avgPosition: 1.147,
      answers: 1374,
    },
    {
      surface: 'gemini',
      mentionRate: 0.163,
      citationRate: 0.137,
      avgPosition: 1.439,
      answers: 1400,
    },
  ],
  competitors: [],
  sentiment: { brand: null, note: '' },
  sources: {
    topCited: [],
    gap: [{ domain: 'getvoibe.com', answersCiting: 999 }],
    gapNote: '',
  },
  coverage: { aio: null, sources: [] },
  prompts: {
    tracked: 25,
    answered: 25,
    top: [],
    zeroVisibility: [
      'What level of offline processing do macOS assistants offer?',
    ],
    zeroVisibilityCount: 8,
    contested: [
      {
        text: "What's the best alternative to WisprFlow on Mac?",
        mentionRate: 0.01,
        leader: 'WisprFlow',
        leaderRate: 0.89,
        answers: 266,
      },
      {
        text: 'What are the best voice control apps for macOS?',
        mentionRate: 0.01,
        leader: 'WisprFlow',
        leaderRate: 0.83,
        answers: 263,
      },
      {
        text: 'How much do macOS voice automation tools cost?',
        mentionRate: 0,
        leader: 'WisprFlow',
        leaderRate: 0.79,
        answers: 265,
      },
    ],
    contestedCount: 3,
    namedSplit: {
      named: { prompts: 2, mentionRate: 1 },
      unnamed: { prompts: 23, mentionRate: 0.059 },
    },
    namedSplitNote: '',
  },
  runs: [
    {
      date: '2026-09-04',
      status: 'complete',
      answersCollected: '100/100',
      brandMentionRate: 0.17,
    },
  ],
  ...over,
});

const changeEvent = (over: Partial<ChangeEvent> = {}): ChangeEvent => ({
  type: 'citation_rate',
  span: 'drift',
  scope: 'overall',
  entity: 'mrmr',
  direction: 'down',
  good: false,
  unit: 'share',
  current: 0.103,
  previous: 0.181,
  delta: -0.078,
  severity: 0.078,
  subject: 'Citation rate',
  headline: 'Citation rate fell 8 pts over 28 days',
  question: 'Citation rate fell from 18% to 10%. Which citations were lost?',
  ...over,
});

const kinds = (list: Suggestion[]) => list.map((s) => s.kind);

describe('buildSuggestions', () => {
  test('every measured chip states a number and names something', () => {
    const picked = buildSuggestions('mrmr', sections(), [changeEvent()], 4);
    const measured = picked.filter((s) => s.kind !== 'starter');
    expect(measured.length).toBe(4);
    for (const chip of measured) {
      expect(chip.label).toMatch(/\d/);
      expect(chip.question).toMatch(/\d/);
      expect(chip.question.length).toBeGreaterThan(chip.label.length);
    }
  });

  // Production shape (workspace 1, 2026-09-04): the named/unnamed split is
  // the largest finding in the data, the contested prompt the sharpest, and
  // the drift the only thing that actually moved. All three beat the counts.
  test('ranks the real workspace the way a reader would', () => {
    expect(
      kinds(buildSuggestions('mrmr', sections(), [changeEvent()], 4)),
    ).toEqual(['named-split', 'contested', 'change', 'zero-visibility']);
  });

  // Three chips reading "WisprFlow 89% vs mrmr 1%", "WisprFlow 83% vs mrmr
  // 1%" would spend the whole strip on one finding.
  test('one rival owning several prompts is one chip, not several', () => {
    const chips = buildSuggestions('mrmr', sections(), [], 6).filter(
      (s) => s.kind === 'contested',
    );
    expect(chips).toHaveLength(1);
    expect(chips[0]?.label).toBe(
      'WisprFlow leads 3 prompts mrmr is absent from',
    );
    // The sharpest example still reaches the agent.
    expect(chips[0]?.question).toContain('best alternative to WisprFlow');
    expect(chips[0]?.question).toContain('89%');
  });

  test('a single contested prompt names the rival, the rate, and the prompt', () => {
    const one = sections();
    one.prompts.contested = one.prompts.contested.slice(0, 1);
    const chip = buildSuggestions('mrmr', one, [], 4).find(
      (s) => s.kind === 'contested',
    );
    expect(chip?.label).toBe('WisprFlow 89% vs mrmr 1% on one prompt');
    expect(chip?.question).toContain('best alternative to WisprFlow');
  });

  // The digest carries a capped list, so a count read off it can be short.
  test('a truncated contested list says "at least", never a firm undercount', () => {
    const more = sections();
    more.prompts.contestedCount = more.prompts.contested.length + 4;
    const chip = buildSuggestions('mrmr', more, [], 6).find(
      (s) => s.kind === 'contested',
    );
    expect(chip?.label).toContain('3+ prompts');
    expect(chip?.question).toContain('at least 3');
  });

  test('rivals get a chip each, never one rival twice', () => {
    const two = sections();
    two.prompts.contested = [
      two.prompts.contested[0] as never,
      {
        text: 'Which Mac dictation tool is most accurate?',
        mentionRate: 0,
        leader: 'Alter',
        leaderRate: 0.71,
        answers: 260,
      },
    ];
    const chips = buildSuggestions('mrmr', two, [], 6).filter(
      (s) => s.kind === 'contested',
    );
    expect(chips.map((c) => c.label.split(' ')[0])).toEqual([
      'WisprFlow',
      'Alter',
    ]);
  });

  test('a change event keeps the wording the engine already owns', () => {
    const event = changeEvent();
    const chip = buildSuggestions('mrmr', sections(), [event], 4).find(
      (s) => s.kind === 'change',
    );
    expect(chip?.label).toBe(event.headline);
    expect(chip?.question).toBe(event.question);
  });

  test('a headline carried by self-naming prompts is called out', () => {
    const chip = buildSuggestions('mrmr', sections(), [], 4).find(
      (s) => s.kind === 'named-split',
    );
    expect(chip?.label).toContain('6%');
    expect(chip?.question).toContain('100%');
    expect(chip?.question).toContain('23');
  });

  test('a normal named gap stays quiet', () => {
    const flat = sections();
    flat.prompts.namedSplit = {
      named: { prompts: 2, mentionRate: 0.2 },
      unnamed: { prompts: 23, mentionRate: 0.15 },
    };
    expect(kinds(buildSuggestions('mrmr', flat, [], 4))).not.toContain(
      'named-split',
    );
  });

  test('a workspace with nothing measurable falls back to starters', () => {
    const quiet: DigestSections = {
      ...sections(),
      surfaces: [],
      sources: { topCited: [], gap: [], gapNote: '' },
      prompts: {
        tracked: 3,
        answered: 3,
        top: [],
        zeroVisibility: [],
        zeroVisibilityCount: 0,
        contested: [],
        contestedCount: 0,
        namedSplit: {
          named: { prompts: 0, mentionRate: null },
          unnamed: { prompts: 3, mentionRate: 0.4 },
        },
        namedSplitNote: '',
      },
      runs: [],
    };
    const picked = buildSuggestions('mrmr', quiet, [], 4);
    expect(picked).toHaveLength(4);
    expect(new Set(kinds(picked))).toEqual(new Set(['starter']));
  });

  test('a run that lost answers is reported as a collection gap', () => {
    const lossy = sections();
    lossy.runs = [
      {
        date: '2026-09-03',
        status: 'complete',
        answersCollected: '205/250',
        brandMentionRate: 0.181,
      },
    ];
    const chip = buildSuggestions('mrmr', lossy, [], 6).find(
      (s) => s.kind === 'collection',
    );
    expect(chip?.label).toContain('205 of 250');
  });

  test('a complete run is not a finding', () => {
    expect(kinds(buildSuggestions('mrmr', sections(), [], 6))).not.toContain(
      'collection',
    );
  });
});

describe('rankSuggestions', () => {
  const candidate = (
    kind: Suggestion['kind'],
    strength: number,
    label: string = kind,
  ): Suggestion => ({ kind, label, question: label, strength });

  test('ranks on distance past each family bar, not raw magnitude', () => {
    const picked = rankSuggestions(
      [candidate('change', 3), candidate('contested', 1.2)],
      2,
    );
    expect(kinds(picked)).toEqual(['change', 'contested']);
  });

  test('drops anything that never cleared its own bar', () => {
    const picked = rankSuggestions(
      [candidate('contested', 0.99), candidate('change', 1)],
      4,
    );
    expect(kinds(picked)).toEqual(['change']);
  });

  test('caps one family so four chips cover four findings', () => {
    const picked = rankSuggestions(
      [
        candidate('contested', 9, 'a'),
        candidate('contested', 8, 'b'),
        candidate('contested', 7, 'c'),
        candidate('change', 1.1, 'd'),
      ],
      4,
    );
    expect(picked.map((s) => s.label)).toEqual(['a', 'b', 'd']);
  });

  test('starters fill only what measurement left empty', () => {
    const picked = rankSuggestions(
      [
        candidate('change', 2, 'real'),
        candidate('starter', 0, 's1'),
        candidate('starter', 0, 's2'),
      ],
      3,
    );
    expect(picked.map((s) => s.label)).toEqual(['real', 's1', 's2']);
  });
});
