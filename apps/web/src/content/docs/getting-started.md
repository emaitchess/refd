---
title: "Getting started with refd"
description: "Create a workspace, define your brand and competitors, choose buyer questions and AI surfaces, and inspect the evidence in your first refd report."
eyebrow: "Documentation"
answer: "Create an account, confirm your brand and competitors, choose representative buyer questions and AI surfaces, then review and start the first report. When results arrive, open at least one answer so you understand the evidence behind the summary metrics."
publishedAt: 2026-07-29
author:
  name: "Mohammad Hamza Suhail"
  url: "https://emaitchess.com"
order: 1
related:
  - href: "/methodology"
    title: "How refd measures AI search visibility"
    description: "Read the collection, scoring, aggregation, and limitations behind every report."
  - href: "/agents"
    title: "Connect an AI agent"
    description: "Use Claude, ChatGPT, or another MCP client to query an existing workspace."
---

refd turns a set of buyer questions into an evidence-backed view of how a brand
appears in AI answers. The setup wizard creates the first workspace and starts a
limited initial report.

## Before you start

Have these ready:

- The official brand name and website.
- Three to five competitors buyers genuinely compare with the brand.
- Questions buyers ask while discovering, comparing, and evaluating products
  in the category.
- A business email address. Hosted registration does not accept free-provider
  or disposable email domains.

The initial report is a snapshot. Recurring scheduled monitoring depends on the
workspace's hosted monitoring access or the policy configured by a self-hosted
operator.

## 1. Create the first workspace

[Create an account](https://dash.refd.ai/auth/create-account) with a business
email and a password of at least eight characters. Registration creates the
first workspace automatically and opens the resumable setup wizard.

The wizard saves progress after each step. If the browser closes, sign in again
and continue from the saved step.

## 2. Confirm the brand

Enter the brand name and primary website. refd can draft a short description
from the homepage, but the result is only a starting point. Edit it until it
describes the company and category accurately.

Confirm:

- The official name people use in prose.
- Owned domains that should receive citation credit.
- Conservative aliases, including product or company names that appear in real
  answers.

Avoid broad abbreviations or ordinary words unless they are genuinely used as
the brand and the casing is distinctive. A loose alias can inflate mention
counts across every future run.

## 3. Choose meaningful competitors

Track companies that answer the same buyer need, not every company adjacent to
the category. A focused set makes position and share-of-voice comparisons easier
to interpret.

Review each suggested competitor before accepting it. Confirm its name, owned
domains, and aliases just as carefully as the primary brand.

Share of voice is relative to this tracked set. Adding or removing a competitor
changes the denominator, so refd does not compare set-relative metrics across
incompatible runs.

## 4. Build the prompt set

Prompts should sound like questions a buyer would ask an assistant. Cover more
than branded searches.

A balanced first set can include:

- **Discovery:** "What tools help a B2B software team monitor visibility in AI
  search?"
- **Problem:** "How can a marketing team tell whether ChatGPT recommends its
  brand?"
- **Comparison:** "Which products compare AI mentions and citations across
  competitors?"
- **Evaluation:** "What should I look for in an AI search monitoring tool?"
- **Decision:** "Which AI visibility platform keeps the raw answer behind each
  metric?"

Replace the example category with the buyer's real problem. Avoid prompts that
contain the desired answer, use hidden brand hints, or differ only by one trivial
word.

Standard hosted accounts can keep up to 25 active prompts in a workspace. Start
with a smaller representative set that you can explain and maintain.

## 5. Select AI answer surfaces

Choose the surfaces that matter to the audience. Standard hosted workspaces can
enable up to three at a time:

- ChatGPT
- Perplexity
- Gemini
- Google AI Mode
- Google AI Overviews

Google AI Mode and Google AI Overviews are separate surfaces. A missing AI
Overview is a valid observation because Google does not show one for every
query.

Each enabled surface increases collection work and cost. More surfaces are not
automatically better if the audience does not use them.

## 6. Review and start the report

The review step shows the brand, competitors, prompts, and surfaces that will be
committed. Correct mistakes before continuing.

Starting the report creates:

- A small preliminary run so the report can begin filling in quickly.
- A background run for the remaining prompts.

The report page polls while results arrive. Sentiment can trail the main answer
scores because it is classified in a separate queue step.

Do not refresh repeatedly to start another run. The committed setup is saved,
and returning to the report resumes the existing work.

## 7. Read the first report

Begin with coverage and evidence rather than one headline number:

1. Check how many expected answers were present.
2. Compare mention and citation rates. They are independent signals.
3. Review the brand against the chosen competitors.
4. Open a prompt result.
5. Read the underlying answer and its sources.

The first report is one observation. Repeated scheduled runs are what make
directional changes useful.

Read the full [measurement methodology](/methodology) before presenting the
metrics to a client or leadership team.

## 8. Enter the dashboard

The final report step includes the action that completes onboarding and enters
the dashboard. Until that action is used, the workspace remains in setup and
will return to the report on the next sign-in.

After setup:

- Home can answer questions from a fresh workspace digest.
- Overview summarizes current visibility and material changes.
- Prompts and Sources lead back to the scored answers.
- Settings manages workspaces, entities, surfaces, account access, and MCP
  connections.

Normal users do not manually trigger paid provider runs. Hosted collection
follows the workspace's monitoring entitlement and schedule.

## What to do next

Refine the prompt set only when a question is redundant, unrepresentative, or
missing an important buyer stage. Preserve enough continuity to compare future
runs.

When a metric changes, open the answers first. The report tells you where to
look; the evidence tells you what the assistants actually said.
