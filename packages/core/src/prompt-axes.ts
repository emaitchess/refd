// Prompt intent axes: where the buyer is, and what shape the question takes.
//
// Both axes are DECLARED, never derived, and that is the whole design decision.
// A prompt's cohort (does it name the brand?) is provable from the text: the same
// matcher that scores a mention answers it. A funnel stage is not. Whether
// "how much do voice tools cost" is consideration or decision depends on who is
// asking and what they already know, and no substring settles it. Guessing would
// produce a dimension whose buckets look authoritative and mean nothing, which is
// strictly worse than an empty one: a reader cannot tell a guessed stage from a
// declared one, so they trust both.
//
// This is the same rule the rest of setup already follows. Ambiguity is resolved
// at setup, with a human confirming it, and never inside a read.
//
// Consequence for the aggregates: unlike cohort, there is NO default. A prompt
// naming the brand scores near 1.0 by construction, so the headline must default
// to the cohort that excludes it. A funnel stage has no such property: blending
// across stages does not flatter the brand or penalise it. So an omitted filter
// means every stage, the response names that population, and the per-bucket
// counts are always present so a reader can see the shape of the set.

import { z } from 'zod';

// Classic funnel: does the asker know the category exists, are they weighing
// options, or are they choosing a specific product. Left to the platform's own
// definition of the taxonomy, and named for what it measures rather than for a
// marketing diagram.
export const FUNNEL_STAGES = [
  'awareness',
  'consideration',
  'decision',
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

// The shape of the question, which is not the same as where the buyer is: a
// question can be navigational in any stage. These are the four search-intent
// forms, kept because they answer different questions about the same answers.
export const QUESTION_TYPES = [
  'informational',
  'navigational',
  'commercial',
  'transactional',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const funnelStageSchema = z.enum(FUNNEL_STAGES);
export const questionTypeSchema = z.enum(QUESTION_TYPES);

export const funnelStageField = z
  .enum(FUNNEL_STAGES)
  .nullish()
  .transform((value) => value ?? null);
export const questionTypeField = z
  .enum(QUESTION_TYPES)
  .nullish()
  .transform((value) => value ?? null);

// String or array, comma-separated, for the same reason the cohort filter takes
// both: an agent writing a filter by hand sends a string and one building it
// programmatically sends an array, and refusing the second blames the schema for
// a shape it never claimed to reject.
const splitFilter = (value: string | string[]) =>
  (Array.isArray(value) ? value : value.split(','))
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);

// Declared on write, absent means undeclared. A NULL is never read as a stage.
const axisFilter = <T extends string>(schema: z.ZodType<T, string>) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((value: string | string[]) => splitFilter(value))
    .pipe(z.array(schema))
    .transform((values) => (values.length > 0 ? values : null))
    .optional();

export const funnelStageFilterSchema = axisFilter(funnelStageSchema);
export const questionTypeFilterSchema = axisFilter(questionTypeSchema);

export const FUNNEL_STAGE_LABEL: Record<FunnelStage, string> = {
  awareness:
    'the asker is finding out whether a category of solution exists and what it does',
  consideration:
    'the asker is comparing approaches or options and weighing them',
  decision: 'the asker is choosing a specific product and checking it fits',
};

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  informational: 'the asker wants to understand something',
  navigational: 'the asker is looking for a specific page, product or account',
  commercial:
    'the asker is researching a purchase, including reviews and pricing',
  transactional: 'the asker is ready to buy, sign up or start using it',
};

export const matchesAxis = <T extends string>(
  value: T | null | undefined,
  filter: readonly T[] | null,
): boolean => filter === null || (value != null && filter.includes(value));

// Names the population an aggregate was measured over. Distinct from the cohort
// label because "every stage" and "every cohort" are different statements, and a
// response that said "all cohorts" while measuring every stage would be lying.
export const axisScopeLabel = <T extends string>(
  axis: 'stage' | 'type',
  filter: readonly T[] | null,
): string =>
  filter === null ? `every declared ${axis}` : filter.join(' and ');
