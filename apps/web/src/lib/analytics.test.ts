import { describe, expect, test } from 'bun:test';
import { analyticsConfig } from './analytics';

const env = {
  websiteId: 'ws-1',
  hostUrl: 'https://analytics.tunnl.xyz',
  analyticsHostname: 'refd.ai',
};

describe('analyticsConfig', () => {
  test('collects from the public site and the dashboard as one website', () => {
    const config = analyticsConfig(env, 'https://dash.refd.ai');
    expect(config?.websiteId).toBe('ws-1');
    expect(config?.domains).toEqual(['refd.ai', 'dash.refd.ai']);
    expect(config?.tag).toBe('web');
  });

  test('stays off unless every value is configured', () => {
    expect(
      analyticsConfig({ ...env, websiteId: undefined }, 'https://dash.refd.ai'),
    ).toBeNull();
    expect(
      analyticsConfig({ ...env, hostUrl: undefined }, 'https://dash.refd.ai'),
    ).toBeNull();
    expect(
      analyticsConfig(
        { ...env, analyticsHostname: undefined },
        'https://dash.refd.ai',
      ),
    ).toBeNull();
  });

  test('stays off when the dashboard origin is unparseable', () => {
    expect(analyticsConfig(env, 'not-a-url')).toBeNull();
  });
});
