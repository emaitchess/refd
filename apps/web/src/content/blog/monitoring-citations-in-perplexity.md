---
title: "Monitoring citations in Perplexity without overcounting them"
description: "Perplexity shows its sources, which makes it the best surface for citation tracking and the easiest one to measure wrong."
eyebrow: "Surface guide"
answer: "Perplexity attaches sources to nearly every answer, which makes citation measurement unusually tractable there. It also emits citation records that repeat a full URL inside a domain field, producing a bare site root that duplicates a deeper link from the same origin. Counting both inflates citation rate, and the inflation is not uniform across surfaces, so cross-surface comparison breaks too."
publishedAt: 2026-09-04
author:
  name: "Mohammad Hamza Suhail"
  url: "https://emaitchess.com"
order: 21
draft: false
related:
  - href: "/perplexity-visibility-tracker"
    title: "Perplexity visibility tracker"
    description: "What refd measures on this surface, with sample metrics and the answer evidence behind each one."
  - href: "/blog/ai-mentions-vs-citations"
    title: "AI mentions and AI citations are not the same metric"
    description: "The four states the two signals produce, and why each requires a different response."
  - href: "/blog/why-ai-surfaces-disagree"
    title: "Why AI surfaces disagree about your brand"
    description: "The same question, five surfaces, five different sets of named companies. What that tells you."
  - href: "/methodology"
    title: "How refd measures AI search visibility"
    description: "Collection, sampling, scoring, and the limits refd states openly."
---

Perplexity is the surface where citation tracking works best, because the product
is built around showing its sources. That visibility is also why it is the
surface where citation rate is most often reported too high.

## Why this surface is worth measuring carefully

Most AI answer surfaces make you infer which sources shaped a response.
Perplexity attaches them to nearly every answer. That turns a question you would
otherwise guess at into one you can count.

Two things become measurable that are hard elsewhere:

**Citation gaps.** Questions where competitors' domains supply the evidence and
yours does not. Each gap is a specific page on a specific query, which is the
most actionable output in this entire category.

**The mention-citation split.** Because sources are dense here, the split between
"named in the answer" and "supplied the evidence" is sharpest on this surface.
Brands regularly discover they are cited constantly and recommended rarely.

## The root-URL artifact

Here is the specific way citation rate gets inflated.

Perplexity's citation records include a field intended to carry the source's
domain. In practice that field frequently carries a full URL. A naive extractor
reads both the URL field and the domain field, and ends up with two entries: the
deep link, and a bare site root derived from the same URL.

Score that and one citation becomes two. Worse, the second one is a site root,
which is exactly the shape that looks like a homepage citation in a report.

refd drops a bare site root when a deeper URL from the same origin is already
present in the same answer. The rule is narrow on purpose: a genuine homepage
citation, with no deeper link beside it, still counts.

Google AI Mode emits the same shape, so any tool that handles one surface without
the other is inconsistent across exactly the comparison you want to make.

## The favicon problem

The second inflation source is smaller and sillier. Citation records carry icon
fields pointing at favicon and thumbnail services. Those are rendering assets,
not sources. An extractor that walks a response looking for anything URL-shaped
will collect them, and a brand will appear to be "cited" by gstatic.

The reason to walk the response anyway is that provider schemas drift without
notice. An extractor pinned to an exact shape returns zeros the day a field is
renamed, and zeros read exactly like "you were not cited." Walking degrades to
missing nothing, then filtering. That is the right trade, but only if the
filtering is actually done.

## How to sanity-check any tool on this surface

Pick one answer where your brand was reported as cited. Open the underlying
response and confirm three things:

1. The cited URL is a real page, not a site root that duplicates a deeper link.
2. It is not a favicon or thumbnail asset.
3. The domain genuinely belongs to the entity it was attributed to.

If the tool cannot show you the underlying response, you cannot check any of
this, and the citation rate it reports is a claim rather than a measurement.

## What to do with the result

Citation gaps convert into work more directly than any other metric here. For
each question where competitors are cited and you are not, you have the query,
the competing page, and the answer text. That is a content brief with the
research already done.

Two cautions. Perplexity varies its answers and sources between runs like every
other surface, so a gap on one run is a hypothesis. And a citation is not a
recommendation. Being the source everyone reads while a competitor is the answer
everyone gets is a real and specific failure, not a partial success.
