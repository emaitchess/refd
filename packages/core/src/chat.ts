import { z } from 'zod';

export const CHAT_EXCHANGE_STATUSES = [
  'accepted',
  'running',
  'completed',
  'partial',
  'failed',
  'cancelled',
] as const;

export const CHAT_EXCHANGE_PHASES = [
  'accepted',
  'gathering',
  'answering',
  'metadata',
  'finalizing',
  'terminal',
] as const;

// The wall-clock ceiling for one exchange, shared by the routes that stamp
// deadlines and the engine that budgets its phases against the same alarm.
export const CHAT_EXCHANGE_TIMEOUT_MS = 5 * 60 * 1000;

export const chatExchangeStatusSchema = z.enum(CHAT_EXCHANGE_STATUSES);
export const chatExchangePhaseSchema = z.enum(CHAT_EXCHANGE_PHASES);

export type ChatExchangeStatus = z.infer<typeof chatExchangeStatusSchema>;
export type ChatExchangePhase = z.infer<typeof chatExchangePhaseSchema>;

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const chatScopeSchema = z.object({
  version: z.literal(1),
  timezone: z.literal('UTC'),
  granularity: z.literal('run_date'),
  asOf: isoDateSchema,
  from: isoDateSchema.nullable(),
  to: isoDateSchema,
  label: z.string().min(1).max(100),
  source: z.enum(['explicit', 'inherited', 'default']),
  inheritedFromMessageId: z.number().int().positive().optional(),
  dataThrough: isoDateSchema.nullable().optional(),
});

export type ChatScope = z.infer<typeof chatScopeSchema>;

export const chatEvidenceProvenanceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('result'),
    resultId: z.number().int().positive(),
    runId: z.number().int().positive(),
    promptId: z.number().int().positive(),
    surface: z.string().min(1).max(40),
    runDate: isoDateSchema,
  }),
  z.object({
    kind: z.literal('web'),
    url: z.string().url(),
    title: z.string().max(300),
    retrieval: z.enum(['search', 'page']),
    retrievedAt: z.number().int().positive(),
    sourceNum: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal('derived'),
    derivation: z.enum([
      'digest',
      'aggregate',
      'query',
      'citations',
      'changes',
    ]),
    metric: z.string().max(40).optional(),
    groupBy: z.string().max(40).optional(),
  }),
]);

export const chatEvidenceRecordSchema = z.object({
  id: z.string().regex(/^E\d+$/),
  status: z.enum(['ok', 'partial', 'no_data', 'unavailable', 'error']),
  origin: z.enum(['digest', 'tool']),
  tool: z.string().max(60).nullable(),
  arguments: z.unknown().nullable(),
  result: z.string().max(30_000),
  scope: chatScopeSchema,
  provenance: z.array(chatEvidenceProvenanceSchema).max(250),
});

export type ChatEvidenceProvenance = z.infer<
  typeof chatEvidenceProvenanceSchema
>;
export type ChatEvidenceRecord = z.infer<typeof chatEvidenceRecordSchema>;

export const chatQuestionSchema = z.object({
  id: z.number().int().positive(),
  role: z.literal('user'),
  content: z.string(),
  createdAt: z.number().int().positive(),
});

export const chatExchangeSummarySchema = z.object({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  status: chatExchangeStatusSchema,
  phase: chatExchangePhaseSchema,
  questionId: z.number().int().positive(),
  deadlineAt: z.number().int().positive(),
  lastEventSeq: z.number().int().nonnegative(),
  error: z.string().nullable(),
});

export type ChatExchangeSummary = z.infer<typeof chatExchangeSummarySchema>;

export const chatStartResponseSchema = z.object({
  chatId: z.number().int().positive(),
  title: z.string(),
  exchange: chatExchangeSummarySchema,
  question: chatQuestionSchema,
});

export type ChatStartResponse = z.infer<typeof chatStartResponseSchema>;

const eventBase = z.object({
  exchangeId: z.string().uuid(),
  seq: z.number().int().positive(),
});

export const chatStreamEventSchema = z.discriminatedUnion('type', [
  eventBase.extend({
    type: z.literal('step'),
    label: z.string(),
    detail: z.string().optional(),
  }),
  eventBase.extend({ type: z.literal('delta'), text: z.string() }),
  eventBase.extend({
    type: z.literal('meta'),
    panels: z.array(z.string()),
    panelData: z.record(z.string(), z.unknown()).nullable(),
  }),
  eventBase.extend({
    type: z.literal('done'),
    chatId: z.number().int().positive(),
    title: z.string(),
    messages: z.array(z.unknown()),
  }),
  eventBase.extend({ type: z.literal('error'), message: z.string() }),
]);

export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;

export const isActiveChatExchange = (status: ChatExchangeStatus): boolean =>
  status === 'accepted' || status === 'running';
