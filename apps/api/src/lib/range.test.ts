import { describe, expect, test } from 'bun:test';
import { detectRange, rangeLabel } from './range';

describe('detectRange', () => {
  test('counted phrases map to the nearest available window', () => {
    expect(detectRange('how did mrmr perform in the past 7 days')).toBe('7d');
    expect(detectRange('citations over the last 3 days')).toBe('3d');
    expect(detectRange('past 2 weeks of mentions')).toBe('30d');
    expect(detectRange('previous 3 months')).toBe('90d');
    expect(detectRange('last 1 day')).toBe('1d');
    expect(detectRange('past 90 days sentiment')).toBe('90d');
  });

  test('named periods', () => {
    expect(detectRange('how was this week?')).toBe('7d');
    expect(detectRange('summarize the past month')).toBe('30d');
    expect(detectRange('what about last quarter')).toBe('90d');
    expect(detectRange('anything today?')).toBe('1d');
  });

  test('all-time phrases', () => {
    expect(detectRange('has superwhisper ever been cited?')).toBe('all');
    expect(detectRange('all time share of voice')).toBe('all');
    expect(detectRange('since the beginning')).toBe('all');
  });

  test('no time hint means null, never a guess', () => {
    expect(detectRange('how is my brand performing?')).toBeNull();
    expect(detectRange('compare my competitors')).toBeNull();
    // "weekly"/"monthly" are cadence words, not windows.
    expect(detectRange('show my weekly cadence')).toBeNull();
  });
});

describe('rangeLabel', () => {
  test('labels', () => {
    expect(rangeLabel('30d')).toBe('last 30 days');
    expect(rangeLabel('7d')).toBe('last 7 days');
    expect(rangeLabel('all')).toBe('all history');
  });
});
