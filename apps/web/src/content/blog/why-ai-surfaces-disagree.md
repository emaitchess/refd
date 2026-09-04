---
title: "Why AI surfaces disagree about your brand"
description: "The same question, asked across five AI answer surfaces, routinely produces five different sets of recommended companies. That disagreement is usable information."
eyebrow: "Surface guide"
answer: "Different AI answer surfaces use different retrieval systems, different underlying models, different answer formats, and different amounts of model memory versus live search. A brand strong on one surface and absent on another is the normal case, not an anomaly. The pattern of disagreement tells you which lever moves your visibility, which is more actionable than any single blended score."
publishedAt: 2026-09-04
author:
  name: "Mohammad Hamza Suhail"
  url: "https://emaitchess.com"
order: 24
draft: false
related:
  - href: "/trackers"
    title: "The five AI answer surfaces"
    description: "How refd tracks ChatGPT, Perplexity, Gemini, Google AI Mode, and Google AI Overviews as separate surfaces."
  - href: "/blog/ai-mentions-vs-citations"
    title: "AI mentions and AI citations are not the same metric"
    description: "The four states the two signals produce, and why each requires a different response."
  - href: "/blog/one-answer-is-not-a-measurement"
    title: "Why one AI answer is not a reliable measurement"
    description: "AI answers change between runs. The comparison rules that stop noise being reported as change."
  - href: "/methodology"
    title: "How refd measures AI search visibility"
    description: "Collection, sampling, scoring, and the limits refd states openly."
---

Ask five AI answer surfaces the same buyer question and you will often get five
different sets of recommended companies. People treat this as a problem with the
measurement. It is the most useful thing the measurement produces.

## Four reasons they disagree

**Different retrieval.** Perplexity, ChatGPT with search, AI Mode, and AI
Overviews each decide what to fetch using different systems. They are not
querying one shared index and formatting it differently.

**Different memory-to-search ratio.** Some surfaces lean on what the model
already associates with a category; others lean on pages fetched at answer time.
Model association reflects years of accumulated coverage. Retrieval reflects
what ranked this morning.

**Different answer formats.** A compressed AI Overview names two or three
companies. A thorough Gemini answer names ten. Mention rate is not comparable
across those without accounting for how many slots the format offers.

**Different underlying models.** Each surface's model has its own training data
and its own tendencies about which categories it will name specific vendors in
at all.

## Reading the pattern

The disagreement is diagnostic. A few patterns and what they usually mean:

| Pattern | Likely mechanism | Where to work |
|---|---|---|
| Strong on retrieval-heavy surfaces, weak on memory-heavy ones | Your pages rank; your brand is not yet an association | Third-party coverage, over months |
| Strong on memory-heavy surfaces, weak on retrieval-heavy ones | Reputation exists; current pages do not rank | Specific pages for specific queries |
| Strong everywhere except AI Overviews | The queries may not trigger Overviews at all | Check trigger rate before assuming absence |
| Cited widely, named rarely, across all surfaces | Your content explains; it does not position | Rewrite to make the brand a candidate answer |
| Strong on one surface only | Usually one third-party page doing the work | Find it; it is fragile |

None of these are visible in a single blended visibility score. They only appear
when surfaces are kept separate and mentions are kept separate from citations.

## Do not average them

Two reasons an average is worse than useless here.

It **hides the mechanism.** A brand at 60% on two surfaces and 20% on three
averages to roughly the same number as one at 40% everywhere. Those two brands
need completely different work.

It **weights by nothing meaningful.** Averaging implies the surfaces matter
equally to your buyers, which is unlikely and, more importantly, unmeasured. If
your buyers use ChatGPT and Perplexity, an AI Overviews figure diluting your
headline number is noise.

Report per surface. If leadership wants one number, give them one surface's
number and say why that surface was chosen.

## What stays comparable

Some things do compare cleanly across surfaces, provided the comparison is built
carefully:

- **Your trend on a single surface over time.** The most reliable comparison
  available.
- **You versus a competitor on the same surface, same prompts, same run.** Both
  saw identical conditions.
- **Citation gaps.** A competitor's domain cited where yours is not is a concrete
  finding on any surface.

What does not compare cleanly is your mention rate on one surface against your
mention rate on another, because the answer formats differ. Comparing them can
be done, but only as "we are named in 3 of 5 slots here and 1 of 10 there," which
is a different statement from "60% versus 10%."

## The measurement discipline underneath

Cross-surface comparison only survives if the runs being compared share a basis.
Compare only the prompt and surface combinations both runs actually covered, and
suppress set-relative metrics like share of voice when the tracked competitor set
changed between them. Without those two rules, a partial run manufactures a
dramatic cross-surface story that never happened.
