import { describe, expect, test } from 'bun:test';
import {
  duplicateDraftIds,
  duplicatePromptIndex,
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

describe('duplicateDraftIds', () => {
  test('flags only ids repeated within one request', () => {
    expect(
      duplicateDraftIds([
        { draftId: 'a' },
        { draftId: 'b' },
        { draftId: 'a' },
        { draftId: 'a' },
      ]),
    ).toEqual(['a']);
    expect(duplicateDraftIds([{ draftId: 'a' }, { draftId: 'b' }])).toEqual([]);
  });

  test('absent ids are generated server-side, never conflicts', () => {
    expect(duplicateDraftIds([{}, {}, { draftId: 'x' }])).toEqual([]);
  });
});

describe('duplicatePromptIndex', () => {
  // The reported collision was silent because duplicateDraftIds skips entries
  // with no explicit id, and auto-assigned ids were positional. These pin the
  // check that sees through the id to the text that is the real identity.
  test('reports the index of a repeated prompt text', () => {
    expect(
      duplicatePromptIndex([
        { text: 'which tools track AI visibility?' },
        { text: 'what is the best voice app?' },
        { text: 'which tools track AI visibility?' },
      ]),
    ).toBe(2);
  });

  test('treats whitespace and case as the same prompt', () => {
    expect(
      duplicatePromptIndex([
        { text: 'which tools track AI visibility?' },
        { text: '  Which   Tools track AI visibility? ' },
      ]),
    ).toBe(1);
  });

  test('reports a repeated explicit draftId', () => {
    expect(
      duplicatePromptIndex([
        { draftId: 'a', text: 'one question here?' },
        { draftId: 'a', text: 'a different question?' },
      ]),
    ).toBe(1);
  });

  test('distinct prompts are not duplicates', () => {
    expect(
      duplicatePromptIndex([
        { text: 'which tools track AI visibility?' },
        { text: 'what is the best voice app?' },
      ]),
    ).toBeNull();
  });
});
