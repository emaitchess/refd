import { describe, expect, test } from 'bun:test';
import { parseToolCall } from '../chat/exchange';
import { agentTool } from './tool-registry';

const getPromptResults = agentTool('get_prompt_results');
if (!getPromptResults) {
  throw new Error('get_prompt_results must be declared');
}

describe('parseToolCall', () => {
  test('parses and validates a well-formed call', () => {
    const parsed = parseToolCall(
      getPromptResults,
      '{"prompt":"best voice control apps for macOS"}',
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(JSON.stringify(parsed.args)).toBe(
        '{"prompt":"best voice control apps for macOS"}',
      );
    }
  });

  test('invalid JSON fails cleanly instead of throwing', () => {
    const parsed = parseToolCall(getPromptResults, 'not json');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.length).toBeGreaterThan(0);
    }
  });

  test('arguments of the wrong shape fail validation instead of throwing', () => {
    const parsed = parseToolCall(getPromptResults, '{"wrong":"field"}');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain('prompt');
    }
  });

  // z.object strips unknown keys by default, so an over-eager extra argument
  // is harmless: the call runs on the fields the schema declares.
  test('an unknown extra key is stripped, not rejected', () => {
    const parsed = parseToolCall(
      getPromptResults,
      '{"prompt":"best voice control apps for macOS","extra":1}',
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(JSON.stringify(parsed.args)).toBe(
        '{"prompt":"best voice control apps for macOS"}',
      );
    }
  });
});
