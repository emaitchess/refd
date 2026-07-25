# refd

Open-source AI search monitoring — track how AI answers talk about any brand: visibility, mentions, citations, and rank across ChatGPT, Perplexity, Gemini, Google AI Mode, and Google AI Overviews. Use the hosted app at [refd.ai](https://refd.ai) or self-host the whole stack.

One Cloudflare Worker runs everything: Hono API, daily cron, queue consumer, and the React dashboard (Workers Static Assets). Data via BrightData (dataset scrapers + SERP API), stored in D1 (Drizzle) with gzipped raw payloads in R2.

## How it works

Accounts hold **workspaces**; each workspace tracks one brand — its competitors, its prompt set, its runs. A daily cron (or "Run now" in the UI) creates an idempotent run per workspace, then fans out queue messages: one batch-snapshot trigger per dataset surface × sample (trigger → poll → fetch), plus one sync SERP call per prompt × sample for AI Overviews. Every answer is scored for every tracked entity (mentioned / cited / first-mention position), and the raw payload is archived gzipped in R2. A missing AI Overview is recorded as a valid "no AIO shown", not a failure. Retries honor `Retry-After`, back off with jitter, and are idempotent at every layer — a redelivered message never re-spends provider quota.

## Develop

```bash
bun install
bun run dev    # applies local migrations, starts vite + Caddy → https://refdlocal.io
```

Register on the login screen (business email + password ≥ 8 chars) — your first workspace is created automatically and drops you into a resumable setup wizard: name your brand, let it draft your description from your site, pick competitors and prompts, choose engines, then watch the first report fill in live. Every AI step falls back to typing it yourself. Afterwards, edit anything in Settings / Prompts; add up to five workspaces via the sidebar switcher.

`bun run dev` also starts Caddy (`Caddyfile`) fronting vite at **https://refdlocal.io** (needs `127.0.0.1 refdlocal.io` in `/etc/hosts` and a one-time `caddy trust`); Caddy stops when dev exits. Plain http://localhost:5173 works too.

Local secrets go in `.dev.vars` (gitignored): `JWT_SECRET`, `BRIGHTDATA_API_TOKEN`, and `EXA_API_KEY` (onboarding's competitor search, optional). Onboarding also uses two **bindings, not secrets** — Workers AI (`AI`) and Browser Rendering (`BROWSER`) — both `remote: true` in `wrangler.jsonc`, so local dev proxies to the real services and the account needs both enabled.

- `bun run check` — typecheck · `bun run lint` / `lint:fix` — Biome · `bun test` — unit tests
- `bun run build` — production build · `bun run deploy` — build + `wrangler deploy`

## Self-host

```bash
wrangler queues create refd-ingest && wrangler queues create refd-ingest-dlq
wrangler secret put JWT_SECRET
wrangler secret put BRIGHTDATA_API_TOKEN
wrangler secret put EXA_API_KEY        # optional: onboarding competitor search
bun run db:migrate:remote
bun run deploy
```

You'll need a Cloudflare account (Workers paid plan for Queues, plus Workers AI and Browser Rendering enabled for onboarding), a D1 database + R2 bucket (ids/names in `wrangler.jsonc`), and a BrightData account: fill the dataset IDs in `wrangler.jsonc` `vars` (dashboard → Web Scrapers → each AI scraper) and create a SERP API zone matching `BRIGHTDATA_SERP_ZONE`. Cron schedule (daily 06:00 UTC), samples, and geo also live in `wrangler.jsonc`.

## Notes

- AI answers are non-deterministic: `SAMPLES=2` per prompt/surface; read trends across runs, not single samples.
- Each run = prompts × 5 surfaces × samples (18 × 5 × 2 = 180 records). BrightData free tiers (~5K/mo per product) roughly cover one workspace's daily runs at this volume — cron runs every workspace daily, so quota scales with workspace count.
- Design system: `docs/DESIGN.md`. Original implementation plan (historical): `docs/plan.md`.

## Contributing

Contributions welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup and the
checks your PR must pass, and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) for
community expectations. Found a security issue? Follow [`SECURITY.md`](SECURITY.md)
instead of opening a public issue.

## License

[MIT](LICENSE) © refd
