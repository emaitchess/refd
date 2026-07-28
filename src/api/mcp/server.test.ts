import { describe, expect, test } from 'bun:test';
import {
  emptyArgsSchema,
  MCP_TOOL_NAMES,
  promptResultsArgsSchema,
  rangeArgsSchema,
  readAnswerArgsSchema,
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

  test('does not accept workspace scope in tool arguments', () => {
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
