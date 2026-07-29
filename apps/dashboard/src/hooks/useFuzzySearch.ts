import Fuse, {
  type FuseResult,
  type FuseSearchOptions,
  type IFuseOptions,
} from 'fuse.js';
import { useDeferredValue, useMemo } from 'react';

export interface UseFuzzySearchOptions<T> {
  fuseOptions?: IFuseOptions<T>;
  searchOptions?: FuseSearchOptions;
  matchAllOnEmpty?: boolean;
  defer?: boolean;
  normalizeQuery?: (query: string) => string;
}

export interface UseFuzzySearchResult<T> {
  results: FuseResult<T>[];
  items: T[];
  normalizedQuery: string;
  activeQuery: string;
  hasQuery: boolean;
  isPending: boolean;
  total: number;
}

const normalizeSearchQuery = (query: string) =>
  query.trim().replace(/\s+/g, ' ');

export const useFuzzySearch = <T>(
  data: ReadonlyArray<T>,
  query: string,
  options: UseFuzzySearchOptions<T> = {},
): UseFuzzySearchResult<T> => {
  const {
    fuseOptions,
    searchOptions,
    matchAllOnEmpty = true,
    defer = true,
    normalizeQuery = normalizeSearchQuery,
  } = options;
  const normalizedQuery = useMemo(
    () => normalizeQuery(query),
    [normalizeQuery, query],
  );
  const deferredQuery = useDeferredValue(normalizedQuery);
  const activeQuery = defer ? deferredQuery : normalizedQuery;
  const fuse = useMemo(() => new Fuse(data, fuseOptions), [data, fuseOptions]);
  const results = useMemo(() => {
    if (activeQuery) {
      return fuse.search(activeQuery, searchOptions);
    }
    if (!matchAllOnEmpty) {
      return [];
    }
    const all = data.map((item, refIndex) => ({ item, refIndex }));
    const limit = searchOptions?.limit;
    return limit === undefined ? all : all.slice(0, Math.max(0, limit));
  }, [activeQuery, data, fuse, matchAllOnEmpty, searchOptions]);
  const items = useMemo(() => results.map((result) => result.item), [results]);

  return {
    results,
    items,
    normalizedQuery,
    activeQuery,
    hasQuery: normalizedQuery.length > 0,
    isPending: normalizedQuery !== activeQuery,
    total: results.length,
  };
};
