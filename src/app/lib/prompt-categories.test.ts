import { describe, expect, test } from 'bun:test';
import {
  PROMPT_CATEGORIES,
  PROMPT_CATEGORY_GLOSSARY,
  promptCategory,
  promptCategoryColor,
  UNCATEGORIZED_CATEGORY,
} from './prompt-categories';

describe('prompt categories', () => {
  test('canonical categories have distinct colors', () => {
    const colors = PROMPT_CATEGORIES.map(promptCategoryColor);
    expect(new Set(colors).size).toBe(PROMPT_CATEGORIES.length);
  });

  test('custom category colors are stable and case-insensitive', () => {
    expect(promptCategoryColor('Use cases')).toBe(
      promptCategoryColor('use cases'),
    );
  });

  test('missing tags use the uncategorized category', () => {
    expect(promptCategory([])).toBe(UNCATEGORIZED_CATEGORY);
    expect(promptCategory([''])).toBe(UNCATEGORIZED_CATEGORY);
  });

  test('documents every canonical category and the uncategorized fallback', () => {
    expect(PROMPT_CATEGORY_GLOSSARY.map(({ title }) => title)).toEqual([
      ...PROMPT_CATEGORIES,
      UNCATEGORIZED_CATEGORY,
    ]);
    expect(new Set(PROMPT_CATEGORY_GLOSSARY.map(({ id }) => id)).size).toBe(
      PROMPT_CATEGORY_GLOSSARY.length,
    );
  });
});
