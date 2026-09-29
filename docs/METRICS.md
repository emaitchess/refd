# Metrics

Internal reference for refd's shipped scoring and aggregation contract.
User-facing definitions live in `packages/core/src/metric-copy.ts`; the implementation
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
- **A headline states which prompts it pools.** Every rate is a statement about a
  set of prompts, and the set has to be named, because a prompt that spells out
  the brand is scored near 1.0 by construction. See Prompt cohorts.

## Prompt cohorts

A prompt that names the brand asks for the brand, so its mention rate is close to
1 whatever the market does. Pooling it with prompts that name nobody measures
the wrong thing: on the reference workspace the two brand-defining prompts are 8%
of answers and about half of all citations, which lifts the blended citation rate
roughly 5 points above the discovery-only figure.

The taxonomy is `discovery`, `problem`, `market_perception`, `alternative`, and
`brand_defining`, and the split is **partly derived and partly declared**:

- **`brand_defining` and `alternative` are derived.** The prompt names your brand,
  or names only a tracked competitor. The same matcher that scores a mention
  decides them, so they are provable from the text and are classified on read. A
  prompt naming both is `brand_defining`, because the brand-named case is the bias
  being corrected.
- **`discovery` is the derived floor.** A prompt naming no tracked entity lands
  here unless it is declared as something else.
- **`problem` and `market_perception` are declared, never guessed.** Separating a
  problem-shaped question from a broad discovery one, or a question about how the
  market frames the category, is a judgement about buyer intent and no substring
  settles it. The repository rule already holds for the rest of setup: ambiguity is
  resolved at setup time with human confirmation, never inside a read. So these two
  are chosen deliberately and can be changed at any time.

- **Membership is derived, not declared.** `prompts.kind` is `branded`,
  `competitor`, or `discovery`, classified by running the mention matcher over
  the prompt text against the tracked entity set, for the two cohorts that text
  can prove. That is the same matcher, and the same alias composition, the scorer
  runs, so "this prompt names the brand" means exactly what "this answer mentions
  the brand" means. A prompt naming both the brand and a competitor is
  `brand_defining`, because the brand-named case is the bias being corrected.
- **A NULL kind means unclassified, never a cohort.** Classification needs the
  alias matcher, so it cannot run in a SQL migration; it runs on the first read
  that needs it and resolves only NULL rows. A kind set explicitly through
  `update_prompt` is never overwritten, so the backfill is idempotent and an
  operator override survives. A prompt with no entity set to classify against
  stays unclassified rather than being asserted into a cohort.
- **A filtered rate is a rate for that cohort, not a share of the blended one.**
  The filter is pushed into the score-row query, so cells outside the cohort
  never enter the pool. Because a cell is one (run, prompt, surface) and each
  cell carries equal weight, the cohort rate is computed over cohort cells only.
- **The headline is the discovery cohort, not the blend.** A caller who asks for
  no filter gets the unprompted-visibility figure, because the alternative is
  handing back a number that brand-named questions inflated. A workspace with no
  discovery prompts falls back to every cohort and says so in `population: "all"`,
  since a silent fallback to an empty population would be worse than either.
- **The blend is kept, labelled, and out of the way.** `get_visibility_overview`
  returns `headline` (which names its population), `byCohort` with all five
  cohorts, and a `blended` block marked `deprecated: true`. It is no longer at the
  top level, so nothing reads it by accident, and it remains available so a
  reading can be compared against one taken before this change. `get_digest` is deliberately not cohort-filterable: it is a
  whole-workspace rollup that already returns every cohort side by side in
  `sections.prompts.cohorts`, and `buildDigest` has no cohort seam, so accepting
  a filter there would relabel a blended number as cohort-specific.
- **Cohort is not category.** `category` is the buyer journey
  (Discovery, Evaluation, Comparison, Decision, Authority) and its `Discovery`
  member is a stage, not the absence of a tracked name. The two are independent
  and frequently disagree, which is why `tags` could not carry the cohort.

## Surfaces: configured versus measured

A surface can be switched off and still have results inside the window being
read, because a 30-day window outlives a configuration change. Two responses
previously answered "which surfaces" differently, and neither said which answer it
was giving: `get_workspace_info` reported the **configured** set, while
`get_visibility_overview` and `get_competitor_landscape` reported the set
**derived from rows in the window**. A reader comparing denominators had no way
to reconcile them, and a coverage figure for a departed surface could not be
interpreted at all.

