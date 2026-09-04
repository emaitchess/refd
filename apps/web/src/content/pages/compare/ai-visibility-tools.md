---
title: "AI visibility tools compared, on facts you can check yourself"
description: "Twelve AI visibility platforms compared on surfaces tracked, published pricing, raw answer evidence, open source status, and API access. Checked 5 September 2026."
eyebrow: "Comparison"
answer: "Twelve AI visibility platforms compared on five publicly checkable criteria: how many AI answer surfaces each tracks, whether pricing is published, whether the product states that it shows the raw AI answer behind each metric, whether it is open source or self-hostable, and whether it offers API or MCP access. Every claim comes from the vendor's own public pages, checked on 5 September 2026, with the method and its limits stated in full."
publishedAt: 2026-09-05
author:
  name: "Mohammad Hamza Suhail"
  url: "https://emaitchess.com"
order: 5
draft: false
related:
  - href: "/blog/how-to-audit-an-ai-visibility-tool"
    title: "How to audit whether a tool's numbers are real"
    description: "Six checks that separate a measurement from a claim, in about twenty minutes."
  - href: "/blog/what-is-ai-search-monitoring"
    title: "What is AI search monitoring?"
    description: "The category definition and the five signals worth keeping separate."
  - href: "/methodology"
    title: "How refd measures AI search visibility"
    description: "Collection, sampling, scoring, aggregation, and the limits refd states openly."
  - href: "/demo"
    title: "Inspect a live sample report"
    description: "A no-signup sample workspace where every metric links back to the answer it came from."
---

Most comparisons in this category are written by one of the vendors, and the
vendor wins. This one is too, so start with the method and decide for yourself
how much to trust the rest.

## How this comparison was made

**What we did.** On 4 and 5 September 2026 we read each vendor's own public
pages and asked the same six questions of every product: which AI surfaces it
tracks, what pricing is published, whether it says it shows the raw AI answer
behind a metric, whether it is open source or self-hostable, whether it offers
API or MCP access, and where the company is based.

**What we did not do.** We did not sign up for these products, run them side by
side, or test their accuracy. There are no screenshots here and no claim that we
used anything. Every cell below reports what a vendor publishes, not what we
observed.

**What that means for you.** "Not stated" in the table means the vendor's public
pages did not answer that question on the date we checked. It does not mean the
product lacks the capability. Several of these products almost certainly do
things their marketing pages do not spell out. Treat "not stated" as a question
to ask on a sales call, not as a mark against the product.

Pricing changes constantly in this category. Check the vendor's page before
making a decision on any number here.

## The comparison

| Tool | AI surfaces tracked | Entry price | Raw answer stated | Open source |
| --- | --- | --- | --- | --- |
| Profound | ChatGPT only on Starter; 3 on Growth; up to 8 on Enterprise | $99/mo, 50 prompts | Not stated | No |
| Peec AI | ChatGPT, Perplexity, Gemini, plus AI Shopping and AI referrals | Not published | Not stated | No |
| Scrunch | ChatGPT, Claude, Gemini, Perplexity, AI Mode, AI Overviews, Meta | $250/mo annual | Not stated | No |
| Otterly.ai | ChatGPT, AI Overviews, Perplexity, Copilot; AI Mode, Gemini, Claude as paid add-ons | $29/mo, 15 prompts | Not stated | No |
| Brandlight | ChatGPT, Gemini, Perplexity, Copilot, Grok | Not published | Not stated | No |
| AthenaHQ | 10 named, including AI Overviews and AI Mode | Free tier; $295/mo | Not stated | No |
| Semrush AI Visibility | ChatGPT, Gemini, Perplexity | $99/mo per domain, 25 prompts | Not stated | No |
| Ahrefs Brand Radar | 7 named, plus YouTube, TikTok, Reddit | $50/mo custom prompts; $199/mo index | Not stated | No |
| PromptMonitor | 8, including AI Mode and AI Overview | $29/mo, 25 prompts | **Yes** | No |
| PromptWatch | 10 named | Not published | **Yes** | No |
| Relixir | AI Overviews, ChatGPT, Perplexity, Claude | Custom only | Not stated | No |
| The Prompting Company | ChatGPT, Perplexity, Gemini, Claude | Not published | Not stated | No |
| **Elmo** | 10 named, including AI Mode and AI Overviews | Cloud from $29/mo; **self-host $0** | **Yes** | **Yes** |
| **refd** | ChatGPT, Perplexity, Gemini, AI Mode, AI Overviews | Not published yet | **Yes** | **Yes**, MIT |

API and MCP access, separately: Otterly.ai lists both API and MCP from its
Standard plan. Peec AI lists "API, MCP, custom exports." Semrush has both a
documented API and an MCP server across the wider platform. refd ships an
OAuth-protected remote MCP server with read-only tools. Profound offers an API
on Enterprise only. Scrunch offers an Enterprise Data API. AthenaHQ sells API
access as a paid add-on. Elmo states API access on every plan. The rest do not
say.

