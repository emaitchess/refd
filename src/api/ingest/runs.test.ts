import { describe, expect, test } from 'bun:test';
import type { AppEnv } from '../env';
import { chunk, promptBatchSize } from './runs';

describe('chunk', () => {
  test('splits into fixed-size batches, last one smaller', () => {
    expect(chunk([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7],
    ]);
  });

  test('an exact multiple has no short trailing batch', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  test('a size larger than the input is a single batch', () => {
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
  });

  test('empty input yields no batches', () => {
    expect(chunk([], 5)).toEqual([]);
  });

  test('a non-positive size falls back to 1 rather than looping forever', () => {
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
  });
});

describe('promptBatchSize', () => {
  const env = (value: string | undefined) =>
    ({ PROMPT_BATCH_SIZE: value }) as unknown as AppEnv;

  test('parses the configured value', () => {
    expect(promptBatchSize(env('5'))).toBe(5);
    expect(promptBatchSize(env('10'))).toBe(10);
  });

  test('defaults to 5 when missing, invalid, or non-positive', () => {
    expect(promptBatchSize(env(undefined))).toBe(5);
    expect(promptBatchSize(env('abc'))).toBe(5);
    expect(promptBatchSize(env('0'))).toBe(5);
    expect(promptBatchSize(env('-3'))).toBe(5);
  });
});
