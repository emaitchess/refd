# refd

[![CI](https://github.com/emaitchess/refd/actions/workflows/ci.yml/badge.svg)](https://github.com/emaitchess/refd/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/github/license/emaitchess/refd)](LICENSE) [![Try refd.ai](https://img.shields.io/badge/try-refd.ai-111111)](https://refd.ai) [![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)

Open-source AI search monitoring — track how AI answers talk about any brand: visibility, mentions, citations, and rank across ChatGPT, Perplexity, Gemini, Google AI Mode, and Google AI Overviews. Use the hosted app at [refd.ai](https://refd.ai) or self-host the whole stack.

One Cloudflare Worker runs everything: Hono API, daily cron, queue consumer, the React dashboard, and the Astro public site (Workers Static Assets). Public routes such as `/`, future docs, and the blog are prerendered by Astro. The authenticated React application lives under `/app/*` and is excluded from crawling and the generated sitemap. Data comes from BrightData (dataset scrapers + SERP API), is stored in D1 (Drizzle), and has gzipped raw payloads archived in R2.

## How it works

Accounts hold **workspaces**; each workspace tracks one brand — its competitors, its prompt set, its runs. A daily cron creates an idempotent run for every workspace eligible for scheduled monitoring, then fans out queue messages: one batch-snapshot trigger per dataset surface × sample (trigger → notify → fetch, with a backstop poll), plus one sync SERP call per prompt × sample for AI Overviews. Every answer is scored for every tracked entity (mentioned / cited / first-mention position), and the raw payload is archived gzipped in R2. A missing AI Overview is recorded as a valid "no AIO shown", not a failure. Retries honor `Retry-After`, back off with jitter, and are idempotent at every layer — a redelivered message never re-spends provider quota.

## Develop

```bash
bun install
bun run dev      # complete local site → https://refdlocal.io
bun run site:dev # public Astro site only → http://localhost:4321
```

Register on the login screen (business email + password ≥ 8 chars) — your first workspace is created automatically and drops you into a resumable setup wizard: name your brand, let it draft your description from your site, pick competitors and prompts, choose engines, then watch the first report fill in live. Every AI step falls back to typing it yourself. Standard accounts can create up to five workspaces, keep up to 25 active prompts in each, and enable up to three AI surfaces. Emails in `ADMIN_EMAILS` have no workspace or active-prompt cap and can enable all available surfaces.

`bun run dev` applies local migrations, starts the Astro public site and the Worker/Vite application, then puts Caddy in front of both at **https://refdlocal.io** (needs `127.0.0.1 refdlocal.io` in `/etc/hosts` and a one-time `caddy trust`). Public routes go to Astro; `/app/*` and `/api/*` go to the Worker/Vite server. Everything stops together when dev exits. Use `bun run site:dev` only when you want the standalone public site without the application or API. A production build combines both outputs into the single Workers Static Assets deployment.

Local secrets go in `.dev.vars` (gitignored): `JWT_SECRET`, `BRIGHTDATA_API_TOKEN`, `BRIGHTDATA_WEBHOOK_SECRET` (optional locally; requires a publicly reachable `PUBLIC_BASE_URL`), `ADMIN_EMAILS` (comma-separated administrator and operator allowlist), and `EXA_API_KEY` (onboarding's competitor search, optional). Onboarding also uses two **bindings, not secrets** — Workers AI (`AI`) and Browser Rendering (`BROWSER`) — both `remote: true` in `wrangler.jsonc`, so local dev proxies to the real services and the account needs both enabled.

- `bun run check` — typecheck · `bun run lint` / `lint:fix` — Biome · `bun test` — unit tests
- `bun run build` — production build · `bun run deploy` — build + `wrangler deploy`

## Self-host

```bash
wrangler queues create refd-ingest && wrangler queues create refd-ingest-dlq
wrangler secret put JWT_SECRET
wrangler secret put BRIGHTDATA_API_TOKEN
wrangler secret put ADMIN_EMAILS       # comma-separated admin/operator allowlist
wrangler secret put EXA_API_KEY        # optional: onboarding competitor search
bun run db:migrate:remote
bun run deploy
```

You'll need a Cloudflare account (Workers paid plan for Queues, plus Workers AI and Browser Rendering enabled for onboarding), a D1 database + R2 bucket (ids/names in `wrangler.jsonc`), and a BrightData account: fill the dataset IDs in `wrangler.jsonc` `vars` (dashboard → Web Scrapers → each AI scraper) and create a SERP API zone matching `BRIGHTDATA_SERP_ZONE`. Set `SCHEDULED_MONITORING_POLICY` to `all` for a self-hosted deployment; the checked-in `entitled` policy is for refd.ai and limits cron to active `pilot` or `subscribed` workspaces. Cron schedule (daily 06:00 UTC), samples, and geo also live in `wrangler.jsonc`.

## Notes

- AI answers are non-deterministic: `SAMPLES=2` per prompt/surface; read trends across runs, not single samples.
- Each standard full run is capped at 25 active prompts × 3 enabled surfaces × samples (25 × 3 × 2 = 150 records at the default). Quota scales with the number of workspaces eligible for scheduled monitoring.
- Design system: `docs/DESIGN.md`. Original implementation plan (historical): `docs/plan.md`.

## Contributing

Contributions welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup and the
checks your PR must pass, and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) for
community expectations. Found a security issue? Follow [`SECURITY.md`](SECURITY.md)
instead of opening a public issue.

## License

[MIT](LICENSE) © refd
