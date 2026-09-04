import { describe, expect, test } from 'bun:test';
import { toolCatalog } from './agent-tools';

describe('toolCatalog', () => {
  test('advertises every dispatched tool', () => {
    const listed = toolCatalog(true)
      .split('\n')
      .map((line) => line.split(' ')[0]);
    expect(listed).toEqual([
      'search_web',
      'list_prompts',
      'get_prompt_results',
      'read_answer',
      'get_digest',
    ]);
  });

  test('hides search_web when Exa is not configured', () => {
    expect(toolCatalog(false)).not.toContain('search_web');
    expect(toolCatalog(false)).toContain('list_prompts');
  });
});
