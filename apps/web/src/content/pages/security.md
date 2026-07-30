---
title: "Security at refd"
description: "How refd protects hosted accounts, isolates workspace data, stores monitoring evidence, authorizes agent access, and handles vulnerability reports."
eyebrow: "Trust"
answer: "The hosted service uses encrypted transport, salted bcrypt password hashes, secure HTTP-only session cookies, origin checks, rate limits, owner-scoped workspaces, authenticated provider callbacks, and revocable read-only OAuth grants. No internet service is risk-free. Report a suspected vulnerability privately through GitHub Security or h@emaitchess.com."
publishedAt: 2026-07-30
author:
  name: "Mohammad Hamza Suhail"
  url: "https://emaitchess.com"
order: 20
related:
  - href: "/privacy"
    title: "Privacy policy"
    description: "See what the hosted service collects, why it is used, which providers receive it, and how deletion works."
  - href: "/open-source"
    title: "Open-source refd"
    description: "Review the architecture, license, hosted boundary, and contribution path."
  - href: "/support"
    title: "Get support"
    description: "Choose the right private or public channel and learn what to include in a useful report."
---

Security at refd starts with a narrow access model. A signed-in user can access
only workspaces they own. Monitoring evidence stays attached to that workspace,
and agent connections receive read-only access to one workspace selected by the
owner.

This page describes the safeguards in the current open-source code and hosted
service. It is not a claim of formal certification, a penetration-test report,
or a guarantee that the service is free from every vulnerability.

## Hosted and self-hosted responsibility

The hosted service runs the public website, dashboard, API, database, object
storage, queues, and agent connector on Cloudflare. refd tracks AI answers and
search results through a managed collection service. Optional onboarding and
research features also use Cloudflare Workers AI, Browser Rendering, and Exa.

The [Privacy policy](/privacy) explains what each provider processes.
Credentials for hosted providers are stored as Worker secrets rather than in
application source.

A self-hosted operator runs an independent deployment. That operator controls
its infrastructure, secrets, provider accounts, domains, access policies,
backups, updates, and legal obligations. A self-hosted installation does not
inherit the operational security of the hosted refd service.

## Account and session security

Hosted accounts use business email addresses and passwords. Passwords are
stored as salted, adaptive bcrypt hashes, never as plaintext.

Successful authentication creates a signed session token in a cookie that is:

- HTTP-only, so application JavaScript cannot read it.
- Secure, so the browser sends it only over HTTPS.
- Host-only to the API origin.
- `SameSite=Strict`.
- Limited to a 24-hour session with sliding renewal while the account remains
  active.

Login attempts are rate-limited. Password changes and account-security actions
can revoke older sessions. The API pins the expected signing algorithm when it
verifies a session token.

The dashboard calls the API from a separate same-site origin. Credentialed
cross-origin requests are allowed only from the configured dashboard origin,
and session-authenticated mutations are checked against their `Origin` header.

## Workspace isolation

Every hosted workspace has one owner. Workspace routes resolve the authenticated
user first, then verify ownership of the requested workspace. A request for
another user's workspace returns a not-found response rather than revealing
whether that workspace exists.

Workspace identifiers are carried by brands, prompts, runs, and other
top-level records. Results, scores, citations, and raw evidence inherit that
scope through their parent records. Server-side authorization is applied before
the dashboard or an agent connector can read the data.

The current hosted product does not offer shared workspace membership or
role-based access. This keeps the authorization boundary deliberately small.

## Monitoring evidence and provider callbacks

refd stores run metadata and calculated metrics in Cloudflare D1. Raw provider
records are compressed and stored in Cloudflare R2 so a result can be audited
against the evidence that produced it. Raw answers are not published as public
pages and are returned only through authenticated, workspace-scoped routes.

Collection completion notifications are accepted only when the configured
webhook secret validates. Queue messages and database uniqueness constraints
make retries idempotent, reducing the risk that a redelivery repeats paid
collection work or writes duplicate results.

Scraped answers, citation URLs, provider responses, and model output are treated
as untrusted input:

- Request bodies and structured external responses are validated at their
  trust boundaries.
- Answer Markdown is rendered without raw HTML passthrough.
- Citation links are limited to HTTP and HTTPS URLs before they become links.
- Generated dashboard changes are proposals that a person must review before
  they can be applied.

## OAuth and agent access

The remote MCP connector uses an OAuth authorization-code flow with PKCE. A
person chooses the workspace during authorization, and the resulting grant is
bound to that workspace and the `data:read` scope.

The connector exposes read tools only. It cannot change workspace data, start a
monitoring run, or trigger provider spend. Every tool derives the workspace
from the encrypted OAuth grant rather than accepting a workspace identifier
from the caller. The owner can review and revoke connections from Settings.

Connection metadata and instructions are available on the
[agent access page](/agents).

## Deletion and retention

Hosted users can delete individual workspaces or their complete account from
Settings. Deletion removes the active workspace records and associated
monitoring data handled by the application. Limited records may remain where
required for security, legal obligations, billing, or disaster recovery.

The [Privacy policy](/privacy#retention-and-deletion) describes the deletion
process, exceptions, and data-protection rights in more detail.

## Report a vulnerability

Do not open a public issue for a suspected security vulnerability. Use one of
these private channels:

1. Open the repository's
   [Security page](https://github.com/emaitchess/refd/security/policy) and use
   **Report a vulnerability**.
2. Email [h@emaitchess.com](mailto:h@emaitchess.com) with “Security” in the
   subject.

Include the affected URL, deployment or commit, impact, reproduction steps, and
a minimal proof of concept when one is safe to provide. Do not include another
person's data, passwords, session cookies, access tokens, or provider secrets.
Avoid destructive testing, denial-of-service testing, automated traffic that
degrades the service, and accessing data beyond what is needed to demonstrate
the issue.

We aim to acknowledge a vulnerability report within 72 hours and keep the
reporter updated while it is investigated. Please allow a reasonable
remediation window before public disclosure.

refd does not currently operate a public bug-bounty program. Reports about
ordinary software defects and feature requests belong in
[GitHub Issues](https://github.com/emaitchess/refd/issues).

## Current assurance boundary

The codebase is public, changes pass automated type, lint, test, and production
build checks, and the security-sensitive boundaries above can be inspected in
the repository. refd does not currently claim SOC 2, ISO 27001, or another
formal security certification.

No internet service can guarantee absolute security. Use a unique password,
protect the email account associated with refd, authorize only MCP clients you
trust, revoke connections you no longer use, and keep self-hosted deployments
up to date.
