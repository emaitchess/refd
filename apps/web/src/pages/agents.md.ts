import type { APIRoute } from 'astro';
import {
  AGENT_CLIENTS,
  AGENT_DISCOVERY,
  AGENT_INJECTION_BOUNDARY,
  AGENT_INSTALLS,
  AGENT_PAT_EXAMPLE,
  AGENT_SCOPES,
  AGENT_SETUP_TOOLS,
  AGENT_SETUP_WORKFLOW,
  AGENT_TOKEN_STEPS,
  AGENT_TOOLS,
  AGENT_WORKSPACE_ENTITLEMENT,
  MCP_ENDPOINT,
} from '../lib/agent-access';
import { markdownResponse } from '../lib/markdown';

const body = `# Build with refd: agent access

> Connect an AI agent to refd's MCP server. Read AI search visibility, competitors, citations, and answer evidence, or let an agent set up a workspace, across the workspaces you choose.

Canonical URL: https://refd.ai/agents

refd exposes AI search monitoring for your workspaces through a remote MCP server at \`${MCP_ENDPOINT}\`. Connect Claude, ChatGPT, or any Model Context Protocol client and query visibility, competitors, citations, and the raw answers behind them. Reading is the default; an optional bounded setup scope lets an agent onboard a workspace.

## The connector

${AGENT_WORKSPACE_ENTITLEMENT} ${AGENT_INJECTION_BOUNDARY} The owner can revoke the connection anytime from Settings.

- Transport: stateless Streamable HTTP MCP at \`${MCP_ENDPOINT}\`.
- Auth: OAuth 2.1 authorization code with PKCE and revocable grants. Personal access tokens (single-workspace) cover clients that have no browser.
${AGENT_SCOPES.map(([scope, description]) => `- Scope \`${scope}\`: ${description}`).join('\n')}

## Read tools

${AGENT_TOOLS.map(([name, description]) => `- \`${name}\`: ${description}`).join('\n')}

Call \`tools/list\` after connecting. Every tool resolves the granted workspaces from the credential; an optional \`workspace\` argument only picks among them, and \`get_workspace_info\` lists the choices.

## Setup tools (data:write)

${AGENT_SETUP_TOOLS.map(([name, description]) => `- \`${name}\`: ${description}`).join('\n')}

With the \`data:write\` scope the setup tools onboard a workspace end to end: ${AGENT_SETUP_WORKFLOW} The workflow is budgeted, and \`confirm_setup\` starts exactly one provider-backed onboarding report; no grant can delete data, manage billing, or start further runs.

## Connect a client

${AGENT_CLIENTS.map(([name, instructions]) => `- ${name}: ${instructions}`).join('\n')}

## Install in one click

${AGENT_INSTALLS.map((install) =>
  install.href
    ? `- ${install.name}: [open the installer](${install.href}) (${install.note})`
    : `- ${install.name}: \`${install.command}\` (${install.note})`,
).join('\n')}

## Headless and CI agents

OAuth needs a browser. Where there is none (CI, cron, servers, sandboxed agents), create a workspace-scoped read-only personal access token:

${AGENT_TOKEN_STEPS.map((step) => `- ${step}`).join('\n')}

\`\`\`bash
${AGENT_PAT_EXAMPLE}
\`\`\`

## Discovery

${AGENT_DISCOVERY.map(([label, value, note]) => `- ${label}: ${value} (${note})`).join('\n')}

## Trust and source

refd is MIT licensed and runs on Cloudflare Workers. The [open-source guide](https://refd.ai/open-source.md) explains the architecture and the self-hosted boundary. Hosted access is covered by the [security overview](https://refd.ai/security.md), [privacy policy](https://refd.ai/privacy.md), and [terms of service](https://refd.ai/terms.md). Connection help lives on the [support page](https://refd.ai/support.md).
`;

export const GET: APIRoute = () => markdownResponse(body);
