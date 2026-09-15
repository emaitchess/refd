import { describe, expect, test } from 'bun:test';
import {
  patchRequestSchema,
  promptDraft,
  stepAfterBrandSave,
} from './contracts';

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

describe('prompt category', () => {
  test('accepts canonical categories', () => {
    expect(
      promptDraft.safeParse({
        text: 'What tools track AI visibility?',
        category: 'Discovery',
      }).success,
    ).toBe(true);
  });

  test('folds casing onto the canonical set', () => {
    const parsed = promptDraft.safeParse({
      draftId: 'manual-cmp-0',
      text: 'refd vs Profound for AI visibility tracking?',
      category: 'comparison',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({ category: 'Comparison' });
  });

  test('rejects categories outside the taxonomy', () => {
    const parsed = promptDraft.safeParse({
      draftId: 'manual-bad-0',
      text: 'What tools track AI visibility?',
      category: 'Awareness',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toContain('Discovery');
    }
  });
});

describe('stepAfterBrandSave', () => {
  test('advances the entry step to describe', () => {
    expect(stepAfterBrandSave(undefined)).toBe('describe');
    expect(stepAfterBrandSave('brand')).toBe('describe');
  });

  test('keeps the pointer where it is on describe', () => {
    expect(stepAfterBrandSave('describe')).toBe('describe');
  });

  test('never rewinds a draft that already advanced', () => {
    expect(stepAfterBrandSave('competitors')).toBe('competitors');
    expect(stepAfterBrandSave('prompts')).toBe('prompts');
    expect(stepAfterBrandSave('report')).toBe('report');
  });
});
