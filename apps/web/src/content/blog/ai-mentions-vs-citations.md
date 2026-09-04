---
title: "AI mentions and AI citations are not the same metric"
description: "A brand can be named in an AI answer without being cited, or cited without being named. The four combinations require four different responses."
eyebrow: "Guide"
answer: "An AI mention means the brand name appears in the answer text a person reads. An AI citation means a domain the brand owns appears in the answer's source list. They are independent: a brand can be mentioned without being cited, cited without being mentioned, both, or neither. Blending them into one visibility score destroys the signal that tells you what to fix."
publishedAt: 2026-09-04
author:
  name: "Mohammad Hamza Suhail"
  url: "https://emaitchess.com"
order: 11
draft: false
related:
  - href: "/methodology"
    title: "How refd measures AI search visibility"
    description: "The scoring contract behind mentions, citations, position, sentiment, and share of voice."
  - href: "/demo"
    title: "Inspect a live sample report"
    description: "See mentions and citations reported separately, with the raw answer behind each one."
  - href: "/blog/what-is-ai-search-monitoring"
    title: "What is AI search monitoring?"
    description: "The category definition, the five signals worth separating, and how to evaluate a tool that claims to measure them."
---

Ask an AI assistant "what are the best project management tools for a small
agency," and two different things happen to the brands involved. Some get named
in the sentences. Some get linked in the sources underneath. The overlap between
those two groups is smaller than most people expect.

Tools that report a single blended "visibility score" average those two groups
together. That average is the least useful number in the report, because the
gap between the two is the part that tells you what to do.

## The two definitions

**A mention** is the brand name, or a configured alias for it, appearing in the
visible answer text. It is what the buyer reads. It is the signal that maps to
recommendation.

**A citation** is a domain the brand owns appearing in the answer's source list.
It is what the model drew on, or at least what it attributed. It is the signal
that maps to source authority.

Both are observable. Neither is inferred from the other.

## The four states, and what each one means

| State | What it looks like | What it usually means | What to do |
| --- | --- | --- | --- |
| Mentioned and cited | Named in the answer, your domain in the sources | Working. The model knows you and uses your material | Protect it. Watch for competitors closing the gap |
| Mentioned, not cited | Named in the answer, sources are third parties | Your reputation travels through other people's pages | Find which third parties are cited and get the facts right there |
| Cited, not mentioned | Your domain is a source, but a competitor is the recommendation | Your content is useful, your brand is not the answer | Your material answers the question without positioning you as the option |
| Neither | Absent from both | No presence on this question | Decide whether the question is worth competing for at all |

The third row is the one that surprises people. Being a cited source while a
competitor is the named recommendation is a common and specific failure. It
usually means the page is written to explain a topic rather than to establish
the brand as a candidate answer to it. Publishing more explanatory content makes
it worse, not better.

The second row is the most common for brands with strong PR and weak technical
content. The model recommends you based on what a review site, a Reddit thread,
or a listicle said. That is real visibility, and it is fragile, because you do
not control the source. The response is outreach to the specific domains being
cited, not more content on your own site.

## Why they have to be measured separately

Three reasons, in increasing order of importance.

**They move independently.** A brand can gain mentions across a whole prompt set
while its citation rate stays flat, or the reverse. Averaging them produces a
number that goes sideways while both underlying signals are moving.

**They have different fixes.** Mentions respond to reputation, category
association, and third-party coverage. Citations respond to crawlable,
substantive, well-structured pages on domains you own. Spending content budget
on the wrong one is the most common waste in this category.

**They fail differently.** Citation detection is a URL-matching problem with
well-known artifacts. Mention detection is a text-matching problem with entirely
different ones. A blended score hides which half of the pipeline is wrong.

## Where each measurement goes wrong

Both are harder to get right than they look, and the errors are systematic
rather than random.

### Mention detection

The trap is aliases. Brands want their product names, abbreviations, and common
misspellings to count, which is correct. But a brand whose name is also an
ordinary word turns every unrelated use of that word into a mention. The fix is
case-sensitive matching for those specific aliases, applied deliberately rather
than as a global setting.

The second trap is where in the answer the match occurred. Some surfaces append
a sponsored unit after the organic answer. An advertiser named there is a paid
placement, not an organic recommendation, and counting it inflates the number
that matters most. Cutting that section requires anchoring on its actual shape
and warning when the shape changes, rather than trimming a fixed number of
characters and hoping.

### Citation detection

The trap is what counts as a source URL. Several surfaces put a full URL inside
a citation's domain field, which produces a bare site root that duplicates a
deeper link from the same origin. Counting both doubles the credit. Favicon and
thumbnail service assets arrive in icon fields and are not sources at all.

Neither artifact is exotic. Both are common enough that a tool which does not
filter them will report a citation rate materially higher than reality, and the
inflation is not uniform across surfaces, so cross-surface comparison breaks
too.

## Making the distinction checkable

Whatever tool you use, the test is the same: click a mention and see the answer
text with the match highlighted, click a citation and see the source URL it came
from. If the interface cannot show you that, the distinction it reports is a
claim rather than a measurement.

In refd, mentions and citations are stored as separate signals on every result,
the highlighting in the answer view runs the same matcher the scorer runs, so a
highlight appears if and only if that entity was scored as mentioned, and the
raw provider response sits behind every score. The scoring contract is
published, and because raw answers are retained, a corrected scorer can be
replayed over historical data rather than leaving old numbers wrong.

## The one-line version for a leadership deck

Mentions are whether the assistant recommends you. Citations are whether it
reads you. You need both numbers, you need them separately, and you need to be
able to click either one and see the sentence it came from.
