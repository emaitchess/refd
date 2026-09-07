import { describe, expect, test } from 'bun:test';
import { CONCEPT_CATEGORIES, CONCEPT_TERMS } from './concepts';
import { GLOSSARY_TERMS } from './glossary';
import {
  findGlossaryEntry,
  GLOSSARY_ENTRIES,
  GLOSSARY_ENTRY_PATHS,
  glossaryEntriesByCategory,
  relatedGlossaryEntries,
} from './glossary-index';
import { METRIC_INFO } from './metric-copy';

describe('glossary index', () => {
  test('merges every metric, term and concept exactly once', () => {
    expect(GLOSSARY_ENTRIES.length).toBe(
      Object.keys(METRIC_INFO).length +
        GLOSSARY_TERMS.length +
        CONCEPT_TERMS.length,
    );
    expect(new Set(GLOSSARY_ENTRIES.map((entry) => entry.id)).size).toBe(
      GLOSSARY_ENTRIES.length,
    );
  });

  // The dashboard Help glossary renders GLOSSARY_TERMS directly, so category
  // vocabulary leaking into that list would put "what is GEO" in the product.
  test('keeps category vocabulary out of the in-product term list', () => {
    const termIds = new Set(GLOSSARY_TERMS.map((term) => term.id));
    for (const concept of CONCEPT_TERMS) {
      expect(termIds.has(concept.id)).toBe(false);
    }
    const conceptCategories = new Set<string>(CONCEPT_CATEGORIES);
    for (const entry of GLOSSARY_ENTRIES) {
      if (conceptCategories.has(entry.category)) {
        expect(entry.kind).toBe('concept');
      }
    }
  });

  test('gives every entry a canonical path under one namespace', () => {
    for (const entry of GLOSSARY_ENTRIES) {
      expect(entry.path).toBe(`/glossary/${entry.id}`);
    }
    expect(new Set(GLOSSARY_ENTRY_PATHS).size).toBe(
      GLOSSARY_ENTRY_PATHS.length,
    );
  });

  test('keeps every entry findable by id', () => {
    for (const entry of GLOSSARY_ENTRIES) {
      expect(findGlossaryEntry(entry.id)).toEqual(entry);
    }
    expect(findGlossaryEntry('not-a-term')).toBeUndefined();
  });

  test('groups without losing or duplicating an entry', () => {
    const grouped = glossaryEntriesByCategory().flatMap(
      (group) => group.entries,
    );
    expect(grouped.length).toBe(GLOSSARY_ENTRIES.length);
    for (const group of glossaryEntriesByCategory()) {
      expect(group.entries.length).toBeGreaterThan(0);
      for (const entry of group.entries) {
        expect(entry.category).toBe(group.category);
      }
    }
  });

  test('never suggests an entry as related to itself', () => {
    for (const entry of GLOSSARY_ENTRIES) {
      const related = relatedGlossaryEntries(entry);
      expect(related.length).toBeLessThanOrEqual(3);
      expect(related.some((item) => item.id === entry.id)).toBe(false);
    }
  });

  test('requires a definition and details on every entry', () => {
    for (const entry of GLOSSARY_ENTRIES) {
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.definition.length).toBeGreaterThan(0);
      expect(entry.details.length).toBeGreaterThan(0);
    }
  });
});