- **Every surface carries a status, and it travels with its figures.** A resolved
  registry covers the union of the configured set and anything with data in the
  window, ordering surfaces canonically rather than alphabetically so chart series
  and colours stay stable. Each is `enabled` or `historical`, and the per-surface
  objects in the overview and landscape repeat the status, so a number and its
  provenance cannot be read apart.
- **`historical` is a real period, not a defect.** Its figures belong to a period
  when the surface was running, which is exactly why they are labelled rather than
  dropped: excluding them silently would make a run where collection was
  interrupted look like a run where the surface scored zero.
- **Absence of data is not absence of a surface.** An enabled surface that has not
  collected yet is still present in the registry, so "what are we tracking" and
  "what have we measured" are answerable separately and neither implies the other.
- **A historical surface is included in the aggregate, not excluded from it.** Its
  answers are part of the window, because dropping them would silently shrink a
  window that was really collected. The registry note says so in those words,
  because the earlier wording claimed the opposite and was wrong about the data
  printed beside it.

## Bounded lists

`get_prompt_performance` with `summary: true` caps `zeroVisibility` at ten entries
and reports the true `count` alongside a `truncated` flag. A caller reading only
the count is never misled by the cap, and the cap never hides a prompt: the
default, untruncated read returns the whole list up to a 200-entry ceiling.

## Attributes

A prompt set with one prompt per capability cannot be read at the capability level,
because a single label change is enough to swing visibility by tens of points. A
rate computed from one prompt reports the wording, not the capability it was
written for.

- **`prompts.attributeId` groups many prompts under one attribute**, addressed by
  label rather than id everywhere a caller supplies one, since prompt text is
  already the unique identity in a submission. An attribute is created on first
  use, and labels fold case and whitespace so two spellings are one attribute.
- **The report states its own denominator.** `get_attribute_performance` returns,
  per attribute: how many tracked prompts carry it, how many fall inside the
  reported population, how many are active, the measured answers and rates, and
  whether anything was measured at all. Membership and measured count are
  reported separately so a cohort filter is legible rather than looking like lost
  prompts.
- **One prompt is labelled unmeasured, not reported as a finding.** An attribute
  with a single variant carries an explicit warning, because the honest reading is
  that the capability is untested rather than that it scores whatever one phrasing
  scored. An attribute with no answers reports `measured: false` and no rate,
  which is a different statement again.
- **Ungrouped prompts are reported, not hidden.** A workspace that has not grouped
  anything still gets numbers, plus the count of prompts carrying no attribute.

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
  `packages/core/src/mentions.ts` and is imported by the Worker and SPA. The
  client-side highlighter is a thin adapter over it, so there is no separate
  matching rule to keep synchronized.

## Mention rate

- **Denominator: `ok = true` and `answerPresent = true`.** Failed fetches are
  not signal, and a missing AI Overview has no answer in which to find a
  mention. AIO coverage is reported separately.
- **A present answer with empty canonical text is a failure, not a quiet
  zero.** A scraped record whose recognized answer field is missing or empty
  (provider field drift) is rejected by `storeScoredResult` and recorded as a
  failed result; storing it as ok would count a non-mention in every
  scoreable denominator and silently deflate the rates. The raw payload stays
  in R2 at the deterministic key for operator diagnosis.
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

## Position, when the brand is mentioned

`averagePositionWhenMentioned` is the mean rank across the answers where the brand
is mentioned, and it is renamed from `averagePosition` because the old name
claimed a denominator it never had.

The failure this fixes is real and small. A surface where the brand is mentioned in
3% of answers can still post a position of exactly 1.000, because the surface tends
to open with the most prominent entity and the conditional mean pins to 1. That
number is arithmetically correct and simultaneously reads as "this brand holds first
position across the surface", which is the opposite of the truth. Placed beside a
mention rate it invited a comparison the two figures do not support: a reader
comparing a 1.000 against a 1.063 concludes the lower-mention surface is better.

- **The denominator travels with the mean.** `positionedAnswers` reports how many
  answers the mean covers, so `1.0` of 2 of 20 reads as what it is.
- **Absence is not a penalty.** A brand that is never mentioned reports `null` with
  `positionedAnswers: 0`, which is a different statement from a rank.
- **A threshold would hide the signal.** Suppressing position below some mention
  rate was considered and rejected: AI Mode leading with the brand when it names it
  is worth knowing, and an arbitrary cut-off discards it.

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
- **One model call per answer.** The default classifier is glm-5.3-flash
  (eval-backed: agreement with glm-5.3 labels within glm-5.3's own
  run-to-run noise band, at a quarter of the output tokens; `SENTIMENT_MODEL`
  pins either direction), and the output is bounded by a `response_format`
  json_schema, so protocol drift cannot leak past validation. Entities are
  referenced by number so the model cannot introduce one, and each entry
  carries the matched span text when the matcher matched an alias, so stance
  is judged for the string actually in the answer. Malformed entries remain
  unclassified rather than being guessed. Negative framing affects sentiment
  but still counts as a mention.
