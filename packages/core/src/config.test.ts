import { describe, expect, test } from 'bun:test';
import {
  applicationConfigFor,
  applicationConfigSchema,
  limitReached,
  STANDARD_LIMITS,
} from './config';
import { SURFACES } from './surfaces';

describe('applicationConfigFor', () => {
  test('returns the standard per-workspace and account limits', () => {
    expect(applicationConfigFor(false)).toEqual({
      version: 1,
      isAdmin: false,
      limits: STANDARD_LIMITS,
      availableSurfaces: [...SURFACES],
    });
  });

  test('gives administrators unlimited prompts and workspaces', () => {
    expect(applicationConfigFor(true).limits).toEqual({
      maxWorkspaces: null,
      maxActivePromptsPerWorkspace: null,
      maxEnabledSurfacesPerWorkspace: SURFACES.length,
    });
  });

  test('produces a response matching the public config schema', () => {
    expect(
      applicationConfigSchema.safeParse(applicationConfigFor(false)).success,
    ).toBe(true);
    expect(
      applicationConfigSchema.safeParse(applicationConfigFor(true)).success,
    ).toBe(true);
  });

  test('rejects a reordered or duplicated surface catalog', () => {
    expect(
      applicationConfigSchema.safeParse({
        ...applicationConfigFor(false),
        availableSurfaces: [
          'chatgpt',
          'perplexity',
          'gemini',
          'google_aio',
          'google_aio',
        ],
      }).success,
    ).toBe(false);
  });
});

describe('limitReached', () => {
  test('blocks counts at and above a finite limit', () => {
    expect(limitReached(4, 5)).toBe(false);
    expect(limitReached(5, 5)).toBe(true);
    expect(limitReached(6, 5)).toBe(true);
  });

  test('never blocks an unlimited allowance', () => {
    expect(limitReached(Number.MAX_SAFE_INTEGER, null)).toBe(false);
  });
});
