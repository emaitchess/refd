import { describe, expect, test } from 'bun:test';
import { GLOSSARY_TERMS, TERM_CATEGORIES } from './glossary';
import { METRIC_GLOSSARY } from './metric-copy';
import { PROMPT_CATEGORY_GLOSSARY } from './prompt-categories';

describe('help glossary', () => {
  test('uses valid term categories and stable unique anchors', () => {
    for (const term of GLOSSARY_TERMS) {
      expect(TERM_CATEGORIES).toContain(term.category);
      expect(term.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }

    const entries = [
      ...GLOSSARY_TERMS,
      ...PROMPT_CATEGORY_GLOSSARY,
      ...METRIC_GLOSSARY,
    ];
    expect(new Set(entries.map(({ id }) => id)).size).toBe(entries.length);
  });

  test('documents the recurring product concepts', () => {
    expect(GLOSSARY_TERMS.map(({ title }) => title)).toEqual(
      expect.arrayContaining([
        'Workspace',
        'Tracked entity',
        'Prompt',
        'Alias',
        'AI surface',
        'Mention',
        'Citation',
        'Run',
        'Sample',
        'Collection unit',
        'Scoring',
        'Raw answer payload',
      ]),
    );
  });
});
