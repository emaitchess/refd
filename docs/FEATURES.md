# FEATURES.md

Internal reference. Full inventory of what refd does today, plus what's on the
roadmap. Status is marked per section:

- **Shipped** — in the codebase and working.
- **Phase 2** — specified (see `plan.md`) but not yet built.

For the tech behind these, see `CLAUDE.md` (architecture) and `DESIGN.md` (UI).

---

## What refd is

Open-source AI search monitoring. Each **workspace** tracks one brand's
visibility, mentions, citations, and rank across AI answer surfaces. BrightData
is the only data provider. Available hosted (refd.ai) or fully self-hosted.

---

## Data collection — Shipped

**AI answer surfaces (5).** Every run checks each active prompt across all of:

| Surface | Provider path |
|---|---|
| ChatGPT | BrightData dataset scraper |
| Perplexity | BrightData dataset scraper |
| Gemini | BrightData dataset scraper |
| Google AI Mode | BrightData dataset scraper |
| Google AI Overview (AIO) | BrightData SERP API (`brd_ai_overview`) |

- **Repeat samples** — `SAMPLES` (default 2) runs per prompt/surface to smooth
  out non-determinism; trends are read across samples/runs, never single answers.
- **Absent AIO is a valid result** — Google serves an AI Overview on only
  ~15–20% of queries; "no AIO shown" is recorded (`answerPresent=false`), not a
  failure.
- **Frozen prompt set per run** — each run carries the prompt set it started
  with, so mid-run prompt edits can't skew results.

**Scheduling & triggers.**
- **Daily cron** (06:00 UTC) runs every workspace with active prompts.
- **Manual runs** on demand from the UI — spends paid quota (~180 records), so
  the UI confirms and the endpoint is rate-limited (5/hour per workspace).
- **Legacy back-import** — historical Oxylabs data can be imported as a run so
  trends start with existing data (`import` trigger).

**Future surfaces** — Grok and Copilot are config-only additions (new
`dataset_id` + surface enum), no new client code.

---

## Metrics (v2) — Shipped

Ground-up redesign of the core metric algorithms, replacing the v1 pipeline
(single-name matching, ASCII-only boundaries, mention detection over the full
deep-walked payload). Landed in layers: schema + shared matcher + entity
snapshot + scoring core → aggregation endpoints → onboarding/Settings alias
capture → per-run and queue-driven backfill rescore. All four metric families
below are live; the backfill's one-time pass over hosted production history
runs with the v2 deploy.

### Principles (apply to all four metrics)

- **Entity-generic.** Brand and competitors are scored by identical rules; one
  joint scan per answer covers every tracked entity. Overlap resolution is
  longest-match-wins: a shorter alias contained in a longer match of a
  *different* entity ("Google" inside "Google Analytics") is dropped at that
  position.
- **Deterministic runtime.** No LLM in the scoring path — same input, same
  score, always. Ambiguity is resolved at *setup time* via LLM-assisted alias
  curation with mandatory human confirmation.
- **Versioned and rescorable.** Every score carries a `scoringVersion`; a
  rescore replays raw R2 payloads through the current parser + scorer so
  algorithm improvements apply to history and trends stay comparable.
  `POST /runs/:id/rescore` replays one run inline; `POST /runs/rescore`
  starts a queue-driven workspace backfill that drains every result whose
  scores predate `SCORING_VERSION` in cursor-chained batches (no provider
  spend, idempotent, resumable). Both are operator levers, not user features —
  the backfill is surfaced only in a dev-build Settings card until it grows an
  admin surface. Runs without R2 raws (the legacy `import:2026-07-14`
  back-import) keep their old scores.
- **Frozen entity snapshot per run.** Entity list + aliases are snapshotted at
  run creation (mirrors the frozen prompt set), so mid-run entity edits can't
  skew results within a run — and SoV denominators are honest.

### Mention detection

- **Alias sets replace single names.** `entities` carries an `aliases` JSON
  column: `{value, caseSensitive}[]`. The name is just the first alias; each
  apex domain doubles as an alias (a visible "ahrefs.com" in prose is a
  mention); dictionary-word aliases ("Notion", "Loop") are flagged
  `caseSensitive` and must match brand casing.
- **Match against the canonical visible answer text only** — what a user would
  read on that surface, assembled by the per-surface normalizer. Excluded:
  source titles/cards, related searches, UI strings, and markdown link
  *targets* (anchor text is kept; hrefs go to the citation pipeline). The
  deep-walk extractor is demoted to URL harvesting only.
