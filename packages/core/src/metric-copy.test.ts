import { describe, expect, test } from 'bun:test';
import {
  METRIC_CATEGORIES,
  METRIC_GLOSSARY,
  METRIC_INFO,
  metricGlossaryHref,
} from './metric-copy';

describe('metric glossary', () => {
  test('contains every metric definition exactly once', () => {
    expect(METRIC_GLOSSARY).toHaveLength(Object.keys(METRIC_INFO).length);
    expect(new Set(METRIC_GLOSSARY.map((metric) => metric.id)).size).toBe(
      METRIC_GLOSSARY.length,
    );
  });

  test('uses valid categories and stable glossary anchors', () => {
    for (const metric of METRIC_GLOSSARY) {
      expect(METRIC_CATEGORIES).toContain(metric.category);
      expect(metricGlossaryHref(metric)).toBe(`/help/glossary#${metric.id}`);
    }
  });
});
