---
title: "Gemini visibility tracker with repeated answers"
description: "Measure Gemini brand mentions, citations, competitor position, sentiment, and answer evidence across a stable set of buyer questions."
eyebrow: "Gemini tracking"
answer: "refd tracks a fixed set of buyer questions in Gemini on each scheduled run and scores the returned answer text and source URLs. It shows how often the brand appears, whether its domain is cited, who is named first, how the brand is described, and which evidence supports every aggregate."
layout: "surface"
surface:
  key: "gemini"
  label: "Gemini"
  collection: "Tracked by refd"
  sampling: "One sample per prompt and run"
  metrics:
    - label: "Mention rate"
      value: "61.0%"
      detail: "Ultrahuman in answered sample cells"
    - label: "Citation rate"
      value: "27.0%"
      detail: "Answers citing ultrahuman.com"
    - label: "Average position"
      value: "#2.0"
      detail: "Conditional on a brand mention"
    - label: "Samples per cell"
      value: "1"
      detail: "One observation per run"
  samplePrompt: "What are the best smart rings without a subscription?"
  sampleSignal: "Mentioned · cited · position 1"
  sampleFinding: "The answer leads with Ultrahuman and RingConn, then distinguishes the brands by recovery experience, price, and battery life."
  limitation: "Gemini does not expose sources for every response, and its decision to use web search can vary with the prompt and product behavior."
publishedAt: 2026-07-30
updatedAt: 2026-08-02
author:
  name: "Mohammad Hamza Suhail"
  url: "https://emaitchess.com"
order: 32
related:
  - href: "/trackers"
    title: "AI surface trackers"
    description: "Compare how refd measures ChatGPT, Perplexity, Gemini, Google AI Mode, and Google AI Overviews."
  - href: "/demo"
    title: "Interactive sample report"
    description: "Explore the fabricated Ultrahuman workspace, prompt results, citations, competitors, and answer evidence."
  - href: "/methodology"
    title: "Measurement methodology"
    description: "Review scheduled collection, scoring, aggregation, and the limits of every metric."
  - href: "/google-ai-mode-tracker"
    title: "Google AI Mode tracker"
    description: "Measure Google's conversational Search surface separately from the standalone Gemini app."
---

Gemini is a distinct answer surface from Google AI Mode and Google AI
Overviews. They can use related Google technology, but they are different
products with different interfaces, retrieval behavior, and source
presentation. refd therefore measures them separately.

The Gemini tracker answers a narrow business question: when your selected buyer
questions are asked, does Gemini name your brand, cite your domain, place a
competitor first, and describe the brand in a way that can be audited?

## What Gemini visibility means

[Google's Gemini Apps documentation](https://support.google.com/gemini/answer/14143489?hl=en)
states that Gemini may show sources and related content within or below a
response. It also states that not every response includes source links.

That is why refd reports both citation rate and source coverage. A Gemini answer
without a source URL can still be scored for visible brand mentions, position,
prominence, and sentiment. It should not be presented as a cited answer.

## What refd measures on Gemini

| Signal | What it tells you |
| --- | --- |
| Mention rate | How often Gemini names the brand in eligible answers |
| Citation rate | How often a returned source URL belongs to a tracked brand or competitor |
| Average position | Which tracked entity is named first, second, or later when it appears |
| Share of voice | How the brand's presence compares with the configured competitor set |
| Prominence | Whether the strongest mention is in the lead, body, or a list |
| Sentiment | Whether the context around a mention is positive, neutral, or negative |
| Source coverage | How often Gemini answers in the selected range expose at least one URL |

Position is conditional on a mention. An absent brand has no position, because
mention rate already represents absence. This avoids inventing an arbitrary
rank penalty.

## Read the illustrative result

The fabricated sample asks for smart rings without a subscription. Gemini names
Ultrahuman first and cites the brand domain. It also mentions RingConn and Oura,
giving the user a compact competitive comparison.

The evidence reveals why the answer matters:

- Ultrahuman is associated with the subscription-free requirement.
- It appears before the other tracked brands.
- The brand's own domain contributes source evidence.
- The answer differentiates competitors using recovery experience, price,
  battery life, and software maturity.

The aggregate mention rate alone cannot explain those associations. refd keeps
the prompt, answer, position, sentiment, and URLs connected so the result can be
reviewed instead of guessed from a score.

## Track associations, not just appearances

For Gemini, useful buyer questions often expose the attributes attached to each
brand:

- Best product for a specific use case.
- Products with or without a particular pricing model.
- Alternatives to a known category leader.
- Best option for a company size, region, or technical requirement.
- Tradeoffs between two named products.
- Requirements a buyer should evaluate before choosing.

A mention can still be strategically weak if the answer attaches the brand to
the wrong audience, an outdated limitation, or a secondary position. Review
the prose and source evidence before deciding that a high mention rate is a
positive outcome.

## Compare Gemini with the Google Search surfaces

Do not merge Gemini, Google AI Mode, and Google AI Overviews into one "Google"
metric. refd tracks each as a separate surface, and a Google AI Overview may be
absent for a successful query.

The same prompt can produce different brands, sources, and wording on each
surface. That difference is useful. It shows where a brand's visibility is
strong, weak, or dependent on one answer environment.

## Limitations

Gemini responses are non-deterministic. Source availability, whether web search
is used, location, prompt wording, product updates, and collection time can
change the output.

Each scheduled run records one observation and does not capture every answer a
user could receive. refd records the tracked result for the configured country
and time. It does not control Gemini's retrieval decision or claim that a
missing source URL means the answer had no outside influence.

## Frequently asked questions

### Is Gemini the same surface as Google AI Mode?

No. refd tracks Gemini and Google AI Mode separately because they are distinct
products and can return different answers and sources.

### Does every Gemini answer contain citations?

No. Google's help documentation says sources and related links are not present
for every response. refd reports only URLs returned in the collected evidence.

### What happens when Gemini names a brand without citing it?

The result contributes to mention rate, position, prominence, sentiment, and
mention share of voice. It contributes zero to that brand's citation rate for
the answer.

## Sources reviewed

- [View related sources from Gemini Apps, Google](https://support.google.com/gemini/answer/14143489?hl=en)
- [How refd measures AI search visibility](/methodology)

External product behavior was reviewed on 30 July 2026. The refd collection and
metric descriptions match the open-source implementation on that date.
