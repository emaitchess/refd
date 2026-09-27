import { describe, expect, test } from 'bun:test';
import { PUBLIC_SITE_ORIGIN } from '@refd/core/public-pages';
import { PUBLIC_SKILLS } from '@refd/core/public-skills';
import {
  AGENT_DISCOVERY,
  AGENT_INJECTION_BOUNDARY,
  AGENT_INSTALLS,
  AGENT_PROMPT_TOOLS,
  AGENT_PROMPT_WORKFLOW,
  AGENT_SCOPES,
  AGENT_SETUP_TOOLS,
  AGENT_SETUP_WORKFLOW,
  AGENT_SKILL_URLS,
  AGENT_WORKSPACE_ENTITLEMENT,
  COMPANION_SKILL_LINES,
  MCP_ENDPOINT,
  PUBLIC_SKILL_COPY,
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
    expect(AGENT_INJECTION_BOUNDARY).toContain(
      'no grant can delete run history',
    );
    expect(AGENT_INJECTION_BOUNDARY).toContain('run_now');
  });

  test('prompt tools list the six registered tools in workflow order', () => {
    expect(AGENT_PROMPT_TOOLS.map(([name]) => name)).toEqual([
      'list_prompts',
      'add_prompt',
      'update_prompt',
      'toggle_prompt',
      'remove_prompt',
      'run_now',
    ]);
    expect(AGENT_PROMPT_WORKFLOW).toContain('list_prompts');
    expect(AGENT_PROMPT_WORKFLOW).toContain('run_now');
    expect(AGENT_PROMPT_WORKFLOW).toContain('1d');
  });

  test('run_now is disclosed as an administrator-gated paid run', () => {
    const runNow = AGENT_PROMPT_TOOLS.find(([name]) => name === 'run_now')?.[1];
    expect(runNow).toContain('paid');
    expect(runNow).toContain('administrator');
    expect(runNow).toContain('5 per hour');
  });

  test('setup tools list the thirteen registered tools in workflow order', () => {
    expect(AGENT_SETUP_TOOLS.map(([name]) => name)).toEqual([
      'create_workspace',
      'check_domain',
      'get_setup_state',
      'set_brand',
      'draft_description',
      'suggest_competitors',
      'suggest_prompts',
      'update_setup',
      'preview_setup',
      'confirm_setup',
      'get_setup_report',
      'complete_setup',
      'revoke_connection',
    ]);
    expect(AGENT_SETUP_WORKFLOW).toContain('preview_setup');
    expect(AGENT_SETUP_WORKFLOW).toContain('confirm_setup');
    expect(AGENT_SETUP_WORKFLOW).toContain('check_domain');
    expect(AGENT_SETUP_WORKFLOW).toContain('complete_setup');
    expect(AGENT_SETUP_WORKFLOW).toContain('revoke_connection');
  });

  test('discovery exposes the SKILL.md', () => {
    const skill = AGENT_DISCOVERY.find(([label]) => label === 'Agent skill');
    expect(skill?.[1]).toBe('https://refd.ai/skills/refd/SKILL.md');
  });
});

describe('published skill discovery', () => {
  test('every catalog skill gets a discovery row and a canonical URL', () => {
    expect(AGENT_SKILL_URLS.map((skill) => skill.name)).toEqual(
      PUBLIC_SKILLS.map((skill) => skill.name),
    );
    for (const skill of AGENT_SKILL_URLS) {
      expect(skill.url).toBe(`${PUBLIC_SITE_ORIGIN}${skill.path}`);
      expect(AGENT_DISCOVERY).toContainEqual([
        skill.title,
        skill.url,
        expect.any(String),
      ]);
    }
  });

  // The refd skill is what an agent installs first, so it has to point at its
  // siblings from inside the file. A catalog with no companion would make this
  // empty, which is a publishing mistake rather than a valid state.
  test('the refd skill points at every companion skill', () => {
    const companions = PUBLIC_SKILLS.filter((skill) => skill.name !== 'refd');
    expect(companions.length).toBeGreaterThan(0);
    for (const skill of companions) {
      expect(COMPANION_SKILL_LINES).toContain(skill.path);
    }
    expect(COMPANION_SKILL_LINES).not.toContain('/skills/refd/');
  });

  test('llms.txt files every skill into the Skills section', () => {
    for (const skill of AGENT_SKILL_URLS) {
      expect(PUBLIC_SKILL_COPY[skill.name].llms.length).toBeGreaterThan(0);
    }
  });
});
