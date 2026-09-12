import { describe, expect, test } from 'bun:test';
import { AGENT_INSTALLS, MCP_ENDPOINT } from './agent-access';

// The install deeplinks encode the same server config per editor. If the
// encoding drifts, editors will silently fail to parse the config, so pin
// the round-trip here.
describe('agent install deeplinks', () => {
  const decodeCursor = (href: string): string =>
    atob(new URL(href).searchParams.get('config') ?? '');

  const decodeVscode = (href: string): string =>
    decodeURIComponent(
      new URL(
        href.replace('vscode:mcp/install?', 'http://x/?'),
      ).searchParams.get('config') ?? '',
    );

  test('every deeplink decodes to the canonical http server entry', () => {
    const expected = JSON.stringify({ type: 'http', url: MCP_ENDPOINT });
    for (const install of AGENT_INSTALLS) {
      if (!install.href) {
        continue;
      }
      const decoded =
        install.name === 'Cursor'
          ? decodeCursor(install.href)
          : decodeVscode(install.href);
      expect(JSON.parse(decoded)).toEqual(JSON.parse(expected));
    }
  });

  test('every command references the published endpoint', () => {
    for (const install of AGENT_INSTALLS) {
      if (install.command) {
        expect(install.command).toContain(MCP_ENDPOINT);
      }
    }
  });

  test('covers the two editors with native deeplinks and the two CLIs', () => {
    expect(AGENT_INSTALLS.map((install) => install.name)).toEqual([
      'Cursor',
      'VS Code',
      'Claude Code',
      'VS Code CLI',
    ]);
  });
});
