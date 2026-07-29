import { describe, expect, test } from 'bun:test';
import { siteMetadataFromScrape } from './site-fetch';

const element = (
  selector: string,
  { text = '', content = '' }: { text?: string; content?: string },
) => ({
  selector,
  results: [
    {
      text,
      attributes: content ? [{ name: 'content', value: content }] : [],
    },
  ],
});

describe('siteMetadataFromScrape', () => {
  test('extracts page metadata and resolves a relative Open Graph image', () => {
    const metadata = siteMetadataFromScrape(
      {
        success: true,
        result: [
          element('title', { text: '  Acme  ' }),
          element('meta[name="description"]', {
            content: 'Tools for careful teams.',
          }),
          element('meta[property="og:image"]', {
            content: '/social/card.png',
          }),
        ],
      },
      'https://acme.example/',
    );

    expect(metadata).toEqual({
      title: 'Acme',
      description: 'Tools for careful teams.',
      imageUrl: 'https://acme.example/social/card.png',
    });
  });

  test('falls back to Open Graph copy and rejects unsafe image schemes', () => {
    const metadata = siteMetadataFromScrape(
      {
        success: true,
        result: [
          element('meta[property="og:title"]', { content: 'Acme Social' }),
          element('meta[property="og:description"]', {
            content: 'A social description.',
          }),
          element('meta[property="og:image"]', {
            content: 'javascript:alert(1)',
          }),
        ],
      },
      'https://acme.example/',
    );

    expect(metadata).toEqual({
      title: 'Acme Social',
      description: 'A social description.',
      imageUrl: '',
    });
  });

  test('returns null for an invalid or empty scrape response', () => {
    expect(
      siteMetadataFromScrape({ success: false }, 'https://example.com/'),
    ).toBeNull();
    expect(
      siteMetadataFromScrape(
        { success: true, result: [] },
        'https://example.com/',
      ),
    ).toBeNull();
  });
});
