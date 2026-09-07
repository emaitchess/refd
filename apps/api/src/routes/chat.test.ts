import { describe, expect, test } from 'bun:test';
import { isLeakedPlan, parseDecision } from './chat';

describe('isLeakedPlan', () => {
  // The exact content chat 15 showed the user as its answer.
  test('catches the plan that reached a user', () => {
    expect(
      isLeakedPlan(
        '{"action":"tool","tool":"get_prompt_results","args":{"prompt":"Would a voice-to-action Mac app be useful for someone who spends most of their day writing and coding?"}}',
      ),
    ).toBe(true);
  });

  test('catches a bare tool call and a leading-whitespace plan', () => {
    expect(isLeakedPlan('{"tool":"get_digest","args":{"range":"7d"}}')).toBe(
      true,
    );
    expect(isLeakedPlan('\n  {"action":"answer"}')).toBe(true);
  });

  test('leaves real answers alone', () => {
    expect(
      isLeakedPlan('mrmr was mentioned in 19% of answers over the last week.'),
    ).toBe(false);
    expect(isLeakedPlan('')).toBe(false);
  });

  // Anchored to the opening brace: an answer that discusses JSON is prose.
  test('prose that quotes JSON later is not a plan', () => {
    expect(
      isLeakedPlan('The tool returned {"action":"tool"} for that prompt.'),
    ).toBe(false);
  });

  // A brace opening that is not a decision must still reach the user.
  test('a non-decision object is not treated as a leak', () => {
    expect(isLeakedPlan('{"panels":["overview"]}')).toBe(false);
  });
});

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

  // Chat 12 lost a whole exchange's gathering to output the model clearly
  // meant as a tool call. The wrapper is the only part that went missing.
  test('a bare tool call is read as one, wrapper or not', () => {
    expect(parseDecision('{"tool":"list_prompts","args":{}}')).toEqual({
      action: 'tool',
      tool: 'list_prompts',
      args: {},
    });
  });

  // The other half of that rule: never infer "answer" from a missing action,
  // or the silent fallthrough is back.
  test('a missing action with no tool stays unreadable', () => {
    expect(parseDecision('{"args":{}}')).toBeNull();
    expect(parseDecision('{}')).toBeNull();
  });

  test('reads the first usable object when the model emits two', () => {
    expect(
      parseDecision(
        '{"action":"tool","tool":"list_prompts"}\n{"action":"answer"}',
      ),
    ).toMatchObject({ action: 'tool', tool: 'list_prompts' });
  });

  test('reads the object when a sentence with braces follows it', () => {
    expect(
      parseDecision('{"action":"answer"} because the data {already} covers it'),
    ).toMatchObject({ action: 'answer' });
  });

  test('skips a leading brace that is not the decision', () => {
    expect(
      parseDecision('Plan {see below}: {"action":"tool","tool":"get_digest"}'),
    ).toMatchObject({ action: 'tool', tool: 'get_digest' });
  });
});
