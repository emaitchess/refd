import { describe, expect, test } from 'bun:test';
import { tokenInputs } from './llm';

describe('tokenInputs', () => {
  test('null means no ceiling: the field is omitted entirely', () => {
    expect(tokenInputs(null)).toEqual({});
    expect('max_tokens' in tokenInputs(null)).toBe(false);
  });

  test('a number is passed through as the ceiling', () => {
    expect(tokenInputs(2000)).toEqual({ max_tokens: 2000 });
  });

  test('omitting the option keeps the legacy default', () => {
    expect(tokenInputs(undefined)).toEqual({ max_tokens: 1500 });
  });
});
