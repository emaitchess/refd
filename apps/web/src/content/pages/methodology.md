---
title: "How refd measures AI search visibility"
description: "How refd collects repeated AI answers, detects mentions and citations, and calculates position, sentiment, and share of voice with auditable evidence."
eyebrow: "Methodology"
answer: "refd repeatedly runs a fixed set of buyer questions across five AI answer surfaces, scores the visible answer text and source URLs, and aggregates results by prompt and surface. Every metric stays linked to the underlying answer so a change can be inspected instead of taken on faith."
publishedAt: 2026-07-29
author:
  name: "Mohammad Hamza Suhail"
  url: "https://emaitchess.com"
order: 1
related:
  - href: "/docs/getting-started"
    title: "Getting started with refd"
    description: "Set up a brand, choose competitors and buyer questions, and inspect the evidence in your first report."
  - href: "/agents"
    title: "Connect an AI agent"
    description: "Read workspace metrics and answer evidence through the OAuth-protected remote MCP server."
---

AI answers change. A useful measurement system has to preserve that uncertainty,
separate distinct signals, and make every aggregate traceable to evidence.
refd is designed around those constraints.

This page describes the methodology implemented by the current open-source
codebase. The detailed scoring contract lives in
[`docs/METRICS.md`](https://github.com/emaitchess/refd/blob/main/docs/METRICS.md),
and the implementation is available in the
[`refd` repository](https://github.com/emaitchess/refd).

## Measurement at a glance

| Stage | What refd does | Why it matters |
| --- | --- | --- |
| Define | Freeze a brand, competitors, aliases, domains, prompts, and surfaces for each run | Mid-run edits cannot change the comparison set |
| Collect | Run each prompt across enabled AI answer surfaces with repeated samples | One answer is not treated as a stable ranking |
| Normalize | Extract the visible answer and source URLs from provider records | Provider-specific response shapes do not leak into scoring |
| Score | Detect mentions, citations, first-mention order, prominence, and sentiment | Each signal keeps a clear definition |
| Aggregate | Calculate rates per prompt and surface, then roll them up with explicit denominators | Large or noisy prompt groups do not silently dominate |
| Audit | Keep the raw provider payload and the normalized answer behind each result | Every chart can be checked against evidence |

## Start with a fixed question and entity set

A workspace represents one brand. It also contains the competitors and buyer
questions that define the comparison.

Each entity has:

- An official name.
- Conservative aliases, including case-sensitive aliases when ordinary words
  could otherwise create false positives.
- One or more owned domains for citation attribution.

Each run freezes the active prompts and the complete entity set. If a user edits
a competitor or alias while collection is in progress, the finished run still
uses the snapshot it started with. This keeps every answer inside a run
comparable.

The prompt set should represent questions real buyers ask across discovery,
comparison, evaluation, and decision stages. refd measures that selected set. It
does not claim that a small prompt list represents every possible question in a
market.

## Collect repeated answers across five surfaces

refd currently monitors:

| Surface | Collection path |
| --- | --- |
| ChatGPT | Bright Data dataset scraper |
| Perplexity | Bright Data dataset scraper |
| Gemini | Bright Data dataset scraper |
| Google AI Mode | Bright Data dataset scraper |
| Google AI Overviews | Bright Data SERP API |

Bright Data is the only answer-collection provider. Provider access, geography,
session state, and product changes can affect the returned answers. refd records
what the configured provider observed at that time; it does not claim to
reproduce every answer every person could receive.

The hosted deployment currently takes two samples of each prompt and surface
cell. Samples are collected independently. Identical prompts are never placed
together in a way that could let a provider collapse them into one response.

Two samples do not eliminate uncertainty. They make instability visible and
reduce the temptation to interpret one answer as a durable rank. Trends across
completed runs are more meaningful than any single sample.

### Missing AI Overviews are observations

Google does not show an AI Overview for every query. When the SERP response
contains no Overview, refd stores a successful result with
`answerPresent=false`.

That result contributes to AI Overview coverage, but it does not enter mention
or citation rate denominators because there was no answer in which a brand could
appear. Absence is data, not a failed fetch and not an automatic zero for every
visibility metric.

## Normalize the answer before scoring

Provider response formats change and differ by surface. refd converts each
record into one normalized answer:

- The canonical visible answer text.
- The source URLs attached to that answer.
- Whether an answer was present.
- The original provider payload.

Mention matching runs only against text a person would read as part of the
answer. Link destinations, source-card titles, related searches, and interface
labels do not count as mentions.

Citation extraction uses three levels of evidence:

1. Provider-labeled source structures.
2. Links written directly in answer Markdown.
3. A schema-agnostic deep walk, only when the first two levels found no URLs.

The fallback is intentionally broad because external schemas drift. It is not
used to invent visible answer text.

## Detect brand and competitor mentions

A mention is the presence of a tracked entity's name or one of its confirmed
aliases in the visible answer text.

The shared matcher:

- Normalizes Unicode and folds diacritics.
- Respects Unicode letter and number boundaries.
- Treats spaces and common token separators such as hyphens, dots, underscores,
  and slashes as equivalent.
- Supports case-sensitive aliases for names that are also dictionary words.
- Allows possessive endings.
- Resolves overlapping entity names by keeping the longest match at a position.

There is no stemming, fuzzy matching, or inferred plural rule. If a legitimate
name is missed, the correction is to add a precise alias. This favors visible,
reviewable rules over probabilistic matching.

Negative context still counts as a mention. For example, a sentence that
criticizes a brand still names it. Sentiment is measured separately.

### Mention rate

For one prompt and surface:

`mention rate = samples mentioning the entity / successful samples with an answer`

The run-level rate is the equal-weight mean of eligible prompt and surface
cells. Samples are averaged within their cell first. This prevents a cell with
more successful samples from silently outweighing another buyer question.

Failed fetches do not enter the denominator. A successful answer that does not
mention the entity enters as zero.

## Detect and attribute citations

A citation is an HTTP or HTTPS source URL associated with an answer. refd
normalizes URLs before deduplication and attribution:

- Hosts are lowercased and default ports are removed.
- Fragments and known tracking parameters are removed.
- Decodable search redirectors are unwrapped.
- Favicons, thumbnails, and common static assets are filtered.
- Internationalized domains are normalized.

An entity receives citation credit when the normalized host matches one of its
confirmed domain entries at an exact or subdomain boundary. An entry for
`example.com` can match `docs.example.com`, but never `notexample.com`.

URLs that do not belong to a tracked entity remain valuable. They appear as
third-party sources and can reveal which publishers, communities, or documents
shape answers in the category.

### Citation rate

Citation rate uses the same denominator and cell weighting as mention rate:

`citation rate = samples citing the entity / successful samples with an answer`

A present answer with no sources stays in the denominator as zero citation
visibility. Source coverage is reported separately so users can distinguish
low citation visibility from surfaces that rarely expose sources.

## Calculate share of voice

refd share of voice is presence-based. Repeating a brand name ten times in one
answer does not give it ten times the voice.

For an entity:

`share of voice = answers mentioning the entity / total tracked-entity mentions`

The denominator includes only the brand and competitors configured in that
workspace. Third parties are not added automatically.

This share sums to 100 percent across the tracked set when at least one entity
appears. It is undefined when no tracked entity appears. Adding or removing a
competitor changes the denominator, so refd suppresses set-relative trend
comparisons when the tracked entity set differs between runs.

Mention share of voice is the headline measure. Citation share of voice applies
the same pooled formula to entity-owned citations.

## Measure position and prominence

Position is the order in which tracked entities are first named in an answer.
The earliest tracked entity receives position 1. An entity that is absent has
no position.

Average position is calculated only across answers where the entity appears.
Absence is already represented by mention rate, so refd does not turn a missing
mention into an arbitrary rank penalty.

First-named share is the percentage of answers with at least one tracked mention
where the entity appeared first.

Prominence records where the strongest mention occurred:

- `lead`: the first prose block.
- `body`: later prose.
- `list`: list items or table rows.

Prominence remains a distribution. It is not compressed into a hidden composite
score.

## Classify sentiment separately

Sentiment is an enrichment step, not part of deterministic scoring. After an
answer has been scored, a Workers AI model classifies the context around every
mentioned entity as positive, neutral, or negative.

One model call handles all mentioned entities in an answer. Entities are
referenced by number so the classifier cannot introduce a new brand. Malformed
or missing classifications remain unclassified rather than being guessed.

Sentiment percentages include classified mentions only. A null value means
"not classified," not neutral. Historical answers created before sentiment
classification may remain unclassified.

## Keep changes comparable

The change engine compares the two most recent completed runs and applies three
guards:

1. Only prompt and surface cells shared by both runs are compared.
2. Share-of-voice, position, and competitor events require compatible tracked
   entity sets.
3. Minimum evidence and material-change thresholds suppress noise.

Current material thresholds are 15 percentage points for mention or citation
rate, 10 points for share of voice, 20 points for sentiment shares, and one full
position for rank. Position and sentiment changes also require enough eligible
observations on both sides.

These alerts are designed to direct attention. They do not establish causation.
The underlying answers show what changed; a user still has to determine why.

## Audit every aggregate

Raw provider payloads are stored in compressed form. The normalized visible
answer, extracted citations, and per-entity scores are stored alongside the run.
The dashboard can open the exact answer behind a prompt, surface, and sample.

Scoring is versioned. When deterministic parsing or matching improves, an
operator can replay stored raw payloads through the current scorer without
paying the provider to collect the answers again. Runs without stored raw data
keep their original scores.

The important contract is simple: a metric is a navigation aid, not a substitute
for evidence. When a number matters, inspect the answers that produced it.

## Limitations

Use refd with these boundaries in mind:

- **AI output is non-deterministic.** Repeated samples help, but no sample count
  makes an answer permanent.
- **The prompt set is selected.** Results describe the questions, surfaces, and
  tracked entities configured in the workspace.
- **The provider has a viewpoint.** Collection reflects Bright Data's access
  path and the response returned at collection time.
- **Aliases require judgment.** A missing alias undercounts. A broad alias can
  create false positives. Human confirmation matters.
- **Citation availability varies.** Some surfaces expose richer source data than
  others.
- **Sentiment is model-classified.** Treat it as directional and inspect the
  answer when context matters.
- **Visibility is not causation.** A movement can be observed without proving
  which content, campaign, model update, or source change caused it.

refd deliberately avoids a composite visibility score. Mentions, citations,
position, sentiment, prominence, coverage, and share of voice answer different
questions and remain separate.
