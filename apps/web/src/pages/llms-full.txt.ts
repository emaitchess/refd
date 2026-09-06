import type { APIRoute } from 'astro';
import {
  getPublicContent,
  type PublicContentEntry,
} from '../lib/public-content';

const ORIGIN = 'https://refd.ai';

const SECTION_ORDER: PublicContentEntry['section'][] = [
  'Guides',
  'Documentation',
  'Trackers',
  'Blog',
  'Glossary',
  'Trust',
  'Legal',
];

// Each document is inlined under an H2, so its own headings drop one level and
// the file keeps a single readable outline. Fenced blocks are left alone: a
// shell comment inside one is not a heading.
const demoteHeadings = (body: string): string => {
  let fenced = false;
  return body
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      return !fenced && /^#{1,5} /.test(line) ? `#${line}` : line;
    })
    .join('\n');
};

const document = (entry: PublicContentEntry): string =>
  `## ${entry.title}

- Canonical URL: ${ORIGIN}${entry.path}
- Markdown URL: ${ORIGIN}${entry.path}.md
- Published: ${entry.publishedAt.toISOString().slice(0, 10)}

> ${entry.answer}

${demoteHeadings(entry.body.trim())}`;

export const GET: APIRoute = async () => {
  const entries = await getPublicContent();
  const ordered = SECTION_ORDER.flatMap((section) =>
    entries.filter((entry) => entry.section === section),
  );

  const body = `# refd: auditable AI search monitoring

> See where a brand appears in AI answers, who appears instead, and the evidence behind every metric.

refd is an open-source platform for monitoring brand visibility in AI search. It tracks ChatGPT, Perplexity, Gemini, Google AI Mode, and Google AI Overviews. It is available as a hosted product at refd.ai or as an MIT-licensed self-hosted stack.

This file is the expanded companion to ${ORIGIN}/llms.txt. It inlines the full text of every public page rather than linking to it. Read llms.txt instead when a shorter context is enough.

## What refd measures

- Mentions in visible answer text.
- Citations to tracked entity domains.
- First-mention position among the tracked brand and competitors.
- Mention and citation share of voice within the tracked entity set.
- Lead, body, or list prominence.
- Positive, neutral, or negative sentiment for mentioned entities.
- AI Overview and citation-source coverage.
- Material changes between compatible completed runs.

Every metric can be traced to a prompt, surface, sample, normalized answer, and raw collected response. Mentions and citations are independent signals. Missing Google AI Overviews are valid observations rather than failed fetches.

## Collection and architecture

refd tracks ChatGPT, Perplexity, Gemini, Google AI Mode, and Google AI Overviews as separate surfaces. It repeats configured buyer questions and preserves the returned answer evidence.

The repository contains three independently deployed Cloudflare Workers:

- The API Worker owns the Hono API, OAuth and MCP, cron, queues, D1, R2, Workers AI, Browser Rendering, and every runtime binding.
- The dashboard Worker serves the authenticated React application as static assets.
- The website Worker serves this statically generated Astro site and fronts only the small discovery routes that need content negotiation or a pinned content type.

Runtime-neutral metric and product contracts live in the shared core package.

## Agent access

The production MCP endpoint is https://api.refd.ai/mcp. It uses OAuth with PKCE, grants read-only access to one human-selected workspace, and exposes nine tools plus a metric-glossary resource. It cannot mutate workspace data or trigger provider spend.

## Hosted and self-hosted

Hosted registration and sign-in live on https://dash.refd.ai. Self-hosters bring their own infrastructure and collection accounts. A self-hosted deployment sends no analytics to refd: the tracker is only built in when the hosted analytics settings are configured, and it then collects only from refd.ai and dash.refd.ai.

---

${ordered.map(document).join('\n\n---\n\n')}

---

## Project links

- Homepage: ${ORIGIN}/
- Interactive demo: ${ORIGIN}/demo
- AI surface trackers: ${ORIGIN}/trackers
- Documentation: ${ORIGIN}/docs
- Glossary: ${ORIGIN}/glossary
- Research and guides: ${ORIGIN}/blog
- Agent access: ${ORIGIN}/agents
- Curated index for LLMs: ${ORIGIN}/llms.txt
- RSS: ${ORIGIN}/rss.xml
- Source code: https://github.com/emaitchess/refd
- Create an account: https://dash.refd.ai/auth/create-account
- Sign in: https://dash.refd.ai/auth/sign-in
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
