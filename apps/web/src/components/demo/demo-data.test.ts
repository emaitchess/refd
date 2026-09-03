import { describe, expect, test } from 'bun:test';
import {
  DEMO_PROMPTS,
  DEMO_RANGE_DATA,
  DEMO_RANGE_ORDER,
  DEMO_SURFACES,
} from './demo-data';

describe('interactive demo data', () => {
  test('keeps every range chartable and bounded', () => {
    for (const range of DEMO_RANGE_ORDER) {
      const data = DEMO_RANGE_DATA[range];
      expect(data.trend.length).toBeGreaterThanOrEqual(2);
      expect(data.surfaces).toHaveLength(DEMO_SURFACES.length);
      expect(data.answerCount).toBe(
        data.runCount * DEMO_PROMPTS.length * DEMO_SURFACES.length,
      );

      for (const value of [
        data.tiles.mention.value,
        data.tiles.sov.value,
        data.tiles.citation.value,
      ]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
      expect(data.tiles.position.value).toBeGreaterThan(0);
    }
  });

  test('provides selectable evidence for every monitored surface', () => {
    expect(new Set(DEMO_PROMPTS.map((prompt) => prompt.surface))).toEqual(
      new Set(DEMO_SURFACES),
    );
    for (const prompt of DEMO_PROMPTS) {
      expect(prompt.answer.length).toBeGreaterThan(80);
      for (const citation of prompt.citations) {
        expect(new URL(citation.url).protocol).toBe('https:');
      }
    }
  });
});
