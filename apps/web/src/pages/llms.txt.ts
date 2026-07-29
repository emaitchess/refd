import type { APIRoute } from 'astro';
import { getPublicContent } from '../lib/public-content';

const staticLinks = [
  '- [Homepage](https://refd.ai/): product overview',
  '- [Documentation](https://refd.ai/docs): setup and operating guides',
  '- [Research and guides](https://refd.ai/blog): public analysis and field notes',
  '- [Agent access](https://refd.ai/agents): MCP endpoint, permissions, tools, and connection instructions',
  '- [Full overview for LLMs](https://refd.ai/llms-full.txt): product and public content in one file',
  '- [Source code](https://github.com/emaitchess/refd): MIT-licensed implementation',
  '- [Design system](https://github.com/emaitchess/refd/blob/main/docs/DESIGN.md): public UI and charting rules',
];

export const GET: APIRoute = async () => {
  const entries = await getPublicContent();
  const contentLinks = entries.map(
    (entry) =>
      `- [${entry.title}](https://refd.ai${entry.path}): ${entry.description}`,
  );
  const body = `# refd

> Auditable AI search monitoring for businesses. See where a brand appears, who appears instead, and the raw answer behind every metric.

refd monitors buyer questions across ChatGPT, Perplexity, Gemini, Google AI Mode, and Google AI Overviews. It measures mentions, citations, first-mention position, sentiment, prominence, and share of voice while preserving the underlying answer evidence.

The hosted product runs at refd.ai. The complete stack is MIT licensed and can be self-hosted on Cloudflare with a separate Bright Data account. Bright Data is the only answer-collection provider.

## Public content
${contentLinks.join('\n')}

## Product and project
${staticLinks.join('\n')}

## Account
- [Create an account](https://dash.refd.ai/auth/create-account): start a hosted workspace
- [Sign in](https://dash.refd.ai/auth/sign-in): return to an existing workspace

## Optional
- [RSS](https://refd.ai/rss.xml): subscribe to published research and documentation
- [Issues](https://github.com/emaitchess/refd/issues): report bugs or request features
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
