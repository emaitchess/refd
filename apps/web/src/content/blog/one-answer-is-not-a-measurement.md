---
title: "Why one AI answer is not a reliable visibility measurement"
description: "AI answers change between runs. Here is what a single answer can and cannot support, and the comparison rules that stop noise being reported as change."
eyebrow: "Methodology"
answer: "AI answer surfaces are non-deterministic: the same prompt can return different text, different sources, and a different set of named brands minutes apart. A single answer is one observation, not a ranking. Reliable measurement comes from comparing completed scheduled runs over a fixed prompt set, on the prompt and surface combinations both runs actually share, with thresholds that suppress movement too small to distinguish from noise."
publishedAt: 2026-09-04
author:
  name: "Mohammad Hamza Suhail"
  url: "https://emaitchess.com"
order: 12
draft: false
related:
  - href: "/methodology"
    title: "How refd measures AI search visibility"
    description: "Collection, sampling, scoring, aggregation, and the limitations refd states openly."
  - href: "/blog/ai-mentions-vs-citations"
    title: "AI mentions and AI citations are not the same metric"
    description: "Why the two signals move independently, and the four combinations that require four different responses."
  - href: "/demo"
    title: "Inspect a live sample report"
    description: "A no-signup sample workspace showing trends across completed runs, with the raw answer behind each number."
---

Run the same prompt through ChatGPT twice and you will often get two different
answers. Different phrasing, sometimes different sources, and sometimes a
different set of brands named. Nothing broke. These systems sample from a
distribution, and the output is a draw from it.

That single fact determines what an AI visibility number can honestly claim.

## What one answer supports, and what it does not

**It supports:** an existence proof. If your brand appeared in one answer, it can
appear. If a competitor appeared, they can appear. That is genuinely useful for
a first look, and it is what a one-off check is for.

**It does not support:** a ranking, a rate, a trend, or a comparison. "We are
third for this query" is a statement about one draw. "Our mention rate fell 12
points" is meaningless without knowing how many observations produced each
figure.

The failure mode this creates is expensive. A team checks a prompt, sees a
competitor named instead of them, and reallocates a quarter of content budget on
evidence that would not survive a second check.

## Two different things people call "sampling"

These get conflated constantly, and they cost different amounts.

**Samples within a run** means asking the same prompt more than once in a single
collection cycle. It measures how variable the answer is right now. It multiplies
provider cost linearly, and every extra sample is a paid record.

**Runs over time** means asking the prompt set again on a schedule. It measures
whether anything actually changed. Cost per run is the same, and the value
compounds because each run adds a comparison point.

For most teams, runs over time is the better purchase. Variance within a moment
is interesting once. Movement across weeks is what you report.

refd's hosted scheduled collection uses one sample per prompt per run
deliberately, for exactly this reason, and builds trends from completed runs.
Additional samples remain available for a focused experiment where within-run
variance is the actual question.

## Three rules that stop noise being reported as change

Non-determinism does not only add uncertainty. It creates specific ways to
report a change that never happened. Three rules prevent the common ones.

### Compare only the cells both runs share

If one run covered thirty prompt and surface combinations and the next covered
eight because a provider failed on the rest, comparing the two totals produces a
dramatic collapse that is entirely an artifact of coverage.

The rule: compare only the prompt and surface combinations present in both runs.
A run that covered a subset can then never fabricate a change. It can only
report on what it actually observed.

### Suppress set-relative metrics when the entity set changed

Share of voice, first-mention position, and competitor comparisons are all
relative to the set of entities being tracked. Add a competitor and your share of
voice falls without anything about your visibility changing.

The rule: when the tracked entity set differs between two runs, set-relative
metrics are not comparable and should be suppressed rather than shown with a
caveat nobody reads.

### Require a floor of observations and a minimum delta

A metric computed from two observations will swing wildly. So will a percentage
point difference of three.

The rule: require a minimum number of shared observations before computing a
change at all, and a minimum size before reporting it. refd uses at least four
shared prompt and surface cells for any change, at least three positioned or
classified mentions before reporting a position or sentiment change, and
thresholds of fifteen percentage points for mention and citation rate, ten for
share of voice, twenty for sentiment shares, and one full position for rank.
Those numbers are deliberately conservative. A quiet report is more useful than
a report that cries wolf every week.

## What this means for how you report

The honest framing for a leadership update is not "we rank third in ChatGPT."
It is:

> Across 25 buyer questions and five AI answer surfaces, measured daily since
> 14 August, we were named in 38% of answers, up from 31% in the previous
> four-week period. The increase is concentrated in comparison-stage questions.
> Here are three answers where we appeared and two where a competitor did.

That version states the prompt set, the surfaces, the period, the denominator,
the direction, where the movement sits, and the evidence. It also survives being
questioned, which the first version does not.

## The auditability requirement

All of the above is only checkable if the raw answers are kept. If a scoring bug
is found six weeks later, retained raw responses mean the fix can be replayed
over history at no additional provider cost, and old numbers get corrected
rather than silently staying wrong. Without them, every historical figure is
frozen at the accuracy of the code that produced it.

That is the practical argument for auditable measurement, and it is separate
from the philosophical one. Non-deterministic inputs make errors likely. Retained
evidence makes them fixable.

## Summary

- One AI answer is an observation, not a ranking.
- Prefer more runs over time to more samples within a run.
- Compare only the prompt and surface cells two runs share.
- Suppress set-relative metrics when the entity set changed.
- Set an observation floor and a minimum delta before calling anything a change.
- Keep the raw answers, so a corrected scorer can fix the past.
