import { describe, expect, test } from 'bun:test';
import { GLOSSARY_TERMS, TERM_CATEGORIES } from '@refd/core/glossary';
import { METRIC_GLOSSARY } from '@refd/core/metric-copy';
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
        'Collection unit',
        'Scoring',
        'Raw answer payload',
      ]),
    );
  });

  // A run finishes on coverage, not on success, so both terms have to say a
  // finished run can still carry failed units. Without this the run page's
  // per-surface shortfall reads as a contradiction of "complete".
  test('states that a finished run can still hold failed units', () => {
    const term = (id: string) => {
      const found = GLOSSARY_TERMS.find((entry) => entry.id === id);
      expect(found).toBeDefined();
      return found?.details ?? '';
    };

    expect(term('run')).toMatch(/not the same as every unit succeeding/);
    expect(term('collection-unit')).toMatch(/recorded as failed/);
  });
});
