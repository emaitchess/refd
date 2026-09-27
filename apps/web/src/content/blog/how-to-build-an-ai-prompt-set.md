---
title: "How to build a prompt set for AI search monitoring"
description: "Your prompt set is the measurement instrument. Choose it badly and every number downstream describes a market you do not sell into."
eyebrow: "Playbook"
answer: "A prompt set is the fixed list of buyer questions an AI visibility tool asks on every run. Twenty to thirty questions, written the way buyers actually phrase them, spread across discovery, comparison, and decision stages, brand-named prompts kept out of the headline number, and then held constant. The set defines what every downstream metric means, so changing it mid-campaign destroys the comparison that makes the metrics worth having."
publishedAt: 2026-09-04
updatedAt: 2026-09-27
author:
  name: "Mohammad Hamza Suhail"
  url: "https://emaitchess.com"
order: 14
draft: false
related:
  - href: "/skills/ai-prompt-set-design/SKILL.md"
    title: "The full prompt set design skill"
    description: "The installable method this article summarises: cohort rules, prompt types, persona segmentation, intent clusters, wording rules, calibration, and a ten-point audit."
  - href: "/blog/one-answer-is-not-a-measurement"
    title: "Why one AI answer is not a reliable measurement"
    description: "AI answers change between runs. The comparison rules that stop noise being reported as change."
  - href: "/blog/what-is-ai-search-monitoring"
    title: "What is AI search monitoring?"
    description: "The category definition, the five signals worth separating, and how to evaluate a tool."
  - href: "/methodology"
    title: "How refd measures AI search visibility"
    description: "Collection, sampling, scoring, and the limits refd states openly."
---

Everything an AI visibility tool reports is a statement about the questions you
told it to ask. Get the prompt set wrong and the dashboard is precise about the
wrong market.

This is the highest-leverage hour in the whole setup, and it is usually rushed.
The full method is published as an installable skill at
[refd.ai/skills/ai-prompt-set-design/SKILL.md](/skills/ai-prompt-set-design/SKILL.md),
which works with any monitoring tool or with a spreadsheet. This article is the
short version, with the evidence behind the parts that used to be rules of
thumb.

## Never pool brand-named prompts into the headline

This is the rule that outranks everything else, and it is now measurable rather
than a matter of opinion.

A prompt that names your brand hands you the mention. Pool those prompts into a
discovery or share-of-voice figure and you are reporting something you already
knew, while calling it a measurement.

