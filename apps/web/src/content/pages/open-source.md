---
title: "Open-source refd"
description: "How refd's MIT-licensed code, auditable metrics, three-Worker Cloudflare architecture, hosted service, and contribution path fit together."
eyebrow: "Open source"
answer: "refd's application code is available under the MIT License. The repository contains the public Astro site, React dashboard, Hono API Worker, shared scoring code, database migrations, OAuth and MCP server, and deployment configuration. Self-hosters bring their own Cloudflare and Bright Data accounts. The hosted service operates the same project with managed infrastructure."
publishedAt: 2026-07-30
author:
  name: "Mohammad Hamza Suhail"
  url: "https://emaitchess.com"
order: 22
related:
  - href: "/methodology"
    title: "Measurement methodology"
    description: "See how refd collects repeated answers and calculates every visibility metric."
  - href: "/docs/getting-started"
    title: "Getting started"
    description: "Set up a hosted workspace and inspect the evidence behind the first report."
  - href: "/security"
    title: "Security at refd"
    description: "Understand account, workspace, evidence, provider, and agent-access safeguards."
  - href: "/support"
    title: "Support"
    description: "Get help with the hosted service or report a reproducible open-source issue."
---

refd is open source so the measurement system can be inspected where it
matters: collection, normalization, mention matching, citation attribution,
aggregation, data isolation, and the path from a chart back to an answer.

Open source supports the trust story. It is not a claim that the product is
unique simply because its code is public.

## What the repository contains

The [refd repository](https://github.com/emaitchess/refd) is a Bun workspace
with three independently deployed Cloudflare Workers and a shared core package.

| Package | Role |
| --- | --- |
| `apps/api` | Hono API, authentication, OAuth, remote MCP, cron, queues, D1, R2, Workers AI, Browser Rendering, and provider integrations |
| `apps/dashboard` | React and Vite authenticated dashboard, deployed as an assets-only Worker |
| `apps/web` | Astro public site with documentation, research, discovery files, and a small asset-fronting Worker |
| `packages/core` | Runtime-neutral metric definitions, mention matching, surface metadata, limits, glossary copy, and public-page contracts |

The repository also includes Drizzle database migrations, scoring tests, the
design system, metric definitions, local development configuration, CI, and
deployment scripts.

Bright Data is the only provider used to collect ChatGPT, Perplexity, Gemini,
Google AI Mode, and Google AI Overview results. A self-hosted deployment
therefore needs its own compatible Bright Data account and collection
configuration.

## Why auditability matters

An AI visibility score is useful only when the evidence and denominator are
clear. refd keeps the scoring contract and the code that implements it in the
same repository.

The public implementation shows:

- How visible answer text is separated from provider interface data.
- How aliases and entity boundaries determine a mention.
- How source URLs are normalized and attributed to tracked domains.
- How missing AI Overviews differ from failed collection.
- How samples are averaged within prompt and surface cells.
- How share of voice changes when the tracked competitor set changes.
- How every calculated result stays linked to its normalized and raw evidence.

Read the [measurement methodology](/methodology) for the plain-language
contract and
[`docs/METRICS.md`](https://github.com/emaitchess/refd/blob/main/docs/METRICS.md)
for the detailed aggregation rules.

## Hosted and self-hosted

The hosted service and a self-hosted deployment use the same open-source
project, but they have different operators and responsibilities.

| Area | Hosted at refd.ai | Self-hosted |
| --- | --- | --- |
| Infrastructure | Operated by refd on Cloudflare | Operated in your Cloudflare account |
| Answer collection | Managed provider configuration | Your Bright Data account and configuration |
| Secrets and domains | Managed by refd | Managed by you |
| Database migrations and releases | Applied by refd | Applied by you |
| Account and workspace support | [Hosted support](/support) | Community support through GitHub |
| Data practices | Covered by the [Privacy policy](/privacy) | Defined by the independent operator |
| Source license | MIT License | MIT License |

Using the hosted service does not require operating Cloudflare resources or
maintaining collection pipelines. Self-hosting provides control over the
deployment, but it also transfers responsibility for reliability, security,
provider cost, user administration, legal compliance, backups, and updates to
the operator.

## The MIT License

refd is distributed under the
[MIT License](https://github.com/emaitchess/refd/blob/main/LICENSE). The license
permits use, copying, modification, distribution, sublicensing, and sale,
subject to preserving the copyright and permission notice.

The software is provided without warranty under the license. The refd name,
logo, hosted service, and website content are not separately licensed as
software merely because the source repository uses MIT. The
[Terms of service](/terms) govern use of the hosted service.

## Self-hosting requirements

A production deployment currently requires:

- Bun for workspace scripts and builds.
- Three Cloudflare Workers for the API, dashboard, and public site.
- Cloudflare D1, R2, KV, Queues, Workers AI, Browser Rendering, rate limits,
  scheduled triggers, and the required Worker secrets.
- A Bright Data account with the supported dataset scrapers and SERP API.
- Custom domains for the public site, dashboard, and API.
- Secure production values for signing, provider, webhook, and operator
  configuration.

The
[README self-hosting guide](https://github.com/emaitchess/refd#self-host)
lists the current commands and configuration. Self-hosters should review the
[security model](/security#hosted-and-self-hosted-responsibility) and track the
`main` branch while the project remains pre-1.0.

## Contributing

Contributions are welcome. The
[contribution guide](https://github.com/emaitchess/refd/blob/main/CONTRIBUTING.md)
covers local setup, code conventions, the validation gate, commit guidance, and
pull-request expectations.

A useful contribution path is:

1. Search [existing issues](https://github.com/emaitchess/refd/issues) and the
   current code before opening a duplicate.
2. Use the bug or feature-request template with a focused problem statement and
   reproduction.
3. Discuss large architecture or product changes before investing in an
   implementation.
4. Keep a pull request focused and run type checks, lint, tests, and the
   production build.
5. Update metric documentation and glossary tests when user-facing metric
   behavior changes.

Contributions are licensed under MIT. Security vulnerabilities must use the
[private reporting process](/security#report-a-vulnerability), not a public
issue.

## Follow the project

- [Source code](https://github.com/emaitchess/refd)
- [Issues and roadmap discussions](https://github.com/emaitchess/refd/issues)
- [Contribution guide](https://github.com/emaitchess/refd/blob/main/CONTRIBUTING.md)
- [Security policy](https://github.com/emaitchess/refd/security/policy)
- [Architecture and self-hosting](https://github.com/emaitchess/refd#self-host)
- [Agent connector](/agents)
