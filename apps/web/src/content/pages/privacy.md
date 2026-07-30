---
title: "Privacy policy"
description: "How the hosted refd service collects, uses, shares, stores, and deletes account, workspace, analytics, and connector data."
eyebrow: "Legal"
answer: "refd uses the data needed to operate and secure the hosted service, collect the AI answers a customer asks it to monitor, and understand aggregate public-site traffic. We do not sell personal data or customer workspace content. Hosted users can delete workspaces or their complete account from Settings."
layout: "legal"
publishedAt: 2026-07-30
author:
  name: "Mohammad Hamza Suhail"
  url: "https://emaitchess.com"
order: 100
related: []
---

This policy explains how the hosted refd service handles information. It applies
to `refd.ai`, `dash.refd.ai`, `api.refd.ai`, and the hosted refd MCP server
(together, the **Service**).

The open-source refd software can also be deployed independently. A person or
organization operating a self-hosted deployment is responsible for that
deployment and its privacy practices. Self-hosted installations do not send
public-site analytics to refd unless their operator deliberately configures
them to do so.

## Who is responsible for the data

The hosted Service is operated from Ireland by Mohammad Hamza Suhail under the
name refd. For data-protection questions or requests, email
[h@emaitchess.com](mailto:h@emaitchess.com).

If you use refd on behalf of an organization, that organization may also be
responsible for deciding which information is entered into a workspace and how
the resulting reports are used.

## Information we collect

### Account and authentication information

When you create or use an account, we process:

- Your business email address.
- Your optional first and last name.
- A salted password hash. refd does not store your plaintext password.
- Account and workspace identifiers, creation dates, and entitlement settings.
- A secure session cookie used to keep you signed in.
- Login and registration security records, including network address and failed
  attempt counters used to prevent abuse.

If you connect an MCP client, we also store the OAuth client and grant
information needed to operate and revoke the connection, including the selected
workspace, client name, scope, and last-used time. We do not receive the
password for your third-party MCP client.

### Workspace and monitoring content

The content you provide or create in the Service can include:

- Workspace and brand names, domains, aliases, descriptions, and public website
  metadata.
- Competitor names, domains, and aliases.
- Buyer questions, prompt categories, selected AI surfaces, and monitoring
  settings.
- Onboarding drafts and the information generated to help complete setup.
- Dashboard chat messages, proposed changes, cited web sources, and the report
  panels shown with a response.

To produce reports, refd stores run metadata, provider snapshots, normalized AI
answers, source URLs, citations, and calculated metrics. Raw provider responses
are retained so each metric can be audited against the evidence that produced
it.

The Service is designed to monitor brands and business questions. Do not submit
special-category personal data, government identifiers, payment-card data,
health records, or other sensitive personal information.

### Public-site analytics and technical information

On `refd.ai` only, OneDollarStats records aggregate usage information such as:

- The page visited and time of the visit.
- Referring page and campaign parameters.
- Session length.
- General device type, operating system, browser, and country information.

refd does not intentionally send account details, workspace prompts, or report
content to OneDollarStats. The integration does not set an analytics cookie or
use browser storage. It is disabled on local and self-hosted domains.

Cloudflare also processes ordinary request and security information needed to
deliver the Service, including network address, requested URL, timestamp,
headers, and diagnostic or firewall events.

### Browser storage

The Service uses browser storage for preferences such as theme, selected
workspace, sidebar state, table layout, and sorting. These values remain in
your browser and do not provide authentication.

The `refd_session` cookie is strictly necessary for hosted sign-in. It is
HTTP-only, secure, host-only to the API, uses `SameSite=Strict`, and expires
after 24 hours with sliding renewal while the account remains active.

## How we use information

We use information to:

- Create and authenticate accounts.
- Set up workspaces and provide monitoring, reports, evidence, and dashboard
  chat.
- Submit selected buyer questions to the configured collection provider and
  retrieve the resulting AI answers.
- Generate onboarding drafts, competitor suggestions, prompts, summaries, and
  sentiment labels.
- Operate user-authorized, read-only MCP connections.
- Enforce workspace, prompt, surface, and request limits.
- Protect the Service, investigate failures, prevent abuse, and maintain
  reliability.
- Understand aggregate public-site acquisition and improve documentation and
  product pages.
- Comply with legal obligations and enforce the Terms.

We do not sell personal data or customer workspace content. We do not use
workspace content to train our own machine-learning models.

## Legal bases

Where the GDPR or similar law applies, we rely on the following legal bases:

