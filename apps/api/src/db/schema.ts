import type { Alias } from '@refd/core/mentions';
import type { SiteMetadata } from '@refd/core/site-metadata';
import type { MonitoringTier } from '@refd/core/workspaces';
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const createdAt = () =>
  integer('created_at', { mode: 'number' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  passwordHash: text('password_hash').notNull(),
  salt: text('salt').notNull(),
  tokenVersion: integer('token_version').notNull().default(0),
  createdAt: createdAt(),
});

// Resumable onboarding draft + soft brand profile. Everything here is an editable
// prefill until the wizard commits it to real entities/prompts; `step` is the
// resume marker. Null until the wizard first writes.
export interface WorkspaceProfile {
  step?: 'brand' | 'describe' | 'competitors' | 'prompts' | 'report';
  description?: string; // public-facing, shown in the dashboard
  summary?: string; // internal, feeds prompt/competitor generation
  targetMarket?: string;
  logoUrl?: string;
  siteMetadata?: SiteMetadata;
  // `domain` is the legacy single-domain draft shape; loadState upgrades it to
  // `domains` on read so in-flight wizards survive the shape change.
  competitors?: {
    name: string;
    domain?: string;
    domains?: string[];
    aliases?: Alias[];
  }[];
  prompts?: { text: string; category: string }[];
  // Manual regenerate count per AI step. Lives here (not in client state) so a
  // reload can't hand out a fresh allowance — every regenerate is a model call.
  regen?: { describe?: number; competitors?: number; prompts?: number };
  // Set once `commit` has materialised the drafts and fired the onboard runs.
  // Distinct from `onboardingCompleted`: the report is still part of the wizard
  // until the user leaves it, and a reload must land back on the report, not on
  // Review (which would commit a second time).
  committed?: boolean;
}

// A brand's tracking space. Standard users own up to five; administrators have
// no account-level cap. Every entity/prompt/run hangs off exactly one workspace.
export const workspaces = sqliteTable('workspaces', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  ownerUserId: integer('owner_user_id')
    .notNull()
    .references(() => users.id),
  // Flips true once the wizard finishes (or the user skips it); gates the dashboard.
  onboardingCompleted: integer('onboarding_completed', { mode: 'boolean' })
    .notNull()
    .default(false),
  monitoringTier: text('monitoring_tier')
    .$type<MonitoringTier>()
    .notNull()
    .default('snapshot_only'),
  // Null is indefinite. A Unix timestamp in milliseconds makes pilots and
  // cancelled subscriptions expire without another cron-side state transition.
  monitoringEndsAt: integer('monitoring_ends_at', { mode: 'number' }),
  profile: text('profile', { mode: 'json' }).$type<WorkspaceProfile>(),
  // Enabled AI surfaces for runs; null = the user's entitlement default. Set in
  // onboarding/Settings and bounded again when a run is created.
  surfaces: text('surfaces', { mode: 'json' }).$type<string[]>(),
  createdAt: createdAt(),
});

export const mcpConnections = sqliteTable(
  'mcp_connections',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    grantId: text('grant_id').notNull(),
    connectionKey: text('connection_key').notNull(),
    workspaceId: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    clientId: text('client_id').notNull(),
    clientName: text('client_name').notNull(),
    callbackTarget: text('callback_target'),
    scopes: text('scopes', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    createdAt: createdAt(),
    lastUsedAt: integer('last_used_at', { mode: 'number' }),
    revokedAt: integer('revoked_at', { mode: 'number' }),
  },
  (t) => [
    uniqueIndex('mcp_connections_grant_unique').on(t.grantId),
    uniqueIndex('mcp_connections_key_unique').on(t.connectionKey),
    index('mcp_connections_ws_idx').on(t.workspaceId),
  ],
);

export const entities = sqliteTable(
  'entities',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    name: text('name').notNull(),
    // JSON array of apex domains or specific hosts, e.g. ["getmrmr.com"];
    // every entry doubles as a mention alias and a citation-ownership match.
    domains: text('domains', { mode: 'json' }).$type<string[]>().notNull(),
    // Curated extra aliases (former names, products, shorthands). The matcher
    // composes name + these + domains via composeAliases — never read alone.
    aliases: text('aliases', { mode: 'json' })
      .$type<Alias[]>()
      .notNull()
      .default(sql`'[]'`),
    isBrand: integer('is_brand', { mode: 'boolean' }).notNull().default(false),
    // Stable ordering — drives chart-N color assignment (brand first).
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('entities_ws_name_unique').on(t.workspaceId, t.name),
    index('entities_ws_idx').on(t.workspaceId),
  ],
);

export const prompts = sqliteTable(
  'prompts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    text: text('text').notNull(),
    tags: text('tags', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('prompts_ws_text_unique').on(t.workspaceId, t.text),
    index('prompts_ws_idx').on(t.workspaceId),
  ],
);

