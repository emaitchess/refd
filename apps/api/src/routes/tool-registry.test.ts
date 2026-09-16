import { describe, expect, test } from 'bun:test';
import type { ChatScope } from '@refd/core/chat';
import {
  AGENT_TOOLS,
  agentTool,
  applyToolScope,
  availableTools,
  effectiveToolScope,
  offeredTool,
  toolDefinition,
  toolParameters,
} from './tool-registry';

describe('tool registry', () => {
  test('every declared tool has a unique name, a description, and a positive cost', () => {
    const names = AGENT_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of AGENT_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.cost).toBeGreaterThan(0);
    }
  });

  test('search_web is only offered when web search is configured', () => {
    expect(availableTools(false).map((tool) => tool.name)).not.toContain(
      'search_web',
    );
    expect(availableTools(true).map((tool) => tool.name)).toContain(
      'search_web',
    );
  });

  test('generated parameters carry no $schema and close the object', () => {
    for (const tool of AGENT_TOOLS) {
      const parameters = toolParameters(tool.args);
      expect('$schema' in parameters).toBe(false);
      expect(parameters.additionalProperties).toBe(false);
      expect(parameters.type).toBe('object');
    }
  });

  test('toolDefinition produces the OpenAI function shape', () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'get_digest');
    if (!tool) {
      throw new Error('get_digest must be declared');
    }
    const definition = toolDefinition(tool);
    expect(definition.type).toBe('function');
    expect(definition.function.name).toBe('get_digest');
    expect(definition.function.description).toBe(tool.description);
    expect(definition.function.parameters).toEqual(toolParameters(tool.args));
  });

  // The gate is only real if resolution respects it. agentTool searches the
  // whole registry, so resolving a model-named tool through it would hand back
  // a runnable handler for a tool this request never offered.
  test('offeredTool never resolves a tool held back from the request', () => {
    const offered = availableTools(false);
    expect(offeredTool(offered, 'search_web')).toBeUndefined();
    expect(agentTool('search_web')).toBeDefined();
    expect(offeredTool(offered, 'get_digest')?.name).toBe('get_digest');
    expect(offeredTool(availableTools(true), 'search_web')?.name).toBe(
      'search_web',
    );
  });

  test('offeredTool returns undefined for a name that is not a tool', () => {
    expect(offeredTool(AGENT_TOOLS, 'delete_everything')).toBeUndefined();
  });

  test('a declared schema rejects malformed arguments', () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'get_prompt_results');
    if (!tool) {
      throw new Error('get_prompt_results must be declared');
    }
    expect(tool.args.safeParse({}).success).toBe(false);
    expect(tool.args.safeParse({ prompt: 'x' }).success).toBe(false);
    expect(tool.args.safeParse({ prompt: 42 }).success).toBe(false);
    expect(
      tool.args.safeParse({ prompt: 'best voice control apps' }).success,
    ).toBe(true);
  });
});

describe('applyToolScope', () => {
  const scope: ChatScope = {
    version: 1,
    timezone: 'UTC',
    granularity: 'run_date',
    asOf: '2026-09-16',
    from: '2026-08-18',
    to: '2026-09-16',
    label: 'last 30 days (2026-08-18 to 2026-09-16)',
    source: 'default',
  };
  const queryResults = AGENT_TOOLS.find((t) => t.name === 'query_results');
  const readAnswer = AGENT_TOOLS.find((t) => t.name === 'read_answer');
  if (!queryResults || !readAnswer) {
    throw new Error('query_results and read_answer must be declared');
  }

  test('exactly the analytical tools inherit the exchange date scope', () => {
    expect(
      AGENT_TOOLS.filter((tool) => tool.inheritsDateScope).map(
        (tool) => tool.name,
      ),
    ).toEqual([
      'get_digest',
      'get_prompt_results',
      'query_results',
      'aggregate',
      'get_citations',
    ]);
  });

  test('undated tools pass through untouched', () => {
    const applied = applyToolScope(readAnswer, { resultId: 3 }, scope);
    expect(applied.ok && applied.args).toEqual({ resultId: 3 });
  });

  test('omitted bounds are injected from the exchange scope', () => {
    const applied = applyToolScope(queryResults, { limit: 5 }, scope);
    expect(applied.ok && applied.args).toEqual({
      limit: 5,
      from: '2026-08-18',
      to: '2026-09-16',
    });
  });

  test('bounds that broaden past the question are refused', () => {
    expect(
      applyToolScope(
        queryResults,
        { from: '2026-01-01', to: '2026-09-16' },
        scope,
      ),
    ).toEqual({
      ok: false,
      error: expect.stringContaining(scope.label),
    });
    expect(applyToolScope(queryResults, { to: '2026-12-31' }, scope).ok).toBe(
      false,
    );
  });

  test('narrower bounds and explicit both-ends dates survive', () => {
    const narrowed = applyToolScope(
      queryResults,
      { from: '2026-09-10', to: '2026-09-12' },
      scope,
    );
    expect(narrowed.ok && narrowed.args).toEqual({
      from: '2026-09-10',
      to: '2026-09-12',
    });
    const fromOnly = applyToolScope(
      queryResults,
      { from: '2026-09-01' },
      scope,
    );
    expect(fromOnly.ok && fromOnly.args).toEqual({
      from: '2026-09-01',
      to: '2026-09-16',
    });
  });

  test('an all-history scope accepts any supplied lower bound', () => {
    const all = { ...scope, from: null };
    const applied = applyToolScope(queryResults, { from: '2025-01-01' }, all);
    expect(applied.ok && applied.args).toEqual({
      from: '2025-01-01',
      to: '2026-09-16',
    });
  });

  test('non-object arguments to a date-scoped tool fail cleanly', () => {
    expect(applyToolScope(queryResults, 'not an object', scope).ok).toBe(false);
  });
});

describe('effectiveToolScope', () => {
  const scope: ChatScope = {
    version: 1,
    timezone: 'UTC',
    granularity: 'run_date',
    asOf: '2026-09-16',
    from: '2026-08-18',
    to: '2026-09-16',
    label: 'last 30 days (2026-08-18 to 2026-09-16)',
    source: 'default',
  };

  test('a narrowed call carries its own window, not the question span', () => {
    // The chat 47 defect: E1/E2 read one run date but their records claimed
    // the whole 30-day window.
    const effective = effectiveToolScope(
      { from: '2026-09-16', to: '2026-09-16', groupBy: 'surface' },
      scope,
    );
    expect(effective).toEqual({
      ...scope,
      from: '2026-09-16',
      to: '2026-09-16',
      label: '2026-09-16 to 2026-09-16',
    });
  });

  test('calls without their own bounds keep the question scope unchanged', () => {
    expect(effectiveToolScope({ limit: 5 }, scope)).toEqual(scope);
    expect(effectiveToolScope({}, scope)).toEqual(scope);
    expect(effectiveToolScope('not an object', scope)).toEqual(scope);
  });

  test('a from-only bound keeps the question upper bound', () => {
    const effective = effectiveToolScope({ from: '2026-09-01' }, scope);
    expect(effective).toEqual({
      ...scope,
      from: '2026-09-01',
      label: '2026-09-01 to 2026-09-16',
    });
  });

  test('an effective window identical to the question returns the same scope', () => {
    expect(
      effectiveToolScope({ from: '2026-08-18', to: '2026-09-16' }, scope),
    ).toBe(scope);
  });
});
