# Plan: BrightData `notify` webhook + backstop poll

**Goal:** Replace the per-snapshot polling loop with a BrightData **notify** webhook (BrightData calls us the moment a snapshot is ready), keeping a single long-delayed **backstop poll** per snapshot so a missed callback never strands a run.

**Status:** implemented locally on 2026-07-26; production migration, secret configuration, and deploy remain. This is a follow-up to the prompt-batching change (batch size 5 → ~40 snapshots/run, each previously polling up to 60×). Notify collapses that to ≈0 polls in the happy path.

**Non-goal:** BrightData "delivery" mode (`endpoint=`, where BrightData POSTs the full dataset). That's heavier on a Worker (large push body, must ack fast) and is out of scope. We use **notify** only: BrightData tells us *when*, we still `fetchSnapshot` ourselves.

---

## Current flow (baseline)

`src/api/ingest/runs.ts` `createRun` fans out `brightdata_trigger` messages → `src/api/ingest/consumer.ts`:

- `handleTrigger` (≈L90): `triggerBatch(env, surface, prompts)` (`src/api/providers/brightdata.ts`) → gets `snapshot_id`, inserts a `snapshots` row (`external_id = snapshot_id`, `status='triggered'`), enqueues a `brightdata_poll` (`polls: 0`, `delaySeconds: POLL_DELAY_SECONDS = 60`).
- `handlePoll` (≈L158): `checkProgress(env, snapshotId)` → `running` (re-enqueue, `polls+1`, up to `MAX_POLLS = 60`) / `failed` (`failWholeSnapshot`) / `ready` (`fetchSnapshot` → score/store per prompt → mark snapshot `ready`).
- Snapshot identity: `snapshots` unique on `(runId, provider, surface, sample, chunk)`; each row stores `promptIds` (the batch it covers). Status enum: `triggered | ready | failed`.
- Queue: `INGEST`, `handleIngestBatch`, `max_retries: 8`, DLQ. `ProviderRetryableError` → `message.retry()` with backoff; else record failure + ack.
- Routing (`src/api/index.ts`): only `/api/auth/*` and `/api/health` are unauthenticated; everything else is under `authed` (`requireAuth`) then `scoped` (`requireWorkspace`). `app.use('/api/*', requireJsonForMutations)` applies to all `/api/*`.

---

## Target design

1. **On trigger**, when notify is configured, pass `notify=true`, `endpoint=<PUBLIC_BASE_URL>/api/webhooks/brightdata`, and `auth_header=<secret>` on the BrightData trigger URL. BrightData sends the `auth_header` value as the callback's `Authorization` header when the snapshot finishes.
2. **New unauthenticated, secret-verified route** `POST /api/webhooks/brightdata` receives `{ snapshot_id, status }`, verifies the secret, looks up our snapshot row by `external_id`, and — if ready — enqueues a fetch (skip `checkProgress`). Responds `200` fast.
3. **Backstop:** at trigger time, also enqueue **one** `brightdata_poll` with a long delay (e.g. `BACKSTOP_DELAY_SECONDS = 1500`, ~25 min) instead of the tight 60s loop. If the webhook already completed the snapshot, the backstop is a cheap no-op; if the webhook was missed, the backstop drives it to completion.
4. **Config-gated fallback:** notify is enabled only when both `BRIGHTDATA_WEBHOOK_SECRET` and `PUBLIC_BASE_URL` are set. When unset (local dev, self-host without a public URL), keep today's 60s polling loop unchanged. BrightData cannot reach `localhost`/`refdlocal.io`, so local dev must stay on polling.

Net: production does ≈0 progress polls in the happy path (one DB read per snapshot for the backstop no-op); a missed webhook still self-heals via the backstop. Polling stops being the mechanism and becomes rare insurance.

---

## Changes, file by file

