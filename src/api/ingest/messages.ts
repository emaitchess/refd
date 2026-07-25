import { z } from 'zod';
import { DATASET_SURFACES } from '../providers/types';

const runPromptSchema = z.object({ id: z.number(), text: z.string() });

// Messages carry the run's frozen prompt set: prompt CRUD mid-run must not
// change what an in-flight run measures. The schema is the source of truth so
// the consumer can `safeParse` every message at intake — a message enqueued
// before a deploy that changed this shape is dropped, not looped.
export const ingestMessageSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('brightdata_trigger'),
    runId: z.number(),
    workspaceId: z.number(),
    surface: z.enum(DATASET_SURFACES),
    sample: z.number(),
    prompts: z.array(runPromptSchema),
  }),
  z.object({
    kind: z.literal('brightdata_poll'),
    runId: z.number(),
    workspaceId: z.number(),
    surface: z.enum(DATASET_SURFACES),
    sample: z.number(),
    snapshotId: z.string(),
    prompts: z.array(runPromptSchema),
    polls: z.number(),
  }),
  z.object({
    kind: z.literal('serp_aio_fetch'),
    runId: z.number(),
    workspaceId: z.number(),
    prompt: runPromptSchema,
    sample: z.number(),
  }),
  // Workspace backfill rescore: one cursor batch per message. The handler
  // rescores stale results with id > afterResultId and re-enqueues the next
  // cursor, so a single trigger chains through the whole backlog.
  z.object({
    kind: z.literal('rescore_batch'),
    workspaceId: z.number(),
    afterResultId: z.number(),
  }),
  // Post-scoring enrichment: LLM-classify how the stored answer portrays each
  // mentioned entity (entity_scores.sentiment). Fire-and-forget per result —
  // a failure leaves sentiment null; it never blocks or fails the run.
  z.object({
    kind: z.literal('sentiment_score'),
    workspaceId: z.number(),
    resultId: z.number(),
  }),
]);

export type RunPrompt = z.infer<typeof runPromptSchema>;
export type IngestMessage = z.infer<typeof ingestMessageSchema>;
