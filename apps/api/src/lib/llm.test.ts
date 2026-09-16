import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import type { AppEnv } from '../env';
import {
  classifySentiments,
  LLM_MODEL,
  parseJson,
  SENTIMENT_DEFAULT_MODEL,
  tokenInputs,
} from './llm';

describe('parseJson', () => {
  const schema = z.object({ a: z.number() });

  test('reads a bare object', () => {
    expect(parseJson('{"a":1}', schema)).toEqual({ a: 1 });
  });

  test('reads through prose and code fences', () => {
    expect(parseJson('Sure!\n```json\n{"a":1}\n```', schema)).toEqual({ a: 1 });
  });

  test('keeps nested objects intact', () => {
    const nested = z.object({ a: z.object({ b: z.number() }) });
    expect(parseJson('{"a":{"b":2}}', nested)).toEqual({ a: { b: 2 } });
  });

  // Slicing first-{ to last-} spanned both objects and parsed as nothing.
  test('takes the first object when the model emits two', () => {
    expect(parseJson('{"a":1}\n{"a":2}', schema)).toEqual({ a: 1 });
  });

  test('survives a trailing sentence containing a brace', () => {
    expect(parseJson('{"a":1} and then {done}', schema)).toEqual({ a: 1 });
  });

  // Candidates are tried in order, so an earlier brace that is not JSON, or is
  // JSON of the wrong shape, no longer discards the real object.
  test('skips candidates that do not parse or do not validate', () => {
    expect(parseJson('note {x y} then {"a":1}', schema)).toEqual({ a: 1 });
    expect(parseJson('{"b":9} {"a":1}', schema)).toEqual({ a: 1 });
  });

  test('a brace inside a string never ends the object early', () => {
    const withText = z.object({ a: z.string() });
    expect(parseJson('{"a":"} not the end"}', withText)).toEqual({
      a: '} not the end',
    });
  });

  test('null when nothing parses or validates', () => {
    expect(parseJson('', schema)).toBeNull();
    expect(parseJson('no json here', schema)).toBeNull();
    expect(parseJson('{"a":1', schema)).toBeNull();
    expect(parseJson('{"a":"not a number"}', schema)).toBeNull();
  });

  // A token ceiling that truncates a multi-item array mid-item loses the
  // whole draft — generatePrompts moved to a json_schema response instead.
  test('truncated array output parses as nothing', () => {
    const prompts = z.object({
      prompts: z.array(z.object({ text: z.string() })),
    });
    expect(
      parseJson(
        '{"prompts":[{"text":"one"},{"text":"two"},{"text":"thr',
        prompts,
      ),
    ).toBeNull();
  });
});

describe('tokenInputs', () => {
  test('null means no ceiling: the field is omitted entirely', () => {
    expect(tokenInputs(null)).toEqual({});
    expect('max_completion_tokens' in tokenInputs(null)).toBe(false);
  });

  test('a number is passed through as the ceiling', () => {
    expect(tokenInputs(2000)).toEqual({ max_completion_tokens: 2000 });
  });

  test('omitting the option keeps the legacy default', () => {
    expect(tokenInputs(undefined)).toEqual({ max_completion_tokens: 1500 });
  });
});

describe('classifySentiments', () => {
  const aiEnv = (
    content: string | null,
    overrides: Partial<AppEnv> = {},
  ): { env: AppEnv; calls: { model: string; input: unknown }[] } => {
    const calls: { model: string; input: unknown }[] = [];
    const env = {
      AI: {
        run: async (model: string, input: unknown) => {
          calls.push({ model, input });
          if (content === null) {
            throw new Error('binding down');
          }
          return { choices: [{ message: { content } }] };
        },
      },
      ...overrides,
    } as unknown as AppEnv;
    return { env, calls };
  };

  const entities = [
    { id: 11, name: 'mrmr' },
    { id: 12, name: 'Dottie' },
  ];

  test('maps verdicts back by entity number and enforces the json_schema contract', async () => {
    const { env, calls } = aiEnv(
      '{"sentiments":[{"entity":1,"sentiment":"negative"},{"entity":2,"sentiment":"positive"}]}',
    );
    const verdicts = await classifySentiments(env, {
      answerText: 'x',
      entities,
    });
    expect(verdicts?.get(11)).toBe('negative');
    expect(verdicts?.get(12)).toBe('positive');
    expect(calls).toHaveLength(1);
    const first = calls[0];
    if (!first) {
      throw new Error('expected one model call');
    }
    expect(first.model).toBe(SENTIMENT_DEFAULT_MODEL);
    expect(
      (first.input as { response_format?: { type?: string } }).response_format
        ?.type,
    ).toBe('json_schema');
  });

  test('unknown or out-of-range entity numbers never resolve to a target', async () => {
    const { env } = aiEnv(
      '{"sentiments":[{"entity":3,"sentiment":"neutral"},{"entity":0,"sentiment":"negative"},{"entity":2,"sentiment":"positive"}]}',
    );
    const verdicts = await classifySentiments(env, {
      answerText: 'text',
      entities,
    });
    expect(verdicts?.size).toBe(1);
    expect(verdicts?.get(12)).toBe('positive');
  });

  test('malformed output is null, never a guess', async () => {
    const { env } = aiEnv('the model said something unparseable');
    expect(
      await classifySentiments(env, { answerText: 'text', entities }),
    ).toBeNull();
  });

  test('SENTIMENT_MODEL overrides the classifier model', async () => {
    const { env, calls } = aiEnv('{"sentiments":[]}', {
      SENTIMENT_MODEL: LLM_MODEL,
    });
    await classifySentiments(env, { answerText: 'text', entities });
    expect(calls[0]?.model).toBe(LLM_MODEL);
  });

  test('the default classifier is flash; the roster carries matched spans', async () => {
    const { env, calls } = aiEnv('{"sentiments":[]}');
    await classifySentiments(env, {
      answerText: 'tryprofound.com is solid',
      entities: [
        { id: 11, name: 'Profound', matchedAs: 'tryprofound.com' },
        { id: 12, name: 'mrmr' },
      ],
    });
    const first = calls[0];
    if (!first) {
      throw new Error('expected one model call');
    }
    expect(first.model).toBe(SENTIMENT_DEFAULT_MODEL);
    const user = (
      first.input as { messages: { role: string; content: string }[] }
    ).messages.find((m) => m.role === 'user')?.content;
    expect(user).toContain('1. Profound (appears as "tryprofound.com")');
    expect(user).toContain('2. mrmr\n');
    expect(user).not.toContain('appears as "mrmr"');
  });
});