### `wrangler.jsonc` + secrets
- Add var `PUBLIC_BASE_URL` (e.g. `"https://refd.ai"`; leave blank/absent in local dev).
- Add secret `BRIGHTDATA_WEBHOOK_SECRET` (via `wrangler secret put`; `.dev.vars` locally if testing).
- Re-run `wrangler types` (`bun run check`) so `env.PUBLIC_BASE_URL` / `env.BRIGHTDATA_WEBHOOK_SECRET` type.

### `src/api/db/schema.ts`
- Add an index on `snapshots.external_id` — the webhook looks a snapshot up by it, and it is currently unindexed. (Migration via `bun run db:generate`; additive, safe.)
- Persist the snapshot's frozen `{ id, text }` prompt batch. Prompt IDs alone are insufficient because a mid-run prompt edit would otherwise break provider-record matching in the webhook fetch path.

### `src/api/providers/brightdata.ts` — `triggerBatch`
- When notify is configured (`env.BRIGHTDATA_WEBHOOK_SECRET && env.PUBLIC_BASE_URL`), append `notify=true`, the encoded callback `endpoint`, and the encoded `auth_header` secret to the trigger URL.
- Add a small exported helper `notifyEnabled(env): boolean` so `handleTrigger` can branch the backstop vs. tight-loop decision on the same condition.
- `format=ndjson` etc. stay as-is; this only adds the notify params.

### `src/api/ingest/messages.ts`
- Add a `brightdata_fetch` message to the discriminated union: `{ kind, runId, workspaceId, surface, sample, chunk, snapshotId, prompts }` (same fields as `brightdata_poll` minus `polls`). This is the "go straight to download" message the webhook enqueues.
- Keep `chunk: z.number().default(0)` convention for deploy-safety.

