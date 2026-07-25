/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import {
  attributeHost,
  inlineUrls,
  isAssetUrl,
  matchesDomainEntry,
  normalizeCitationUrl,
} from './urls';

describe('normalizeCitationUrl', () => {
  test('strips fragments including AIO text anchors', () => {
    expect(
      normalizeCitationUrl('https://ahrefs.com/blog/seo#:~:text=key%20insight')
        ?.url,
    ).toBe('https://ahrefs.com/blog/seo');
  });

  test('strips tracking params, keeps meaningful ones', () => {
    const n = normalizeCitationUrl(
      'https://shop.example.com/p?id=42&utm_source=x&gclid=abc&srsltid=xyz',
    );
    expect(n?.url).toBe('https://shop.example.com/p?id=42');
  });

  test('unwraps google.com/url redirects', () => {
    const n = normalizeCitationUrl(
      'https://www.google.com/url?q=https://ahrefs.com/blog&sa=t',
    );
    expect(n?.host).toBe('ahrefs.com');
  });

  test('opaque grounding redirects are unattributable, never google.com', () => {
    const n = normalizeCitationUrl(
      'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC123',
    );
    expect(n).not.toBeNull();
    expect(n?.host).toBeNull();
    expect(n?.registrableDomain).toBeNull();
  });

  test('registrable domain uses the PSL, not naive TLD splitting', () => {
    expect(
      normalizeCitationUrl('https://blog.example.co.uk/x')?.registrableDomain,
    ).toBe('example.co.uk');
    expect(
      normalizeCitationUrl('https://docs.ahrefs.com/x')?.registrableDomain,
    ).toBe('ahrefs.com');
  });

  test('rejects non-http schemes and garbage', () => {
    expect(normalizeCitationUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeCitationUrl('not a url')).toBeNull();
    expect(normalizeCitationUrl('ftp://files.example.com/a')).toBeNull();
  });
});

describe('isAssetUrl', () => {
  test('filters favicons, thumbnails, and static assets', () => {
    expect(isAssetUrl('https://t0.gstatic.com/faviconV2?url=x')).toBe(true);
    expect(isAssetUrl('https://lh3.googleusercontent.com/img=s90')).toBe(true);
    expect(isAssetUrl('https://example.com/logo.png')).toBe(true);
    expect(isAssetUrl('https://example.com/article')).toBe(false);
  });
});

describe('matchesDomainEntry / attributeHost', () => {
  const entities = [
    { id: 1, domains: ['ahrefs.com'] },
    { id: 2, domains: ['analytics.google.com'] },
    { id: 3, domains: ['google.com'] },
  ];

  test('apex entries cover subdomains, not lookalikes', () => {
    expect(matchesDomainEntry('blog.ahrefs.com', 'ahrefs.com')).toBe(true);
    expect(matchesDomainEntry('ahrefs.com', 'ahrefs.com')).toBe(true);
    expect(matchesDomainEntry('notahrefs.com', 'ahrefs.com')).toBe(false);
  });

  test('longest entry wins when entities overlap', () => {
    expect(attributeHost('analytics.google.com', entities)).toBe(2);
    expect(attributeHost('mail.google.com', entities)).toBe(3);
    expect(attributeHost('example.org', entities)).toBeNull();
    expect(attributeHost(null, entities)).toBeNull();
  });
});

describe('inlineUrls', () => {
  test('harvests link destinations and bare URLs from markdown', () => {
    const text =
      'See [the guide](https://ahrefs.com/guide) or https://moz.com/learn.';
    expect(inlineUrls(text)).toEqual([
      'https://ahrefs.com/guide',
      'https://moz.com/learn',
    ]);
  });

  test('returns nothing for prose without URLs', () => {
    expect(inlineUrls('no links here')).toEqual([]);
  });
});
