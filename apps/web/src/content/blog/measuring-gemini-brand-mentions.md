---
title: "Measuring brand mentions in Gemini, and why it is not Google Search"
description: "Gemini, Google AI Mode, and Google AI Overviews are three different products from one company. Treating them as one Google number loses the distinction that matters."
eyebrow: "Surface guide"
answer: "Gemini is a standalone assistant, not a search feature. It differs from Google AI Mode and Google AI Overviews in interface, retrieval behavior, and the shape of the answers it returns, so a brand's visibility in one says little about the other two. Merging them into a single Google figure hides which of the three is actually moving."
publishedAt: 2026-09-04
author:
  name: "Mohammad Hamza Suhail"
  url: "https://emaitchess.com"
order: 22
draft: false
related:
  - href: "/gemini-visibility-tracker"
    title: "Gemini visibility tracker"
    description: "What refd measures on this surface, with sample metrics and the answer evidence behind each one."
  - href: "/blog/google-ai-mode-vs-ai-overviews"
    title: "Google AI Mode and AI Overviews are not the same surface"
    description: "Two Google products, two collection methods, and one distinction most reporting collapses."
  - href: "/blog/why-ai-surfaces-disagree"
    title: "Why AI surfaces disagree about your brand"
    description: "The same question, five surfaces, five different sets of named companies. What that tells you."
  - href: "/methodology"
    title: "How refd measures AI search visibility"
    description: "Collection, sampling, scoring, and the limits refd states openly."
---

The most common reporting mistake on Google's AI products is treating them as one
thing. Gemini, Google AI Mode, and Google AI Overviews come from one company and
behave differently enough that a single "Google AI visibility" number is close to
meaningless.

## Three products, not one

**Gemini** is a standalone assistant. Someone opens it deliberately, the way they
open ChatGPT, and asks a question in full sentences. There is no search results
page underneath.

**Google AI Mode** is a conversational search experience inside Google, returning
an extended generated answer with sources.

**Google AI Overviews** is a feature of the ordinary results page. It appears
above the blue links on some queries and not others.

The user is in a different posture in each. Someone in Gemini is in a
conversation. Someone looking at an AI Overview typed a short query and is
deciding whether to scroll. Visibility in one does not predict visibility in
another, which is exactly why they should be tracked as separate surfaces and
never averaged.

## What to measure here

Gemini answers tend toward completeness, which affects how mentions behave. Being
named is a lower bar on a surface that lists several options, so the useful
signals shift:

- **First-mention position** matters more than on sparser surfaces, because
  being named eighth in a thorough answer is not the same as being named first.
- **Share of voice** is more informative than raw mention rate, because a long
  answer that names everyone makes mention rate approach 100% for the whole
  category and stop discriminating.
- **Sentiment** carries real weight, because there is enough text about each
  named brand for the characterization to be meaningful.

If your Gemini mention rate is high and your share of voice is unremarkable, you
are being listed rather than recommended. Those need different responses.

## Phrasing sensitivity

Conversational surfaces are sensitive to how a question is asked in a way that
short search queries are not. "Best X for Y" and "what should I use for Y" can
return different companies.

This is a prompt-set design problem, not a measurement problem. Write the
questions the way buyers actually type them into an assistant, in full sentences,
and hold them constant. A prompt set of three-word search queries measures
something real, but it is not what people ask Gemini.

## The measurement caution

Every surface here is non-deterministic, and comprehensive answers add a specific
wrinkle: a long answer that names ten companies produces a high mention rate for
all ten, which makes the metric look stable while telling you very little.

Watch position and share of voice on this surface, use mention rate as a floor
rather than a headline, and compare completed runs rather than single answers.
The general rule holds here as everywhere: one answer is an observation, not a
ranking.
