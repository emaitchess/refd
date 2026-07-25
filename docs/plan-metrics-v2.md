# Metrics v2 — implementation plan

Executes the decided design in `FEATURES.md` → "Metrics v2 — Decided". Layers
land in order; each ends green (`bun run check` · `bun run lint` · `bun test`)
with the app working. Nothing old is removed until the last layer.

## Layer 0 — groundwork

- Add deps: `tldts` (PSL registrable-domain extraction), `remark-parse` +
  `unified` (markdown block mapping). Verify both run under workerd (pure JS,
  no Node APIs).
- Create `src/shared/` — pure modules importable by both Worker and SPA:
  - `mentions.ts` — the alias matcher (compile + joint scan + overlap
    resolution + spans).
  - `blocks.ts` — mdast block pass: span offset → `lead` / `body` / `list`.
- `SCORING_VERSION = 2` constant.

## Layer 1 — schema (one migration set, no drip-feed)

- `entities` + `aliases` (JSON `{value, caseSensitive}[]`).
- `runs` + `entitySnapshot` (JSON: frozen entities with aliases/domains) and
  `entitySetHash`.
- `entity_scores` + `mentionCount`, `firstOffset`, `spans` (JSON),
  `citedCount`, `prominence` (`lead`|`body`|`list`), `scoringVersion`.
- `citations` + `host`, `registrableDomain`, `entityId` (nullable FK),
  `origin` (`source_list`|`inline`|`walk`), `rank`; unique
  `(resultId, url)`. `isOurs` stays until the removal layer (old UI reads it).
- `bun run db:generate` + migrate local; smoke-test onboarding after
  `db:reset`.

## Layer 2 — scoring core (all atoms in one pass)

- Implement the shared matcher per spec: NFKC + diacritic fold, Unicode
  letter/number boundaries, `- . _ /`/whitespace separator equivalence,
  trailing possessives, case-sensitive lane for flagged aliases, joint scan,
  longest-match-wins. Unit-test the edge list (dictionary-word casing,
  contained aliases, possessives, diacritics, separator variants).
- Normalizer audit (the main implementation risk):
  - Canonical `answerText` = visible answer only, all five surfaces. AIO:
    parse text blocks vs reference list (lenient Zod), stop joining source
    titles into the text.
  - Tiered citation extraction: source structures → inline hrefs →
    deep-walk only when tiers 1+2 are empty. Asset-URL filter. Redirector
    unwrap (`google.com/url?q=`); Gemini grounding links resolve from payload
    metadata or store unattributable. URL normalization + dedup.
- New `scoreResult`: consumes the run's frozen `entitySnapshot`, emits every
  atom (mention flags/counts/offsets/spans/prominence, cited/citedCount,
  citations rows with entityId/origin/rank), stamps `scoringVersion`.
- `createRun` writes `entitySnapshot` + `entitySetHash`.
- Client: `rehypeHighlightEntities` switches to the shared matcher; delete the
  duplicated rule. `highlight.test.ts` shrinks to asserting AST wiring, not
  rule parity.

## Layer 3 — aggregation endpoints + UI

- Rewrite overview/prompts/sources/competitors queries to the v2 formulas:
  - Mention rate + citation rate (denominator `ok && answerPresent`,
    mean over prompt×surface cells) with AIO coverage and source coverage
    alongside.
  - SOV (pooled ratio, mention + citation variants), suppressed until ≥1
    competitor.
  - Average position (conditional on mention, paired with mention rate),
    first-mention share, prominence distribution.
  - Trend payloads carry `entitySetHash` so charts can draw break markers.
- UI per DESIGN.md: updated stat tiles, break markers on SOV/position trends,
  prominence distribution, coverage stats, "—" for undefined (never 0%).

## Layer 4 — onboarding & Settings alias capture

- `WorkspaceProfile.competitors` → `{name, domains[], aliases[]}` (lenient
  schema; old-shape drafts upgrade on read). Brand gets aliases too (extract
  step's site markdown as a source).
- Richer draft contract on the competitor-discovery call (one web-grounded
  Perplexity Sonar request; same regen cap): owned-and-operated domains only,
  conservative aliases, dictionary-word flagging.
- Alias/domain chip editors in the wizard competitors step and in
  Settings/dashboard entity management; `commit` materializes into
  `entities.aliases`.
- **Full onboarding pass.** Walk every wizard step end-to-end against the v2
  input needs and update wherever capture falls short: does each step collect
  everything scoring depends on (brand aliases + all owned domains, competitor
  aliases + domains, dictionary-word flags, surface selection), is anything
  new worth asking the user, and do the drafts land in `entities` complete?
  Nothing in v2 should depend on an input onboarding never asked for.
- **Preliminary report shows the full v2 metric breadth.** The report step is
  the moment the user decides refd is worth entering, and a sparse or
  confusing report reads as "broken" and gets abandoned before "Enter
  dashboard". So: every single-run-meaningful v2 metric appears — mention
  rate, citation rate, mention + citation SOV, first-mention share, average
  position, prominence distribution, AIO/source coverage, per-engine and
  you-vs-competitors breakdowns (trend charts still need ≥2 runs and stay
  out). Sparse states must explain themselves instead of looking empty: the
  preliminary run is 1 prompt/category at sample 1, so e.g. a missing AIO
  renders as "AI Overviews appear on ~15–20% of queries — none for your
  prompts yet", not a bare "—", and the report says more results are filling
  in (background run + tonight's cron). Goal: absence reads as insight, the
  user presses "Enter dashboard", and lands on an Overview showing the same
  metrics, fuller.

## Layer 5 — backfill rescore (once)

- Rescore job: for every result with an `r2Key`, decompress the raw payload,
  re-normalize + re-score under v2, upsert `entity_scores`/`citations`, stamp
  `scoringVersion = 2`. Queue-driven and batched (D1/subrequest limits),
  idempotent and resumable; the legacy `import:2026-07-14` run has no raws and
  keeps its old scores.
- Validate before proceeding: spot-check a sample of rescored results against
  their raw answers (receipts view) — known mentions found, no
  source-title-only "mentions" surviving, citations attributed correctly.

## Layer 6 — remove the obsolete v1 pipeline

Only after Layer 5 validates. Everything below is dead weight once v2 serves
all reads:

- `src/api/scoring.ts` v1 logic: `mentionPattern` / `mentionsBrand` /
  `firstMentionIndex` single-name matching, mention detection over deep-walk
  texts, blanket URL union, `extractDomain`'s `www.`-strip-as-apex.
- `citations.isOurs` (column + writes + reads) — replaced by `entityId`.
- Old aggregation formulas left in any router after Layer 3.
- The old client-side highlight rule reimplementation and the mention-parity
  lockstep test (already superseded in Layer 2 — confirm nothing crept back).
- Any `FEATURES.md` / code comments still describing v1 behavior; drop the
  "Metrics v2 — Decided (not yet built)" status to "Shipped" and fold it into
  the normal metrics section.