- **Matcher rules.** Unicode NFKC + diacritic folding; Unicode letter/number
  boundaries; token-separator equivalence across `- . _ /` and whitespace
  ("Coca-Cola" ≡ "Coca Cola"); trailing possessives (`'s`) allowed. No
  stemming, no fuzzy matching, no plural inference — every miss must be
  fixable by adding an alias.
- **Negative context still counts.** "Unlike Ahrefs…" is a mention; sentiment
  is a separate future axis.
- **Persisted atoms.** Per (answer, entity): `mentioned`, `mentionCount`,
  `firstOffset`, `spans` (JSON). Spans feed position/prominence and client
  highlighting.
- **One matcher implementation, shared.** The matcher lives in a shared pure
  module (`src/shared/mentions.ts`) imported by both the Worker and the SPA —
  the client-side highlighter is a thin adapter over it, so there is no
  separate rule to keep in lockstep.

### Mention rate

- **Denominator: `ok = true` AND `answerPresent = true`.** Failed fetches are
  our problem, not signal; a missing AI Overview has no answer to be mentioned
  in. **AIO coverage** ("AIO appeared on N% of prompts") is reported as its own
  stat instead.
- Per prompt per surface: mentioned samples ÷ ok samples. Per surface per run:
  mean over prompts with ≥1 ok sample. Overall per run: mean over all
  (prompt × surface) cells, equal weight per cell.
- Runs are never blended; trends plot per-run values.

### Citation detection

- **Three source tiers, by trust.** (1) Provider-labeled source structures
  (`citations` / `search_sources` / `links_attached`, the AIO reference list);
  (2) inline links in the answer markdown (anchor stays with the mention
  pipeline, the href lands here); (3) deep-walk harvest as **fallback only** —
  walked URLs count only when tiers 1+2 find zero (schema-drift safety net,
  and a loud fix-the-normalizer signal). Every citation records its `origin`
  (`source_list` | `inline` | `walk`). Asset URLs (favicons, thumbnails,
  image extensions) are filtered in all tiers.
