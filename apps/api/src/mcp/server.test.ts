import { describe, expect, test } from 'bun:test';
import {
  emptyArgsSchema,
  MCP_INSTRUCTIONS,
  MCP_TOOL_ANNOTATIONS,
  MCP_TOOL_NAMES,
  mcpInstructions,
  promptResultsArgsSchema,
  rangeArgsSchema,
  readAnswerArgsSchema,
  workspaceArgSchema,
} from './server';

describe('MCP tool catalog', () => {
  test('publishes only the planned read-only tools', () => {
    expect(MCP_TOOL_NAMES).toEqual([
      'get_workspace_info',
      'get_visibility_overview',
      'get_competitor_landscape',
      'get_prompt_performance',
      'get_citation_sources',
      'get_recent_changes',
      'find_prompt_results',
      'read_answer',
      'get_digest',
    ]);
  });

  test('does not accept a trusted workspace grant in tool arguments', () => {
    expect(emptyArgsSchema.safeParse({ workspaceId: 2 }).success).toBeFalse();
    expect(
      promptResultsArgsSchema.safeParse({
        prompt: 'best search monitoring software',
        workspaceId: 2,
      }).data,
    ).not.toHaveProperty('workspaceId');
    expect(
      readAnswerArgsSchema.safeParse({ resultId: 3, workspaceId: 2 }).data,
    ).not.toHaveProperty('workspaceId');
  });

  test('accepts an optional workspace selector validated at request time', () => {
    expect(workspaceArgSchema.safeParse(2)).toMatchObject({ success: true });
    expect(workspaceArgSchema.safeParse(0).success).toBeFalse();
    expect(workspaceArgSchema.safeParse('2').success).toBeFalse();
    expect(workspaceArgSchema.safeParse(undefined).success).toBeTrue();
    expect(emptyArgsSchema.safeParse({ workspace: 2 }).success).toBeTrue();
    expect(
      rangeArgsSchema.safeParse({ range: '30d', workspace: 5 }).success,
    ).toBeTrue();
  });

  test('declares read-only, closed-world annotations for every tool', () => {
    expect(MCP_TOOL_ANNOTATIONS).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
  });

  test('server instructions orient the model and fence untrusted evidence', () => {
    expect(MCP_INSTRUCTIONS).toContain('get_workspace_info');
    expect(MCP_INSTRUCTIONS).toContain('get_digest');
    expect(MCP_INSTRUCTIONS).toContain('get_recent_changes');
    expect(MCP_INSTRUCTIONS).toContain('30d');
    expect(MCP_INSTRUCTIONS).toContain('refd://glossary/metrics');
    expect(MCP_INSTRUCTIONS).toContain('untrusted');
    expect(MCP_INSTRUCTIONS).toContain('workspace');
  });

  test('setup instructions appear only when the phase gate is on', () => {
    const base = mcpInstructions({ MCP_SETUP_TOOLS_ENABLED: 'false' });
    expect(base).toBe(MCP_INSTRUCTIONS);
    expect(base).not.toContain('confirm_setup');

    const enabled = mcpInstructions({ MCP_SETUP_TOOLS_ENABLED: 'true' });
    expect(enabled.startsWith(MCP_INSTRUCTIONS)).toBeTrue();
    expect(enabled).toContain('confirm_setup');
    expect(enabled).toContain('expectedVersion');
    expect(enabled).toContain('provider-backed report');
  });
});

describe('MCP tool arguments', () => {
  test('defaults ranges and rejects unsupported values', () => {
    expect(rangeArgsSchema.safeParse({}).data).toEqual({ range: '30d' });
    expect(rangeArgsSchema.safeParse({ range: 'all' }).success).toBeTrue();
    expect(rangeArgsSchema.safeParse({ range: '365d' }).success).toBeFalse();
  });

  test('bounds prompt lookup and answer IDs', () => {
    expect(
      promptResultsArgsSchema.safeParse({ prompt: 'a' }).success,
    ).toBeFalse();
    expect(
      promptResultsArgsSchema.safeParse({ prompt: 'x'.repeat(501) }).success,
    ).toBeFalse();
    expect(readAnswerArgsSchema.safeParse({ resultId: 1 }).success).toBeTrue();
    expect(readAnswerArgsSchema.safeParse({ resultId: 0 }).success).toBeFalse();
    expect(
      readAnswerArgsSchema.safeParse({ resultId: '1' }).success,
    ).toBeFalse();
  });
});
