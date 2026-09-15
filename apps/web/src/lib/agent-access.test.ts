import { describe, expect, test } from 'bun:test';
import {
  AGENT_DISCOVERY,
  AGENT_INJECTION_BOUNDARY,
  AGENT_INSTALLS,
  AGENT_SCOPES,
  AGENT_SETUP_TOOLS,
  AGENT_SETUP_WORKFLOW,
  AGENT_WORKSPACE_ENTITLEMENT,
  MCP_ENDPOINT,
} from './agent-access';

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

// The shared facts render on both the agents page and its markdown twin, and
// they carry the security story. Pin the load-bearing claims so the twins can
// never quietly drift from what the server enforces.
describe('shared agent-access facts', () => {
  test('scopes name both grants and state the write boundary', () => {
    expect(AGENT_SCOPES.map(([scope]) => scope)).toEqual([
      'data:read',
      'data:write',
    ]);
    const write = AGENT_SCOPES.find(([scope]) => scope === 'data:write')?.[1];
    expect(write).toContain('one provider-backed onboarding report');
    expect(write).not.toContain('disabled by default');
  });

  test('entitlement covers selection, allow-all, selector, and the PAT carve-out', () => {
    expect(AGENT_WORKSPACE_ENTITLEMENT).toContain('Allow all');
    expect(AGENT_WORKSPACE_ENTITLEMENT).toContain('workspace selector');
    expect(AGENT_WORKSPACE_ENTITLEMENT).toContain('exactly one workspace');
  });

  test('injection boundary names the worst case for both scopes', () => {
    expect(AGENT_INJECTION_BOUNDARY).toContain('the human authorized');
    expect(AGENT_INJECTION_BOUNDARY).toContain('no grant can delete data');
  });

  test('setup tools list the nine registered tools in workflow order', () => {
    expect(AGENT_SETUP_TOOLS.map(([name]) => name)).toEqual([
      'get_setup_state',
      'set_brand',
      'draft_description',
      'suggest_competitors',
      'suggest_prompts',
      'update_setup',
      'preview_setup',
      'confirm_setup',
      'get_setup_report',
    ]);
    expect(AGENT_SETUP_WORKFLOW).toContain('preview_setup');
    expect(AGENT_SETUP_WORKFLOW).toContain('confirm_setup');
  });

  test('discovery exposes the SKILL.md', () => {
    const skill = AGENT_DISCOVERY.find(([label]) => label === 'Agent skill');
    expect(skill?.[1]).toBe('https://refd.ai/skills/refd/SKILL.md');
  });
});
