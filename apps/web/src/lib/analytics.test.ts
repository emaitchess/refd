import { describe, expect, test } from 'bun:test';
import { analyticsEnabled } from './analytics';

describe('analyticsEnabled', () => {
  test('enables analytics only on the configured hostname', () => {
    expect(analyticsEnabled('refd.ai', 'refd.ai')).toBe(true);
    expect(analyticsEnabled('refd.ai', ' refd.ai ')).toBe(true);
    expect(analyticsEnabled('refdlocal.io', 'refd.ai')).toBe(false);
    expect(analyticsEnabled('example.com', undefined)).toBe(false);
  });
});
