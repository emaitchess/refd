export const MCP_ENDPOINT = 'https://api.refd.ai/mcp';

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
    'Point a Streamable HTTP MCP client at the endpoint; it discovers auth via the protected-resource metadata.',
  ],
];
