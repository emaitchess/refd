import {
  GLOSSARY_TERMS,
  type GlossaryDefinition,
  TERM_CATEGORIES,
  type TermCategory,
} from './glossary';
import {
  METRIC_CATEGORIES,
  METRIC_INFO,
  type MetricCategory,
} from './metric-copy';

export type GlossaryKind = 'metric' | 'term';

export type GlossaryCategory = MetricCategory | TermCategory;

export interface GlossaryEntry extends GlossaryDefinition<GlossaryCategory> {
  kind: GlossaryKind;
  path: string;
}

const withKind = (
  definitions: readonly GlossaryDefinition<GlossaryCategory>[],
  kind: GlossaryKind,
): GlossaryEntry[] =>
  definitions.map((definition) => ({
    ...definition,
    kind,
    path: `/glossary/${definition.id}`,
  }));

/**
 * Metric definitions carry the measured contract, so they lead. Both sets share
 * one URL namespace because a reader searching "share of voice" does not know
 * or care which of the two files it happens to live in.
 */
export const GLOSSARY_ENTRIES: GlossaryEntry[] = [
  ...withKind(Object.values(METRIC_INFO), 'metric'),
  ...withKind(GLOSSARY_TERMS, 'term'),
];

export const GLOSSARY_CATEGORIES: GlossaryCategory[] = [
  ...METRIC_CATEGORIES,
  ...TERM_CATEGORIES,
];

export const GLOSSARY_ENTRY_PATHS: string[] = GLOSSARY_ENTRIES.map(
  (entry) => entry.path,
);

export const glossaryEntriesByCategory = (): {
  category: GlossaryCategory;
  entries: GlossaryEntry[];
}[] =>
  GLOSSARY_CATEGORIES.map((category) => ({
    category,
    entries: GLOSSARY_ENTRIES.filter((entry) => entry.category === category),
  })).filter((group) => group.entries.length > 0);

export const findGlossaryEntry = (id: string): GlossaryEntry | undefined =>
  GLOSSARY_ENTRIES.find((entry) => entry.id === id);

/**
 * Terms sharing a category are the closest thing to a "see also" the structured
 * definitions carry, so they stand in for hand-curated related links.
 */
export const relatedGlossaryEntries = (
  entry: GlossaryEntry,
  limit = 3,
): GlossaryEntry[] =>
  GLOSSARY_ENTRIES.filter(
    (candidate) =>
      candidate.id !== entry.id && candidate.category === entry.category,
  ).slice(0, limit);
