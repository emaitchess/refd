---
title: "Google AI Overview tracker with coverage evidence"
description: "Track when Google shows an AI Overview, which brands and sources appear, and the answer evidence behind mentions, citations, and position."
eyebrow: "AI Overview tracking"
answer: "refd checks a fixed set of buyer queries in Google Search, records whether an AI Overview appeared, and scores its visible text and source URLs when present. A successful query with no Overview is coverage evidence, not a failed fetch or an invented zero for mention and citation rates."
layout: "surface"
surface:
  key: "google-ai-overviews"
  label: "Google AI Overviews"
  collection: "Tracked by refd"
  sampling: "One sample per query and run"
  metrics:
    - label: "Mention rate"
      value: "52.0%"
      detail: "Ultrahuman in present Overviews"
    - label: "Citation rate"
      value: "36.0%"
      detail: "Present Overviews citing the brand"
    - label: "Average position"
      value: "#3.0"
      detail: "Conditional on a brand mention"
    - label: "Samples per cell"
      value: "1"
      detail: "Overview presence checked per run"
  samplePrompt: "Is a smart ring or fitness band better for sleep tracking?"
  sampleSignal: "Overview present · mentioned · cited · position 3"
  sampleFinding: "The Overview explains the form-factor tradeoff, then names Ultrahuman after other tracked products and cites the brand domain."
  limitation: "Google shows AI Overviews only when its systems determine they add value, so coverage can vary by query, country, language, time, and product behavior."
publishedAt: 2026-07-30
updatedAt: 2026-08-02
author:
  name: "Mohammad Hamza Suhail"
  url: "https://emaitchess.com"
order: 34
related:
  - href: "/trackers"
    title: "AI surface trackers"
    description: "Compare how refd measures ChatGPT, Perplexity, Gemini, Google AI Mode, and Google AI Overviews."
  - href: "/google-ai-mode-tracker"
    title: "Google AI Mode tracker"
    description: "Measure Google's deeper conversational Search experience separately from the quick Overview."
  - href: "/demo"
    title: "Interactive sample report"
    description: "Explore the fabricated Ultrahuman workspace, prompt results, citations, competitors, and answer evidence."
  - href: "/methodology"
    title: "Measurement methodology"
    description: "Review scheduled collection, scoring, aggregation, and the limits of every metric."
---

Google AI Overviews are generated summaries that can appear on a standard
Google Search results page. They are not shown for every query. That absence is
one of the most important things an AI Overview tracker must preserve.

refd distinguishes three outcomes: an Overview appeared and contained the
brand, an Overview appeared without the brand, or Google returned a successful
results page without an Overview. Only the first two contain an answer that can
be scored for mentions and citations.

## What AI Overview visibility means

[Google Search Central](https://developers.google.com/search/docs/appearance/ai-features)
describes AI Overviews as a way to get the gist of a complex question and
explore supporting links. Google says they appear when its systems determine
that an Overview adds value beyond the ordinary Search results, so they often
do not trigger.

Google also says AI Overviews and AI Mode can use different models and
techniques, which means their answers and links can differ. refd treats them as
separate surfaces.

For AI Overviews, refd checks Google Search using the configured country and
English language. When an Overview is present, refd records its visible text
and ordered reference URLs. When none is present, refd stores the successful
query as an answerless observation.

## Coverage comes before visibility

AI Overview coverage answers:

> Of the successful Google queries checked, how often did an AI Overview
> appear?

Mention rate and citation rate answer different questions:

> Of the successful queries where an Overview appeared, how often did it name
> or cite the tracked entity?

The answerless result belongs in the coverage denominator. It does not belong
in the mention or citation denominator because there was no generated answer in
which a brand could appear.

This prevents a query with no Overview from being confused with:

- A failed Google Search request.
- A present Overview that omitted the brand.
- A present Overview with no source links.
- A present Overview that mentioned only competitors.

## What refd measures on AI Overviews

| Signal | What it tells you |
| --- | --- |
| AI Overview coverage | How often a successful query returned an Overview |
| Mention rate | How often present Overviews name the brand |
| Citation rate | How often present Overviews cite a confirmed brand domain |
| Average position | Where the brand is first named among tracked entities |
| Share of voice | The brand's share of tracked mentions inside present Overviews |
| Source coverage | How often a present Overview exposes at least one source URL |
| Source domains | Which owned and third-party pages support the generated answer |

Rates remain linked to the prompt, sample, normalized Overview, and stored
answer evidence. The [methodology](/methodology) documents the exact scoring
and aggregation contract.

## Read the illustrative result

The fabricated sample asks whether a smart ring or fitness band is better for
sleep tracking. An AI Overview appeared, named Ultrahuman third among the
tracked products, and cited ultrahuman.com.

The evidence supports several separate conclusions:

1. The query produced an AI Overview for this sample.
2. Ultrahuman appeared in the visible Overview text.
3. Other tracked brands were named first.
4. A page from the Ultrahuman domain appeared in the reference list.
5. The brand was associated with the smart-ring side of the comparison.

A later run of the same query could return no Overview or a different answer.
That is why refd stores coverage and visibility separately and trends the
observation over time.

## AI Overviews and AI Mode differ

An AI Overview is part of the standard Search results experience and is
intended as a quick snapshot. AI Mode is a deeper conversational Search
experience that supports follow-up questions and more exploration.

refd also tracks the two surfaces differently:

- AI Overviews are checked as part of standard Google Search results.
- AI Mode is tracked as a conversational Search answer.
- AI Overview absence is a valid result.
- AI Mode is scored as a returned conversational answer.

Do not combine their rates into one Google AI metric. Keeping them separate
reveals whether a brand appears in the quick Search snapshot, the deeper
conversation, both, or neither.

## What site owners can and cannot infer

Google's current site-owner guidance says the same SEO foundations remain
relevant for AI Overviews and AI Mode. A page must be indexed and eligible to
appear in Search with a snippet to be eligible as a supporting link. Google
does not require special AI markup, an AI text file, or a separate technical
optimization.

Eligibility is not a guarantee. refd can show which prompts, brands, and sources
appeared in the configured observations. It cannot prove why Google's systems
selected one source or guarantee that a page change will produce an Overview.

## Limitations

AI Overview availability and content can vary by query, country, language,
device context, time, source availability, and product changes. A valid
observation may still contain no Overview.

One scheduled observation does not represent every Google user or location.
Trend coverage and visibility across completed runs instead of treating one
Search result as a durable fact.

## Frequently asked questions

### Is a missing AI Overview a monitoring failure?

No. If Google returned a successful Search result without an Overview, refd
stores a valid answerless observation. Collection or network failures are
tracked separately.

### Does no Overview count as zero mention rate?

No. It contributes to AI Overview coverage but is excluded from mention and
citation rate denominators because no answer was present.

### Is AI Overview tracking the same as ordinary rank tracking?

No. refd measures generated answer coverage, tracked-entity mentions,
brand-domain citations, and first-mention order inside the Overview. It does
not turn the organic result position into the AI visibility metric.

### Does refd guarantee inclusion in an AI Overview?

No. Google determines whether an Overview appears and which links support it.
refd monitors the observed outcome and preserves the evidence.

## Sources reviewed

- [AI features and your website, Google Search Central](https://developers.google.com/search/docs/appearance/ai-features)
- [AI Overviews in Google Search, Google Search Help](https://support.google.com/websearch/answer/14901683)
- [How refd measures AI search visibility](/methodology)

External product behavior was reviewed on 30 July 2026. The refd collection and
metric descriptions match the open-source implementation on that date.
