# Contributing to refd

Thanks for your interest in refd. This guide covers how to get set up, the
checks your change must pass, and how to open a pull request.

## Prerequisites

- [Bun](https://bun.sh) (package manager and script runner — do not use npm/npx/node)
- [Caddy](https://caddyserver.com) (local dev serves over https via `Caddyfile`)
- A Cloudflare account with Workers AI and Browser Rendering enabled, if you
  want to exercise the onboarding wizard locally (both bindings are
  `remote: true`, so local dev proxies to the real services)

## Getting started

```bash
bun install
cp .dev.vars.example .dev.vars   # then fill in JWT_SECRET, BRIGHTDATA_API_TOKEN, EXA_API_KEY (optional)
bun run dev                      # applies local migrations, starts vite + Caddy at https://refdlocal.io
```

Local dev needs `127.0.0.1 refdlocal.io` in `/etc/hosts` and a one-time
`caddy trust`. Plain `http://localhost:5173` works too. See the
[README](README.md) for the full self-host and secrets walkthrough.

## Before you open a PR

Run the full gate locally — CI runs the same four commands and must be green:

```bash
bun run check    # wrangler types + tsc --noEmit
bun run lint     # Biome (run `bun run lint:fix` to auto-fix)
bun test         # unit tests
bun run build    # production build
```

`bun run check` regenerates `worker-configuration.d.ts` via `wrangler types`
first, so a fresh clone typechecks without any manual step.

## Code style and conventions

The project's conventions are documented in [`CLAUDE.md`](CLAUDE.md) (and its
tool-neutral twin [`AGENTS.md`](AGENTS.md) — keep both in sync when you change
either). Highlights:

- **Arrow functions everywhere** (`const f = () => {}`), never `function`
  declarations.
- **Validate data at trust boundaries with Zod** (`safeParse`), never bare
  `as` casts — request bodies, LLM output, and external API responses.
- **UI work follows [`docs/DESIGN.md`](docs/DESIGN.md).** Charts are dither-kit
  only; monochrome chrome, hue belongs to data; no em dashes in UI copy.
- Any user-facing metric change must also update the glossary
  (`src/app/lib/metric-copy.ts`) and its tests.
- Comments only where they carry a non-obvious constraint, invariant, or why.

## Commit and pull request guidelines

- Keep PRs focused; describe the change and how you verified it.
- Reference any related issue (`Fixes #123`).
- Make sure the four checks above pass before requesting review.
- New behavior should come with tests where practical (scoring, metrics, and
  change-detection logic all have unit-test suites to extend).

## Reporting bugs and requesting features

Use the [issue templates](.github/ISSUE_TEMPLATE). For anything
security-related, do **not** open a public issue — follow
[`SECURITY.md`](SECURITY.md) instead.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
