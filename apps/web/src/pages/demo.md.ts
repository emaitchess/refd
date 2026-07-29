import type { APIRoute } from 'astro';
import { markdownResponse } from '../lib/markdown';

const body = `# Interactive AI search visibility demo

> Explore a no-signup sample refd workspace with visibility metrics, competitor comparisons, prompt results, citations, and answer evidence.

Canonical URL: https://refd.ai/demo

This interactive demo uses a hypothetical workspace for ultrahuman.com and a stable, fabricated dataset. It is not live monitoring, and refd is not affiliated with or endorsed by Ultrahuman.

## What the demo includes

- Mention rate across tracked AI answers.
- Share of voice within the tracked competitor set.
- Average first-mention position.
- Citation rate for the tracked brand domain.
- Run-by-run visibility and share-of-voice trends.
- Mention and citation rates across ChatGPT, Perplexity, Gemini, Google AI Mode, and Google AI Overviews.
- A competitive surface profile for Ultrahuman, Oura, WHOOP, and RingConn.
- Brand prominence and sentiment distributions.
- Buyer-question results with the answer text and cited domains behind each metric.

The HTML version supports 7-day, 30-day, and 90-day ranges, interactive chart tooltips and legends, AI-surface filtering, and selectable answer evidence.

## Try refd with your own brand

[Start monitoring](https://dash.refd.ai/auth/create-account) or [read the methodology](https://refd.ai/methodology).
`;

export const GET: APIRoute = () => markdownResponse(body);
