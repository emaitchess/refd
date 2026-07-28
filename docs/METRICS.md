# Metrics

Internal reference for refd's shipped scoring and aggregation contract.
User-facing definitions live in `src/app/lib/metric-copy.ts`; the implementation
and its tests remain authoritative.

The current metric system replaced the original single-name matching,
ASCII-only boundaries, and mention detection over the full deep-walked payload.
It landed in layers: schema, shared matcher, frozen entity snapshot, scoring
core, aggregation endpoints, alias capture, and historical rescoring.

## Principles

- **Entity-generic.** Brand and competitors are scored by identical rules; one
  joint scan per answer covers every tracked entity. Overlap resolution is
  longest-match-wins: a shorter alias contained in a longer match of a
  *different* entity ("Google" inside "Google Analytics") is dropped at that
  position.
- **Deterministic runtime.** No LLM runs in the scoring path. The same input
  always produces the same score. Ambiguity is resolved at setup time via
  LLM-assisted alias curation with mandatory human confirmation.
- **Versioned and rescorable.** Every score carries a `scoringVersion`; a
  rescore replays raw R2 payloads through the current parser and scorer so
  algorithm improvements apply to history and trends stay comparable.
  `POST /runs/:id/rescore` replays one run inline; `POST /runs/rescore`
  starts a queue-driven workspace backfill that drains every result whose
  scores predate `SCORING_VERSION` in cursor-chained batches (no provider
  spend, idempotent, resumable). Both are operator levers, not user features;
  their mutations require `ADMIN_EMAILS`, and the backfill is surfaced only in
  a dev-build Settings card until it grows an admin surface. Runs without R2
  raws keep their existing scores.
- **Frozen entity snapshot per run.** Entity list and aliases are snapshotted at
  run creation, mirroring the frozen prompt set, so mid-run entity edits cannot
  skew results within a run or silently change share-of-voice denominators.

## Mention detection

- **Alias sets replace single names.** `entities` carries an `aliases` JSON
  column: `{value, caseSensitive}[]`. The name is the first alias; each apex
  domain doubles as an alias, so a visible "ahrefs.com" in prose is a mention.
  Dictionary-word aliases such as "Notion" and "Loop" are flagged
  `caseSensitive` and must match brand casing.
- **Match against the canonical visible answer text only.** This is the text a
  user would read on that surface, assembled by the per-surface normalizer.
  Source titles and cards, related searches, UI strings, and markdown link
  targets are excluded. Anchor text remains visible; hrefs go to the citation
  pipeline. The deep-walk extractor is reserved for fallback URL harvesting.
- **Matcher rules.** Unicode NFKC plus diacritic folding; Unicode letter and
  number boundaries; token-separator equivalence across `- . _ /` and
  whitespace ("Coca-Cola" is equivalent to "Coca Cola"); trailing possessives
  (`'s`) allowed. There is no stemming, fuzzy matching, or plural inference.
  Every miss must be fixable by adding an alias.
- **Negative context still counts.** "Unlike Ahrefs…" is a mention. Sentiment
  is measured separately.
- **Persisted atoms.** Per answer and entity: `mentioned`, `mentionCount`,
  `firstOffset`, and `spans`. Spans feed position, prominence, and client
  highlighting.
- **One matcher implementation, shared.** The matcher lives in
  `src/shared/mentions.ts` and is imported by the Worker and SPA. The
  client-side highlighter is a thin adapter over it, so there is no separate
  matching rule to keep synchronized.

## Mention rate

- **Denominator: `ok = true` and `answerPresent = true`.** Failed fetches are
  not signal, and a missing AI Overview has no answer in which to find a
  mention. AIO coverage is reported separately.
- Per prompt and surface: mentioned samples divided by successful samples. Per
  surface and run: mean over prompts with at least one successful sample.
  Overall per run: mean over all prompt and surface cells, with equal weight
  per cell.
- Runs are never blended; trends plot per-run values.

## Citation detection

- **Three source tiers, by trust.** First, provider-labeled source structures
  (`citations`, `search_sources`, `links_attached`, and the AIO reference
  list). Second, inline links in answer markdown. Third, deep-walk harvesting
  as fallback only when the first two tiers find nothing. Every citation stores
  its `origin` as `source_list`, `inline`, or `walk`. Asset URLs such as
  favicons, thumbnails, and image files are filtered in all tiers.
- **URL normalization before matching and deduplication.** Lowercase host;
  strip default ports and fragments, including AIO text fragments; strip only
  known tracking parameters such as `utm_*`, `gclid`, and `fbclid`; unwrap
  decodable redirectors such as `google.com/url?q=`. Opaque redirectors resolve
  from payload metadata or remain unattributable. They count in totals but
  never receive domain or entity credit. IDN hosts become punycode. The dedupe
  key is the normalized URL per result.
- **Ownership matching.** An entity domain entry is an apex such as
  `ahrefs.com` or a specific host such as `mybrand.substack.com`. Matching uses
  exact host or dot-boundary suffix, covering subdomains without matching
  `notahrefs.com`. Registrable-domain grouping uses the Public Suffix List via
  `tldts`, never naive TLD splitting. Path-level properties such as
  `github.com/brand` are not supported.