// The entity set a run scores against, frozen at run creation (mirrors the
// frozen prompt set): mid-run entity edits can't skew results within a run.
export interface SnapshotEntity {
  id: number;
  name: string;
  domains: string[];
  aliases: Alias[];
  isBrand: boolean;
}

export interface SnapshotPrompt {
  id: number;
  text: string;
}

export const runs = sqliteTable(
  'runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    // Idempotency key: "cron:<wsId>:<date>" | "manual:<uuid>" | "import:<date>" | "onboard:<wsId>"
    key: text('key').notNull(),
    date: text('date').notNull(), // YYYY-MM-DD
    trigger: text('trigger', {
      enum: ['cron', 'manual', 'import', 'onboard'],
    }).notNull(),
    status: text('status', { enum: ['running', 'complete', 'failed'] })
      .notNull()
      .default('running'),
    okCount: integer('ok_count').notNull().default(0),
    totalCount: integer('total_count').notNull().default(0),
    entitySnapshot: text('entity_snapshot', { mode: 'json' }).$type<
      SnapshotEntity[]
    >(),
    // Hash of the snapshot's identity; trend charts draw a break marker where
    // consecutive runs differ (SOV/position shifts from set changes are
    // mechanical, not visibility events).
    entitySetHash: text('entity_set_hash'),
    createdAt: createdAt(),
    completedAt: integer('completed_at', { mode: 'number' }),
  },
  (t) => [
    uniqueIndex('runs_key_unique').on(t.key),
    index('runs_date_idx').on(t.date),
    index('runs_ws_idx').on(t.workspaceId),
  ],
);

export const snapshots = sqliteTable(
  'snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: integer('run_id')
      .notNull()
      .references(() => runs.id),
    provider: text('provider').notNull(),
    surface: text('surface').notNull(),
    // One snapshot per (surface, sample, chunk): identical prompts in one
    // BrightData batch risk being collapsed, which silently breaks sampling.
    sample: integer('sample').notNull().default(1),
    // Batch index within a (surface, sample): each batch is its own snapshot,
    // so a failed download loses one batch, not the whole surface.
    chunk: integer('chunk').notNull().default(0),
    // Prompt ids this snapshot covers, so a retry re-triggers the same batch.
    promptIds: text('prompt_ids', { mode: 'json' }).$type<number[]>(),
    // Frozen texts for webhook-driven fetches. Looking up live prompts here
    // would let a mid-run edit break record-to-prompt matching.
    promptSnapshot: text('prompt_snapshot', { mode: 'json' }).$type<
      SnapshotPrompt[]
    >(),
    externalId: text('external_id'),
    status: text('status', { enum: ['triggered', 'ready', 'failed'] })
      .notNull()
      .default('triggered'),
    createdAt: createdAt(),
    // Terminal timestamp (ready or failed); createdAt→finishedAt = how long
    // the provider batch took. Null while still polling.
    finishedAt: integer('finished_at', { mode: 'number' }),
    polls: integer('polls'),
  },
  // Idempotency: a redelivered trigger message must never re-trigger a snapshot.
  (t) => [
    uniqueIndex('snapshots_run_surface_unique').on(
      t.runId,
      t.provider,
      t.surface,
      t.sample,
      t.chunk,
    ),
    index('snapshots_external_id_idx').on(t.externalId),
  ],
);

export const results = sqliteTable(
  'results',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: integer('run_id')
      .notNull()
      .references(() => runs.id),
    promptId: integer('prompt_id')
      .notNull()
      .references(() => prompts.id),
    surface: text('surface').notNull(),
    sample: integer('sample').notNull(),
    provider: text('provider').notNull(),
    ok: integer('ok', { mode: 'boolean' }).notNull().default(false),
    // AIO-only: Google served no AI Overview for this query — valid, not a failure.
    answerPresent: integer('answer_present', { mode: 'boolean' })
      .notNull()
      .default(true),
    r2Key: text('r2_key'),
    totalUrls: integer('total_urls').notNull().default(0),
    error: text('error'),
    // End-to-end wall time for this unit: AIO = the sync fetch+score+store;
    // dataset surfaces = snapshot trigger → result stored (batch answers share
    // one provider round-trip, so batch-mates carry near-identical values).
    durationMs: integer('duration_ms'),
    createdAt: createdAt(),
  },
  // Idempotency: the unit-of-work identity; retries check-then-skip on this.
  (t) => [
    uniqueIndex('results_identity_unique').on(
      t.runId,
      t.promptId,
      t.surface,
      t.sample,
    ),
    index('results_run_idx').on(t.runId),
  ],
);

