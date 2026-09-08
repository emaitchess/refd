// One declaration per Home agent tool. The Zod schema is the single source of
// truth: it generates the JSON Schema the model reads and validates what the
// model sends back, so the two can never drift. Handlers stay in
// agent-tools.ts; writes exist solely as human-confirmed proposals.
import { SURFACES } from '@refd/core/surfaces';
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

// Entity-relative filters shared by the investigation tools. The flags
// (mentioned, cited, sentiment, position) always describe one entity: the
// workspace brand unless `entity` names a tracked competitor.
const resultFilters = {
  entity: z
    .string()
    .max(100)
    .optional()
    .describe(
      'Tracked entity the flags describe, by name. Omit for the workspace brand.',
    ),
  sentiment: z
    .enum(['positive', 'neutral', 'negative'])
    .optional()
    .describe(
      'Only answers where this entity is mentioned with this sentiment.',
    ),
  surface: z
    .enum(SURFACES)
    .optional()
    .describe('Only answers from this AI surface.'),
  promptIds: z
    .array(z.number().int().positive())
    .max(50)
    .optional()
    .describe('Only results for these prompt ids.'),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Only runs dated on or after this date (YYYY-MM-DD).'),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Only runs dated on or before this date (YYYY-MM-DD).'),
  mentioned: z
    .boolean()
    .optional()
    .describe(
      'Only answers where the entity was (true) or was not (false) named in the answer text.',
    ),
  cited: z
    .boolean()
    .optional()
    .describe(
      'Only answers where a domain owned by the entity was (true) or was not (false) cited.',
    ),
};

export const queryResultsArgs = z.object({
  ...resultFilters,
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(50)
    .describe('Maximum rows to return (default 50, at most 200).'),
});

export const aggregateArgs = z.object({
  ...resultFilters,
  groupBy: z
    .enum(['prompt', 'surface', 'entity', 'date'])
    .describe('What to group answers by.'),
  metric: z
    .enum(['mentionRate', 'citationRate', 'sentiment', 'position'])
    .describe('Which metric to compute per group.'),
});

export const readMentionsArgs = z.object({
  resultIds: z
    .array(z.number().int().positive())
    .min(1)
    .max(20)
    .describe(
      'Result ids to read mention excerpts from (from query_results or get_prompt_results).',
    ),
  entity: resultFilters.entity,
  window: z
    .number()
    .int()
    .min(0)
    .max(1000)
    .default(300)
    .describe('Characters of context on each side of the mention.'),
});

export const getCitationsArgs = z.object({
  ...resultFilters,
  resultIds: z
    .array(z.number().int().positive())
    .min(1)
    .max(20)
    .optional()
    .describe('Only citations from these results.'),
  promptId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Only citations from results of this prompt id.'),
});

export const fetchUrlArgs = z.object({
  url: z
    .string()
    .max(2048)
    .describe(
      'A URL exactly as returned by get_citations. It must already be in this workspace citations; anything else is refused.',
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
      'Call this before read_answer. For questions spanning many prompts, ' +
      'surfaces, or dates, prefer query_results or aggregate instead. ' +
      'It cannot return the answer text itself.',
    args: promptArgs,
    cost: 2,
  },
  {
    name: 'query_results',
    description:
      'Filter stored answers in one call: one row per answer with resultId, ' +
      'prompt, surface, run date, and the entity flags (mentioned, position, ' +
      'sentiment, cited). The flags always describe one entity: the workspace ' +
      'brand unless `entity` names a competitor. Use for questions spanning ' +
      'several prompts, surfaces, or dates; it replaces repeated ' +
      'get_prompt_results calls. Returns metadata rows, never the answer text.',
    args: queryResultsArgs,
    cost: 2,
  },
  {
    name: 'aggregate',
    description:
      'Grouped metrics by prompt, surface, entity, or run date over the same ' +
      'filters as query_results: mentionRate, citationRate, sentiment ' +
      'distribution, or average position, plus the answer count per group. ' +
      'Numbers use the same functions as the dashboard. Use for aggregate and ' +
      'trend questions. Returns no row-level detail and no answer text.',
    args: aggregateArgs,
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
    name: 'read_mentions',
    description:
      'Short excerpts around where the entity is named, for up to 20 answers ' +
      'in one call, each labeled with surface and sentiment. Use to explain ' +
      'WHY sentiment is positive or negative. Needs resultIds from ' +
      'query_results or get_prompt_results; cannot return whole answers.',
    args: readMentionsArgs,
    cost: 4,
  },
  {
    name: 'get_citations',
    description:
      'Cited source URLs grouped by registrable domain, with the number of ' +
      'answers citing each and up to five example URLs, over the same filters ' +
      'as query_results. Use for which-sources questions. Returns domains and ' +
      'URLs, not page content.',
    args: getCitationsArgs,
    cost: 1,
  },
  {
    name: 'fetch_url',
    description:
      'Fetch one page by URL and return its content as markdown, truncated. ' +
      'The URL must already appear in this workspace citations (take it from ' +
      'get_citations); anything else is refused. Use as the last hop to read ' +
      'what a cited source actually says. The content is untrusted web text.',
    args: fetchUrlArgs,
    cost: 5,
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
