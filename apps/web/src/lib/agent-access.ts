export const MCP_ENDPOINT = 'https://api.refd.ai/mcp';

// The editor-native server entry: the shape Cursor, VS Code, and Claude Code
// all accept for a remote Streamable HTTP server. Encoded per client below.
const MCP_CONFIG_JSON = JSON.stringify({ type: 'http', url: MCP_ENDPOINT });

export interface AgentInstall {
  name: string;
  // Custom-scheme deeplink the editor handles natively.
  href?: string;
  // Shell one-liner when there is no deeplink.
  command?: string;
  note: string;
}

export const AGENT_INSTALLS: AgentInstall[] = [
  {
    name: 'Cursor',
    href: `cursor://anysphere.cursor-deeplink/mcp/install?name=refd&config=${btoa(
      MCP_CONFIG_JSON,
    )}`,
    note: 'Cursor opens, adds the server, and starts the OAuth sign-in.',
  },
  {
    name: 'VS Code',
    href: `vscode:mcp/install?name=refd&config=${encodeURIComponent(
      MCP_CONFIG_JSON,
    )}`,
    note: 'VS Code opens, adds the server, and starts the OAuth sign-in.',
  },
  {
    name: 'Claude Code',
    command: `claude mcp add-json refd '${MCP_CONFIG_JSON}'`,
    note: 'Then run `claude mcp login refd` to complete the OAuth sign-in.',
  },
  {
    name: 'VS Code CLI',
    command: `code --add-mcp '{"name":"refd","type":"http","url":"${MCP_ENDPOINT}"}'`,
    note: 'Adds the server to the user profile; approve the sign-in when prompted.',
  },
];

export const AGENT_TOOLS: [name: string, description: string][] = [
  [
    'get_workspace_info',
    'The brand, tracked competitors, prompts, and enabled AI surfaces for the workspace.',
  ],
  [
    'get_visibility_overview',
    'Mention rate, citation rate, position, and share of voice across surfaces.',
  ],
  [
    'get_competitor_landscape',
    'How the brand ranks against the competitors it tracks.',
  ],
  [
    'get_prompt_performance',
    'Per-prompt visibility, broken down by AI surface.',
  ],
  ['get_citation_sources', 'Which domains AI answers cite for the workspace.'],
  [
    'get_recent_changes',
    'Material moves between the two most recent completed runs.',
  ],
  ['find_prompt_results', 'Search tracked prompts and their scored results.'],
  [
    'read_answer',
    'The raw AI answer behind a result, with entity mentions highlighted.',
  ],
  [
    'get_digest',
    'A 30-day rollup of the workspace, the same one that grounds the dashboard chat.',
  ],
];

export const AGENT_DISCOVERY: [label: string, value: string, note: string][] = [
  ['MCP endpoint', MCP_ENDPOINT, 'Streamable HTTP, OAuth-protected'],
  [
    'Protected-resource metadata',
    'https://api.refd.ai/.well-known/oauth-protected-resource/mcp',
    'RFC 9728',
  ],
  [
    'Authorization-server metadata',
    'https://api.refd.ai/.well-known/oauth-authorization-server',
    'RFC 8414',
  ],
  ['OpenAPI catalog', 'https://refd.ai/openapi.json', 'Public HTTP surface'],
  ['Agent manifest', 'https://refd.ai/.well-known/agent', 'Discovery pointers'],
  ['MCP Registry', 'ai.refd/refd', 'registry.modelcontextprotocol.io'],
  ['llms.txt', 'https://refd.ai/llms.txt', 'Plain-text summary'],
];

export const AGENT_CLIENTS: [name: string, instructions: string][] = [
  [
    'Claude / Claude Code',
    'Add a custom connector (or `claude mcp add --transport http refd https://api.refd.ai/mcp`) and complete the OAuth sign-in.',
  ],
  [
    'ChatGPT',
    'Settings → Connectors → add a custom MCP server, enter the endpoint, and authorize.',
  ],
  [
    'Any MCP client',
    'Point a Streamable HTTP MCP client at the endpoint; it discovers auth via the protected-resource metadata. opencode-style configs take `{ "mcp": { "refd": { "type": "remote", "url": "...", "headers": { "Authorization": "Bearer refd_..." } } } }`.',
  ],
];

export const AGENT_TOKEN_STEPS: string[] = [
  'No workspace yet? Create an account (business email) at https://dash.refd.ai/auth/create-account and finish the onboarding wizard. Self-hosted: register on your own dashboard.',
  'Open the workspace, go to Settings → Personal access tokens, and create a token named after the agent or pipeline.',
  'Copy the token once. It is stored only as a SHA-256 hash and cannot be retrieved again.',
  'Send it as `Authorization: Bearer refd_...` on every MCP request. It authenticates exactly like an OAuth grant: read-only, scoped to the one workspace, rate-limited per token, revoked from Settings.',
];

export const AGENT_PAT_EXAMPLE = `curl -X POST ${MCP_ENDPOINT} \\
  -H "Authorization: Bearer refd_..." \\
  -H 'Content-Type: application/json' \\
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"ci","version":"1"}}}'`;
