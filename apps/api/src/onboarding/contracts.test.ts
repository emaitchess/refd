import { describe, expect, test } from 'bun:test';
import { patchRequestSchema } from './contracts';

describe('onboarding contracts', () => {
  test('accepts enabled surfaces in a draft update', () => {
    const parsed = patchRequestSchema.safeParse({
      expectedVersion: 4,
      surfaces: ['chatgpt', 'gemini', 'google_ai_mode', 'google_aio'],
    });

    expect(parsed.success).toBe(true);
  });

  test('requires at least one enabled surface', () => {
    const parsed = patchRequestSchema.safeParse({
      expectedVersion: 4,
      surfaces: [],
    });

    expect(parsed.success).toBe(false);
  });
});