- **Long answers get a second pass.** The prompt window caps the answer text;
  an entity whose first mention lies beyond the cap is invisible to the main
  call, so it is classified from a tail window anchored just before its first
  mention. Entities the model still returns nothing for are logged, and stay
  unclassified rather than guessed.
- **Pending coverage is an operator-visible number.** `rescoreProgress`
  reports `sentimentPending` (mentioned rows still unclassified), and the
  operator rescore re-drives the backlog alongside stale scores.
- **New answers only, mostly.** History is not backfilled on rescoring that
  only relifts scores; rescoring carries existing labels over, and both the
  per-run rescore and the queue backfill re-drive classification for results
  that mention tracked entities whose rows are still unclassified (the
  handler no-ops on fully labeled results, so carry-over labels cost no model
  call). Pre-sentiment rows remain null and leave every sentiment denominator.
- **Aggregated as a distribution.** `sentimentDist` covers classified mentions
  only. Sentiment is never collapsed into a composite score.

## Change alerts: what an event is measured over

Every event carries `measuredOver: 'shared-cells'`. The engine compares only the
prompt x surface cells present in **both** windows, so a rate event is a comparison
of the same questions before and after, even when the live prompt set has moved on.
Set-relative events (share of voice, position) depend on the whole tracked set
agreeing, so they are withheld across a break in either the entity set or the
prompt set.

The distinction is stated on the report rather than left to be inferred, because one
flag was being read as two things:

| Field | Question it answers |
| --- | --- |
| `comparedOverSharedCells` | What the numbers are over: the cells both windows share, always true when events are present |
| `liveSetUnchanged` | Whether the questions measured are still the ones tracked now |
| `populationMatches` | The old combined flag, equal to `liveSetUnchanged`; kept for existing consumers and no longer the thing to read |

`status` is `population-moved` when `liveSetUnchanged` is false. It is a distinct
state, not a failure: the events are valid for the cells both windows share, and a
consumer keying on `status` can no longer read a comparison made across a changed
prompt set as the same clean bill of health as a stable one. `caveat` carries one
sentence saying which case applies, so no client has to re-derive it from four
booleans and get it subtly wrong. An unprovable population (a run predating the
frozen prompt set) is a different sentence from a proven change, and says so.

`activePromptCount` is null when the count could not be established, which is not
the same as zero: a zero reads as an empty workspace and would mark every window as
a population mismatch.

## Prompt population versions: recovering history

A version row is minted the first time a population is measured, which leaves every
run that predates the feature with a null `promptSetVersionId`. Left alone, a
workspace with a month of history reports only its newest population and labels it
"first recorded population for this workspace", while the endpoint's own note tells
the reader to compare within a version. A short list makes that instruction
impossible to follow while looking authoritative.

- **The history is recovered on read.** Each historical run's frozen dispatch plan
  is the only place its population can be read from, so the backfill derives the
  hash from it, mints a version per distinct population oldest first, and points
  those runs at it. It is idempotent, keyed on the run's own plan, and scoped to one
  workspace.
- **Runs are matched by hash, not only by version id.** A run recorded before the
  feature carries the hash and a null id, so an id-only match reported a version's
  first run as the first run that *pointed* at it, which put the first run after the
  version that already existed. The hash is the identity the version was keyed on.
- **Each version is described against its real predecessor.** Change reasons are
  computed in run order, not insert order, so "10 added against the previous
  population" means the population measured before it in time.
- **`sequence` is the workspace's own order.** `versionId` is a global row id, so the
  first version a workspace has is not numbered 1, and reporting both stops a reader
  inferring missing history from a number that never promised to start at one.
- **Incompleteness is stated.** `historyComplete` is false and `unattributedRuns`
  counts the runs whose population cannot be read, rather than returning a short
  list that reads as a complete history.

## Change alerts

- **Derived on read, never stored.** `detectChanges` and `detectDrift` in
  `apps/api/src/routes/changes.ts` compare seven-day windows of runs using the
  same metric functions as the dashboard. `GET /changes` serves the report, so
  a rescore corrects it on the next read.
- **The window is the comparison unit.** At `SAMPLES=1` a run holds roughly one
  answer per cell, so day-over-day deltas are dominated by answer
  non-determinism: across eleven consecutive production run pairs the largest
  mention-rate move was 3.4 points, well under any threshold that survives that
  noise. `WINDOW_DAYS = 7` pools about seven times the answers, which is what
  makes the current thresholds meaningful rather than unreachable.
