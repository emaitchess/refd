# Security Policy

refd handles authentication (bcrypt password hashing + JWT sessions), API secrets,
and per-workspace tenant data, so we take security reports seriously.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately through either channel:

- **GitHub** — use the repository's **Security** tab → **Report a
  vulnerability** (private advisory). This is preferred.
- **Email** — `h@emaitchess.com`

Please include:

- A description of the issue and its impact.
- Steps to reproduce (a proof of concept if you have one).
- Affected version / commit and deployment (hosted refd.ai vs. self-hosted).

We aim to acknowledge reports within 72 hours and to keep you updated as we
investigate and ship a fix. Please give us a reasonable window to remediate
before any public disclosure.

## Scope

In scope: the code in this repository — the Cloudflare Worker (API, cron,
queue consumer) and the React app. Especially relevant areas: authentication
and session handling, workspace tenancy isolation (`requireWorkspace`), secret
handling, and any injection surface (scraped AI answers and LLM output are
treated as untrusted).

Out of scope: vulnerabilities in third-party providers (Cloudflare,
BrightData, Exa), and issues that require a already-compromised account or
physical access.

## Supported versions

This project is pre-1.0 and evolves on the `main` branch. Security fixes land
on `main`; self-hosters should track it.
