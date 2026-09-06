import type { APIRoute } from 'astro';
import {
  AGENT_CLIENTS,
  AGENT_DISCOVERY,
  AGENT_TOOLS,
  MCP_ENDPOINT,
} from '../lib/agent-access';
import { markdownResponse } from '../lib/markdown';

const body = `# Build with refd: agent access

> Connect an AI agent to refd's read-only MCP server over OAuth. Read a brand's AI search visibility, competitors, citations, and answer evidence, scoped to one workspace.

Canonical URL: https://refd.ai/agents

refd exposes a workspace's AI search monitoring through a read-only, OAuth-protected remote MCP server at \`${MCP_ENDPOINT}\`. Connect Claude, ChatGPT, or any Model Context Protocol client and query visibility, competitors, citations, and the raw answers behind them.

## The connector

Every OAuth grant is bound to a single workspace and is read-only. The connector cannot change data or start paid runs, and the owner can revoke it anytime from Settings. Web prompt-injection can, at worst, read within the one workspace the human authorized.

- Transport: stateless Streamable HTTP MCP at \`${MCP_ENDPOINT}\`.
- Auth: OAuth 2.1 authorization code with PKCE, per-workspace revocable grants, \`data:read\` scope.
- Access: nine read tools plus a metric-glossary resource. No writes, no run triggers, no spend.

## Tools

${AGENT_TOOLS.map(([name, description]) => `- \`${name}\`: ${description}`).join('\n')}

Call \`tools/list\` after connecting. Every tool resolves the workspace from the OAuth grant, never from arguments.

## Connect a client

${AGENT_CLIENTS.map(([name, instructions]) => `- ${name}: ${instructions}`).join('\n')}

## Discovery

${AGENT_DISCOVERY.map(([label, value, note]) => `- ${label}: ${value} (${note})`).join('\n')}

## Trust and source

refd is MIT licensed and runs on Cloudflare Workers. The [open-source guide](https://refd.ai/open-source.md) explains the architecture and the self-hosted boundary. Hosted access is covered by the [security overview](https://refd.ai/security.md), [privacy policy](https://refd.ai/privacy.md), and [terms of service](https://refd.ai/terms.md). Connection help lives on the [support page](https://refd.ai/support.md).
`;

export const GET: APIRoute = () => markdownResponse(body);
