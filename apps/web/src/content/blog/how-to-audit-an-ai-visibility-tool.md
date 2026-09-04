---
title: "How to audit whether an AI visibility tool's numbers are real"
description: "Every tool in this category reports confident percentages. Here are the checks that separate a measurement from a claim, in about twenty minutes."
eyebrow: "Evaluation"
answer: "An AI visibility number is auditable only if you can trace it to the answer text it was scored from. The fastest checks are: click one metric through to its raw answer, confirm mentions and citations are stored separately, ask what the denominator is, and test whether a missing Google AI Overview is recorded as a valid observation rather than an error. Tools that cannot survive those four have reported a claim, not a measurement."
publishedAt: 2026-09-04
author:
  name: "Mohammad Hamza Suhail"
  url: "https://emaitchess.com"
order: 15
draft: false
related:
  - href: "/methodology"
    title: "How refd measures AI search visibility"
    description: "Collection, sampling, scoring, aggregation, and the limits refd states openly."
  - href: "/demo"
    title: "Inspect a live sample report"
    description: "A no-signup sample workspace where every metric links back to the answer it came from."
  - href: "/blog/ai-mentions-vs-citations"
    title: "AI mentions and AI citations are not the same metric"
    description: "The four states the two signals produce, and why each requires a different response."
  - href: "/blog/one-answer-is-not-a-measurement"
    title: "Why one AI answer is not a reliable measurement"
    description: "AI answers change between runs. The comparison rules that stop noise being reported as change."
---

Every product in this category will show you a dashboard of confident
percentages. The percentages are easy to produce and hard to verify, which is an
uncomfortable combination for a number you are about to put in front of your
leadership team.

Here is how to check, quickly.

## Check one: click a number through to an answer

Pick any metric. Click it. You should reach the actual text of an AI answer, with
the reason it was scored that way visible.

This is the whole audit in one step. A mention is a claim that a specific name
appeared in specific text. If you cannot see the text, there is nothing to check,
and every number downstream inherits that.

Ask specifically whether raw responses are retained. Tools that score at
collection time and discard the response can never show you this, and they can
never correct a historical number when a scoring bug is found. The past stays
wrong at the accuracy of whatever code produced it.

## Check two: are mentions and citations separate?

Ask for your mention rate and your citation rate as two numbers. If the product
offers one blended visibility score, it has averaged away the distinction that
determines what you do next.

Then ask the harder version: **can you show me an answer where we were cited but
not mentioned?** That state is common and specific. A tool that cannot express it
is not modelling the domain correctly.

## Check three: name the denominator

Every rate needs one. "42% mention rate" is meaningless until you know:

- 42% of which prompts?
- On which surfaces?
- Over which runs?
- Counting answers that failed to collect, or excluding them?

That last one matters more than it sounds. If failed collections are dropped
silently, your rate is computed over successes only, which flatters it. If they
are counted as absences, it understates. Either is defensible. Not knowing which
is not.

Also ask how cells are weighted. If one prompt returns long answers on five
surfaces and another returns one, an unweighted average lets the noisy prompt
dominate the headline.

## Check four: what happens when there is no AI Overview

Google AI Overviews do not fire on every query. Ask what the tool records when
one does not appear.

The correct answer is that the query ran and no Overview was present, stored as a
valid observation. The wrong answers are that it retries until something appears,
logs an error, or silently drops the row. All three corrupt the denominator, and
the third one is invisible.

This question is a good proxy for general seriousness, because it only has a
right answer if someone thought carefully about the surface.

## Check five: ask how it handles non-determinism

Ask directly: **if I run the same prompt twice, do I get the same answer?**

The honest reply is no. The follow-up is what the product does about it: does it
compare completed runs over time, or present one answer as a ranking? Does it
require a minimum number of observations before reporting a change, or will a
two-observation swing appear as a trend?

A tool with no thresholds will show you dramatic movement every week, and none of
it will be real.

## Check six: sponsored placements and source artifacts

Two specific questions that separate careful implementations from quick ones:

**Does it count advertiser placements as organic mentions?** ChatGPT appends
sponsored units after the organic answer. Counting a name there inflates the
number that matters most, and inflates it for whoever has budget.

**Does it count a site root that duplicates a deeper link from the same origin?**
Perplexity and Google AI Mode both emit citation records that repeat a full URL
inside a domain field. Counting both roughly doubles the credit for one citation,
and the same records carry favicon assets that are not sources at all.

Most vendors will not have an answer to either. That is informative.

## The one-line version

Ask to see the answer behind a number. Everything else follows from whether that
is possible.