- **URL normalization before matching/dedup.** Lowercase host, strip default
  ports and fragments (AIO's `#:~:text=` anchors), strip tracking params only
  (`utm_*`, `gclid`, `fbclid`), unwrap decodable redirectors
  (`google.com/url?q=`). Opaque redirectors (Gemini's
  `vertexaisearch…/grounding-api-redirect/<token>`) resolve from payload
  metadata or are stored **unattributable** — counted in totals, never
  credited to a domain or entity (and never to google.com). IDN hosts →
  punycode. Dedup key = normalized URL per result.
- **Ownership matching.** An entity domain entry is an apex (`ahrefs.com`) or
  a specific host (`mybrand.substack.com`); match = exact host or
  `.`-boundary suffix, which covers all subdomains without `notahrefs.com`
  false positives. Registrable-domain grouping (ranked domains, source gap)
  uses the Public Suffix List via `tldts` — never naive TLD splitting.
  Path-level properties (`github.com/brand`) are out of v1.
- **Per-entity attribution.** `citations.entityId` (nullable; null =
  unaffiliated third party) replaces the brand-only `isOurs`; longest matching
  domain entry wins ties; matching set = the run's frozen entity snapshot.
  `entity_scores` carries `citedCount` (distinct owned URLs per answer).
- **Citation rate math mirrors mention rate exactly** (same denominator
  `ok && answerPresent`, same per-cell weighting) so the two are directly
  comparable. **Sourceless answers stay in the denominator** (zero sources =
  zero source visibility, and ChatGPT answers without browsing often);
  **source coverage** per surface ("N% of answers carried sources") is
  reported alongside, the citation analog of AIO coverage.

### Share of Voice

- **Presence-based, never occurrence-weighted.** SOV consumes the binary
  `mentioned` flag; `mentionCount` is a diagnostic atom only (one listicle
  repeating a name in every row must not swing a run).
- **Pooled-ratio formula.** Over results in scope with `ok && answerPresent`:
  `SOV(e) = voice(e) ÷ Σ voice(i)` across the tracked set, where `voice(e)` =
  count of results mentioning `e`. Sums to exactly 100% across entities; an
  answer mentioning three entities contributes 3 to the pool, 1 to each.
  Undefined when the pool is 0 → render "—", never 0%.
- **Pooled, not mean-of-cells — deliberately unlike mention rate.** Rates
  average over cells; shares must sum numerators ÷ sum denominators (per-cell
  SOVs are constantly undefined or quantized, and averaging ratios with
  varying denominators is Simpson's-paradox territory). Per-surface SOV pools
  within the surface; overall pools across everything; samples are just
  observations in the pool.
- **Two SOVs, one headline.** Mention SOV is the stat tile; citation SOV is
  the identical formula on `cited`, denominator still tracked-entities only
  (third-party citations answer "how much of AI sourcing is me" — that lives
  on the Sources page, not in SOV).
- **Honesty guards.** The denominator is the *tracked set*, not the market:
  adding/removing a competitor moves everyone's SOV mechanically. Each run
  stores an **entity-set hash**; SOV trend charts draw a break marker where
  the hash changed. SOV is suppressed ("—" + add-competitors hint) until the
  workspace tracks ≥1 competitor (brand-only SOV is a meaningless 100%). No
  composite "visibility score" blending position into SOV — metrics stay pure
  and legible.

### Position / prominence

- **Rank (first-mention order).** Per answer: mentioned tracked entities
  ordered by `firstOffset`; 1 = first named, null = not mentioned. Ties are
  impossible (overlap resolution guarantees distinct span starts); markdown
  source order stands in for reading order. Rank is **relative to the tracked
  set** (the matcher can't see untracked brands) — entity-set-hash break
  markers apply to position trends too.
- **Average position is conditional on mention** (pooled mean over answers
  where the entity appears; no absence penalty — absence is mention rate's
  job). The UI must pair the position tile with mention rate.
- **First-mention share.** Rank-1 events ÷ answers where ≥1 tracked entity is
  mentioned; same pool as SOV, sums to 100% across entities ("when a winner
  exists, how often is it you").
- **Prominence tiers: `lead` / `body` / `list`.** First text block vs other
  prose vs list-item/table-row, mapped by parsing the canonical markdown into
  blocks (`remark-parse` in the shared module; mdast offsets → span-to-block
  lookup, and server/client agree by construction). Per (answer, entity):
  best tier among spans. Aggregated as a **distribution** ("28% lead / 45%
  body / 27% list-only", lead% trendable) — no weighted prominence composite.
- **Citation source-list rank stored, not surfaced.** `citations.rank` =
  order within the provider source list (tier-1 origin only, null otherwise).
  Free at scoring time, expensive to reconstruct later; no UI metric in v1.

### Sentiment

- **Enrichment, not scoring.** Classification runs outside the deterministic
  scoring path: after a result is scored, a `sentiment_score` queue message
  classifies it and fills `entity_scores.sentiment` (positive / neutral /
  negative; null = unclassified, rendered "—"). A classification failure
  retries and can only ever leave null — it never fails or delays a run.
- **One model call per answer.** Workers AI glm-5.2 judges every mentioned
  tracked entity (brand and competitors alike) in a single call. Entities are
  referenced by number so the model can never introduce one; a malformed
  entry leaves that entity unclassified, never guessed. Negative framings
  ("unlike X", "X lacks") classify negative — the mention itself still
  counts, mention detection stays valence-blind.
- **New answers only.** History is not backfilled; pre-sentiment rows stay
  null and drop out of every denominator. A rescore carries existing labels
  over (same raw, same portrayal); the per-run rescore additionally re-drives
  classification for mentioned rows still unclassified (the recovery lever
  when a model call flaked), while the queue backfill never classifies.
- **Aggregated as a distribution** over *classified* mentions
  (`sentimentDist`), mirroring prominence — no composite score. Surfaced as
  the brand sentiment chart on Overview, a positive/neutral/negative split
  column on Competitors, and a per-entity badge in the result pane.

### Change alerts

- **Derived on read, never stored.** `detectChanges`
  (`src/api/routes/changes.ts`) compares the two most recent *completed* runs
  using the same pure metric functions as the dashboard; `GET /changes`
  serves the report. Nothing persists, so a rescore corrects what the card
  says the next time anyone looks.
- **Three honesty guards.** (1) Only the shared (prompt × surface) cells of
  the two runs are compared — a subset run (onboard, manual) can never
  fabricate a change from cells it didn't run. (2) Set-relative metrics
  (SOV, position, competitor movement) are suppressed when `entitySetHash`
  differs between the runs, or is null on either side. (3) Material
  thresholds gate every event: 15pp for mention/citation rates, 10pp for
  SOV, 20pp for sentiment shares, one full rank for position — plus ≥4
  shared cells for any comparison and ≥3 positioned/classified mentions on
  both sides for position/sentiment. Sampled answers wobble; sub-threshold
  moves are noise, not news.
- **Event set:** brand mention/citation rate moves (overall, or per surface
  only when the overall delta stayed quiet — no per-surface echoes of an
  overall event), SOV swings, position slips, sentiment shifts (one event
  per shift, on the larger-moving share), competitor appearances (rises
  only — fades are dashboard material, not alerts). Sorted by severity,
  capped at 6.
- **Two render surfaces, one engine.** The Overview "What changed" card
  (previous → current values, colored delta, a "no material changes" line
  when quiet, a paused-comparisons note on set changes) and the Home idle
  chips (top two events phrased as agent questions). Every event carries its
  question; the card's "ask" button opens Home with it prefilled
  (`/home?ask=`) so the agent picks up the investigation.
- Thresholds are restated in the Help glossary ("Material change") and
  pinned to the engine constants by `changes.test.ts`.

### Onboarding & Settings alias capture

- Competitor drafts are `{name, domains[], aliases[]}`; the brand gets the
  same treatment (the extract step's site markdown is an alias source). Draft
  schema stays lenient so in-flight old-shape drafts upgrade on read.
- The search + LLM draft call has a richer contract (same call, same
  regen cap): official name, **owned-and-operated apex domains only** (never
  "domains about them" — a Wikipedia page is not their domain), conservative
  aliases (a missed alias is a visible undercount; a bad alias is silent
  inflation — bias to precision), dictionary-word flagging.
- Every suggestion is human-confirmed: alias/domain editors in the wizard
  competitors step and in Settings/dashboard entity management.

---

## Dashboard — Shipped

Sidebar app: **Home · Overview · Prompts · Sources · Competitors · Runs ·
Help · Settings · Account**.

- **Home** — talk to the data. The post-login landing page: a greeting, a
  question box, suggestion chips computed from the workspace's actual state
  (not canned; material change events lead, quantified and phrased as
  questions), and persisted conversations. Answers are grounded: the server
  builds a keyed digest of the last 30 days with the same pure metric
  functions as the dashboard, and glm-5.2 answers only from it, returning
  short prose plus up to two **data panels** (digest sections the client
  renders as real components, frozen per message so old conversations keep
  the numbers they showed) and up to two **deep links** into the dashboard
  (whitelisted internal paths only). When the data cannot answer, the
  assistant says so rather than inventing. 30 messages/hour per workspace.
  The assistant is **agentic**: a capped tool loop (10 calls) can search the
  web (Exa, retrieval-only, numbered sources cited in the answer), drill
  into a tracked prompt's per-surface results, read stored answer texts, and
  re-pull the snapshot at another time window — every call appears in the
  live work trace. Write actions are **proposals only**: the agent drafts
  prompts or a competitor from its research, and a confirmation card applies
  them through the same validated endpoints as the dashboard (per-item
  selection, once-only resolution). Nothing mutates without a human click,
  which also keeps web prompt-injection away from every write path.
- **Overview** — AI-visibility home. Time-range selector; stat tiles (value +
  delta vs previous period); trend charts across all runs in range; per-surface
  breakdown.
- **Prompts** — table with per-surface mention/cite badges and history; add /
  edit / enable-disable prompts (tags, active flag); prompt-run detail opens in
  a shared side pane.
- **Sources** — cited domains ranked by frequency, the brand's cited URLs, and
  the source-gap list.
- **Competitors** — SoV comparison, per-entity trend lines, sentiment split,
  and the entity alias/domain editor (add/remove aliases with case-sensitive
  flags).
- **Runs** — run history with status/counts; drill into any result and open the
  **raw answer payload** behind every score (receipts).
- **Help** — an extensible documentation section whose first page is a
  searchable glossary covering core product terms, prompt categories, metrics,
  and signals. Metric info tooltips link directly to the matching definition
  and calculation notes.
- **Settings** — workspace management (list / create / rename / switch) and
  tracked AI-surface selection. **Account** — profile and password change.

**Prompt & entity management.** CRUD for prompts and tracked entities (brand +
competitor domains) from the dashboard UI. The onboarding wizard seeds both; the
30-prompt cap applies only there, not to the dashboard.

---

## Multi-workspace tenancy — Shipped

- A **workspace** tracks one brand; users own up to five. The create endpoint
  enforces the limit atomically, and every client creation surface disables at
  the cap.
- `entities`, `prompts`, `runs` carry `workspace_id`; everything deeper inherits
  scope. Data routes live under `/api/w/:workspaceId/*` behind `requireWorkspace`
  (owner-only; foreign workspaces 404).
- **Sidebar workspace switcher** sets the client URL prefix and remounts the
  dashboard on switch.
- Cron loops every workspace independently (`cron:<wsId>:<date>` keys); a failing
  workspace never blocks the others.
- First workspace is auto-created on registration.

---

## Accounts & auth — Shipped

- **Self-registration** — email + password (≥ 8 chars), per-IP rate-limited;
  first workspace auto-created.
- **Self-built auth** — PBKDF2-SHA256 (WebCrypto), HS256 JWT in an httpOnly
  SameSite=Strict cookie, 24h sliding renewal, `tokenVersion` revocation.
- **Login brute-force protection** — per-IP and per-email attempt tracking in D1.
- **Password change** on the Account page — revokes all other sessions.
- Only `/api/auth/login`, `/api/auth/register`, and `/api/health` are
  unauthenticated.

---

## Storage & auditability — Shipped

- **Raw snapshots** — every provider response archived to R2, always gzipped,
  deterministic keys; served back with `Content-Encoding: gzip`. Every score is
  traceable to the exact answer that produced it.
- **Idempotency backbone** — unique keys on results, snapshots, and runs;
  redelivered queue messages check-then-skip so a paid provider record is never
  re-spent. Snapshots are per (surface, sample) so identical prompts in one batch
  can't collapse and silently break sampling.
- **Provider-agnostic scoring** — normalizes over `NormalizedAnswer`; a deep-walk
  extractor degrades to "missed nothing" when provider schemas drift.

---

## Reliability — Shipped

- Queue-based fan-out with low concurrency to respect provider rate limits.
- Retries with backoff/jitter on 429/5xx; dead-letter handling marks results
  failed so a run can still complete.
- A run is marked complete once all expected results are stored or failed.

---

## Input handling & security — Shipped

- All user input sanitised (`src/api/lib/sanitize.ts`) — strips control /
  format / bidi / zero-width chars, NFC-normalises, validates emails and domains.
- Zod validation on all write endpoints; Drizzle parameterized queries.
- **Scraped AI content is untrusted** — rendered as escaped text or via
  react-markdown with no raw-HTML passthrough; never `dangerouslySetInnerHTML`.
- Outbound fetches only to fixed provider hosts.

---

## UX & design — Shipped

- **Design system** (see `DESIGN.md`) — monochrome chrome, hue reserved for data;
  dither-kit charts only (no shadcn/ui); Departure Mono numerals.
- **Entity series colors** — fixed CVD-validated order (green=brand, purple, red,
  blue, orange, pink, then grey); never cycled or reordered per view.
- **Light / dark theme** — defaults to system, toggle persists the choice; `t`
  toggles, pre-paint init avoids flash. Live on the landing page too.
- **Keyboard-first** — `g`-chords navigate (`g o/p/u/c/r/s`), `a` adds a prompt,
  `⌘ /` toggles sidebar, `t` toggles theme, `⇧ ?` opens the shortcuts dialog,
  `esc` closes. All via universal `useOnKeyPress` / `useChordKeyPress` hooks.
- **Landing page** — dithered shader background + static dithered "refd"
  wordmark banner; `c` create account, `s` sign in, `v` view source.
- Shared table utilities (sort + pagination) and a shared side-pane for detail
  views.

---

## Deployment — Shipped

- **One Cloudflare Worker does everything** — Hono API, cron trigger, queue
  consumer, and the React SPA (Workers Static Assets). One `wrangler.jsonc`, one
  deploy.
- **Hosted** at refd.ai, or **self-hosted** with your own Cloudflare + BrightData
  accounts. Nothing phones home.
- **Secrets** via `wrangler secret` (`JWT_SECRET`, `BRIGHTDATA_API_TOKEN`).

---

## AI-powered onboarding — Shipped

A resumable 5-step wizard. A workspace is not usable until it finishes:
`workspaces.onboardingCompleted` gates the dashboard via `RequireOnboarded`, and
the step + editable drafts live in the nullable `workspaces.profile` JSON, served
and mutated by the workspace-scoped `/onboarding` router. Every AI step
soft-fails to manual entry — the wizard never dead-ends on a flaky site or model.

1. **Set up brand** — name + domains → creates the brand entity.
2. **Describe** — fetches the site (`llms.txt` / `llms-full.txt` raced in
   parallel, else Cloudflare Browser Rendering markdown) → glm-5.2 drafts an
   editable public description + an internal summary; favicon as logo.
3. **Competitors** — Exa company search (semantic query + homepage
   findSimilar) returns real indexed candidates; glm-5.2 selects direct
   competitors by candidate number, so every suggested domain is backed by an
   actual result URL (never model-generated — Sonar fabricated domains here),
   with conservative aliases (dictionary-word aliases flagged case-sensitive);
   user adds (multi-domain + aliases), removes, or drags to reorder (order
   sets chart colors). Hard cap of 10.
4. **Prompts** — glm-5.2 generates 25 prompts, 5 per buyer-journey category
   (Discovery, Evaluation, Comparison, Decision, Authority). Capped at 30 total
   so there's room to hand-add a few; the AI-engine selector lives on this step.
5. **Review & report** — `commit` materialises the drafts and fires two runs: a
   preliminary `onboard:<wsId>` (1 prompt/category, sample=1) that the live
   report polls, plus `onboard-bg:<wsId>` for the rest. The report also previews
   the brand homepage metadata fetched through Browser Rendering and cached in
   the workspace profile. The full set then joins the nightly cron.

- **The report is the last step, not a victory lap.** `commit` does *not*
  complete onboarding; `POST /onboarding/complete` does, fired by "enter
  dashboard". `profile.committed` marks the in-between, so abandoning the report
  resumes there instead of dropping back to Review and committing a second time.
- **Regenerate is capped at one per AI step.** The count lives in
  `profile.regen` server-side (a reload must not hand out a fresh model call);
  only a *successful* draft counts, and over the cap the endpoint 429s while the
  UI toasts.
- **Providers**: Exa (retrieval-only company search), Cloudflare Browser
  Rendering, Workers AI `@cf/zai-org/glm-5.2` — BrightData is used only to run
  prompts.
- **Abuse control**: signups restricted to business emails (free-provider +
  disposable domains rejected) on top of the per-IP register rate limit.

---

## Roadmap

Every Phase 2 feature from `plan.md` has shipped (metrics v2, sentiment,
change alerts, the Home agent).

### Next — proactive notifications (committed, not yet built)

Flip the platform from pull to push: the user gets told when something
material happened instead of coming to look. Design agreed; build order
webhook → email → headless briefing.

- **Trigger.** A run completing is the only moment something new is
  knowable. When the queue consumer flips a cron run to `complete`, build
  the change report (`buildChangeReport`); material events → notify, no
  events → silence. Noise discipline is inherited from the change-alert
  thresholds — no scheduled pings, no empty digests.
- **Channel 1: Slack / generic webhook.** Per-workspace webhook URL in
  Settings; POST event headlines + links after a material run. Also the
  self-hoster integration point (wire it to anything).
- **Channel 2: alert email.** Provider (likely Resend) + secret + DKIM on
  refd.ai; optional for self-hosters, webhook stays the fallback. One
  template: event rows with previous → current values, each carrying its
  "ask" deep link into Home. Material-change cron runs only, max one per
  day. A separate opt-in weekly summary covers the "nothing changed but I
  want a pulse" case.
- **Channel 3: in-app unread.** A dot on the sidebar Home icon while unseen
  notification rows exist. Free polish once notifications are rows.
- **Agent briefing (the differentiator).** Don't send the alert, send the
  investigation: on fired events, run the Home agent headless with the
  event's own question, store the result as a ready conversation, and
  deliver the conclusion plus a thread link ("citation rate fell 20 pts
  because Perplexity dropped the docs page on 3 prompts"). Same tool caps
  and grounding as interactive chat; writes remain proposals, so a briefing
  can end with a one-click "add these prompts?" card. Costs Workers AI
  neurons only — no provider spend.
- **Shared plumbing.** A `notifications` table keyed (runId, channel) with
  check-then-skip idempotency (the platform pattern), per-workspace channel
  preferences in Settings, and a `notify` queue message kind fired on run
  completion.

### Backlog (not spec)

- **Grok / Copilot surfaces** — config-only additions (new `dataset_id` +
  surface enum); no new client code.
- **`read_page` agent tool** — full-page retrieval via Exa `/contents` for
  when search snippets prove too thin in real usage.
