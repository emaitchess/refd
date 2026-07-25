# refd — AEO Tool Implementation Plan

## Context

Convert the existing single-script AEO monitor (`run.mjs` + `prompts.json`, Oxylabs-based) into a full-fledged AEO tool for tracking mrmr's visibility, mentions, citations, and ranks across AI answer surfaces. Deployed at **refd.ai** as a **single Cloudflare Worker** (backend + UI). Provider switched from Oxylabs to **BrightData only**: dataset scrapers for ChatGPT, Perplexity, Gemini, Google AI Mode; BrightData SERP API for Google AI Overviews.

## Core features

1. **Multi-surface prompt tracking** — a curated prompt set run on schedule (daily cron) and on demand across ChatGPT, Perplexity, Gemini, Google AI Mode, and Google AI Overviews, with N samples per prompt to smooth non-determinism.
2. **Mention tracking** — word-boundary brand detection for mrmr and every tracked competitor in each AI answer.
3. **Citation tracking** — URL- and domain-level detection of who gets cited, with full lists of our cited URLs per run.
4. **Rank / position tracking** — order of first mention among tracked entities per answer (1 = mentioned first), averaged over time.
5. **Derived metrics** — visibility % (share of answers mentioning an entity), Share of Voice (entity mentions ÷ all tracked-entity mentions), average position, citation frequency; all trended run-over-run and per surface.
6. **Competitor benchmarking** — same metrics computed for all competitors, side-by-side comparisons and trends.
7. **Source intelligence** — ranked cited domains across all answers plus source-gap analysis: domains AI cites on prompts where mrmr is absent (the "go get mentioned there" list).
8. **Run history & raw snapshots** — every response archived (gzipped, R2), browsable per run/result for auditing and re-scoring.
9. **Prompt & entity management** — CRUD for prompts (with tags/active flag) and tracked entities (brand + competitor domains) from the dashboard.
10. **Dashboard** — sidebar UI (Overview, Prompts, Sources, Competitors, Runs, Settings) with dither-kit charts for all trends.
11. **Phase 2: sentiment analysis** — positive/neutral/negative classification of each brand mention via Cloudflare Workers AI (the `AI` binding).
12. **Phase 2: change alerts** — run-over-run deltas surfaced on Overview (visibility drops, lost citations, new competitor appearances).
13. **Phase 2: AI-powered onboarding** — a **resumable** multi-step wizard (progress tracked by `workspaces.onboardingCompleted` + a step marker; every step degrades to manual input on failure, with live loading status throughout):
    1. **Set up your brand** — user enters brand name + domain; creates the brand entity (so `RequireBrand` passes and the later steps enrich).
    2. **Describe** — fetch the site (`llms.txt`/`llms-full.txt` if present, else render markdown via Cloudflare **Browser Rendering**) and draft an editable public **description** + an internal **summary** with Workers AI `@cf/zai-org/glm-5.2`; display name, description, and a **logo** (favicon API — `google.com/s2/favicons` or `favicon.im`). Fetch failure → ask the user to write the description.
    3. **Competitors** — find the top ~5 via **parallel.ai Search** + glm-5.2 function calling; show icon/name/domain; user adds/removes.
    4. **Prompts** — glm-5.2 generates **25 prompts, 5 per buyer-journey category** (Discovery, Evaluation, Comparison, Decision, Authority/Industry), streamed in with an add-your-own option.
    5. **Preliminary report** — run **1 prompt per category (5 total)** across the 5 surfaces (sample=1, key `onboard:<wsId>`, `runs.trigger` `onboard`), show the initial **AI Visibility Report**, then drop the user into an already-populated dashboard while the remaining **20 prompts run in the background** into the final report. The full 25-prompt set joins the nightly cron.

    Inferred values are always editable prefills, cleaned through the manual sanitisers (`domainField`/`multiLineText`) and persisted only on commit; the soft profile (description, summary, target market) lands in a nullable `workspaces.profile` JSON column. **Providers:** parallel.ai Search (`PARALLEL_API_KEY`) for competitor discovery, Cloudflare Browser Rendering for site markdown, Workers AI `@cf/zai-org/glm-5.2` for describe/competitors/prompts — **BrightData is used only to run prompts.** **Abuse control:** signups are restricted to **business emails** (reject free-provider + disposable/temporary domains) on top of the per-IP register rate limit. Endpoints live under a workspace-scoped `onboarding` router (`extract`, `competitors`, `prompts`, `commit`); `needsSetup: true` (200) replaces the no-brand 500s on overview/prompts/sources. Per-signup provider cost ≈ 25 prompts × 5 surfaces × 1 sample ≈ **125 BrightData records** (25 preliminary + 100 background) — bounded by the business-email gate.

## Stack

