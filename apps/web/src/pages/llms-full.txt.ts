import type { APIRoute } from 'astro';
import { getPublicContent } from '../lib/public-content';

export const GET: APIRoute = async () => {
  const entries = await getPublicContent();
  const publishedContent = entries
    .map(
      (entry) => `## ${entry.title}

Canonical URL: https://refd.ai${entry.path}

${entry.description}

${entry.body}`,
    )
    .join('\n\n---\n\n');

  const body = `# refd: auditable AI search monitoring

> See where a brand appears in AI answers, who appears instead, and the evidence behind every metric.

refd is an open-source platform for monitoring brand visibility in AI search. It tracks ChatGPT, Perplexity, Gemini, Google AI Mode, and Google AI Overviews. It is available as a hosted product at refd.ai or as an MIT-licensed self-hosted stack.

## What refd measures

- Mentions in visible answer text.
- Citations to tracked entity domains.
- First-mention position among the tracked brand and competitors.
- Mention and citation share of voice within the tracked entity set.
- Lead, body, or list prominence.
- Positive, neutral, or negative sentiment for mentioned entities.
- AI Overview and citation-source coverage.
- Material changes between compatible completed runs.

Every metric can be traced to a prompt, surface, sample, normalized answer, and raw provider record. Mentions and citations are independent signals. Missing Google AI Overviews are valid observations rather than failed fetches.

## Collection and architecture

Bright Data is the only answer-collection provider. Dataset scrapers collect ChatGPT, Perplexity, Gemini, and Google AI Mode. The Bright Data SERP API collects Google AI Overviews.

The repository contains three independently deployed Cloudflare Workers:

- The API Worker owns the Hono API, OAuth and MCP, cron, queues, D1, R2, Workers AI, Browser Rendering, and every runtime binding.
- The dashboard Worker serves the authenticated React application as static assets.
- The website Worker serves this statically generated Astro site and fronts only the small discovery routes that need content negotiation or a pinned content type.

Runtime-neutral metric and product contracts live in the shared core package.

## Agent access

The production MCP endpoint is https://api.refd.ai/mcp. It uses OAuth with PKCE, grants read-only access to one human-selected workspace, and exposes nine tools plus a metric-glossary resource. It cannot mutate workspace data or trigger provider spend.

## Hosted and self-hosted

Hosted registration and sign-in live on https://dash.refd.ai. Self-hosters bring their own Cloudflare and Bright Data accounts. A self-hosted public website does not send analytics to refd because hosted website analytics are enabled only when the browser hostname is exactly refd.ai.

## Published content

${publishedContent}

## Project links

- Homepage: https://refd.ai/
- Documentation: https://refd.ai/docs
- Research and guides: https://refd.ai/blog
- Agent access: https://refd.ai/agents
- RSS: https://refd.ai/rss.xml
- Source code: https://github.com/emaitchess/refd
- Create an account: https://dash.refd.ai/auth/create-account
- Sign in: https://dash.refd.ai/auth/sign-in
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
