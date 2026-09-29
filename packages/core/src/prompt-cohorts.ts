// Prompt cohorts: which questions name the brand, name only a competitor, or
// name neither. A prompt that spells out the brand is scored near 1.0 by
// construction, so blending it into an unprompted-visibility headline flatters
// the number; cohort membership is what lets a reader exclude it.
//
// Classification runs the same matcher the scorer runs, so "this prompt names
// the brand" means exactly what "this answer mentions the brand" means.

import { z } from 'zod';
import { type Alias, composeAliases, findMentionSpans } from './mentions';

// Two of these are provable from the prompt text and three are declared.
//
// brand_defining and alternative are lexical: the same matcher that scores a
// mention decides them, so they are derived and always right. problem,
// market_perception and the discovery residual are not — separating a
// problem-shaped question from a broad discovery question is a judgement about
// buyer intent, not a substring, and the repo's own rule is that ambiguity is
// resolved at setup time with human confirmation rather than in the read path.
// So the residual defaults to discovery and the other two are declared (setup
// suggestion with confirmation, or update_prompt), never guessed.
export const PROMPT_KINDS = [
  'discovery',
  'alternative',
  'brand_defining',
  'market_perception',
  'problem',
] as const;
export type PromptKind = (typeof PROMPT_KINDS)[number];

// A row can carry no kind yet: pre-migration prompts are classified lazily, and
// a NULL is never silently read as a real answer.
export const promptKindSchema = z.enum(PROMPT_KINDS);

export const promptKindField = z
  .enum(PROMPT_KINDS)
  .nullish()
  .transform((value) => value ?? null);

// Comma-separated on the wire because that is what an agent composing a filter
// by hand writes, and an array is accepted because that is what an agent
// building one programmatically sends. An empty or absent filter means every
// cohort (blended), which callers read as null. `.optional()` is outermost so
// the field stays optional in the generated JSON Schema rather than looking
// required.
// A caller may reasonably send the cohorts already split, because the field is
// described as a list and an agent that reads the description literally will
// send an array. Rejecting that shape produced "The tool arguments did not match
// the published schema", which blames the schema for a value the schema never
// claimed to reject, and the caller has no way to tell a shape problem from a
// genuine unknown cohort. Both shapes now parse; the published JSON Schema is
// the union, so a client validating against it is told about both.
const promptKindFilterValue = z
  .union([z.string(), z.array(z.string())])
  .transform((value) =>
    (Array.isArray(value) ? value : value.split(','))
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.length > 0),
  )
  .pipe(z.array(promptKindSchema))
  .transform((kinds) => (kinds.length > 0 ? kinds : null));

export const promptKindFilterSchema = promptKindFilterValue.optional();

export interface CohortEntity {
  id: number;
  name: string;
  domains: string[];
  aliases: Alias[];
  isBrand: boolean;
}

const matcherFor = (entities: CohortEntity[]) =>
  entities.map((entity) => ({
    id: entity.id,
    aliases: composeAliases(entity.name, entity.domains, entity.aliases),
  }));

export const mentionsAnyEntity = (text: string, entities: CohortEntity[]) =>
  findMentionSpans(text, matcherFor(entities)).length > 0;

// Brand-named beats competitor-named: a prompt naming both ("mrmr vs Alter") is
// the biased case this cohort exists to isolate, and calling it `competitor`
// would hide it inside the comparison set instead.
export const classifyPromptCohort = (
  text: string,
  entities: CohortEntity[],
): PromptKind => {
  if (
    mentionsAnyEntity(
      text,
      entities.filter((entity) => entity.isBrand),
    )
  ) {
    return 'brand_defining';
  }
  if (
    mentionsAnyEntity(
      text,
      entities.filter((entity) => !entity.isBrand),
    )
  ) {
    return 'alternative';
  }
  return 'discovery';
};

export const matchesPromptKind = (
  kind: string | null | undefined,
  filter: readonly PromptKind[] | null,
) => filter === null || filter.includes((kind ?? 'discovery') as PromptKind);