| Purpose | Legal basis |
| --- | --- |
| Accounts, workspaces, reports, MCP connections, and requested features | Performance of a contract or steps requested before entering one |
| Security, abuse prevention, service diagnostics, and aggregate public-site analytics | Our legitimate interests in operating, protecting, and improving the Service |
| Tax, accounting, regulatory, and lawful disclosure duties | Compliance with a legal obligation |
| Optional processing that the law requires us to offer by choice | Consent, which may be withdrawn at any time |

## Service providers and disclosures

We disclose information only as needed to operate the Service, follow your
instructions, or meet legal obligations.

| Recipient | What it does |
| --- | --- |
| [Cloudflare](https://www.cloudflare.com/privacypolicy/) | Hosts the website, dashboard, API, database, object storage, queues, OAuth records, network security, browser rendering, and Workers AI inference |
| [Bright Data](https://brightdata.com/privacy) | Receives monitoring prompts and collection settings, then returns answers and search results from the configured AI surfaces |
| [Exa](https://exa.ai/privacy-policy) | Searches public web indexes for competitor discovery and for dashboard web research when that feature is used |
| [OneDollarStats](https://onedollarstats.com/privacy) | Processes aggregate traffic information from the public `refd.ai` website |
| An MCP client you authorize | Receives read-only workspace data requested through the tools available to that client |

These providers process information under their own terms and privacy
commitments. Some features are optional or only run when configured.

We may also disclose information when reasonably necessary to comply with law,
respond to valid legal process, protect users or the Service, investigate fraud
or abuse, or complete a business reorganization. If the operator of the hosted
Service changes, affected information may transfer with the Service subject to
this policy and applicable law.

## International processing

refd is operated from Ireland, but the Service and its providers use
infrastructure that may process information in multiple countries. Storage and
request-processing locations depend on the relevant Cloudflare resource and
account configuration. Where required, we rely on appropriate contractual or
other lawful safeguards for international transfers.

## Retention and deletion

Account and workspace information is kept while the account is active and as
needed to provide the Service. Monitoring evidence is retained until the
relevant workspace or account is deleted unless a shorter retention period is
introduced and communicated.

You can delete an individual workspace, except the only remaining workspace,
from Settings. You can delete the complete account from Settings after
confirming your password. Account deletion revokes hosted MCP grants and
removes the account, workspaces, prompts, entities, chats, reports, metrics,
citations, and raw provider records from active application storage.

Limited residual copies may remain temporarily in infrastructure backups,
security logs, or disaster-recovery systems and are removed or overwritten
under the relevant provider's normal retention schedule. We may retain a
minimal record when required by law, to resolve disputes, or to enforce an
agreement.

For help with deletion or a request that cannot be completed in the product,
email [h@emaitchess.com](mailto:h@emaitchess.com).

## Security

refd uses technical and organizational safeguards appropriate to the nature of
the Service. These include encrypted transport, salted password hashing,
HTTP-only secure session cookies, origin checks, rate limits, workspace-scoped
authorization, authenticated provider callbacks, and revocable read-only OAuth
grants.

No internet service can guarantee absolute security. Please use a unique
password, protect authorized MCP clients, and contact us promptly if you
suspect unauthorized access.

## Your rights

Depending on where you live, you may have the right to:

- Access personal data held about you.
- Correct inaccurate or incomplete data.
- Delete personal data.
- Receive a portable copy of certain data.
- Restrict or object to certain processing.
- Withdraw consent where processing is based on consent.
- Complain to a data-protection authority.

To exercise a right, email [h@emaitchess.com](mailto:h@emaitchess.com). We may
need to verify your identity before acting on a request. If you are in Ireland
or the European Economic Area, you may also raise a concern with the
[Irish Data Protection Commission](https://www.dataprotection.ie/en/individuals/exercising-your-rights/raising-concern-commission)
or your local supervisory authority.

refd does not sell personal information or share it for cross-context behavioral
advertising.

## Children

The hosted Service is intended for business users aged 18 or older. It is not
directed to children, and we do not knowingly collect personal data from
children.

## Changes to this policy

We may update this policy as the Service, providers, or legal requirements
change. The effective and updated dates at the top show the version in force.
For a material change, we will provide reasonable notice through the Service,
the website, or the account email address when appropriate.

## Contact

Privacy questions and requests can be sent to:

**Mohammad Hamza Suhail, operator of refd**

[h@emaitchess.com](mailto:h@emaitchess.com)

Ireland