A 2026 preprint
([arXiv 2606.20065](https://arxiv.org/abs/2606.20065)) of 102,025 prompt
responses across 102 brands and five AI engines split results by whether the
brand name appeared in the prompt:

| Engine | Branded prompts | Unbranded prompts |
| --- | --- | --- |
| ChatGPT | 94.2% | 22.1% |
| Gemini | 94.0% | 18.7% |
| Perplexity | 98.5% | 23.9% |
| Claude | 100.0% | 51.5% |
| Grok | 100.0% | 12.0% |

Branded prompts were about 9% of first-run responses and recognised the brand at
94% or better on every engine. Including them lifted the pooled per-tier figure
from 43.6% to 52.2% for mid-market brands and from 11.4% to 17.3% for small ones.
The study computes its headline result on unbranded prompts only, and explains
why in the text.

So keep two cohorts and report them separately. Unbranded prompts are your
visibility number. Brand-named prompts are an accuracy and framing report:
what the assistant says about you, how it positions you, which objections it
raises. Nothing else produces that data, so do not delete the branded prompts.
Just never let them into the discovery aggregate.

**Check this first.** If your tool cannot separate the two cohorts, the headline
is uninterpretable and no amount of prompt editing will fix it. Fix the
reporting before you touch the set.

refd implements this as five prompt cohorts: `discovery` (names neither the
brand nor a competitor, so the rate is unprompted visibility), `alternative`
(names only a tracked competitor), `brand_defining` (names your brand),
`market_perception` (about how the market sees the category), and `problem` (a
buyer's problem). The first three are derived, and classification runs the same
alias matcher the scorer runs, so "this prompt names the brand" means exactly
what "this answer mentions the brand" means. A prompt naming both you and a
rival, the classic "mrmr versus Alter" case, is classified `brand_defining`,
because that is the biased case worth isolating.

The last two are declared rather than derived, and that is a deliberate
refusal. Telling a problem-shaped question from a broad discovery one is a
judgement about buyer intent that no substring settles, so refd asks you at
setup rather than guessing at read time. It follows the rule the rest of setup
follows: ambiguity is resolved once, when the questions are written, and never
again in a read.

Two details make the model trustworthy rather than decorative. A cohort rate is
computed over that cohort's own answer cells, so it is a rate for the cohort
rather than a re-weighted share of the blended figure. And a filter that matches
no prompt returns null rates instead of quietly falling back to the blend, so a
typo cannot manufacture a healthy-looking headline.

Every aggregate then names the population it was measured over. The measures sit
inside a `headline` object that carries the cohort in `population` and the
prose in `scope`, rather than sitting at the top level where a pooled number
would read as organic visibility. And because a blended figure is not the number
a reader assumes it is, asking for no filter at all gives you the discovery
cohort rather than the blend. The blend is still available, labelled and marked
deprecated, for when you genuinely want it.

In the dashboard, a cohort picker on the Overview page narrows the whole page,
and the Prompts table shows each prompt's cohort inline, which is where you will
see a row reading near 100% while the workspace average does not.

## One prompt is not a measurement

The older advice here was that a single prompt is noisy. It is worse than noisy.

A study of roughly 6,000 paraphrase runs against roughly 6,000 same-prompt
rerun controls, on OpenAI and Anthropic models
([arXiv 2605.27440](https://arxiv.org/abs/2605.27440)), measured how much of an
answer is driven by the exact wording of the question. Scoring the overlap
between the sets of brands each answer recommends:

| Comparison | Overlap | 95% CI |
| --- | --- | --- |
| Same prompt, rerun | 0.50-0.61 | baseline |
| Two paraphrases of one intent | 0.288 | 0.215-0.361 |
| Paraphrase that adds a constraint | 0.135 | 0.098-0.175 |

Paraphrasing the same buying intent moves the answer *further* than rerunning the
identical prompt does. The wording is the dominant input to which brands
surface, ahead of the intent behind it. The authors conclude that tracking
mentions prompt by prompt is structurally unstable as a unit of measurement, and
that the fix is a different unit rather than a bigger list.

The practical consequence: **treat one buyer intent as an attribute, not as a
prompt.** Write three to five phrasings per intent, score them together, and read
at the attribute level. The individual prompts do the measuring. The cluster
holds the read you act on.

One honest nuance from the same literature. A separate variance decomposition
([arXiv 2607.13304](https://arxiv.org/abs/2607.13304)) found brand-by-prompt
interaction to be close to zero once other terms were removed, so a brand's
relative standing is fairly stable across paraphrases even while the set of
recommended brands is not. Expect rewording to reshuffle who appears in the
answer, and expect it to move your own rank far less. Read clusters for reach,
not for position.

## Personas are not optional, and the effect is measured

The most commonly skipped discipline is separating prompts by buyer, and it is
the one with the largest published effect.

An audit of 2,000 runs across 10 personas, 8 prompts, 3 model configurations,
and 10 repetitions per cell
([arXiv 2605.30207](https://arxiv.org/abs/2605.30207)) asked the same question
of different buyers. Prefixing the question with a persona dropped the overlap
between recommended brand sets by 0.12 to 0.20 against a within-persona
baseline, with clustered 95% confidence intervals excluding zero on all three
model cells.

The effect was stratified by how established the brand is. Category leaders held
80% same-brand consistency as the persona changed. Mid-market brands swapped up
to 75% of their recommendation set.

The conclusion is the rule: any measurement of AI brand perception has to
condition on the persona supplying the query, because a protocol that averages
across personas systematically hides that variation. A single blended number
across two audiences is a number about nobody.

For every broad category prompt, add one variant per priority persona, and make
the constraint real. "Best voice tool" is not a segment. "Best Mac voice
automation app for software developers who live in the terminal" is.

## Write prompts, not keywords

People type three words into Google and full sentences into an assistant. A
prompt set built from keyword exports measures something real, but it is not
what your buyers are doing.

Wrong: `project management software`

Right: `What project management tool should a 15-person design agency use?`

The second gives the model enough to make a specific recommendation, which is
what you are trying to measure. The first invites a generic listicle.

The same logic kills third-person analyst phrasing, which is the most reliable
predictor of zero visibility in a mature set:

- Fails: "What level of offline or on-device processing do voice assistants offer
  for privacy?"
- Works: "Can I use a voice assistant without my recordings going to the cloud?"

One is a specification question. The other is a person protecting something they
care about. Buyers ask the second.

## Include buying questions and informational questions

These measure different things and the distinction is easy to miss.

A buying question ("best AI visibility tracker") makes the model name a specific
product in nearly every run. It measures your recommendation rate.

An informational question ("how do I get my site cited in ChatGPT") usually makes
the model name nobody but cite sources almost every run. It measures whether your
content gets picked up.

A set of only buying questions hides your citation problem. A set of only
informational questions hides whether you get recommended. Include both and read
them separately, because the fixes differ: recommendation gaps need authority
and comparison coverage, citation gaps need crawlable facts and extractable
answer blocks.

## Cover the stages, not just the money question

The temptation is to fill the set with comparison questions, because those feel
closest to revenue. A set weighted entirely to one stage tells you about one
moment in a buying process.

| Stage | What the buyer is doing | Roughly |
|---|---|---|
| Awareness | Does not know your category exists yet | 15-20% |
| Consideration | Building a shortlist | 35-45% |
| Evaluation | Choosing between them | 20-25% |
| Purchase | Ready now, or nearly | 10% |
| Brand-defining | Verifying you specifically | The rest |

Discovery questions matter more than they look. A brand named when someone asks
"how do I solve X" reaches buyers before a shortlist exists, and being absent
there is invisible in any comparison-stage metric.

## Include the questions you will lose

The instinct is to pick questions you already win. It produces a beautiful
dashboard that never moves and never teaches you anything.

Deliberately include:

- Questions where you expect a competitor to be named first.
- Questions about a capability you are still building.
- Questions phrased around a competitor's category framing rather than yours.

These are where change shows up first. A prompt set with no losses in it is a
vanity instrument.

## Know what normal looks like before you panic

Do not report a rate without a baseline. The same 2026 preprint reports a clear
brand-stature ladder in first-run visibility, on unbranded category prompts:

| Tier | Brands | Visibility | 95% CI |
|---|---|---|---|
| Global household names | 11 | 72.9% | 60.1-84.2% |
| Established mid-market and regional | 36 | 43.6% | 36.4-50.9% |
| Niche and small brands | 55 | 11.4% | 4.2-20.3% |

About 30 points per step, significant at p<0.001.

Read that with the study's own stated limits: it is a single-author preprint,
not peer reviewed, the author is affiliated with a commercial measurement tool,
and the cohort is convenience-sampled from four verticals with no claim to
category representativeness. Read the shape of the gap, not the absolute rates.

The part that survives the caveats is the practical one. **A niche brand at 11%
to 15% is at the expected baseline, not failing.** Before treating a number as a
problem, establish what comparable brands actually get.

Two more findings from that dataset, carrying the same caveats: the ranked
"best-of" listicle is the most-cited page format at about 21% of all citations,
and sentiment framing flips about 6.7 times more often than mention does. So do
not build a target or a decision on sentiment movement. Mention is the stable
signal.

## Size and cost

Twenty to thirty questions is right for one brand in one market. Below about
fifteen you have too few cells to read a rate against, and above roughly forty
prompts start restating each other while cost keeps rising.

Cost is real and it multiplies. Every prompt runs against every enabled surface,
on every scheduled run. Twenty-five prompts on three surfaces, daily, is 2,250
collected answers a month. On all five surfaces it is 3,750. Adding "just a few
more" prompts is a recurring cost decision, not a one-off.

If budget is tight, cut surfaces before cutting prompts. Three surfaces measured
across a representative question set beats five surfaces measured across a thin
one.

## Freeze it

The single most important operational rule: **once the set is running, stop
editing it.**

A metric computed over a changed question set is not comparable with the same
metric from last month. Add three easy questions and your mention rate rises with
no change in the world. Remove two hard ones and it rises again.

Good tools defend against this in three specific ways, and it is worth checking
yours does:

1. Each run freezes the exact prompt ids and texts it will use when it starts, so
   an edit during collection cannot change the work already in progress. refd
   also freezes the tracked competitor set, and pauses share of voice, position,
   and competitor comparisons when that set changed inside the compared span.
2. Two runs are compared only over the prompt and surface combinations present in
   both, so a partial run cannot fabricate a change.
3. Comparisons are made over seven-day windows of runs rather than between single
   days, and require a minimum number of shared cells before reporting anything.

If you must evolve the set, do it deliberately: add on a stated date, note it,
and treat the before and after as two series rather than one trend.

## A workable first draft

1. List the ten questions your sales team is actually asked. Verbatim.
2. Add five where a competitor is the obvious answer today.
3. Add five discovery questions that do not mention your category by name.
4. Add five comparison questions using the phrasings buyers use, including
   competitor names.
5. Label every prompt with its cohort, type, attribute, funnel stage, and persona.
6. Read the whole set aloud. Anything that sounds like a search query rather than
   a question gets rewritten.
7. Freeze it. Run it for a month before touching it.

Then audit it against the
[full skill](/skills/ai-prompt-set-design/SKILL.md), which has the complete
wording rules, the seven sources behind these numbers, the prompt source-mining
order, the output format for a drafted set, and a ten-point audit checklist for
a set you already have.
