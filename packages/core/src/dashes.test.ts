/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { normalizeDashes } from './dashes';

describe('normalizeDashes', () => {
  test('em dash becomes a comma, surrounding spaces consumed', () => {
    expect(normalizeDashes('A — B')).toBe('A, B');
    expect(normalizeDashes('A—B')).toBe('A, B');
    expect(normalizeDashes('A —B')).toBe('A, B');
    expect(normalizeDashes('A— B')).toBe('A, B');
  });

  test('en dash stays a hyphen so ranges survive', () => {
    expect(normalizeDashes('2–3 days')).toBe('2-3 days');
    expect(normalizeDashes('A – B')).toBe('A - B');
  });

  test('split artifacts are tidied', () => {
    expect(normalizeDashes('word , word')).toBe('word, word');
    expect(normalizeDashes('word, , word')).toBe('word, word');
  });

  test('plain text passes through untouched', () => {
    expect(normalizeDashes('already clean, 2-3 days')).toBe(
      'already clean, 2-3 days',
    );
    expect(normalizeDashes('')).toBe('');
  });
});
