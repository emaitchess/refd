import { describe, expect, test } from 'bun:test';
import {
  emptyArgsSchema,
  MCP_INSTRUCTIONS,
  MCP_TOOL_ANNOTATIONS,
  MCP_TOOL_NAMES,
  promptCitationsArgsSchema,
  promptPerformanceArgsSchema,
  promptResultsArgsSchema,
  rangeArgsSchema,
  readAnswerArgsSchema,
  runHistoryArgsSchema,
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
      'get_run_history',
      'get_prompt_changes',
      'get_prompt_citations',
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
    expect(runHistoryArgsSchema.safeParse({ limit: 5 }).data).toMatchObject({
      limit: 5,
    });
    expect(runHistoryArgsSchema.safeParse({ limit: 51 }).success).toBeFalse();
    expect(
      promptCitationsArgsSchema.safeParse({ promptId: 3, range: '7d' }).data,
    ).toMatchObject({ promptId: 3, range: '7d' });
    expect(
      promptCitationsArgsSchema.safeParse({ promptId: 0 }).success,
    ).toBeFalse();
    expect(
      promptPerformanceArgsSchema.safeParse({ range: '30d', summary: true })
        .data,
    ).toMatchObject({ summary: true });
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

  test('server instructions include the bounded setup workflow', () => {
    expect(MCP_INSTRUCTIONS).toContain('confirm_setup');
    expect(MCP_INSTRUCTIONS).toContain('expectedVersion');
    expect(MCP_INSTRUCTIONS).toContain('provider-backed report');
    expect(MCP_INSTRUCTIONS).toContain('complete_setup');
  });

  test('server instructions include the operational prompt tools', () => {
    expect(MCP_INSTRUCTIONS).toContain('list_prompts');
    expect(MCP_INSTRUCTIONS).toContain('add_prompt');
    expect(MCP_INSTRUCTIONS).toContain('add_competitor');
    expect(MCP_INSTRUCTIONS).toContain('enable_surface');
    expect(MCP_INSTRUCTIONS).toContain('run_now');
    expect(MCP_INSTRUCTIONS).toContain('administrator accounts only');
  });

  test('server instructions orient agents through the run cycle', () => {
    expect(MCP_INSTRUCTIONS).toContain('get_run_history');
    expect(MCP_INSTRUCTIONS).toContain('get_prompt_changes');
    expect(MCP_INSTRUCTIONS).toContain('get_prompt_citations');
  });

  test('server instructions state the provisioning rule', () => {
    expect(MCP_INSTRUCTIONS).toContain('create_workspace');
    expect(MCP_INSTRUCTIONS).toContain('Allow all workspaces');
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
