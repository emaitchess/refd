import { PROMPT_CATEGORIES, STANDARD_LIMITS } from '@refd/core/config';
import { SURFACE_LABELS, SURFACES } from '@refd/core/surfaces';

// Every refd-specific number in this document is asserted against its canonical
// source by skills.test.ts. Change one there and the skill has to change with it.
export const AI_PROMPT_SET_DESIGN_SKILL = `---
name: ai-prompt-set-design
description: >
  Design and audit prompt sets for AI search visibility monitoring (GEO). Covers
  the rule that outranks the rest, never pooling brand-named prompts into a
  discovery score, the prompt types worth covering, funnel and persona
  segmentation, intent clusters instead of single prompts, wording rules, source
  mining, and what a normal visibility number looks like for a brand of your
  size. Use when building a prompt set, auditing an existing one, deciding what
  to add or retire, or explaining why a visibility number looks wrong. Platform
  neutral: works with any monitoring tool, or with a spreadsheet.
---

# AI prompt set design

A prompt set is the measurement instrument. Every rate, rank, and share you
report is a statement about the questions you chose to ask, so a set built badly
produces a dashboard that is precise about the wrong market.

This skill is platform neutral. The discipline belongs to the instrument, not the
vendor. It applies to any AI search monitoring tool, and to a spreadsheet and
patience. The final section covers what refd does and what you still have to do
by hand.

## The rule that outranks everything else

**Never pool brand-named prompts into a discovery or share-of-voice number.**

A prompt that names your brand hands you the mention. That is a constant, not a
measurement, and pooling it into a headline inflates the number with information
you already had before you spent anything.

One study of 102,025 prompt responses across 102 brands and five engines, with
149,912 citations, collected between March and May 2026, measured the effect
directly. Split by whether the brand name appears in the prompt:

| Engine | Branded prompts | Unbranded prompts |
| --- | --- | --- |
| ChatGPT | 94.2% | 22.1% |
| Gemini | 94.0% | 18.7% |
| Perplexity | 98.5% | 23.9% |
| Claude | 100.0% | 51.5% |
| Grok | 100.0% | 12.0% |

Branded prompts were roughly 9% of first-run responses and recognised the brand
at 94% or better on every engine. Including them lifted the pooled per-tier
figure from 43.6% to 52.2% for mid-market brands and from 11.4% to 17.3% for
small ones. The paper computes its headline result on unbranded prompts only, and
says why in the text.

That is the entire argument. A branded prompt answers "what does the assistant
say about you", which is worth measuring. It is not evidence about whether an
assistant would have found you.

Branded prompts are not worthless. They are the only source of accuracy checks,
competitive framing, and objection data, because no unbranded prompt can produce
those. Keep them, keep them a minority of the set, and never let them touch a
discovery aggregate. There is no universal right share, because the right share
depends on how many buying decisions you need to watch. If you can only report
one number, report the unbranded one.

**Check this before anything else.** If your tool cannot separate the two
cohorts in reporting, the headline is uninterpretable and no amount of prompt
editing will repair it. Fix the reporting first. Changing prompts will not fix a
broken aggregate.

## What a prompt set is

A fixed list of questions, asked on every run, held stable long enough to
compare. Twenty to thirty is a legitimate starting size for one brand in one
market. The set defines the denominator of every metric derived from it, so
changing it mid-campaign destroys the comparison that makes the metrics worth
having.

The taxonomy below is a practical scaffold, not a finding. No study tells you
which five buckets to use. What the research does support is the first rule,
persona conditioning, and clusters over single prompts, all of which are
separated out below because each one has evidence behind it.

## The prompt types worth covering

1. **Category discovery.** "Best X for Y", "what are the best X". Where new
   buyers meet the category. Highest reach, hardest to win, and where most
   competitors live.
2. **Use-case fit.** "X for a [persona] with [constraint]". Qualified intent.
   This is where a strong fit beats a bigger brand.
3. **Comparison and alternatives.** "A vs B", "alternatives to X", "how does X
   compare". Highest commercial intent. Naming a competitor is legitimate and
   worth tracking. Naming the brand you are measuring is not, because that prompt
   belongs in the branded cohort.
4. **Brand-defining.** "Is X any good", "what is X", "how much does X cost",
   "what is the learning curve for X". What the assistant says about you
   specifically. This is the branded cohort. Segregate it.
5. **Problem and job to be done.** "How do I solve Z", "will X actually save me
   time". Captures buyers who do not yet know the category exists.

Two more worth adding when you have budget:

- **Market perception.** "What is a [category] and how should I evaluate one?"
  Names no brand at all. Tests whether the buying framework itself favours you,
  which is upstream of any prompt you could write about yourself.
- **Implementation and proof.** "How do I measure whether X is working", "how do
  I prove X pays for itself". Authority-building, frequently cited, and usually
  missing from most sets.

## Funnel coverage

Prompts must span the journey, because absence early is invisible and absence
late loses the sale.

| Stage | Buyer state | Prompt shape | Share |
| --- | --- | --- | --- |
| Awareness | Has the problem, does not know the category exists | Concern, doubt, objection, job to be done | 15-20% |
| Consideration | Building a shortlist | Category discovery, use-case fit | 35-45% |
| Evaluation | Choosing between vendors | Comparison, alternative | 20-25% |
| Purchase | Ready now, or nearly | Where to get it, price, trial, onboarding friction | 10% |
| Brand-defining | Verifying you specifically | Accuracy, framing, objections | remainder |

These proportions are a starting distribution, not a measured optimum. Two
failure shapes are worth naming because they are common and they are invisible:

- A set that is all category discovery will show you losing every comparison and
  never tell you why.
- A set that is all comparison will show you winning the evaluation stage while
  being invisible at the moment buyers form a shortlist.

Skip the purchase stage only if you genuinely do not sell direct.

## Personas: measured, not optional

**A blended persona view hides the fact that you win one segment and lose
another, and the size of the effect is large enough to justify separate prompts
per segment.**

An audit of 2,000 runs across 10 personas, 8 prompts, 3 model configurations, and
10 repetitions per cell measured what happens when the same question is asked of
a different buyer. Prefixing the user message with a persona dropped the overlap
between recommended brand sets by 0.12 to 0.20 against a within-persona
reference, with clustered 95% confidence intervals excluding zero on all three
model cells.

The effect was sharply stratified by how established the brand is. Category
leaders held 80% same-brand consistency as the persona changed. Mid-market
brands swapped up to 75% of their recommendation set.

The authors' conclusion is the rule: any measurement of AI brand perception has
to condition on the persona supplying the query, because a protocol that
aggregates across personas systematically hides that variation. The same
question to two audiences can return entirely different answers, and a single
average over both is a number about nobody.

Practically:

- For every broad category prompt, add one variant per priority persona.
- Persona prompts must carry the constraint that makes the segment real.

  Weak: "best voice tool"

  Strong: "best Mac voice automation app for software developers who live in the
  terminal"

- Keep the personas as separate, labelled prompts so you can read visibility per
  persona. If you cannot separate them in reporting, the variants cost you
  queries and buy you an unreadable average.
- If you sell across regions, add region-specific phrasing where it changes the
  answer. One variance decomposition of 12,933 responses across 8 languages and 3
  models found query language accounted for 26.5% of single-response variance
  against 1.5% for brand identity, so a single-language set is blind to a large
  systematic effect.

## One prompt is not a measurement

**Treat one buyer intent as an attribute, not as a prompt.**

A study of roughly 6,000 paraphrase runs against roughly 6,000 same-prompt rerun
controls, on OpenAI and Anthropic models, measured how much of an answer is
driven by the question's exact wording. Using Jaccard overlap between the sets of
recommended brands:

| Comparison | Overlap | 95% CI |
| --- | --- | --- |
| Same prompt, rerun | 0.50-0.61 | baseline |
| Two paraphrases of one intent | 0.288 | 0.215-0.361 |
| Paraphrase that adds a constraint | 0.135 | 0.098-0.175 |

Paraphrasing the same buying intent moves the answer *further* than rerunning
the identical prompt does. The wording is the dominant input to which brands
surface, ahead of the intent behind it. The authors conclude that prompt-by-prompt
mention tracking is structurally unstable as a unit of measurement, and that the
fix is a different unit, not a bigger list.

The academic prompt-sensitivity literature agrees on the mechanism and names the
axis: across task types, paraphrasing is the variation that moves open-ended
generation most, while template changes move multiple-choice tasks most.
Recommendation questions are open-ended generation.

What to do:

- Write 3 to 5 phrasings per intent and score them together.
- Read at the attribute level. The individual prompts do the measuring; the
  cluster holds the read you act on.
- Expect variance inside a cluster. That variance is the most actionable thing in
  the whole exercise, because it tells you which wording to keep and which to
  retire.
- Useful cluster axes: "best" versus "top", category label versus job
  description, broad versus segment-specific, capability-framed versus
  outcome-framed.

A caution on the same evidence: the same variance decomposition found brand by
prompt interaction to be near zero once other terms were removed. So a brand's
*relative standing* is fairly stable across paraphrases even while the *set of
brands recommended* is not. Expect rewording to reshuffle who is in the answer,
and expect it to move your own rank far less. Read clusters for reach, not for
position.

## Wording rules

These are cheap to follow and they dominate results.

**Write what a buyer types, not what an analyst writes.** Third-person spec
phrasing is the most reliable predictor of zero visibility in a mature set.
Compare:

- Fails: "What level of offline or on-device processing do voice assistants offer
  for privacy?"
- Works: "Can I use a voice assistant without my recordings going to the cloud?"

One is a specification question. The other is a person protecting something they
care about. Buyers ask the second.

- **One question per prompt.** A bundled ask produces a muddy answer and an
  unreadable trend. "Developers and knowledge workers" is two audiences in one
  prompt.
- **Evergreen, with no year stamps.** A year in the prompt breaks before and
  after comparability. Measure year-stamped variants as their own cluster.
- **Customer language, not internal taxonomy.** Take phrasing from real users,
  not from your product categories or your sales deck. A generated set is a
  starting draft to edit, not a finished instrument.
- **No near-duplicates.** Two prompts asking the same decision in slightly
  different words is waste. Cluster them instead.
- **Neutral wording on discovery prompts.** Do not praise, hint, or name the brand
  you want to be found for.
- **Freeze and version.** Once a set is live, hold it stable. A trend line across
  a changed population is not a trend line. If you must evolve the set, add on a
  stated date and treat the two periods as two series rather than one trend.

## Buying questions versus informational questions

These shapes measure different things, and the distinction is easy to miss.

**A buying question** ("best AI visibility tracker") makes the model name a
specific product in nearly every run. It measures your recommendation rate.

**An informational question** ("how do I get my site cited in ChatGPT") usually
makes the model name nobody but cite sources almost every run. It measures
whether your content gets picked up.

A set of only buying questions hides your citation problem. A set of only
informational questions hides whether you get recommended. Include both and read
them separately, because the fixes differ. Recommendation gaps need authority and
comparison coverage. Citation gaps need crawlable facts, structured data, and
extractable answer blocks.

## Where prompts come from

In priority order. Do not skip to inventing questions.

1. **Your own search data.** Export unbranded queries and rewrite each as a
   conversational question. This is proven demand, already filtered for you.
2. **Frontier models themselves.** Ask the models people actually use what real
   users ask about the topic. This surfaces intent before it reaches a keyword
   tool.
3. **People Also Ask and autocomplete.** Real aggregated queries, already phrased
   the way humans phrase them.
4. **Competitor pages.** The businesses ranking and getting cited for your topics
   have, in effect, published a validated question list. Read the pages that beat
   you and extract the questions they answer.
5. **First-party voice.** Sales calls, support tickets, on-site search, reviews,
   community forums. No competitor has this, and for objection prompts it beats
   anything you can infer.
6. **Query fan-out.** Run a few starter prompts and collect the follow-up
   questions the model generates. Those are the model's own prediction of what a
   user wants to ask next, already phrased naturally.
7. **Reddit and forums.** Heavily represented in model training data, so
   Reddit-style phrasing is phrasing models are unusually well tuned to.

## Calibration: know what normal is

Do not report a rate without a baseline. Absolute numbers mean nothing out of
context.

The same 102,025-response study reports a clear brand-stature ladder in first-run
visibility, restricted to unbranded category prompts:

| Tier | Brands | Unbranded visibility | 95% CI |
| --- | --- | --- | --- |
| Global household names | 11 | 72.9% | 60.1-84.2% |
| Established mid-market and regional | 36 | 43.6% | 36.4-50.9% |
| Niche and small brands | 55 | 11.4% | 4.2-20.3% |

About 30 points per step, significant at p<0.001 with Cohen's d above 1.3.

Read that table with its own caveats, which the authors state: it is a
single-author preprint, not peer reviewed, the author is affiliated with a
commercial measurement tool, the data is that tool's own production database,
and the cohort is convenience-sampled from four verticals with no claim to
category representativeness. Read the shape of the gap, not the absolute rates.
A different vendor measuring a different market will report different numbers.

The part that survives the caveats is the practical one: **a niche brand at 11%
to 15% is at the expected baseline, not failing.** Before treating a number as a
problem, establish what comparable brands actually get.

Three more findings from that dataset, carrying the same caveats:

- The ranked "best-of" listicle is the most-cited page format, at about 21% of
  all citations. If you publish no ranked lists, you are leaving the
  highest-yield citation format available to you.
- Sentiment framing flips about 6.7 times more often than mention does. Do not
  build a target, a cadence, or a decision on sentiment movement. Mention is the
  stable signal.
- About 78% of citations went to corporate websites, but only 2.9% pointed back
  to the tracked brand's own domain, while 75.2% went to third-party brand pages
  such as a competitor's site or a business directory. Treat that as a question
  to check in your own data rather than a settled fact, because citation
  extraction differs between tools. If it holds for you, the implication is that
  being cited usually means being cited by someone else, and the lever is
  third-party authority rather than more messaging on your own site.

When a brand *is* mentioned, watch the gap between mention rate and citation
rate. High mention with near-zero own-domain citation means the model knows the
name and will not retrieve the site, which is an extractability problem rather
than an awareness problem.

## Budget for how little a single cycle can show

Set expectations before you read your first month.

An open-source probe that sends 20 buyer-intent prompts to a provider 5 times
each reports the smallest change its own design can distinguish from sampling
noise as 21 to 35 percentage points, at conventional significance and power,
raising the floor to about 33 points if the threshold has to read in both
directions. Those are design calculations for that probe's budget rather than
universal constants, but they are the right order of magnitude to assume: in a
small prompt set, a swing of a few points is noise, and buying more repeats of
the same prompts barely moves the floor.

Two practical consequences:

- Run for a full cycle before reading anything. A month of answers is the
  minimum that says something, and it is still thin.
- Prefer changes you can see in several prompts at once over changes in one
  prompt. One prompt moving is the paraphrase variance from the section above.

## Workflow

1. **Establish the brand's attributes.** What should it be known for? Attributes
   drive which prompts matter. Get this wrong and you generate data with no
   strategy to read it against.
2. **Enumerate the buying territory.** Segments, use cases, constraints,
   objections, geography, price posture.
3. **Build the core set.** Discovery and use-case first, then comparison, then a
   small brand-defining slice.
4. **Cluster.** Group into attributes, add phrasings, mark which prompt speaks
   for which attribute.
5. **Label every prompt** with its cohort, type, attribute, funnel stage, and
   persona. This is what makes the set auditable later.
6. **Run and baseline.** A full cycle minimum.
7. **Read by cohort, never blended.** Unbranded visibility is the headline.
   The branded cohort is a separate accuracy and framing report. Buying and
   informational questions separately.
8. **Iterate on gaps, not on noise.** Act where you are consistently invisible on
   an attribute you could credibly serve. Leave small swings alone.

## Auditing an existing set

Work through these in order. Most sets fail at the first two.

1. **Are cohorts separable in reporting?** If the tool pools branded into
   discovery, the headline is uninterpretable. Fix reporting before changing the
   set.
2. **Compute the branded share and judge it against the two jobs.** Too much and
   the headline is carrying self-reference. Too little and you have no accuracy,
   framing, or objection data at all. There is no published target share, so
   judge it on what the unbranded half can still answer: if you could delete
   every branded prompt and lose nothing you report, the branded side is too
   small.
3. **Split into unbranded, competitor-named, and brand-named**, and report each
   separately.
4. **Map every prompt to a funnel stage.** Look for the stages with no coverage.
5. **Map every prompt to a persona.** Count how many carry a real constraint. One
   or two in a set of thirty is effectively none, and the measured persona effect
   above says that is leaving a real effect unread.
6. **Group into attributes.** Any attribute with a single prompt is unmeasured.
7. **Classify wording.** Count the analyst-voiced prompts among your
   zero-visibility prompts. If the failures cluster stylistically, the fix is
   rewriting, not new content.
8. **Check competitor coverage.** Each tracked competitor needs its own
   alternative, head-to-head, and differentiator prompts, or you cannot read
   share of voice against them.
9. **Check for near-duplicates**, and for prompts retired for the wrong reason.
   Never delete buyer-journey coverage to hit a prompt count. Segregate it.
10. **Verify new prompts have aged.** Anything added recently has no baseline. Do
    not judge it.

## Anti-patterns

- Pooling brand-named prompts into a discovery score
- Reporting one rate with no cohort label and no baseline
- A single prompt per attribute, then concluding the attribute does not work
- A blended persona average hiding which segment you lose
- Deleting buyer-moment prompts to hit a prompt count instead of segregating them
- A set that is all "best X" prompts
- Inventing questions from internal taxonomy instead of mining real sources
- Reading sentiment movement as a trend
- Judging a prompt in its first cycle
- Reordering the set mid-cycle and calling the change a trend
- Acting on a few-point move in a small prompt set

## Output format for a drafted set

Deliver a table plus per-prompt reasoning. Columns: \`prompt\`, \`cohort\`,
\`type\`, \`attribute\`, \`funnel stage\`, \`persona\`, \`wording note\`, \`action\`.

Then state explicitly:

- Cohort counts and the branded share
- Which funnel stages and personas are covered, and which are not
- Every attribute with only one prompt, as a coverage gap
- Which prompts are variants of which attribute
- What to retire, and where each retired prompt should go instead
- The cadence: how long to run before the set can be read

**Reasoning per prompt is mandatory.** A set without a stated rationale per row
cannot be reviewed, and an unreviewable set accumulates cruft. Where a prompt
exists to answer a specific question, say which question, and which result would
change a decision.

## What refd does, and what you still do by hand

The discipline above is not vendor-specific. This section is specific to refd, and
it is split honestly into the two halves.

### refd handles

- **Prompt cohorts.** Every prompt is classified as \`branded\` (the text names
  your brand), \`competitor\` (it names only a tracked competitor), or \`discovery\`
  (it names neither, so the rate is unprompted visibility). Classification runs
  the same alias matcher the scorer runs, so "this prompt names the brand" means
  exactly what "this answer mentions the brand" means, and a prompt naming both
  you and a rival lands in \`branded\`, which is the biased case the cohort exists
  to isolate. Rows written before the column existed are classified on the first
  read that needs it, a \`kind\` you set explicitly is never overwritten, and an
  unclassified prompt is counted rather than dropped.
- **Cohort-filtered rates.** A cohort rate is computed over that cohort's own
  answer cells, not re-weighted from the blended figure, so it is a rate for that
  cohort rather than a share of the whole. A filter that matches no prompt yields
  null rates instead of quietly falling back to the blend.
- **Labelled headlines.** Every aggregate states its own scope: either "blended
  across all prompt cohorts" or which cohort it covers, so a pooled number is
  never passed off as unprompted visibility.
- **All three cohorts at once.** \`get_visibility_overview\` returns the three
  cohorts side by side beside the blended number, always over the full prompt
  pool, and the digest carries the same three-way split. One call answers "how
  visible am I when nobody asked by name" without grouping prompt ids by hand.
- **A filtered prompt read.** \`get_prompt_performance\` takes a cohort filter and
  applies it to the prompt list, the per-surface breakdowns, and the
  zero-visibility list alike, so a prompt the filter excluded cannot leak back in
  through a different field.
- **Filtered prompt writes.** \`add_prompt\` and \`update_prompt\` classify the
  prompt they write and accept an explicit cohort override, and \`list_prompts\`
  reports each prompt's cohort alongside the per-cohort counts.
- **A starting set.** Onboarding drafts prompts spread across
  ${PROMPT_CATEGORIES.slice(0, -1).join(', ')}, and ${PROMPT_CATEGORIES.at(-1)},
  capped at five per category and steerable by total count and free-text focus.
  The generator is explicitly told that most questions must not name the brand,
  which is the cohort discipline applied at draft time. Treat the output as a
  draft to edit, not a finished set. A standard workspace holds up to
  ${STANDARD_LIMITS.maxActivePromptsPerWorkspace} active prompts and
  ${STANDARD_LIMITS.maxEnabledSurfacesPerWorkspace} of the ${SURFACES.length}
  surfaces (${SURFACES.map((id) => SURFACE_LABELS[id]).join(', ')});
  administrator accounts are not capped.
- **A cohort control in the dashboard.** The Overview page has a cohort picker
  that narrows the whole page, and the Prompts table shows each prompt's cohort
  inline where a row can read near 100% while the workspace average does not.
- **Frozen sets.** A run records the prompt ids and exact texts it will use, plus
  the tracked entity set, before collection starts. Editing a prompt while a run
  is in flight cannot change what that run measures.
- **Set-change detection.** Share of voice, position, and competitor comparisons
  pause automatically when the tracked competitor set changed anywhere inside
  the compared span, because those metrics are relative to that set. Trend charts
  mark the break.
- **Shared-cell comparison.** Two periods are compared only over the cells, one
  prompt on one surface, that both actually answered. A partial run cannot
  manufacture a change.
- **Noise floors.** refd needs at least 4 shared cells before it reports any change
  at all, and at least 3 positioned or classified mentions before it reports a
  position or sentiment change. Thresholds are stated in the glossary and
  calibrated to seven-day windows rather than single runs, because at one sample
  per cell a day-to-day comparison is mostly sampling wobble: 5 points on mention
  and citation rates, 4 points on share of voice, 5 points on sentiment shares,
  and a quarter of a rank on position.
- **Prompt retirement without deletion.** A prompt with history is deactivated
  and keeps its past results, then can be reactivated.
- **Independent mention and citation.** They are stored and reported separately,
  and an answer can carry either, both, or neither.
- **A valid empty result.** A Google query that returns no AI Overview is recorded
  as a valid observation, not a failed fetch, and coverage counts it.
- **Named versus unnamed, as a standing signal.** The Home agent raises it as a
  suggestion when visibility on brand-named prompts leads visibility on prompts
  that do not name the brand by 20 points, which is where a headline starts being
  carried by self-reference.
- **Sentiment discipline.** Classification runs on a queue hop after the answer is
  stored. Unclassified mentions are excluded from the distribution rather than
  counted as neutral, and a pending classification is shown as pending.

### Reading a cohort safely through the API

\`get_visibility_overview\`, \`get_competitor_landscape\`, \`get_citation_sources\`,
and \`get_prompt_performance\` all accept a cohort filter and apply it to
everything they return.

The digest does not, on purpose. It is a whole-workspace rollup that already
carries all three cohorts side by side, so it has no cohort argument to get
wrong. To read one cohort from the digest, read \`sections.prompts.cohorts\`.

Whichever route you take, read the cohort out of the response rather than
assuming the label: \`headlineScope\` on an aggregate, and the per-cohort rates
inside \`byCohort\` or \`sections.prompts.cohorts\`.

### You still do by hand

- **Versioning.** A run records which prompt ids and texts it froze, and refd can
  tell you which prompts entered or exited between two runs, but there is no
  prompt-set revision number and no way to filter history by set version. Keep
  your own set version and the dates you changed it. Note also that a cohort
  filter over historical answers reads each prompt's current cohort, not the one
  it had when the answers were collected, because the run freeze covers prompt
  text and nothing else.
- **Funnel and persona coverage.** refd measures the prompts you give it. It does
  not tell you which funnel stages or personas your set is missing, whether two
  prompts cover the same intent, or whether one prompt is carrying an attribute
  alone. That audit is a spreadsheet, and the checklist above is the audit.
- **Persona reading.** If you sell to more than one segment, you write the
  per-persona prompts and you read the per-persona results yourself. Nothing in
  the product segments results by persona.
- **Category rollups.** Prompt categories are stored on every prompt and the
  dashboard can filter the prompt table by them, but no aggregate is computed per
  category anywhere. Rolling rates up by category is a join you have to make.
- **The three-cohort breakdown on a screen.** The dashboard filters to one cohort
  and shows each prompt's cohort, but it does not display the three cohorts side by
  side, and it does not show the scope label the API attaches to a headline. For
  both, read \`byCohort\` or the digest.

The rule that survives all of this: prefer a platform change over a prompt change
when a metric is being misread. Deleting prompts to compensate for a reporting
gap destroys exactly the data that segmentation would have preserved.

## Sources

Every empirical claim above traces to one of these. Vendor-affiliated and
preprint work is labelled as such, with the authors' own stated limits, and is
never presented as a settled market-wide rate.

- \`https://arxiv.org/abs/2606.20065\`: *Generative Engine Optimization at
  Scale: Measuring Brand Visibility Across AI Search Engines.* 102,025 prompt
  responses, 102 brands, 3,508 runs, 149,912 citations, five engines, March to
  May 2026. Source for the branded versus unbranded recognition table, the
  stature ladder, the 21% listicle citation share, the 78% / 2.9% / 75.2% citation
  breakdown, and the 6.7x sentiment volatility. Single-author preprint, not peer
  reviewed, author-affiliated with a commercial measurement tool, convenience
  sample, authors state no category representativeness.
- \`https://arxiv.org/abs/2605.27440\`: *Paraphrase Brittleness in Production
  Retrieval-Augmented Commercial Recommendation.* Roughly 6,000 paraphrase runs
  and 6,000 same-prompt rerun controls on OpenAI and Anthropic models. Source for
  the Jaccard table and the conclusion that prompt-by-prompt tracking is
  structurally unstable.
- \`https://arxiv.org/abs/2605.30207\`: *Persona Conditioning of Brand
  Recommendations in Retrieval-Augmented Commercial Chat.* 2,000 runs, 10
  personas, 8 prompts, 3 model configurations, 10 repetitions. Source for the
  persona effect sizes and the prominence stratification.
- \`https://arxiv.org/abs/2607.13304\`: *Where Does the Noise Come From? A
  Variance-Components Decomposition of Non-Determinism in LLM Brand Answers.*
  12,933 responses, 20 brands, 8 languages, 3 models. Source for the 26.5%
  language variance share and the near-zero brand-by-prompt term.
- \`https://arxiv.org/abs/2410.02185\`: *POSIX: A Prompt Sensitivity Index for
  Large Language Models.* Source for paraphrasing being the highest-sensitivity
  axis in open-ended generation.
- \`https://github.com/chirag23177/geo-probe\`: open-source probe reporting a
  minimum detectable effect of 21 to 35 percentage points at 20 prompts and 5
  repetitions. A design calculation for one budget, not a constant.
- \`https://arxiv.org/abs/2311.09735\`: Aggarwal et al., *GEO: Generative Engine
  Optimization*, KDD 2024. The peer-reviewed entry point for the field, cited by
  the work above.

For the platform-specific claims, see the companion skill for the refd MCP
server at \`https://refd.ai/skills/refd/SKILL.md\`, and the metric definitions
refd itself reports at \`https://refd.ai/glossary\`.
`;
