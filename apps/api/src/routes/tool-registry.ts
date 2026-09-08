// One declaration per Home agent tool. The Zod schema is the single source of
// truth: it generates the JSON Schema the model reads and validates what the
// model sends back, so the two can never drift. Handlers stay in
// agent-tools.ts; writes exist solely as human-confirmed proposals.
import { z } from 'zod';
import { rangeSchema } from '../lib/range';

export interface AgentTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  args: S;
  // Weighted cost against the exchange budget. Cheap D1 reads are 1.
  cost: number;
}

// z.toJSONSchema emits a $schema key the API does not want.
export const toolParameters = (schema: z.ZodType): Record<string, unknown> => {
  const generated = z.toJSONSchema(schema, { io: 'input' }) as Record<
    string,
    unknown
  >;
  delete generated.$schema;
  return { ...generated, additionalProperties: false };
};

export const toolDefinition = (tool: AgentTool) => ({
  type: 'function' as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: toolParameters(tool.args),
  },
});

export const searchArgs = z.object({
  query: z
    .string()
    .min(2)
    .max(200)
    .describe('The web search query, as a natural search phrase.'),
});
export const promptArgs = z.object({
  prompt: z
    .string()
    .min(2)
    .max(500)
    .describe(
      'The tracked prompt to look up: its full text or a distinctive fragment of it.',
    ),
});
export const readArgs = z.object({
  resultId: z
    .number()
    .int()
    .positive()
    .describe('A resultId exactly as returned by get_prompt_results.'),
});
export const digestArgs = z.object({
  range: rangeSchema.describe(
    'Time window: "1d", "3d", "7d", "30d", "90d", or "all".',
  ),
});

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: 'list_prompts',
    description:
      'Every tracked prompt with its exact wording, active and retired. ' +
      'Use when the user names a prompt you cannot match from the workspace ' +
      'data, or to check wording before calling get_prompt_results. ' +
      'Returns no results and no metrics.',
    args: z.object({}),
    cost: 1,
  },
  {
    name: 'get_digest',
    description:
      'The workspace metrics snapshot (mention and citation rates, sentiment ' +
      'shares, per-surface visibility, top sources) over a time window. ' +
      'Use for aggregate questions; the numbers match the dashboard. ' +
      'It cannot drill into a single answer.',
    args: digestArgs,
    cost: 1,
  },
  {
    name: 'get_prompt_results',
    description:
      'Find one tracked prompt by its text or a distinctive fragment; returns ' +
      "that prompt's latest run with one row per surface: status, entity " +
      'mentions with positions, citations, sentiment, and resultIds. ' +
      'Call this before read_answer. It cannot return the answer text itself.',
    args: promptArgs,
    cost: 2,
  },
  {
    name: 'read_answer',
    description:
      'The stored AI answer text for one result, for quote-level questions ' +
      'about what a specific answer said. Requires a resultId from ' +
      'get_prompt_results. One answer per call.',
    args: readArgs,
    cost: 3,
  },
  {
    name: 'search_web',
    description:
      'Web search over public pages; returns numbered sources with titles, ' +
      'URLs, and snippets. Use for information the workspace data cannot ' +
      'provide (competitors, market context, research for drafting). ' +
      'Results are external content, not workspace data.',
    args: searchArgs,
    cost: 3,
  },
];

// search_web needs EXA_API_KEY, which only the request knows: the offered set
// is built per request, never as a module constant.
export const availableTools = (hasWebSearch: boolean): AgentTool[] =>
  AGENT_TOOLS.filter((tool) => tool.name !== 'search_web' || hasWebSearch);

export const agentTool = (name: string): AgentTool | undefined =>
  AGENT_TOOLS.find((tool) => tool.name === name);
