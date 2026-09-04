---
title: "How ChatGPT decides which brands to name, and how to track it"
description: "ChatGPT answers from model memory, from web search, or from both. Each path changes what a brand mention means and what you can do about it."
eyebrow: "Surface guide"
answer: "ChatGPT can answer a buyer question from what the model already associates with a category, from pages it retrieves at answer time, or from a blend of the two. Mentions driven by model association respond to broad third-party coverage over months. Mentions driven by retrieval respond to specific pages. Tracking the two together without separating citations from mentions hides which one is actually moving."
publishedAt: 2026-09-04
author:
  name: "Mohammad Hamza Suhail"
  url: "https://emaitchess.com"
order: 20
draft: false
related:
  - href: "/chatgpt-visibility-tracker"
    title: "ChatGPT visibility tracker"
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

ChatGPT is the surface people ask about first and understand least. The
confusion is usually the same: they treat it as a search engine that happens to
write prose. It is closer to two systems sharing one output box.

## Two paths to a brand mention

**Model association.** The model has read a great deal about your category. Ask
it for the best tools for something and it can answer without retrieving
anything, drawing on what it absorbed during training. A brand named this way is
named because it was widely and consistently discussed in the sources the model
learned from.

**Retrieval.** With web search active, the model fetches pages at answer time and
writes from them. A brand named this way is named because a page said so a moment
ago.

These have different clocks. Model association moves over months and responds to
broad third-party coverage. Retrieval moves in days and responds to specific
pages ranking for the query the model chose to run. A strategy aimed at the wrong
one produces no result and no explanation for why.

## Why the citation signal is the tell

You cannot see which path produced an answer. You can see its shadow.

An answer with sources ran retrieval. An answer with none was written from model
association. Track mentions and citations as separate signals over a fixed prompt
set, and the ratio between them tells you which mechanism your visibility rests
on:

- **Mentioned, no sources anywhere in the answer.** Model association is carrying
  you. That is durable and slow to change, in both directions.
- **Mentioned, sources present, none of them yours.** Retrieval is carrying you,
  through someone else's page. Find that page.
- **Cited but not mentioned.** Your content answered the question and a
  competitor got the recommendation.

None of this is visible if a tool reports one blended visibility score.

## The sponsored unit problem

ChatGPT has begun appending advertiser placements after the organic answer. For
brand monitoring this is a measurement trap, because the advertiser's name sits
in the same response body as the organic recommendation.

An advertiser is not an organic mention. Counting one inflates the number that
matters most, and it inflates it precisely for brands with budget, which makes
competitive comparison meaningless. refd cuts the trailing sponsored unit before
scoring. The cut is anchored at both ends and warns rather than trimming when the
shape drifts, because a scorer that silently guesses at a boundary is worse than
one that says it is unsure.

If you are evaluating any tool on this surface, ask what it does with sponsored
placements. Most will not have an answer, which is itself the answer.

## Variance is the property, not the bug

The same prompt on the same day returns different text, sometimes different
sources, and sometimes a different set of named brands. This is not a collection
failure. These systems sample from a distribution.

The consequence is practical: one answer is an existence proof, not a rank.
"ChatGPT recommends us" needs a denominator to mean anything. Across how many
questions, over how many runs, compared with which competitors.

## What to actually do

1. **Fix your prompt set before you measure.** Twenty to thirty questions real
   buyers ask, held constant. Changing the set mid-campaign destroys the
   comparison.
2. **Read the sources, not just the score.** The cited domains are your outreach
   list. They are a short, specific, verifiable list, which is rare in this work.
3. **Separate the two mechanisms.** If your mentions come with no citations,
   more content on your own site is the wrong lever. Third-party presence is the
   right one.
4. **Compare completed runs, never single answers.** And require a floor of
   observations before calling any movement a change.

## The limit worth stating

Nobody outside OpenAI can see why a given brand was named. Everything above is
inference from observable output: the text, the sources, and how both change
over time. That is enough to act on, and it is not enough to claim causation.
Treat anyone promising to "get you into ChatGPT" with the skepticism that promise
deserves.