- **Per-entity attribution.** `citations.entityId` is nullable, with null
  meaning an unaffiliated third party. The longest matching domain entry wins
  ties, and the matching set is the run's frozen entity snapshot.
  `entity_scores.citedCount` stores distinct owned URLs per answer.
- **Citation-rate math mirrors mention rate.** It uses the same
  `ok && answerPresent` denominator and per-cell weighting, making the rates
  directly comparable. Sourceless answers remain in the denominator as zero
  citation visibility. Source coverage per surface is reported separately.

## Share of voice

- **Presence-based, never occurrence-weighted.** Share of voice consumes the
  binary `mentioned` flag. `mentionCount` is diagnostic only, so a listicle
  repeating one name cannot dominate the result.
- **Pooled-ratio formula.** Over eligible results,
  `SOV(e) = voice(e) ÷ Σ voice(i)` across the tracked set, where `voice(e)` is
  the count of results mentioning entity `e`. It sums to exactly 100% across
  entities. An answer mentioning three entities contributes one to each. When
  the pool is empty, the result is undefined and renders "—", never 0%.
- **Pooled, not a mean of cells.** Rates average over cells; shares use summed
  numerators divided by summed denominators so they remain additive and avoid
  averaging unstable or undefined per-cell ratios. Per-surface SOV pools within
  that surface; overall SOV pools across all eligible results.
- **Two SOVs, one headline.** Mention SOV is the headline tile. Citation SOV
  uses the same formula over `cited`, with tracked entities as the denominator.
  Third-party sourcing belongs on the Sources page instead.
- **Honesty guards.** The denominator is the tracked set, not the market.
  Adding or removing a competitor mechanically changes every share. Each run
  stores an entity-set hash, and set-relative comparisons are suppressed across
  incompatible sets. SOV is unavailable until the workspace tracks at least
  one competitor. There is no composite visibility score.

## Position and prominence

- **Rank is first-mention order.** Mentioned tracked entities are ordered by
  `firstOffset` per answer; 1 means named first and null means not mentioned.
  Overlap resolution guarantees distinct span starts. Rank is relative to the
  tracked set, so entity-set compatibility applies to position comparisons.
- **Average position is conditional on mention.** It is a pooled mean over
  answers where the entity appears. Absence is represented by mention rate,
  not a position penalty.
- **First-named share.** Rank-1 events divided by answers where at least one
  tracked entity is mentioned. It uses the same pool as SOV and sums to 100%
  across the tracked set.
- **Prominence tiers are `lead`, `body`, and `list`.** The first text block,
  other prose, and list items or table rows are mapped by parsing canonical
  markdown into blocks. Per answer and entity, the best tier among its spans is
  stored. Aggregation is a distribution, never a weighted composite.
- **Citation source-list rank is stored but not surfaced.** `citations.rank`
  records order within provider source lists for `source_list` citations.

## Sentiment

- **Enrichment, not scoring.** Classification runs outside the deterministic
  scoring path. After a result is scored, a `sentiment_score` queue message
  fills `entity_scores.sentiment` with positive, neutral, or negative. Null
  means unclassified and renders "—". Classification failure never delays or
  fails the run.
- **One model call per answer.** Workers AI glm-5.2 judges every mentioned
  tracked entity in one call. Entities are referenced by number so the model
  cannot introduce one. Malformed entries remain unclassified rather than
  being guessed. Negative framing affects sentiment but still counts as a
  mention.
- **New answers only.** History is not backfilled; pre-sentiment rows remain
  null and leave every sentiment denominator. Rescoring carries existing
  labels over. Per-run rescore can re-drive classification for mentioned rows
  still unclassified, while the queue backfill never classifies.
- **Aggregated as a distribution.** `sentimentDist` covers classified mentions
  only. Sentiment is never collapsed into a composite score.

## Change alerts

- **Derived on read, never stored.** `detectChanges` in
  `src/api/routes/changes.ts` compares the two most recent completed runs using
  the same metric functions as the dashboard. `GET /changes` serves the report,
  so a rescore corrects it on the next read.
- **Three honesty guards.** Only prompt and surface cells shared by both runs
  are compared. Set-relative metrics are suppressed when `entitySetHash`
  differs or is null. Material thresholds gate every event: 15 percentage
  points for mention and citation rates, 10 points for SOV, 20 points for
  sentiment shares, and one full rank for position. Comparisons require at
  least four shared cells, and position or sentiment require at least three
  eligible observations on both sides.
- **Event set.** Brand mention and citation rate moves, overall or per surface
  when the overall delta stayed quiet; SOV swings; position slips; sentiment
  shifts; and competitor appearances, rises only. Events are severity-sorted
  and capped at six.
- **Two render surfaces, one engine.** The Overview "What changed" card and
  Home idle chips consume the same events. Every event carries its question,
  and the card's ask action opens Home with the question prefilled.
- Thresholds are restated in the Help glossary under "Material change" and
  pinned to engine constants by `changes.test.ts`.

## Alias capture

- Competitor drafts are `{name, domains[], aliases[]}`; the brand uses the same
  model. Draft schemas remain lenient so old in-flight drafts upgrade on read.
- Search and LLM drafting return official name, owned-and-operated apex domains,
  conservative aliases, and dictionary-word flags. A missed alias is a visible
  undercount, while a bad alias silently inflates metrics, so drafting biases
  toward precision.
- Every suggestion is human-confirmed through the onboarding and Settings
  alias/domain editors.
