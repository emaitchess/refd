import { describe, expect, test } from 'bun:test';
import { CONCEPT_CATEGORIES, CONCEPT_TERMS } from './concepts';
import { GLOSSARY_TERMS } from './glossary';
import { METRIC_INFO } from './metric-copy';

describe('category concepts', () => {
  test('uses valid categories and stable unique slugs', () => {
    for (const concept of CONCEPT_TERMS) {
      expect(CONCEPT_CATEGORIES).toContain(concept.category);
      expect(concept.id).toMatch(/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/);
    }
    expect(new Set(CONCEPT_TERMS.map(({ id }) => id)).size).toBe(
      CONCEPT_TERMS.length,
    );
  });

  test('never collides with a metric or product term', () => {
    const taken = new Set([
      ...Object.values(METRIC_INFO).map(({ id }) => id),
      ...GLOSSARY_TERMS.map(({ id }) => id),
    ]);
    for (const concept of CONCEPT_TERMS) {
      expect(taken.has(concept.id)).toBe(false);
    }
  });

  test('requires a definition and details on every concept', () => {
    for (const concept of CONCEPT_TERMS) {
      expect(concept.title.length).toBeGreaterThan(0);
      expect(concept.definition.length).toBeGreaterThan(0);
      expect(concept.details.length).toBeGreaterThan(0);
    }
  });

  // These strings render as site copy, where the em dash is reserved as the
  // "no data" glyph.
  test('carries no em dashes in published copy', () => {
    for (const concept of CONCEPT_TERMS) {
      expect(concept.title).not.toContain('—');
      expect(concept.definition).not.toContain('—');
      expect(concept.details).not.toContain('—');
    }
  });

  test('covers the vocabulary the field actually argues about', () => {
    expect(CONCEPT_TERMS.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        'answer-engine',
        'answer-engine-optimization',
        'generative-engine-optimization',
        'llms-txt',
        'answer-variance',
      ]),
    );
  });
});
