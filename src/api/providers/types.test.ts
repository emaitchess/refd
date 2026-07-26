import { describe, expect, test } from 'bun:test';
import { enabledSurfaces, SURFACES } from './types';

describe('enabledSurfaces', () => {
  test('uses the canonical leading surfaces for a bounded default', () => {
    expect(enabledSurfaces(null, 3)).toEqual([
      'chatgpt',
      'perplexity',
      'gemini',
    ]);
  });

  test('preserves canonical order while enforcing the maximum', () => {
    expect(
      enabledSurfaces(['google_aio', 'gemini', 'chatgpt', 'perplexity'], 3),
    ).toEqual(['chatgpt', 'perplexity', 'gemini']);
  });

  test('allows every surface at the administrator maximum', () => {
    expect(enabledSurfaces(null, SURFACES.length)).toEqual([...SURFACES]);
  });
});
