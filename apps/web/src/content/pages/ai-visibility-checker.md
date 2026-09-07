---
title: "AI visibility checker: how to check whether AI answers mention your brand"
description: "There is no honest one-click AI visibility score. Here is what a real check requires, a free manual method you can run in about thirty minutes, and what it still cannot tell you."
eyebrow: "Checker"
answer: "Checking your AI visibility means asking the questions your buyers ask, on the AI surfaces they use, several times each, and recording whether your brand was named in the answer text and whether your pages were cited as sources. A single question asked once is not a check, because answer engines return different answers to the same question. You can run a usable manual check yourself in about thirty minutes with no tool and no signup, and the method is set out in full below."
publishedAt: 2026-09-07
author:
  name: "Mohammad Hamza Suhail"
  url: "https://emaitchess.com"
order: 6
draft: false
related:
  - href: "/demo"
    title: "Inspect a live sample report"
    description: "A no-signup sample workspace where every metric links back to the answer it came from."
  - href: "/blog/one-answer-is-not-a-measurement"
    title: "Why one AI answer is not a measurement"
    description: "What answer variance does to a number built on a single observation."
  - href: "/blog/how-to-build-an-ai-prompt-set"
    title: "How to build a prompt set"
    description: "Choosing the buyer questions worth tracking, and how many you actually need."
  - href: "/methodology"
    title: "How refd measures AI search visibility"
    description: "Collection, sampling, scoring, aggregation, and the limits refd states openly."
---

Plenty of tools offer to check your AI visibility instantly. Type a domain, get a
score. It is worth understanding what that number can and cannot be before you
rely on one, including ours.

## Why an instant score cannot be trusted

Answer engines are not rank trackers. Ask ChatGPT the same question three times
and you can get three different answers, with different brands named and
different sources cited. Nothing about your brand changed between them. The
retrieval step ran again and returned a different set of pages.

That single fact breaks the instant-checker format. A tool that asks one question
once and returns a score has taken one draw from a distribution and printed it as
a measurement. Run it again an hour later and the number moves, not because your
visibility moved, but because you sampled again.

So the useful question is not "what is my score" but "across the questions my
buyers actually ask, how often am I named, how often am I cited, and is that
changing".

## What a real check has to include

Four things, none of them optional:

**The questions your buyers ask, not your brand name.** Searching your own brand
tells you almost nothing. Of course the answer mentions you, you were the
question. What matters is whether you appear when someone asks "best X for Y"
without naming anyone.

**More than one answer per question.** One observation per question is noise. The
minimum that supports a comparison is repeated runs over a fixed question set,
so that a change in the number reflects a change in the world rather than a
change in the draw.

**Mentions and citations counted separately.** Being named in the prose and
having your page cited as a source are different outcomes with different causes.
A brand can be recommended without a link, and linked without being recommended.
Collapsing them into one score hides which problem you have.

**The raw answer kept.** A number you cannot trace back to the text it came from
cannot be checked, by you or by anyone you report it to.

## Check it yourself, free, in about thirty minutes

You do not need a tool for a first read. This method costs nothing and will tell
you more than most instant checkers.

1. **Write ten buyer questions.** Real ones, in the phrasing a person would use,
   with no brand names in them. "Best AI search monitoring tool for a small B2B
   team" is a buyer question. "refd reviews" is not.
2. **Pick two surfaces.** ChatGPT and one other your buyers plausibly use, such
   as Perplexity or Google AI Mode. Two surfaces is enough to see whether they
   disagree, and they usually do.
3. **Ask each question three times** on each surface, in a fresh chat every time
   so context does not carry over. That is 60 answers. It goes faster than it
   sounds.
4. **Record four columns per answer:** the question, the surface, whether your
   brand was named anywhere in the answer text, and whether any of your pages
   appeared in the sources.
5. **Count.** Mentions divided by 60 is your mention rate. Citations divided by
   60 is your citation rate. Note which competitors kept appearing, and in which
   position relative to you.

What you now have is a baseline with a stated method, which is more than a score
out of 100 gives you.

## What the manual method cannot tell you

It is a snapshot, and it is worth being honest about the limits.

You ran it once, so you have a level and no trend. You cannot tell whether last
week was better. Three samples per question is enough to notice a pattern and
too few to be confident about a small difference. You sampled from your own
account, in your location, which is not neutral. And you will not do it again
next Tuesday, which is the real problem: a visibility number is only useful as a
series.

That is the gap a monitoring tool fills. Not the first check, which you can do
yourself, but the hundredth.

## See what a continuous check looks like

The [demo](/demo) is a no-signup sample workspace with the full structure:
mention and citation rates per surface, share of voice against a competitor set,
first-mention position, sentiment, and the raw answer behind every number. It
uses a fabricated dataset for a hypothetical brand, so treat it as a look at the
shape of the report rather than as real data about anyone.

If you want the same thing running against your own brand, refd asks the
questions on a schedule, scores every answer the same way, and keeps the raw
response behind each metric so you can check the arithmetic. The
[methodology](/methodology) sets out exactly how, including where the numbers
stop being reliable.
