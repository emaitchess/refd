# refd: open-source AI search monitoring

Know when AI answers mention your brand, and who they mention instead.

refd monitors the questions your buyers ask across ChatGPT, Perplexity, Gemini,
Google AI Mode, and Google AI Overviews. It tracks mentions, citations,
first-mention position, and share of voice over time, and keeps every raw answer
for verification. Use the hosted app at [refd.ai](https://refd.ai) or deploy the
complete platform yourself.

## What it does

- **AI surfaces:** Monitor ChatGPT, Perplexity, Gemini, Google AI Mode, and AI
  Overviews on a schedule. Repeat samples help reveal trends instead of one-off
  answers.
- **Buyer questions:** Build a prompt set around the questions buyers ask. Every
  run checks each active prompt across every surface.
- **Competitive visibility:** Compare your brand with the competitors you track
  across mentions, citations, first-mention position, and share of voice.
- **Citation gaps:** Find the domains cited on prompts where your brand is
  absent, so you can see which sources may influence AI answers.
- **Receipts:** Open the raw answer behind every score. When a metric changes,
  you can see exactly why.
- **Hosted or self-hosted:** Use the hosted app, or deploy the complete stack
  with your own Cloudflare and Bright Data accounts.

## How it works

Each workspace tracks a single brand and its competitors. On a daily schedule,
refd runs your active prompts across every AI answer surface, takes repeat
samples of each, and scores the results. Because AI answers are
non-deterministic, refd compares trends across runs rather than trusting a single
answer. Bright Data is the only data provider.

## Open source

The whole stack is public: three independently deployed Cloudflare Workers for
the Hono API, authenticated React dashboard, and statically generated Astro
website. The API Worker owns D1, R2, Queues, OAuth, MCP, and every runtime
binding. Read it, fork it, or run it for your own brand.

- Source code: <https://github.com/emaitchess/refd>
- Methodology: <https://refd.ai/methodology>
- Documentation: <https://refd.ai/docs>
- Research and guides: <https://refd.ai/blog>
- Create an account: <https://dash.refd.ai/auth/create-account>
- Sign in: <https://dash.refd.ai/auth/sign-in>
