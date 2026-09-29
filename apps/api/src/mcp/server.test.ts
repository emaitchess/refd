import { describe, expect, test } from 'bun:test';
import { promptKindFilterSchema } from '@refd/core/prompt-cohorts';
import { PUBLIC_SKILL_PATHS } from '@refd/core/public-skills';
import { z } from 'zod';
import {
  createRefdMcpServer,
  digestArgsSchema,
  emptyArgsSchema,
  MCP_INSTRUCTIONS,
  MCP_RESOURCE_URIS,
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
      'get_prompt_set_timeline',
      'get_attribute_performance',
      'get_intent_performance',
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

// A tool that advertises `kind` and then ignores it is the worst failure mode
// here: the caller gets a plausible number labelled as a cohort rate when it is
// the blend. The list below is the contract, and each of those handlers must
// forward the parsed filter to a data function that applies it.
const KIND_FILTERED_TOOLS = [
  'get_visibility_overview',
  'get_competitor_landscape',
  'get_citation_sources',
  'get_prompt_performance',
] as const;

describe('MCP cohort filter contract', () => {
  test('only the aggregates that apply the filter advertise it', () => {
    expect('kind' in (rangeArgsSchema.shape ?? {})).toBeTrue();
    expect('kind' in (promptPerformanceArgsSchema.shape ?? {})).toBeTrue();

    // The digest returns every cohort side by side already, so it must not
    // accept a filter it cannot apply.
    expect('kind' in (digestArgsSchema.shape ?? {})).toBeFalse();
    expect(
      digestArgsSchema.safeParse({ range: '30d', kind: 'discovery' }).data,
    ).not.toHaveProperty('kind');
  });

  test('a filter that names an unknown cohort is rejected outright', () => {
    for (const schema of [rangeArgsSchema, promptPerformanceArgsSchema]) {
      expect(
        schema.safeParse({ range: '30d', kind: 'discovery' }).data,
      ).toMatchObject({ kind: ['discovery'] });
      expect(
        schema.safeParse({ range: '30d', kind: 'brand' }).success,
      ).toBeFalse();
      expect(schema.safeParse({ range: '30d', kind: '' }).data).toMatchObject({
        kind: null,
      });
    }
  });

  test('the instructions name the exception rather than claiming every tool filters', () => {
    expect(MCP_INSTRUCTIONS).toContain('get_digest is the exception');
    expect(MCP_INSTRUCTIONS).not.toContain(
      'Every aggregate that pools prompts',
    );
  });

  test('every tool that advertises the filter is a real read tool', () => {
    for (const name of KIND_FILTERED_TOOLS) {
      expect(MCP_TOOL_NAMES).toContain(name);
    }
  });
});

describe('MCP skill discovery', () => {
  // A connected agent cannot browse refd.ai, so the instructions are the only
  // place it learns a resource exists. The instructions and the registrations
  // read MCP_RESOURCE_URIS, so asserting the instructions carry each URI also
  // asserts the URI is one the server serves.
  test('the instructions name every resource the server serves', () => {
    for (const uri of Object.values(MCP_RESOURCE_URIS)) {
      expect(MCP_INSTRUCTIONS).toContain(uri);
    }
    expect(MCP_RESOURCE_URIS.promptSetDesign).toBe(
      'refd://skills/ai-prompt-set-design',
    );
  });

  test('the instructions point at every published skill file', () => {
    for (const path of PUBLIC_SKILL_PATHS) {
      expect(MCP_INSTRUCTIONS).toContain(`https://refd.ai${path}`);
    }
  });
});

// Every assertion in this file reads a Zod object. A client reads the PUBLISHED
// JSON Schema, and the two are produced by different code. These two tests are
// the ones that read the published side, because that is the side a broken
// argument is rejected on.
describe('MCP published schemas', () => {
  const shapeOf = (inputSchema: unknown): Record<string, unknown> | null => {
    const candidate = inputSchema as {
      def?: { shape?: Record<string, unknown> };
      shape?: Record<string, unknown>;
    };
    return candidate?.def?.shape ?? candidate?.shape ?? null;
  };

  test('every published tool schema advertises the arguments its handler parses', () => {
    const server = createRefdMcpServer(
      {} as never,
      {
        waitUntil: () => {},
      } as never,
    ) as unknown as {
      _registeredTools: Record<string, { inputSchema: unknown }>;
    };
    const names = Object.keys(server._registeredTools);
    expect(names.length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const [name, tool] of Object.entries(server._registeredTools)) {
      const shape = shapeOf(tool.inputSchema);
      if (!shape) continue;
      const published = (
        z as unknown as {
          toJSONSchema: (
            s: unknown,
            o: Record<string, unknown>,
          ) => { properties?: Record<string, unknown> };
        }
      ).toJSONSchema(z.object(shape), { io: 'input' });
      const advertised = new Set(Object.keys(published.properties ?? {}));
      for (const key of Object.keys(shape)) {
        if (!advertised.has(key)) {
          missing.push(`${name}.${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test('the kind filter takes a comma-separated string or an array alike', () => {
    const asString = promptPerformanceArgsSchema.safeParse({
      range: '30d',
      kind: 'discovery,alternative',
    });
    const asArray = promptPerformanceArgsSchema.safeParse({
      range: '30d',
      kind: ['discovery', 'alternative'],
    });
    expect(asString.success && asString.data.kind).toEqual([
      'discovery',
      'alternative',
    ]);
    expect(asArray.success && asArray.data.kind).toEqual([
      'discovery',
      'alternative',
    ]);
    // An unknown cohort is still refused rather than silently dropped.
    expect(
      promptPerformanceArgsSchema.safeParse({ range: '30d', kind: 'nonsense' })
        .success,
    ).toBeFalse();
    // And the published schema says both shapes are valid, so a client that
    // validates before sending cannot reject the array we now accept.
    const published = (
      z as unknown as {
        toJSONSchema: (s: unknown, o: Record<string, unknown>) => unknown;
      }
    ).toJSONSchema(promptKindFilterSchema, { io: 'input' }) as {
      anyOf?: { type?: string }[];
    };
    expect(published.anyOf?.map((entry) => entry.type).sort()).toEqual([
      'array',
      'string',
    ]);
  });
});
