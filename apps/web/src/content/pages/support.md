---
title: "Support"
description: "How to get help with hosted refd, account access, monitoring results, MCP connections, privacy requests, and self-hosted deployments."
eyebrow: "Support"
answer: "For hosted-service help, email h@emaitchess.com with the account email, affected workspace, page URL, time of the issue, and expected result. Never send a password, session cookie, access token, provider secret, or unredacted customer evidence. Reproducible open-source bugs can go to GitHub Issues when the report contains no private data."
publishedAt: 2026-07-30
author:
  name: "Mohammad Hamza Suhail"
  url: "https://emaitchess.com"
order: 21
related:
  - href: "/docs/getting-started"
    title: "Getting started"
    description: "Create a workspace, choose buyer questions and AI surfaces, and inspect the first report."
  - href: "/security"
    title: "Security at refd"
    description: "Review the hosted security model and report a suspected vulnerability privately."
  - href: "/open-source"
    title: "Open-source refd"
    description: "Understand the self-hosted boundary, architecture, license, and contribution workflow."
---

The fastest way to get useful help is to choose the right channel and include
enough context to reproduce the problem without sharing secrets or private
evidence.

## Choose the right support channel

| Request | Where to send it |
| --- | --- |
| Hosted account, workspace, report, or MCP connection | Email [h@emaitchess.com](mailto:h@emaitchess.com) |
| Reproducible software bug with no private data | Open a [GitHub bug report](https://github.com/emaitchess/refd/issues/new?template=bug_report.md) |
| Feature request or product suggestion | Open a [GitHub feature request](https://github.com/emaitchess/refd/issues/new?template=feature_request.md) |
| Security vulnerability | Follow the private process on the [security page](/security#report-a-vulnerability) |
| Privacy or data-protection request | Email [h@emaitchess.com](mailto:h@emaitchess.com) and read the [Privacy policy](/privacy#your-rights) |

Do not put account data, workspace content, private AI answers, access tokens,
or security details in a public GitHub issue.

## What to include

For a hosted-service problem, include:

- The business email address on the account.
- The affected workspace name.
- The page URL and the feature you were using.
- The date, time, and time zone when the issue occurred.
- What you expected to happen and what happened instead.
- Reproduction steps, if the problem repeats.
- The AI surface, prompt title, or run identifier when it is relevant.
- Your browser and operating system for a display or interaction problem.

A screenshot can help, but crop or redact brand evidence, email addresses,
workspace identifiers, and any information that is not needed to understand the
problem.

Use a descriptive subject such as “Workspace report remains pending” or “MCP
authorization returns an error.” One issue per message is easier to investigate
than several unrelated problems in the same thread.

## Never send secrets

refd support does not need your:

- Password.
- Session cookie.
- OAuth access or refresh token.
- Cloudflare API token.
- Bright Data token or webhook secret.
- JWT secret.
- Raw provider record containing information unrelated to the report.

If a secret has already been shared or exposed, revoke or rotate it through the
system that issued it and say that rotation has happened. Do not copy the secret
into a follow-up message.

## Checks before reporting a monitoring problem

Monitoring is asynchronous. A run can remain in progress while provider
snapshots, webhook notifications, queue processing, and sentiment
classification complete.

Before reporting a missing or unexpected result:

1. Confirm that the intended workspace is selected.
2. Confirm that the buyer question is active and the relevant AI surface is
   enabled for that workspace.
3. Check the report's date range and surface filters.
4. Open the answer evidence. A missing Google AI Overview is a valid
   observation when Google did not show one, and a citation is independent from
   a text mention.
5. Reload once after the run has completed. If the result still looks wrong,
   include the prompt, surface, sample, and visible run time in the report.

The [methodology](/methodology) defines the metrics and explains why repeated AI
answers can differ.

## MCP connection help

The production MCP endpoint is `https://api.refd.ai/mcp`. It uses OAuth and
grants read-only access to one workspace at a time.

If a client cannot connect:

1. Confirm that the client supports remote Streamable HTTP MCP servers and
   OAuth.
2. Remove the incomplete connection from the client and retry authorization.
3. Choose the intended workspace during the hosted authorization screen.
4. If access worked previously, check Settings for a revoked connection and
   authorize a new one.

Include the client name and version, the stage that failed, and the exact error
text. Do not send the issued token. The [agent access page](/agents) lists the
endpoint, discovery metadata, tools, and client setup.

## Self-hosted support

Self-hosted refd is community-supported through the public repository. Start
with the [README](https://github.com/emaitchess/refd#self-host) and
[contribution guide](https://github.com/emaitchess/refd/blob/main/CONTRIBUTING.md),
then search existing issues before opening a new one.

Self-hosted operators are responsible for their Cloudflare resources, custom
domains, secrets, provider accounts, migrations, capacity, updates, access
policies, and backups. Hosted support cannot inspect an independent deployment
or operate those resources on the operator's behalf.

When reporting a self-hosted bug, include the refd commit, relevant non-secret
configuration, deployment topology, sanitized logs, expected behavior, and a
minimal reproduction. Confirm that the problem still occurs on a current
revision before reporting it.

## Response and availability

Hosted support is currently provided directly by the operator on a best-effort
basis. There is no standard support response-time commitment or uptime
service-level agreement unless a separate written agreement expressly provides
one.

Security reports use the acknowledgement target stated on the
[security page](/security#report-a-vulnerability). Legal and data-protection
requests are handled within the time required by applicable law.

For other requests, sending complete and safely redacted context is the best way
to make the first reply useful.
