---
title: "How to build a prompt set for AI search monitoring"
description: "Your prompt set is the measurement instrument. Choose it badly and every number downstream describes a market you do not sell into."
eyebrow: "Playbook"
answer: "A prompt set is the fixed list of buyer questions an AI visibility tool asks on every run. Twenty to thirty questions, written the way buyers actually phrase them, spread across discovery, comparison, and decision stages, and then held constant. The set defines what every downstream metric means, so changing it mid-campaign destroys the comparison that makes the metrics worth having."
publishedAt: 2026-09-04
author:
  name: "Mohammad Hamza Suhail"
  url: "https://emaitchess.com"
order: 14
draft: false
related:
  - href: "/blog/one-answer-is-not-a-measurement"
    title: "Why one AI answer is not a reliable measurement"
    description: "AI answers change between runs. The comparison rules that stop noise being reported as change."
  - href: "/blog/what-is-ai-search-monitoring"
    title: "What is AI search monitoring?"
    description: "The category definition, the five signals worth separating, and how to evaluate a tool."
  - href: "/methodology"
    title: "How refd measures AI search visibility"
    description: "Collection, sampling, scoring, and the limits refd states openly."
  - href: "/demo"
    title: "Inspect a live sample report"
    description: "A no-signup sample workspace showing a real prompt set and the answers behind each metric."
---

Everything an AI visibility tool reports is a statement about the questions you
told it to ask. Get the prompt set wrong and the dashboard is precise about the
wrong market.

This is the highest-leverage hour in the whole setup, and it is usually rushed.

## Write prompts, not keywords

People type three words into Google and full sentences into an assistant. A
prompt set built from keyword exports measures something real, but it is not what
your buyers are doing.

Wrong: `project management software`

Right: `What project management tool should a 15-person design agency use?`

The second gives the model enough to make a specific recommendation, which is
what you are trying to measure. The first invites a generic listicle.

## Cover the stages, not just the money question

The temptation is to fill the set with comparison questions, because those feel
closest to revenue. A set weighted entirely to one stage tells you about one
moment in a buying process.

| Stage | What the buyer is doing | Roughly |
|---|---|---|
| Discovery | Does not know your category exists yet | 25% |
| Category education | Knows the problem, learning the options | 25% |
| Comparison | Has a shortlist, deciding between them | 35% |
| Implementation | Has chosen, working out how | 15% |

Discovery questions matter more than they look. A brand named when someone asks
"how do I solve X" reaches buyers before a shortlist exists, and being absent
there is invisible in any comparison-stage metric.

## Include the questions you will lose

The instinct is to pick questions you already win. It produces a beautiful
dashboard that never moves and never teaches you anything.

Deliberately include:

- Questions where you expect a competitor to be named first.
- Questions about a capability you are still building.
- Questions phrased around a competitor's category framing rather than yours.

These are where change shows up first. A prompt set with no losses in it is a
vanity instrument.

## Size and cost

Twenty to thirty questions is right for one brand in one market. Below fifteen,
individual answer variance dominates and nothing looks stable. Above forty, cost
grows without adding much signal, because prompts start restating each other.

Cost is real and it multiplies. Every prompt runs against every enabled surface,
on every scheduled run. Twenty-five prompts across five surfaces daily is 3,750
collected answers a month. Deciding to add "just a few more" prompts is a
recurring cost decision, not a one-off.

If budget is tight, cut surfaces before cutting prompts. Three surfaces measured
across a representative question set beats five surfaces measured across a thin
one.

## Freeze it

The single most important operational rule: **once the set is running, stop
editing it.**

A metric computed over a changed question set is not comparable with the same
metric from last month. Add three easy questions and your mention rate rises with
no change in the world. Remove two hard ones and it rises again.

Good tools defend against this. Each run should freeze the active prompts and the
full competitor set at the moment it starts, so an edit during collection cannot
skew the run in flight. And when two runs are compared, only the prompt and
surface combinations present in both should count, so a partial run can never
fabricate a change.

If you must evolve the set, do it deliberately: add on a stated date, note it,
and treat the before and after as two series rather than one trend.

## A workable first draft

1. List the ten questions your sales team is actually asked. Verbatim.
2. Add five where a competitor is the obvious answer today.
3. Add five discovery questions that do not mention your category by name.
4. Add five comparison questions using the phrasings buyers use, including
   competitor names.
5. Read the whole set aloud. Anything that sounds like a search query rather than
   a question gets rewritten.
6. Freeze it. Run it for a month before touching it.