## Four things the table shows that vendor marketing does not

**Surface counts are not comparable at face value.** Profound's entry plan tracks
ChatGPT and nothing else, while its Enterprise tier names eight engines. Otterly
tracks four and sells three more as add-ons priced from $9 to $439 a month. A
headline count means little until you check which tier it belongs to and whether
the engines you care about are included in it.

**Almost nobody commits to showing you the raw answer.** Of the fourteen products
here, four state publicly that you can read the underlying AI response behind a
metric: Elmo, PromptMonitor, PromptWatch, and refd. The rest may well offer it.
None of them say so on the pages we read. For a category built on
non-deterministic inputs, that is a striking gap in what vendors choose to
promise.

**Published pricing is the exception.** Five of fourteen publish no prices at
all. Peec AI lists four tiers with no numbers. If a fast, cheap evaluation
matters to you, this alone narrows the field.

**Two products are open source.** Elmo and refd. Everything else is proprietary
SaaS.

## Where each one is strongest

These are positioning readings, not test results.

- **Profound** is the enterprise default in the United States. Highest brand
  demand in the category by a wide margin, deepest analytics, priced for teams
  with an analyst.
- **Peec AI** is the strongest in German-speaking Europe. Its brand demand in
  Germany is several times Profound's, which is the reverse of the US picture.
  Clean product, agency and mid-market oriented.
- **Scrunch** targets enterprise buyers with governance requirements, at a
  $250/mo floor.
- **Otterly.ai** is the budget entry point at $29/mo, and one of the few with a
  documented MCP server.
- **PromptMonitor** and **PromptWatch** are European, cheaper, and both lead with
  reading the actual answer text. PromptWatch lists Amsterdam and New York
  offices.
- **AthenaHQ** has the widest engine list with a genuine free tier.
- **Ahrefs Brand Radar** and **Semrush AI Visibility** make sense if you already
  pay for the suite. Both fold AI visibility into an existing SEO workflow.
- **Relixir** and **The Prompting Company** both generate and publish content as
  well as measuring. That is a different product category from measurement, and
  worth knowing before you compare them on measurement features.
- **Elmo** is the most complete open-source option today.

## The market is regional, and most lists hide it

Brand search demand for these products, measured across four markets in
September 2026, does not describe one global ranking. It describes several
local ones.

Profound leads the United States by a distance and is close to invisible in
Germany. Peec AI leads Germany and is a mid-sized player in the US. Writesonic,
which sells content generation with a visibility feature attached, has its
largest audience by far in India.

If you are buying in Europe or India, a US-authored "best tools" list is
describing a different market from yours. That is not a criticism of those
lists. It is a reason to check whether the tool you are being sold has customers
who look like you.

## Who should not choose refd

refd is one of the fourteen products here, so this section matters more than the
rest of the page.

**Do not choose refd if you need the widest engine coverage.** refd tracks five
surfaces: ChatGPT, Perplexity, Gemini, Google AI Mode, and Google AI Overviews.
Elmo, AthenaHQ, PromptWatch, and PromptMonitor all name more. If Copilot, Grok,
DeepSeek, or Meta AI matter to your buyers, refd does not track them today.

**Do not choose refd if you need pricing certainty now.** refd has not published
hosted pricing. Several products here have a price and a signup button.

**Do not choose refd if you want the tool to fix the problem.** refd measures.
It does not generate content, publish pages, or run optimization campaigns.
Relixir and The Prompting Company do that. If you want one vendor for both,
refd is the wrong shape.

**Do not choose refd if you need white-label client reporting**, multi-seat
collaboration, or an established support organization. It is a young project.

**Do not choose refd if you want a free open-source option with more engines
today.** That is Elmo. It is open source, self-hostable at no cost, names ten
engines to refd's five, and states that you can read exactly what each model
said. On coverage it is ahead.

## What refd does differently

Three things, stated narrowly.

**Every metric stays attached to its evidence.** refd keeps the raw provider
response for every collected answer and links each score back to it. That is not
unique, as the table shows, but it is uncommon enough to be worth checking for.

**The calculation is auditable, not just the output.** The scoring contract is
published, the code is MIT licensed, and scores are versioned. When a scoring
bug is found, refd can replay the corrected scorer over retained raw answers and
fix historical numbers rather than leaving them wrong.

**Signals stay separate.** Mentions, citations, first-mention position,
sentiment, and share of voice are measured and reported independently, with
stated denominators, rather than blended into one visibility score.

Whether those are worth more to you than five extra engines is a real question
with a real answer, and the answer is not always refd.

## Check any of this yourself

Every claim here came from a vendor's public pages on 4 and 5 September 2026.
Open the pricing page of any product above and compare. If we have something
wrong, or a vendor has since published what we recorded as "not stated," tell us
and we will correct it and date the correction.
