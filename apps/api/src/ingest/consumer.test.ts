import { describe, expect, test } from 'bun:test';
import { isQueueOverload } from './consumer';

describe('isQueueOverload', () => {
  test('matches the Cloudflare Queues backpressure error', () => {
    expect(
      isQueueOverload(
        new Error('Queue is overloaded. Please back off. (10250)'),
      ),
    ).toBe(true);
  });

  test('does not match provider or transport failures', () => {
    expect(
      isQueueOverload(
        new Error(
          'brightdata 400 on trigger perplexity: Customer is not active',
        ),
      ),
    ).toBe(false);
    expect(isQueueOverload(new Error('Network connection lost.'))).toBe(false);
  });

  test('tolerates a non-Error throw', () => {
    expect(isQueueOverload('Queue is overloaded')).toBe(true);
    expect(isQueueOverload(undefined)).toBe(false);
  });
});
