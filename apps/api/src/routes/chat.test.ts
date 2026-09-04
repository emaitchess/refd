import { describe, expect, test } from 'bun:test';
import { parseDecision } from './chat';

describe('parseDecision', () => {
  test('reads a tool call', () => {
    expect(
      parseDecision('{"action":"tool","tool":"list_prompts","args":{}}'),
    ).toEqual({ action: 'tool', tool: 'list_prompts', args: {} });
  });

  test('reads a deliberate answer', () => {
    expect(parseDecision('{"action":"answer"}')).toEqual({
      action: 'answer',
      tool: '',
      args: {},
    });
  });

  test('finds the object when the model wraps it in prose or fences', () => {
    expect(
      parseDecision('Sure!\n```json\n{"action":"answer"}\n```'),
    ).not.toBeNull();
  });

  // The distinction the retry depends on: unreadable output must not
  // masquerade as a decision to stop gathering.
  test('unreadable output is null, never a silent answer', () => {
    expect(parseDecision('')).toBeNull();
    expect(parseDecision('I think I should look at the prompts')).toBeNull();
    expect(parseDecision('{"action":"tool"')).toBeNull();
  });

  test('an unknown action is unreadable, not an answer', () => {
    expect(parseDecision('{"action":"ponder"}')).toBeNull();
  });
});
