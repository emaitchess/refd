import { describe, expect, test } from 'bun:test';
import {
  AGENT_TOOLS,
  agentTool,
  availableTools,
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