| Concern | Choice |
|---|---|
| Runtime | One Cloudflare Worker (API + cron + queue consumer + static assets) |
| Language | TypeScript everywhere |
| Package manager / scripts | Bun (`bun install`, `bun run`, `bunx`) — tooling only; deployed runtime stays workerd |
| API framework | Hono |
| UI | React SPA (Vite) + Tailwind, custom components (no shadcn/ui), served via Workers Static Assets |
| Charts | dither-kit (`bunx @dither-kit/cli add <component>`; copies components into repo — needs only Tailwind, a minimal `components.json`, and a `cn()` helper, not the shadcn/ui library) |
| Database | D1 with Drizzle ORM |
| Raw payload storage | R2, gzipped via `CompressionStream('gzip')` before `put` (raw responses ~9 MB/run uncompressed; JSON compresses ~5–10×). Keys end `.json.gz`, object metadata `contentEncoding: gzip` |
| Scheduling | Cron Trigger (daily run) |
| Fan-out | Queues |
| LLM tasks (phase 2: sentiment, onboarding describe/competitors/prompts) | Cloudflare Workers AI, model `@cf/zai-org/glm-5.2` (function calling + JSON; `AI` binding, no secret) |
| Web search (phase 2: competitor discovery) | parallel.ai Search API (`PARALLEL_API_KEY`) |
| Site fetch (phase 2: onboarding) | `llms.txt`/`llms-full.txt` if present, else Cloudflare Browser Rendering markdown |
| Dashboard auth | Email + password login screen; JWT session in httpOnly cookie, verified by Hono middleware |

## Repo layout

```
wrangler.jsonc          # worker + D1 + R2 + Queues + cron + assets config
drizzle/                # migrations
src/
  api/
    index.ts            # Hono app, fetch/scheduled/queue handlers
    providers/
      brightdata.ts     # ChatGPT + Perplexity + Gemini + AI Mode (async dataset API)
      brightdata-serp.ts # Google AI Overviews (BrightData SERP API, sync)
      types.ts          # NormalizedAnswer { answerText, citationUrls, raw }
    scoring.ts          # ported from run.mjs (see below)
    db/schema.ts        # Drizzle schema
    routes/             # API route modules
  app/                  # React SPA
    components/         # custom Tailwind components + dither-kit charts (CLI-copied)
    lib/cn.ts           # class-merge helper (only shadcn convention dither-kit needs)
    pages/              # Overview, Prompts, Sources, Competitors, Runs, Settings
```

## Providers

### BrightData dataset scrapers — ChatGPT + Perplexity + Gemini + Google AI Mode

Async dataset ("scraper") API:

1. `POST /datasets/v3/trigger?dataset_id=...` with a **batch** of inputs (all prompts × samples for one surface in a single snapshot) → returns `snapshot_id`
2. Poll `GET /datasets/v3/progress/{snapshot_id}` until ready
3. `GET /datasets/v3/snapshot/{snapshot_id}?format=json` → structured records: answer text, citations (title + URL), model, timestamps

Same flow for all four surfaces — only the `dataset_id` differs (one per scraper).

### BrightData SERP API — Google AI Overviews

Sync request/response against the SERP API with `brd_ai_overview=2` (expands AI Overview retrieval); parsed JSON returns `aio_text` plus sources when Google serves an AIO for the query. AIO appears only on a subset of queries (~15–20%+, query-dependent) — an absent AIO is recorded as a valid "no AIO shown" result, not a failure.

### Future surfaces

BrightData also lists **Grok** and **Copilot** scrapers (same dataset API). Grok is currently marked *unavailable* in their docs — when it reactivates, adding it (or Copilot) is a config-only change: new `dataset_id` + surface enum value, no new client code.

Both providers normalize to `NormalizedAnswer { answerText, citationUrls, raw }`. Scoring consumes the normalized shape; the deep-walk extractor still runs over `raw` as a drift-tolerant fallback.

### Secrets

`BRIGHTDATA_API_TOKEN` (+ SERP zone name if the SERP API requires zone-scoped auth) via `wrangler secret put`. Phase 2 LLM tasks use the Cloudflare Workers AI `AI` binding (wrangler.jsonc config, no secret); onboarding also needs `PARALLEL_API_KEY` (parallel.ai Search) and the Cloudflare Browser Rendering binding.

## Ingestion flow

```
Cron (daily) → create run row → enqueue:
  brightdata_trigger  ×4  (chatgpt, perplexity, gemini, google_ai_mode)
      → trigger batch snapshot, store snapshot_id
      → enqueue brightdata_poll { snapshotId } with delaySeconds: 60
  brightdata_poll
      → check progress; not ready → re-enqueue self with delay
      → ready → fetch snapshot, per record: raw gzipped → R2, scores → D1
  serp_aio_fetch  ×36  (18 prompts × 2 samples, google_aio)
      → sync SERP API call, raw gzipped → R2, scores → D1
Run marked complete when all expected results are stored (or failed).
```

