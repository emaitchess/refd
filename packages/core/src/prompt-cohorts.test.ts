import { describe, expect, test } from 'bun:test';
import {
  type CohortEntity,
  classifyPromptCohort,
  matchesPromptKind,
  PROMPT_KINDS,
  promptKindFilterSchema,
} from './prompt-cohorts';

// The mrmr workspace's tracked set, so the fixtures below are the real prompts
// this classifier has to get right rather than invented strings.
const ENTITIES: CohortEntity[] = [
  {
    id: 1,
    name: 'mrmr',
    domains: ['getmrmr.com'],
    aliases: [],
    isBrand: true,
  },
  {
    id: 2,
    name: 'VoiceOS',
    domains: ['voiceos.com'],
    aliases: [],
    isBrand: false,
  },
  {
    id: 4,
    name: 'WisprFlow',
    domains: ['wisprflow.com', 'wisprflow.ai'],
    aliases: [{ value: 'Wispr' }, { value: 'Wispr Flow' }],
    isBrand: false,
  },
  {
    id: 5,
    name: 'Alter',
    domains: ['alterhq.com'],
    aliases: [{ value: 'alterhq' }, { value: 'alter' }],
    isBrand: false,
  },
  {
    id: 6,
    name: 'Lemon',
    domains: ['heylemon.ai'],
    aliases: [{ value: 'heylemon' }, { value: 'lemon' }],
    isBrand: false,
  },
];

const kind = (text: string) => classifyPromptCohort(text, ENTITIES);

describe('classifyPromptCohort', () => {
  test('a prompt naming neither is discovery', () => {
    expect(
      kind(
        'What are the best voice control apps for macOS to speed up my workflow?',
      ),
    ).toBe('discovery');
  });

  test('naming only a competitor is competitor', () => {
    expect(
      kind(
        "What's the best alternative to WisprFlow for voice-controlled automations on Mac?",
      ),
    ).toBe('alternative');
  });

  test('naming the brand is branded', () => {
    expect(kind('Is mrmr good for voice automations on macOS?')).toBe(
      'brand_defining',
    );
  });

  // The edge case the brief calls out: brand-defining takes precedence.
  test('naming both brand and a competitor is branded, not competitor', () => {
    expect(
      kind(
        'mrmr vs VoiceOS: which is better for multi-app voice workflows on macOS?',
      ),
    ).toBe('brand_defining');
    expect(
      kind('mrmr vs Alter: which voice assistant gives more control?'),
    ).toBe('brand_defining');
  });

  test('a competitor name is matched case- and separator-insensitively', () => {
    expect(kind('How does LEMON compare to other macOS dictation tools?')).toBe(
      'alternative',
    );
  });

  test('a brand domain in the prompt names the brand', () => {
    expect(kind('Is getmrmr.com any good for dictation?')).toBe(
      'brand_defining',
    );
  });

  test('a word that merely contains an alias is not a mention', () => {
    expect(kind('Alternatives to lemonade stand software on Mac')).toBe(
      'discovery',
    );
  });

  test('a workspace with no brand entity yields discovery for everything', () => {
    expect(classifyPromptCohort('mrmr vs Alter', [])).toBe('discovery');
  });
});

describe('promptKindFilterSchema', () => {
  test('parses a comma-separated list', () => {
    expect(promptKindFilterSchema.parse('brand_defining,alternative')).toEqual([
      'brand_defining',
      'alternative',
    ]);
    expect(promptKindFilterSchema.parse('discovery,problem')).toEqual([
      'discovery',
      'problem',
    ]);
  });

  test('normalizes case and stray whitespace', () => {
    expect(
      promptKindFilterSchema.parse(' Market_Perception , discovery '),
    ).toEqual(['market_perception', 'discovery']);
  });

  test('an absent filter stays undefined so the field reads as optional', () => {
    expect(promptKindFilterSchema.parse(undefined)).toBeUndefined();
  });

  test('an empty filter means every cohort', () => {
    expect(promptKindFilterSchema.parse('  ')).toBeNull();
    expect(promptKindFilterSchema.parse(',')).toBeNull();
  });

  test('rejects a value outside the enum, including the retired names', () => {
    expect(
      promptKindFilterSchema.safeParse('brand_defining,nope').success,
    ).toBe(false);
    // The pre-taxonomy names are refused rather than quietly accepted as
    // aliases: a caller sending one gets a validation error instead of an
    // empty cohort that reads as "no prompts in this cohort".
    expect(promptKindFilterSchema.safeParse('branded').success).toBe(false);
    expect(promptKindFilterSchema.safeParse('competitor').success).toBe(false);
  });
});

describe('matchesPromptKind', () => {
  test('no filter matches every cohort', () => {
    for (const value of PROMPT_KINDS) {
      expect(matchesPromptKind(value, null)).toBe(true);
    }
  });

  test('a filter matches only its own cohorts', () => {
    expect(matchesPromptKind('brand_defining', ['brand_defining'])).toBe(true);
    expect(matchesPromptKind('discovery', ['brand_defining'])).toBe(false);
  });

  test('an unclassified prompt reads as discovery', () => {
    expect(matchesPromptKind(null, ['discovery'])).toBe(true);
    expect(matchesPromptKind(null, ['brand_defining'])).toBe(false);
  });
});
