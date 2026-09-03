---
title: "ChatGPT visibility tracker with answer evidence"
description: "Track when ChatGPT names or cites your brand, which competitors appear first, and the answer evidence behind every visibility metric."
eyebrow: "ChatGPT tracking"
answer: "refd tracks a fixed set of buyer questions in web-search-enabled ChatGPT responses on each scheduled run and records the returned answer text and source URLs. It measures brand and competitor mentions, citations, first-mention position, sentiment, prominence, and share of voice without treating one answer as a stable ranking."
layout: "surface"
surface:
  key: "chatgpt"
  label: "ChatGPT"
  collection: "Tracked by refd"
  sampling: "One sample per prompt and run"
  metrics:
    - label: "Mention rate"
      value: "68.0%"
      detail: "Ultrahuman in answered sample cells"
    - label: "Citation rate"
      value: "39.0%"
      detail: "Answers citing ultrahuman.com"
    - label: "Average position"
      value: "#2.0"
      detail: "Conditional on a brand mention"
    - label: "Samples per cell"
      value: "1"
      detail: "One observation per run"
  samplePrompt: "What is the best smart ring for sleep tracking?"
  sampleSignal: "Mentioned · cited · position 2"
  sampleFinding: "The answer names Ultrahuman as a subscription-free alternative after Oura and links to the brand domain."
  limitation: "ChatGPT can vary its wording, search behavior, sources, and recommendations between otherwise identical prompts."
publishedAt: 2026-07-30
updatedAt: 2026-08-02
author:
  name: "Mohammad Hamza Suhail"
  url: "https://emaitchess.com"
order: 30
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
  - href: "/perplexity-visibility-tracker"
    title: "Perplexity visibility tracker"
    description: "Measure source-rich Perplexity answers without collapsing mentions and citations into one signal."
---

ChatGPT can answer a buyer question from model knowledge, web search, or a
combination of both. For brand monitoring, the useful question is not whether a
page has a conventional blue-link rank. It is whether the returned answer names
the brand, cites the brand's domain, places it before or after tracked
competitors, and describes it positively, neutrally, or negatively.

refd records those signals for a fixed prompt set and keeps the answer behind
the aggregate. The result is a trendable view of the questions you chose, not a
claim that every ChatGPT user receives the same response.

## What ChatGPT visibility means

[OpenAI's current ChatGPT Search documentation](https://help.openai.com/en/articles/9237897-chatgpt-search)
states that ChatGPT can search the web when a question would benefit from
current information. Search responses may include inline citations, and a
Sources panel can contain cited sources and other relevant links.

For the configured ChatGPT surface, refd tracks web-search-enabled responses.
It stores the visible answer text and the source URLs returned with the answer.
A source URL is evidence of a citation. It does not become a brand mention
unless the visible answer text also names the brand.

That distinction matters:

- **Mentioned and cited:** the answer names the brand and links to its domain.
- **Mentioned, not cited:** the answer recommends or discusses the brand but
  sources other domains or exposes no source URL.
- **Cited, not mentioned:** a brand page supports the answer without the
  visible prose naming the brand.
- **Neither:** the answer is still relevant evidence because it shows who or
  what appeared instead.

## What refd measures on ChatGPT

For each successful answer, refd calculates:

| Signal | What it tells you |
| --- | --- |
| Mention rate | How often the visible answer names the brand across eligible prompt and sample cells |
| Citation rate | How often the answer cites a confirmed brand domain |
| Average position | The order in which the brand is first named among tracked entities, calculated only when it appears |
| Share of voice | The brand's share of all tracked-entity mentions in the selected range |
| Prominence | Whether the strongest mention appears in the lead, body, or a list |
| Sentiment | Whether the context around a mention is positive, neutral, or negative |
| Source coverage | How often an answered result exposes at least one source URL |

The complete definitions and denominators are documented in the
[measurement methodology](/methodology). Every rate is calculated from
successful results with an answer. Failed collection does not silently become a
zero.

## Read the illustrative result

The sample panel above uses fabricated Ultrahuman data from the public demo. In
the selected ChatGPT answer, Ultrahuman is mentioned second and its domain is
cited. That one result supports four separate observations:

1. Ultrahuman appeared for the buyer question.
2. Another tracked brand appeared before it.
3. A page on the Ultrahuman domain was included as a source.
4. The answer described Ultrahuman positively as an alternative without a
   recurring membership.

The aggregate tiles summarize repeated results, but the answer is what makes
the numbers auditable. Open the [interactive demo](/demo) to inspect the full
fabricated answer and its source list.

## Buyer questions worth monitoring

A useful ChatGPT prompt set follows buyer intent rather than a list of brand
keywords. Include questions such as:

- What are the best tools for a defined job?
- Which product is best for a particular company size or use case?
- What are the strongest alternatives to the category leader?
- Which products have or avoid a specific limitation?
- How do two named options compare?
- What should a buyer evaluate before choosing?

Keep the wording stable across runs. If the question changes, the resulting
answer is not a clean continuation of the previous trend.

## How to interpret a visibility gap

A missing mention is a diagnosis point, not proof of a technical defect.
Inspect the full answer and ask:

- Which competitors were named?
- Which attributes did the answer use to distinguish them?
- Which third-party domains were cited?
- Did your own domain appear as a source without the brand being named?
- Does the question match how real buyers describe the problem?

This evidence can inform research, positioning, documentation, and content
priorities. refd does not promise that a particular change will cause ChatGPT
to mention or cite a page.

## Limitations

ChatGPT answers are non-deterministic. Search behavior, query rewriting,
location, product changes, source availability, and collection conditions can
affect the result. OpenAI also notes that there is no guaranteed placement in
ChatGPT Search.

refd therefore records one observation per prompt and surface in each scheduled
run and recommends comparing trends across completed runs. One observation does
not describe every answer a person might see. Each result records what refd
observed for the configured country at that time.

## Frequently asked questions

### Does refd track a conventional ChatGPT rank?

No. ChatGPT produces an answer rather than a stable ordered result page. refd
measures first-mention position among the brand and competitors configured in
the workspace. Position 1 means the entity was named before the other tracked
entities in that answer.

### Does a mention require a citation?

No. Mention and citation are independent. A brand can be named without a link,
and a brand page can be cited without the visible prose naming the brand.

### Can one ChatGPT answer represent overall visibility?

No. One answer is evidence for one prompt, sample, surface, country
configuration, and collection time. Use a representative prompt set and trends
across completed runs.

## Sources reviewed

- [ChatGPT Search, OpenAI Help Center](https://help.openai.com/en/articles/9237897-chatgpt-search)
- [How refd measures AI search visibility](/methodology)

External product behavior was reviewed on 30 July 2026. The refd collection and
metric descriptions match the open-source implementation on that date.
