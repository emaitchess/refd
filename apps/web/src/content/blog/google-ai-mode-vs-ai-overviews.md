---
title: "Google AI Mode and AI Overviews are not the same surface"
description: "Two Google products, two collection methods, two user postures, and one distinction that most AI visibility reporting collapses into a single number."
eyebrow: "Surface guide"
answer: "Google AI Overviews is a feature of the ordinary results page that appears on some queries and not others. Google AI Mode is a separate conversational search experience that always returns a generated answer. The most important consequence for measurement is that an absent AI Overview is a real and meaningful observation, while an absent AI Mode answer is a collection failure."
publishedAt: 2026-09-04
author:
  name: "Mohammad Hamza Suhail"
  url: "https://emaitchess.com"
order: 23
draft: false
related:
  - href: "/google-ai-overview-tracker"
    title: "Google AI Overview tracker"
    description: "Trigger rate, citation rate, citation position, and competitor share of voice, with the answer behind each."
  - href: "/google-ai-mode-tracker"
    title: "Google AI Mode tracker"
    description: "What refd measures on the conversational Google surface, with source evidence."
  - href: "/blog/how-to-rank-in-ai-overviews"
    title: "How to get cited in AI Overviews and AI answers"
    description: "What two live AI Overviews actually cited, and what that implies about getting included."
  - href: "/blog/why-ai-surfaces-disagree"
    title: "Why AI surfaces disagree about your brand"
    description: "The same question, five surfaces, five different sets of named companies."
---

These two products share a company, a brand prefix, and a general shape. Almost
everything that matters for measurement is different.

## The difference in one table

| | Google AI Overviews | Google AI Mode |
|---|---|---|
| Where it lives | Above the blue links on a normal results page | A separate conversational search experience |
| When it appears | On some queries only | On every query you ask it |
| User posture | Typed a short query, deciding whether to scroll | Asked a question, expecting an answer |
| Answer length | Compressed | Extended, often with follow-ups |
| Absent answer means | The query did not trigger one, which is real data | Collection failed |

That last row is the one that breaks reporting.

## An absent AI Overview is data

AI Overviews do not fire on every query. Whether one appears is itself a
property of the query, and it is one of the four things worth tracking on this
surface. The industry calls it trigger rate.

A tool that treats a missing Overview as a failed collection will either drop
that observation or retry it, and both corrupt the denominator. Drop it and your
citation rate is computed only over queries that triggered, which silently
overstates presence. The honest record is that the query ran, no Overview
appeared, and that is what was observed.

refd stores this as an explicit "no answer present" result rather than as an
error. It is the difference between "we were not cited" and "there was nothing to
be cited in."

For AI Mode, the opposite holds. It always returns something. An empty result
there means collection broke, and treating it as a real absence would understate
your visibility.

## They are collected differently, and that matters

AI Overviews are part of a search results page, so they are collected the way a
results page is collected. AI Mode is a conversational product, collected the way
an assistant is.

Two practical consequences:

**Different artifacts.** AI Mode citation records repeat a full URL inside a
domain field, producing a bare site root that duplicates a deeper link from the
same origin. Perplexity does the same thing. Counting both inflates citation
rate. Google's citation records also carry favicon and thumbnail service assets
in icon fields, which are rendering assets rather than sources.

**Different failure modes.** A results page can be blocked or return a variant
layout. A conversational surface can return a well-formed answer with an entirely
different shape than last week. Neither degrades gracefully into the other, which
is why merging them into one Google number hides which one broke.

## What the market itself says about the gap

Google Search Console does not break out which URLs were cited inside AI
Overviews. That absence is the whole reason third-party tracking of this surface
exists, and it is worth stating plainly rather than overclaiming past it: no
tool, including this one, has access to Google's own attribution. What a tracker
observes is what a collected results page showed at that time, from that
collection context.

## What to do

1. **Track them as two surfaces.** Never average them into "Google."
2. **Measure trigger rate on AI Overviews first.** A query that never fires an
   Overview cannot be won, and effort spent on it is effort not spent elsewhere.
3. **Expect different winners.** The same question can produce different cited
   domains on each, because the retrieval and the answer format differ.
4. **Check that absent Overviews are recorded, not discarded.** This is a fast
   way to find out whether a tool understands the surface.
