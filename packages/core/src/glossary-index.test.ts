import { describe, expect, test } from 'bun:test';
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
  test('merges every metric and term exactly once', () => {
    expect(GLOSSARY_ENTRIES.length).toBe(
      Object.keys(METRIC_INFO).length + GLOSSARY_TERMS.length,
    );
    expect(new Set(GLOSSARY_ENTRIES.map((entry) => entry.id)).size).toBe(
      GLOSSARY_ENTRIES.length,
    );
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
