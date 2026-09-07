import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { parseJson, tokenInputs } from './llm';

describe('parseJson', () => {
  const schema = z.object({ a: z.number() });

  test('reads a bare object', () => {
    expect(parseJson('{"a":1}', schema)).toEqual({ a: 1 });
  });

  test('reads through prose and code fences', () => {
    expect(parseJson('Sure!\n```json\n{"a":1}\n```', schema)).toEqual({ a: 1 });
  });

  test('keeps nested objects intact', () => {
    const nested = z.object({ a: z.object({ b: z.number() }) });
    expect(parseJson('{"a":{"b":2}}', nested)).toEqual({ a: { b: 2 } });
  });

  // Slicing first-{ to last-} spanned both objects and parsed as nothing.
  test('takes the first object when the model emits two', () => {
    expect(parseJson('{"a":1}\n{"a":2}', schema)).toEqual({ a: 1 });
  });

  test('survives a trailing sentence containing a brace', () => {
    expect(parseJson('{"a":1} and then {done}', schema)).toEqual({ a: 1 });
  });

  // Candidates are tried in order, so an earlier brace that is not JSON, or is
  // JSON of the wrong shape, no longer discards the real object.
  test('skips candidates that do not parse or do not validate', () => {
    expect(parseJson('note {x y} then {"a":1}', schema)).toEqual({ a: 1 });
    expect(parseJson('{"b":9} {"a":1}', schema)).toEqual({ a: 1 });
  });

  test('a brace inside a string never ends the object early', () => {
    const withText = z.object({ a: z.string() });
    expect(parseJson('{"a":"} not the end"}', withText)).toEqual({
      a: '} not the end',
    });
  });

  test('null when nothing parses or validates', () => {
    expect(parseJson('', schema)).toBeNull();
    expect(parseJson('no json here', schema)).toBeNull();
    expect(parseJson('{"a":1', schema)).toBeNull();
    expect(parseJson('{"a":"not a number"}', schema)).toBeNull();
  });
});

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