Manual trigger: `POST /api/runs` does the same as cron.

### Rate limits, retries & idempotency

**Rate limiting (respect provider limits)**
- Queue consumer configured with low `max_concurrency` (2–3) and small `max_batch_size` so SERP API calls never burst BrightData's request limits; the dataset side is 1 trigger call per surface plus polling, inherently low-rate.
- On HTTP 429 (or 5xx) from either provider: honor the `Retry-After` header when present, otherwise exponential backoff with jitter via `msg.retry({ delaySeconds })`. Never drop — `max_retries` ~8 with a dead-letter queue for messages that exhaust retries; DLQ entries mark the result row failed so the run can still complete.

**Idempotency (each unit of work executes exactly once)**
- Runs: cron creates runs with a deterministic key (`cron:YYYY-MM-DD`, unique index) — a re-fired or overlapping cron invocation upserts into a no-op instead of creating a duplicate run.
- Results: deterministic identity `runId:promptId:surface:sample` (unique index on `results`). Consumer checks for an existing `ok` row before calling the provider — a redelivered message acks without spending a paid BrightData record/request.
- BrightData triggers: unique `(runId, provider, surface)` on `snapshots` — if a trigger message is redelivered after the snapshot was created, we skip re-triggering and proceed straight to polling the stored `snapshot_id`.
- R2 writes: deterministic keys (`raw/{runId}/{promptId}-{surface}-{sample}.json.gz`) — rewrites on retry overwrite the same object, never duplicate.
- D1 score writes: upserts keyed on the deterministic identities above, so a message retried after a partial failure (e.g. R2 write succeeded, D1 write died) converges instead of double-counting.

## D1 schema (Drizzle)

- `users` — id, email, passwordHash, salt, tokenVersion, createdAt
- `entities` — id, name, domains (JSON), isBrand
- `prompts` — id, text, tags (JSON), active
- `runs` — id, date, status, okCount, totalCount
- `snapshots` — id, runId, provider, surface, externalId, status
- `results` — id, runId, promptId, surface, sample, provider, ok, r2Key, totalUrls, error
- `entity_scores` — id, resultId, entityId, mentioned, cited, position, sentiment (nullable until phase 2)
- `citations` — id, resultId, url, domain, isOurs

Seed script imports current `prompts.json` (18 prompts, brand + 6 competitors). Back-import `out/2026-07-14.jsonl` as run #1 so trends start with existing data.

## Scoring lib (`src/api/scoring.ts`)

Port from `run.mjs`:

- `collectStringsAndUrls` — deep-walk extractor (keep; degrades to "missed nothing" on provider schema drift)
- `mentionsBrand` — word-boundary regex match
- `citesDomain` — hostname suffix match against entity domains

Add:

- `position` — order of first mention among tracked entities in `answerText` (1 = mentioned first)
- Derived metrics computed at query time: visibility % (share of responses mentioning entity), Share of Voice (entity mentions ÷ all tracked-brand mentions), average position, citation frequency

## API (Hono, under `/api`)

- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` — the only unauthenticated route is login
- `GET /overview?range=1d|3d|7d|30d|90d|all` — trend series across runs in range: visibility %, SoV, avg position, citation counts; per-surface breakdown; deltas vs previous equivalent period for stat tiles
- `GET /prompts` + CRUD — per-prompt mention/cite status per surface, history
- `GET /sources` — cited domains ranked, our cited URLs, source gap (domains cited on prompts where mrmr is absent)
- `GET /competitors` — SoV comparison, per-entity trends
- `GET /runs`, `GET /runs/:id`, `POST /runs` (manual trigger); `GET /runs/:id/results/:resultId/raw` streams R2 payload with `Content-Encoding: gzip` (browser decompresses; no CPU spent in the worker)
- `GET /entities` + CRUD

## Dashboard (sidebar + main view)

Visual language defined in `DESIGN.md` (monochrome chrome, hue reserved for chart series + status, Departure Mono numerals, dither-kit texture).

Unauthenticated users land on a standalone **Login** screen (email + password); everything below requires a session.

Sidebar: **Overview · Prompts · Sources · Competitors · Runs · Settings**

- **Overview** — AI visibility home page with a time-range selector (1d / 3d / 7d / 30d / 90d / all). Stat tiles (visibility %, SoV, avg position, cited count) show the current value plus delta vs the previous equivalent period; dither-kit area charts plot the historical series across all runs in the selected range, with per-surface breakdown bars
- **Prompts** — table with per-surface mention/cite badges, sparklines per prompt, add/edit/disable prompts
- **Sources** — citation domains ranked by frequency, our cited URLs list, source-gap list
- **Competitors** — SoV bar chart + radar (per-surface), trend lines per competitor
- **Runs** — run history with status/counts, drill into per-result raw payloads
- **Settings** — entities (brand/competitors + domains), samples, geo, schedule

## Security

**Authentication & sessions**
- Own login screen: email + password against a `users` table in D1. No public signup — user(s) seeded via a CLI script.
- Password hashing: PBKDF2-SHA256 via WebCrypto (`crypto.subtle`, native in workerd) with per-user random salt and OWASP-recommended iteration count; constant-time hash comparison. (bcrypt/argon2 wasm ports burn worker CPU; PBKDF2 is the platform-native choice.)
- On login success: signed JWT (HS256, `JWT_SECRET` in `wrangler secret`) with `sub`, `exp`, and a `tokenVersion` claim, delivered as an **httpOnly, Secure, SameSite=Strict cookie** — never localStorage, so XSS can't exfiltrate it.
- Session duration: **24h** token expiry, sliding renewal (re-issued when a valid token is older than half its lifetime). Logout clears the cookie; bumping the user's `tokenVersion` revokes all outstanding sessions.
- Hono auth middleware verifies the JWT on every `/api/*` request (except `/api/auth/login`). SPA shell is public; all data lives behind the API.
- Login brute-force protection: rate limit per IP and per email (e.g. 5 failures / 15 min, then backoff); generic "invalid credentials" error either way.
- CSRF: SameSite=Strict cookie + JSON `Content-Type` requirement on state-changing endpoints.
- Disable the `*.workers.dev` route so refd.ai is the only path to the worker.

**Application hardening**
- All API input validated with zod (prompt/entity CRUD, range params); Drizzle parameterized queries throughout — no string-built SQL.
- Scraped AI answers are **untrusted content**: render as plain text/JSON only, never `dangerouslySetInnerHTML`; raw-payload viewer serves JSON with `Content-Type: application/json` + `X-Content-Type-Options: nosniff`.
- Security headers on all HTML responses: strict CSP (self-only script/style, no inline script), `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, HSTS.
- CORS: same-origin only — no CORS headers emitted at all.
- `POST /api/runs` (spends provider quota) rate-limited per user (e.g. 5/hour) and confirmed in the UI.
- Outbound fetches only to fixed provider hosts (BrightData, SerpApi) — never to user-supplied URLs.

**Secrets & data**
- Provider keys only in `wrangler secret` (never repo/code); `.env` stays gitignored; rotate keys on any suspicion.
- R2 bucket private — no public bucket access; raw payloads reachable only via the authenticated worker route.
- Logs (Workers Logs / `wrangler tail`): never log secrets, auth headers, or full JWTs.
- Dependencies: Bun lockfile committed, `bun audit` in CI habit, keep dep count minimal.

## Build order

1. **Scaffold** — Vite + React + Hono worker (single `wrangler.jsonc`: assets, D1, R2, Queues, cron), Drizzle schema + migrations, Tailwind + minimal `components.json` + `cn()` shim + dither-kit charts via CLI, seed from `prompts.json`
2. **Ingestion** — scoring lib port, provider clients, queue consumer, cron + manual trigger, back-import of existing JSONL
3. **API + dashboard** — routes above, six pages, dither-kit charts
4. **Phase 2** — sentiment via Workers AI, alert deltas on Overview, source-gap refinements, AI-powered onboarding (resumable wizard: brand → describe via Browser Rendering + glm-5.2 → competitors via parallel.ai search → 25 prompts across 5 buyer-journey categories → preliminary report on 5 prompts → background run of the remaining 20; business-email-only signup; see Core features #13)

`run.mjs` / `prompts.json` stay until parity is verified, then delete.

## Verification

- `bun run dev` (wraps `wrangler dev`) locally: trigger `POST /api/runs` with 1–2 prompts, confirm rows in D1 and objects in R2
- `--dry`-equivalent: provider clients expose payload-preview mode used by a `?dry=1` flag on manual trigger
- Dashboard renders trends from back-imported run #1 + one live run
- Deploy to refd.ai, confirm cron fires (wrangler tail); confirm unauthenticated `/api/*` requests get 401 and the login flow issues/renews/clears the session cookie correctly

## Cost

- BrightData dataset scrapers: ~144 records/day (4 surfaces × 18 prompts × 2 samples) ≈ 4.3K/mo — fits advertised 5K/mo free tier (tight; headroom gone if prompts/samples grow — then paid records)
- BrightData SERP API (AIO): ~36 requests/day ≈ 1.1K/mo — fits its separate 5K/mo free tier
- Cloudflare: existing Workers plan covers Queues; D1/R2 usage negligible at this volume
- Net provider cost at current volume: ~$0