export const entityScores = sqliteTable(
  'entity_scores',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    resultId: integer('result_id')
      .notNull()
      .references(() => results.id),
    entityId: integer('entity_id')
      .notNull()
      .references(() => entities.id),
    mentioned: integer('mentioned', { mode: 'boolean' })
      .notNull()
      .default(false),
    mentionCount: integer('mention_count').notNull().default(0),
    // Offset of the first mention in the canonical answer text; null = absent.
    firstOffset: integer('first_offset'),
    // Mention spans into the canonical answer text — feeds position,
    // prominence, and client highlighting without re-running the matcher.
    spans: text('spans', { mode: 'json' }).$type<
      { start: number; end: number }[]
    >(),
    cited: integer('cited', { mode: 'boolean' }).notNull().default(false),
    // Distinct owned URLs among this answer's citations.
    citedCount: integer('cited_count').notNull().default(0),
    // 1 = first entity mentioned in the answer; null = not mentioned.
    position: integer('position'),
    // Best structural tier among the entity's spans; null = not mentioned.
    prominence: text('prominence', { enum: ['lead', 'body', 'list'] }),
    // 0 = scored before versioning existed; the rescore job replays R2 raws
    // to lift old rows to the current version.
    scoringVersion: integer('scoring_version').notNull().default(0),
    sentiment: text('sentiment', { enum: ['positive', 'neutral', 'negative'] }),
  },
  (t) => [
    uniqueIndex('entity_scores_identity_unique').on(t.resultId, t.entityId),
    index('entity_scores_entity_idx').on(t.entityId),
  ],
);

export const citations = sqliteTable(
  'citations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    resultId: integer('result_id')
      .notNull()
      .references(() => results.id),
    // Normalized URL (fragments/tracking params stripped, redirectors
    // unwrapped); dedup key within a result.
    url: text('url').notNull(),
    host: text('host'),
    // PSL-backed eTLD+1 for ranked-domains / source-gap grouping; null when
    // the URL is unattributable (e.g. an opaque grounding redirect).
    registrableDomain: text('registrable_domain'),
    // Tracked entity whose domain entry matched; null = third party. "Ours" is
    // derived (entityId = brand id), never stored.
    entityId: integer('entity_id').references(() => entities.id),
    origin: text('origin', { enum: ['source_list', 'inline', 'walk'] }),
    // Order within the provider source list (source_list origin only).
    rank: integer('rank'),
  },
  (t) => [index('citations_result_idx').on(t.resultId)],
);

// Login brute-force tracking: key = "email:<addr>" or "ip:<addr>".
export const loginAttempts = sqliteTable('login_attempts', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(0),
  resetAt: integer('reset_at').notNull(),
});

// Persisted "talk to the data" conversations (Home). The grounding digest is
// recomputed per question; what each answer actually showed is frozen on the
// message (panelData), so old conversations keep displaying the numbers the
// reader originally saw, not today's.
export const chats = sqliteTable(
  'chats',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    // First question, truncated — the conversation list label.
    title: text('title').notNull(),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'number' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index('chats_ws_idx').on(t.workspaceId)],
);

export interface ChatLink {
  label: string;
  to: string;
}

export interface ChatStep {
  label: string;
  detail?: string;
}

export interface ChatWebSource {
  title: string;
  url: string;
  // The S-number the answer prose cites (the stored list is the cited subset).
  num?: number;
}

// Agent write actions are proposals, never direct writes: the model drafts,
// a human confirms, and applying runs the same validated code paths as the
// dashboard. Status transitions pending → applied | dismissed, once.
export type ChatProposal =
  | {
      kind: 'prompts';
      items: { text: string; category?: string }[];
      status: 'pending' | 'applied' | 'dismissed';
      summary?: string;
    }
  | {
      kind: 'competitor';
      name: string;
      domains: string[];
      aliases: Alias[];
      status: 'pending' | 'applied' | 'dismissed';
      summary?: string;
    };

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    chatId: integer('chat_id')
      .notNull()
      .references(() => chats.id),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    content: text('content').notNull(),
    // Digest-section keys the assistant chose to show; the client renders them
    // as real components from panelData — numbers are never model-written.
    panels: text('panels', { mode: 'json' }).$type<string[]>(),
    panelData: text('panel_data', { mode: 'json' }).$type<
      Record<string, unknown>
    >(),
    // Deep links into the dashboard ("open Competitors"), validated app paths.
    links: text('links', { mode: 'json' }).$type<ChatLink[]>(),
    // The honest work trace behind an assistant answer (digest read, model
    // call, panel selection) plus how long the whole exchange took.
    steps: text('steps', { mode: 'json' }).$type<ChatStep[]>(),
    durationMs: integer('duration_ms'),
    // Confirmation-gated write draft + the web pages the answer cited.
    proposal: text('proposal', { mode: 'json' }).$type<ChatProposal>(),
    sources: text('sources', { mode: 'json' }).$type<ChatWebSource[]>(),
    createdAt: createdAt(),
  },
  (t) => [index('chat_messages_chat_idx').on(t.chatId)],
);
