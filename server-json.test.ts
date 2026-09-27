import { describe, expect, test } from 'bun:test';
import server from './server.json';

// The registry validates this file against ServerDetail and answers a bad
// publish with 422, which cannot be fixed afterwards: a version is immutable
// once published. So the constraints the registry enforces are pinned here,
// where a rename or a longer blurb fails CI instead of the registry.
const SERVER_NAME_PATTERN = /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/;
const ICON_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/svg+xml',
  'image/webp',
];

describe('registry server.json', () => {
  test('carries the fields the registry requires', () => {
    expect(server.$schema).toStartWith('https://');
    expect(server.name).toMatch(SERVER_NAME_PATTERN);
    expect(server.description.length).toBeGreaterThan(0);
    expect(server.version.length).toBeGreaterThan(0);
  });

  test('description and title stay inside the registry 100-char ceiling', () => {
    expect(server.description.length).toBeLessThanOrEqual(100);
    expect(server.title?.length ?? 0).toBeLessThanOrEqual(100);
  });

  test('name and version stay inside the registry bounds', () => {
    expect(server.name.length).toBeLessThanOrEqual(200);
    expect(server.version.length).toBeLessThanOrEqual(255);
  });

  test('repository carries the url and source the registry requires', () => {
    expect(server.repository?.url).toStartWith('https://');
    expect(server.repository?.source).toBe('github');
  });

  test('icons and remotes are well formed', () => {
    for (const icon of server.icons ?? []) {
      expect(icon.src).toStartWith('https://');
      expect(icon.src.length).toBeLessThanOrEqual(255);
      if (icon.mimeType !== undefined) {
        expect(ICON_MIME_TYPES).toContain(icon.mimeType);
      }
    }
    for (const remote of server.remotes ?? []) {
      expect(remote.url).toStartWith('https://');
    }
  });

  test('points at the production MCP endpoint, not a local or stale host', () => {
    const urls = (server.remotes ?? []).map((remote) => remote.url);
    expect(urls).toContain('https://api.refd.ai/mcp');
    expect(urls.join(' ')).not.toContain('refdlocal');
  });
});
