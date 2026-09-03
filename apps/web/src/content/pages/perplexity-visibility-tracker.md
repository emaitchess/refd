---
title: "Perplexity visibility and citation tracker"
description: "Track brand mentions, cited domains, competitor position, and the answer evidence returned for your buyer questions in Perplexity."
eyebrow: "Perplexity tracking"
answer: "refd tracks a fixed set of buyer questions in Perplexity on each scheduled run, records the returned answer and source URLs, and measures brand mentions, citations, competitor position, sentiment, prominence, and share of voice. Source-rich answers make citation gaps especially useful, but every citation remains separate from a visible brand mention."
layout: "surface"
surface:
  key: "perplexity"
  label: "Perplexity"
  collection: "Tracked by refd"
  sampling: "One sample per prompt and run"
  metrics:
    - label: "Mention rate"
      value: "75.0%"
      detail: "Ultrahuman in answered sample cells"
    - label: "Citation rate"
      value: "61.0%"
      detail: "Answers citing ultrahuman.com"
    - label: "Average position"
      value: "#1.5"
      detail: "Conditional on a brand mention"
    - label: "Samples per cell"
      value: "1"
      detail: "One observation per run"
  samplePrompt: "Which wearable is best for metabolic health insights?"
  sampleSignal: "Mentioned · cited · position 1"
  sampleFinding: "The answer leads with Ultrahuman, connects the brand to metabolic context, and cites the brand domain."
  limitation: "Perplexity answers and sources can vary by search mode, selected model, location, product changes, and collection time."
publishedAt: 2026-07-30
updatedAt: 2026-08-02
author:
  name: "Mohammad Hamza Suhail"
  url: "https://emaitchess.com"
order: 31
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
  - href: "/chatgpt-visibility-tracker"
    title: "ChatGPT visibility tracker"
    description: "Track web-search-enabled ChatGPT answers with separate mention, citation, and position evidence."
---

Perplexity is built around direct answers with linked sources. That makes it a
useful surface for understanding both sides of brand visibility: which
companies are named in the response and which domains supply the evidence.

refd keeps those signals separate. A source can influence an answer without
the source owner's brand being named, and a brand can be discussed without its
own domain being cited.

## What Perplexity visibility means

[Perplexity's current product documentation](https://www.perplexity.ai/help-center/en/articles/10352155-what-is-perplexity)
describes the service as an AI-powered search engine that searches the web,
produces conversational answers, and links to original sources. Perplexity also
offers several search modes and, for some plans, a choice of underlying model.

refd tracks the configured buyer questions in Perplexity and records the
visible answer text and source URLs returned with each answer. The tracked
brand receives citation credit only when a normalized URL matches one of its
confirmed domains.

refd does not infer ownership from a page title, guess a brand from an opaque
redirect, or count a source-card title as a visible mention.

## What refd measures on Perplexity

| Signal | What it tells you |
| --- | --- |
| Mention rate | How often Perplexity names the brand in answered prompt and sample cells |
| Citation rate | How often a returned source URL belongs to the brand |
| Average position | Where the brand is first named relative to tracked competitors |
| Share of voice | The brand's share of tracked-entity mentions or citations |
| Source domains | Which owned and third-party domains support relevant answers |
| Prominence | Whether the strongest mention is in the lead, body, or a list |
| Sentiment | How the answer describes the brand when it is mentioned |

Mention rate and citation rate use the same eligible answer set and equal cell
weighting. An answered result with no brand citation remains a zero for citation
visibility. Review the [methodology](/methodology) for the exact denominator and
URL normalization rules.

## Read the illustrative result

The fabricated sample asks which wearable is best for metabolic health
insights. Perplexity names Ultrahuman first, connects the product to metabolic
context, and cites ultrahuman.com.

The answer is valuable for more than a positive tile:

- Position 1 shows that Ultrahuman led the tracked competitive set.
- The brand-domain citation shows direct source visibility.
- Other cited domains show which adjacent products or publishers shaped the
  response.
- The raw prose explains which attributes created the recommendation.

If the citation disappeared in a later run while the mention remained, that
would be a source change rather than a loss of all visibility. refd preserves
both signals so the difference remains visible.

## Use source gaps as research input

Perplexity source gaps are domains cited on relevant answers where your brand
was neither mentioned nor cited. They can reveal:

- Comparison pages that define the category.
- Publisher reviews that support competitor recommendations.
- Documentation pages used to explain technical criteria.
- Community discussions that supply first-hand experience.
- Competitor pages that own a specific attribute or use case.

A source gap is not an instruction to copy or manipulate a page. Read the
source, understand why it was relevant, and decide whether your own product,
documentation, evidence, or positioning leaves a genuine information gap.

## Build a Perplexity prompt set

Include questions from several buyer stages:

1. Discovery questions that describe the problem without naming a vendor.
2. Category comparisons that ask for a shortlist.
3. Alternative questions around a known competitor.
4. Evaluation questions about requirements, integrations, cost model, or
   limitations.
5. Decision questions for a specific company type or use case.

Avoid filling the set with slight rewrites of one keyword. A broad but stable
question set produces a more useful picture of what Perplexity says across the
buyer journey.

## Limitations

Perplexity answers can change between identical prompts. Search mode, selected
model, available sources, location, session context, and product updates may
affect both prose and citations. The hosted tracker records a defined
observation, not every possible Perplexity experience.

Although Perplexity describes its answers as cited, refd reports only the
source URLs actually returned with the answer. A missing URL remains missing
evidence. refd never manufactures a citation to make the result look complete.

## Frequently asked questions

### Does refd count every Perplexity source as a brand citation?

No. A source is attributed to a brand only when its normalized hostname matches
a confirmed domain for that tracked entity. Other URLs remain third-party
sources.

### Why can citation rate differ from mention rate?

The answer might name a brand but cite a publisher, or it might cite a brand
page without naming that brand in the visible prose. These are different
signals and should not be collapsed.

### Does refd control which Perplexity model produces the answer?

No. Model selection is not a workspace control. refd records the tracked result
and does not claim that one observation represents every Perplexity mode or
plan.

## Sources reviewed

- [What is Perplexity?, Perplexity Help Center](https://www.perplexity.ai/help-center/en/articles/10352155-what-is-perplexity)
- [How refd measures AI search visibility](/methodology)

External product behavior was reviewed on 30 July 2026. The refd collection and
metric descriptions match the open-source implementation on that date.
