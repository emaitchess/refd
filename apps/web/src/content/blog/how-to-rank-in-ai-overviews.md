---
title: "How to get cited in AI Overviews and AI answers"
description: "What two live AI Overviews actually cited on 4 September 2026, what that implies about getting included, and how to measure whether any of it worked."
eyebrow: "Guide"
answer: "Getting cited in an AI answer depends on which pattern the query follows. For commercial queries, AI Overviews largely cite third-party comparison articles, so inclusion is won by appearing in other people's lists. For definitional and product queries, they cite vendor pages directly, so a page structured around a plain definition, separated named measures, and stated limitations can be quoted. Measure the outcome per query rather than assuming either pattern holds."
publishedAt: 2026-09-04
author:
  name: "Mohammad Hamza Suhail"
  url: "https://emaitchess.com"
order: 13
draft: false
related:
  - href: "/google-ai-overview-tracker"
    title: "Google AI Overview tracking"
    description: "Track whether an AI Overview fires for your queries, whether you are cited, and who is cited instead."
  - href: "/blog/one-answer-is-not-a-measurement"
    title: "Why one AI answer is not a reliable measurement"
    description: "AI answers change between runs. The comparison rules that stop noise being reported as change."
  - href: "/methodology"
    title: "How refd measures AI search visibility"
    description: "Collection, sampling, scoring, aggregation, and the limitations refd states openly."
---

Most advice on this topic is written from inference. This piece is written from
two SERPs we captured on 4 September 2026, United States, desktop, English, with
the AI Overview loaded. They behaved differently enough that treating "AI
Overviews" as one target would have produced the wrong strategy for one of them.

## What we observed

### Query one: a commercial tools query

For `ai visibility tools`, an AI Overview occupied the top of the page, above
every organic result. It cited nine sources. Every one was a third-party
comparison article or review: a Zapier roundup, a Frase listicle, posts on
kime.ai, business.com, position.digital, rankmax.com.au, tryanalyze.ai,
thatmarketingbuddy.com, and a YouTube comparison video.

**No vendor's own product page was cited.** The overview named six products, and
it learned about all six from other people's articles.

It also closed by asking the searcher two qualifying questions: whether their
goal was monitoring brand mentions or optimizing content, and what their monthly
software budget was. The answer surface is now doing discovery-call
qualification.

### Query two: a product-category query

For `ai overview tracker`, the top organic result was a vendor product page, and
the AI Overview sat directly beneath it. This time the overview cited vendor
pages directly alongside editorial: five product pages and three articles.

It defined the category using four named measures: trigger rate, citation rate,
citation rank position, and competitor share of voice. It also stated a
constraint as the reason the category exists, noting that Google Search Console
does not break out URL citations inside AI Overviews.

## The two patterns, and what each one requires

| Pattern | Typical query | What gets cited | What actually wins inclusion |
| --- | --- | --- | --- |
| Editorial | "best X tools", "X software" | Third-party listicles and reviews | Being included in those articles |
| Vendor | "X tracker", "what is X" | Product and definition pages | A page structured to be quoted |

The mistake is applying the second strategy to the first pattern. Publishing an
excellent product page for a query where the answer only reads listicles is
effort with no path to the outcome. Check which pattern your target query
follows before deciding what to build.

For editorial-pattern queries, the work is outreach: identify the specific
domains being cited today, and get accurately represented in them. That is a
short, concrete list, usually under a dozen domains per query, and it is
verifiable rather than speculative.

## What makes a page quotable

For vendor-pattern queries, six properties showed up consistently across the
sources both overviews drew on.

1. **A direct definition in the opening sentence.** Declarative, standalone, no
   preamble. This is the sentence most likely to be lifted close to verbatim.
   Both overviews opened by paraphrasing a source's first-line definition.
2. **Named, separable measures.** Both overviews reproduced a bulleted list of
   distinct metrics. Pages that blend signals into one score do not survive that
   transformation, because there is nothing discrete to list.
3. **Stated limitations.** The second overview quoted a constraint as
   justification for the whole category. Explicit limits get cited more readily
   than claims do, which inverts the usual marketing instinct.
4. **Comparison tables with a rubric and a visible test date.** Undated
   comparisons were consistently passed over for dated ones.
5. **Unambiguous entity language.** Put the brand name and the measure in the
   same sentence. Pronouns and implied subjects break attribution.
6. **Crawlable HTML.** A plain-text or Markdown representation and an `llms.txt`
   are useful supplements. Neither substitutes for indexable pages, internal
   links, canonicals, and a sitemap.

What did not appear to matter: keyword density, publishing frequency, and page
count. Every cited source was a substantial page, and the overviews cited eight
to ten of them rather than dozens.

## The same principles apply in ChatGPT and Perplexity

The surfaces differ in mechanism, but the practical requirements converge.
Perplexity leans heavily on retrieved sources and shows them prominently, so
citation-worthy pages matter most there. ChatGPT blends retrieval with what the
model already associates with your category, so third-party coverage carries more
weight. Gemini and Google AI Mode sit between the two.

Across all of them, the two levers are the same: be the page that is easy to
quote, and be present in the third-party sources that get retrieved. The mix
shifts by surface and by query. That mix is measurable, which is the point of the
next section.

## Should you trust an AI Overview?

As a description of the market, no. It reflects which articles were retrieved for
one query at one moment, and article authors have commercial relationships. Both
overviews we captured named products from lists that included the list author's
own product at position one.

As a measurement target, yes, in the narrow sense that it is what your buyers
are shown. The correct posture is to track what it says rather than to believe
it.

## How to tell whether any of this worked

Every recommendation above is a hypothesis until it is measured on your own
queries. Four things to record, per query, over time:

- **Trigger rate.** Does an AI Overview fire for this query at all? Many
  commercial queries never trigger one, and the rate varies sharply by query
  type. A query that does not trigger cannot be won, and time spent on it is
  time not spent elsewhere. Measure this before optimizing anything.
- **Citation rate.** Is your domain in the source list?
- **Mention rate.** Are you named in the answer text? This is a separate signal
  from citation, and the two move independently.
- **Who is cited instead.** The specific competing domains, which is your
  outreach list.

A missing AI Overview is a valid observation, not a collection failure. Tools
that discard the empty case will overstate how often you were absent from
something that never appeared.

Because these answers are non-deterministic, a single check does not establish
any of the four. Compare completed runs over a fixed query set, and require a
minimum number of shared observations before calling anything a change.

## What we do not claim

We measure these outcomes. We do not sell the optimization work, and we would be
suspicious of anyone who reports the number and sells the fix without separating
the two.

The observations in this piece come from two SERPs on one day, in one country,
on desktop. They are a starting hypothesis for your own query set, not a
finding about AI Overviews in general. Run the measurement on your queries
before acting on any of it.