- **Two spans.** A `shift` compares the latest window with the previous one. A
  `drift` compares the newest of `TREND_WINDOWS` (4) with the oldest and fires
  only when no step contradicts the overall direction by more than a fifth of
  the metric's threshold — the slow slide an adjacent pair never breaches. When
  a metric produces both, `mergeEvents` keeps the larger reading so one metric
  is one row.
- **Four honesty guards.** Only prompt and surface cells answered by every
  compared window count (`cells` for the shift scope, `trendCells` for the
  narrower drift scope). Set-relative metrics are suppressed when
  `entitySetHash` differs or is null anywhere in the span, including within a
  single window. Material thresholds gate every event: 5 percentage points for
  mention and citation rates, 4 points for SOV, 5 points for sentiment shares,
  and a quarter rank for position. Comparisons require at least four shared
  cells, and position or sentiment require at least three eligible observations
  in every window compared.
- **Event set.** Brand mention and citation rate moves, overall or per surface
  when the overall delta stayed quiet; SOV swings; position slips; sentiment
  shifts; and competitor appearances, rises only. Drift covers overall scope
  only: a four-week trend read off one surface's cells is a shape found by
  looking. Events are severity-sorted and capped at six.
- **Two render surfaces, one engine.** The Overview "What changed" card and
  Home idle chips consume the same events. Every event carries its question,
  and the card's ask action opens Home with the question prefilled.
- Thresholds are restated in the Help glossary under "Material change" and
  pinned to engine constants by `changes.test.ts`.

## Prompt population and trend honesty

`entitySetHash` identifies the entity set, and it was the only population
identity a trend carried. That made a prompt-set change invisible: adding or
retiring prompts moved the questions underneath a trend line while every
set-relative event still read as a visibility movement.

- **A run's prompt population is identified by `promptSetHash`**, hashed from the
  frozen dispatch plan's prompt list with the same djb2 over a canonical identity
  that `entitySetHash` uses, so a prompt break and an entity break are computed
  and read the same way.
- **It is derived from the dispatch plan on read, not stored in a column.** Every
  run already froze the population it meant to score, so a stored column would be
  null for all pre-existing runs and would make every historical comparison read
  as a break it cannot prove.
- **A null population is unknown, not changed.** A run predating the frozen prompt
  set yields null, the relative-metric guard still withholds share-of-voice and
  position, and `promptSetKnown: false` says so. A reader is never told the
  questions moved when the endpoint merely cannot prove they did not.
- **`promptCount` and `activePromptCount` are different quantities and both are
  reported.** `promptCount` is the population that produced shared cells in the
  two compared windows; `activePromptCount` is what the workspace tracks now.
  `populationMatches` is true only when the windows provably shared one prompt
  population *and* that population is the live set. Reporting only the first is
  what let a stale population look authoritative.
- **Set-relative events are withheld across a prompt break**, exactly as they are
  across an entity break: a share moving because the questions changed is a change
  of questions, not of visibility. Rate events survive, because a brand mention
  rate can still fall on a shared cell.
- **A population is versioned, and the version is the identity.** The first time a
  prompt set is measured, `prompt_set_versions` records it and every run against
  that set carries its id, so two runs sharing a version id provably measured the
  same questions. That is what makes a period-over-period comparison either
  legitimate or visibly illegitimate, rather than a comparison a reader has to
  reason about. A version's key is the same `promptSetHash` the guard above
  recomputes, deliberately: a second notion of population identity would let the
  version a run points at disagree with the break the engine detects.
- **A surface change does not mint a version.** The version describes the question
  set; `surfaceIds` records the surfaces of the run that created it. This matches
  the guard treating a surface change and a prompt change as different kinds of
  break.
- **A membership change with no run yet has no version.** A version is a record of
  what was measured, so one is minted on measurement rather than on edit. The
  timeline therefore answers "what did each run measure, in order", which is the
  question a trend needs; the un-run draft lives in setup.

## Alias capture

- Competitor drafts are `{name, domains[], aliases[]}`; the brand uses the same
  model. Draft schemas remain lenient so old in-flight drafts upgrade on read.
- Search and LLM drafting return official name, owned-and-operated apex domains,
  conservative aliases, and dictionary-word flags. A missed alias is a visible
  undercount, while a bad alias silently inflates metrics, so drafting biases
  toward precision.
- Every suggestion is human-confirmed through the onboarding and Settings
  alias/domain editors.