### `src/api/ingest/consumer.ts`
- **Extract** the post-`ready` body of `handlePoll` (the `fetchSnapshot` → per-prompt score/store → mark snapshot `ready` block) into a shared `fetchAndStore(env, msg, snap)` so both the poll path and the new fetch path use it (DRY, no logic drift).
- **Early-return guard** in `handlePoll` (and `handleFetch`): load the snapshot row first; if its `status !== 'triggered'`, return immediately. This makes the backstop poll a cheap no-op when the webhook already finished, and keeps duplicate deliveries idempotent.
- `handleTrigger`: after inserting the snapshot row, enqueue the backstop poll with `delaySeconds: notifyEnabled(env) ? BACKSTOP_DELAY_SECONDS : POLL_DELAY_SECONDS`. (Everything else unchanged; `handlePoll`'s `running` branch still re-enqueues at 60s if the backstop finds it not-yet-ready.)
- Add `handleFetch(env, msg)` for the `brightdata_fetch` kind: load snapshot by `(runId, provider, surface, sample, chunk)` (or by `snapshotId`), apply the early-return guard, then `fetchAndStore`. `fetchSnapshot` already treats a not-yet-materialized snapshot (HTTP 202) as `ProviderRetryableError`, so an early webhook self-corrects via retry — no need to re-check progress.
- Wire `brightdata_fetch` into the `handleIngestBatch` dispatch and `markMessageFailed` (route it to `failWholeSnapshot` like the poll/trigger kinds, passing its `chunk`).

### `src/api/routes/webhooks.ts` (new)
- `POST /` handler:
  1. Read the configured secret; if unset, `404`/`503` (notify shouldn't be hitting us).
  2. Compare the incoming auth header to the secret with a **constant-time** compare; mismatch → `401`, no body work.
  3. `safeParse` the body: `{ snapshot_id: string, status: string }` (lenient). Malformed → `400`.
  4. Look up the snapshot row by `external_id = snapshot_id`. Not found → `200` ack + log (rely on backstop; do not error, to avoid BrightData retry storms).
  5. If our row is already terminal (`ready`/`failed`) → `200` (idempotent no-op).
  6. If status indicates ready → enqueue `brightdata_fetch` using the row's `runId/workspaceId/surface/sample/chunk` and frozen prompt batch. If status indicates failed → `failWholeSnapshot`. Anything else (still running) → `200` ignore.
  7. Respond `200` fast — enqueue, never fetch/score inline (BrightData expects a timely ack or it retries).

### `src/api/index.ts`
- Mount the webhook **outside** `requireAuth`, alongside `/api/auth` and `/api/health`: `app.route('/api/webhooks', webhookRoutes)` before `app.route('/api', authed)`. It is secret-verified, not session-verified. Confirm `requireJsonForMutations` is satisfied (BrightData sends JSON) or exempt the path if needed.

---

## Security

- **Auth:** shared secret via BrightData's `auth_header`; verify constant-time. Reject before any DB work.
- **Least trust:** the webhook is only a *trigger* — we look up **our** snapshot row and use **our** stored `promptIds`; we never let the payload dictate what to fetch beyond matching an existing `snapshot_id`. Worst case of a forged-but-authenticated call is re-fetching an existing snapshot (idempotent).
- **Idempotency:** the handler only enqueues; `fetchAndStore` is already idempotent (`hasOkResult` per prompt, snapshot status guard). Duplicate notifies → cheap no-ops.
- **DoS:** cheapest check (secret) first; unknown `snapshot_id` acked with `200` (no retry storm) and logged.

## Reliability / edge cases

- **Missed webhook** (our endpoint down, retries exhausted, lost callback): the backstop poll catches it; `MAX_POLLS` still bounds the eventual timeout → `failWholeSnapshot`. This is the property that justifies keeping *any* polling.
- **Early webhook** (fires before the snapshot is downloadable): `fetchSnapshot`'s existing HTTP-202 → `ProviderRetryableError` path retries.
- **Race** (notify arrives before `handleTrigger` inserted the row): effectively impossible (scraping takes minutes), but handled — unknown `snapshot_id` → ack + backstop.
- **Failed status:** treat like `handlePoll`'s `failed` branch.

## Provider contract verified

- BrightData documents the notify payload as `{ snapshot_id, status, result_url }`; snapshot states are `starting`, `running`, `ready`, and `failed`. The handler acts only on `ready` and `failed`.
- BrightData documents `auth_header` as the callback's `Authorization` header value.
- Notify is lightweight; results remain downloadable through the snapshot API. BrightData currently documents 16-day snapshot retention.
- Docs: [Scraper async requests](https://docs.brightdata.com/api-reference/rest-api/scraper/asynchronous-requests), [Scrapers quick start](https://docs.brightdata.com/datasets/scrapers/scrapers-library/quickstart), [Download snapshot](https://docs.brightdata.com/api-reference/scrapers/delivery-apis/download-snapshot).

## Testing

- Webhook handler unit tests: valid secret + ready → enqueues `brightdata_fetch`; failed → marks failed; bad secret → `401`; unknown id → `200` ack; malformed body → `400`; already-terminal row → `200` no-op.
- `handlePoll`/`handleFetch` early-return guard: terminal snapshot → no `checkProgress`/`fetchSnapshot` call.
- Idempotency: two identical notifies → one effective fetch.
- Keep existing consumer/provider tests green.

Implemented coverage includes configured and fallback trigger URLs, constant-time secret verification, ready/failed callbacks, malformed/unauthorized/unknown callbacks, and terminal/running no-ops. The additive migration was applied successfully to an isolated local D1 database.

## Rollout

1. Set `BRIGHTDATA_WEBHOOK_SECRET` (secret) + `PUBLIC_BASE_URL` (var) in prod; deploy. Notify auto-enables via `notifyEnabled(env)`; unconfigured envs keep polling.
2. Log/metric the fetch trigger source (webhook vs backstop) to confirm notify is doing the work and backstops are rare.
3. Rollback = unset the config → transparently reverts to the 60s polling loop; no schema rollback needed (the `external_id` index and `brightdata_fetch` message are inert without notify).
