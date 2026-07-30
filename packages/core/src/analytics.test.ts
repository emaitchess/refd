import { describe, expect, test } from 'bun:test';
import {
  ACTIVATION_FUNNEL,
  ANALYTICS_EVENTS,
  sanitizeAnalyticsPath,
} from './analytics';

describe('sanitizeAnalyticsPath', () => {
  test('collapses numeric record ids', () => {
    expect(sanitizeAnalyticsPath('/runs/1284')).toBe('/runs/:id');
    expect(sanitizeAnalyticsPath('/home/7')).toBe('/home/:id');
  });

  test('leaves static routes alone', () => {
    expect(sanitizeAnalyticsPath('/help/glossary')).toBe('/help/glossary');
    expect(sanitizeAnalyticsPath('/')).toBe('/');
    expect(sanitizeAnalyticsPath('/google-ai-overview-tracker')).toBe(
      '/google-ai-overview-tracker',
    );
  });
});

describe('ACTIVATION_FUNNEL', () => {
  test('every event step names a real event', () => {
    const known = new Set<string>(Object.values(ANALYTICS_EVENTS));
    for (const step of ACTIVATION_FUNNEL) {
      if (step.type === 'event') {
        expect(known.has(step.value)).toBe(true);
      }
    }
  });

  test('event names stay within umami 50-character limit', () => {
    for (const name of Object.values(ANALYTICS_EVENTS)) {
      expect(name.length).toBeLessThanOrEqual(50);
    }
  });
});
