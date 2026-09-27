export const MCP_ENDPOINT = 'https://api.refd.ai/mcp';

// Shared agent-facing facts. The agents page and its markdown twin render
// these verbatim, so the two can never drift apart.
export const AGENT_SCOPES: [scope: string, description: string][] = [
  [
    'data:read',
    'Twelve analytics tools plus a metric-glossary resource. Read-only.',
  ],
  [
    'data:write',
    'Adds twelve setup tools plus revoke_connection covering the whole lifecycle: verify domains, provision a workspace, configure it, start one provider-backed onboarding report, finish onboarding, and revoke the connection when it is no longer needed. Onboarded workspaces also get row-scoped prompt management, competitor CRUD, and surface toggles (eleven tools) plus run_now, an immediate paid run limited to administrator accounts.',
  ],
];

export const AGENT_WORKSPACE_ENTITLEMENT =
  'At consent you pick the workspaces the connection may target: check the ones you want, use Allow all to cover every workspace on the account (including ones you create later), or provision a new workspace for the agent to onboard (the create_workspace tool needs an Allow all connection, since only those can target workspaces created after approval). Every tool takes an optional workspace selector, and the credential, never the tool arguments, defines what it may target. Personal access tokens always cover exactly one workspace.';

export const AGENT_INJECTION_BOUNDARY =
  "Web prompt-injection can, at worst, act inside the workspaces the human authorized: a setup-scoped agent can edit configuration, start the one onboarding report, and manage tracked prompts row by row; no grant can delete run history or manage billing, and only an administrator's connection can trigger an extra paid run (run_now).";

export const AGENT_SETUP_TOOLS: [name: string, description: string][] = [
  [
    'create_workspace',
    'Provisions a new workspace for the connection. Needs an Allow all connection: a checked grant could never target a workspace created after approval.',
  ],
  [
    'check_domain',
    'Verifies a domain resolves and where its redirect chain lands. Run it before saving any brand or competitor domain: a wrong domain silently breaks citation matching forever.',
  ],
  [
    'get_setup_state',
    'The setup wizard state: phase, editable draft, version, regeneration allowances, plus the effective limits and the generation budget of the last 24h.',
  ],
  ['set_brand', 'Sets or updates the tracked brand: name, domains, aliases.'],
  [
    'draft_description',
    'Fetches the brand website and drafts description, summary, and target market.',
  ],
  [
    'suggest_competitors',
    'Generates editable competitor candidates from indexed company search; failures carry the cause and the raw candidate domains they saw.',
  ],
  [
    'suggest_prompts',
    'Generates categorized, editable buyer-question candidates, steerable by count and theme.',
  ],
  [
    'update_setup',
    'Applies explicit edits to any draft field, including enabled surfaces.',
  ],
  [
    'preview_setup',
    'Returns the exact canonical configuration, its hash, and a per-surface expected-check breakdown.',
  ],
  [
    'confirm_setup',
    'Commits the approved configuration and starts the one provider-backed onboarding report.',
  ],
  [
    'get_setup_report',
    'Live progress and the pinned setup report for the run group.',
  ],
  [
    'complete_setup',
    'Marks the workspace onboarded after the commit, the same gate the dashboard "enter dashboard" click passes.',
  ],
  [
    'revoke_connection',
    'Revokes this connection: the grant, every token under it, and access to every approved workspace die together, after an explicit confirm argument. Only ever touches the connection the credential belongs to.',
  ],
];

export const AGENT_SETUP_WORKFLOW =
  'get_setup_state, check_domain on every candidate domain, set_brand, draft_description, suggest or update competitors and prompts (prompt generation is steerable by count and theme), preview_setup, explicit user approval, confirm_setup, then get_setup_report until the runs land, then complete_setup to finish. When the connection is no longer wanted, revoke_connection ends the access it had.';

export const AGENT_PROMPT_TOOLS: [name: string, description: string][] = [
  [
    'list_prompts',
    'Every tracked prompt with id, text, category, tags, active status, and answer counts, plus the active-prompt limit and the valid categories.',
  ],
  [
    'add_prompt',
    'Adds one prompt (optional category becomes its single tag) and returns the assigned id; a repeated text converges to the existing prompt.',
  ],
  [
    'update_prompt',
    'Rewords the text and/or changes the category of one prompt; text is unique per workspace.',
  ],
  [
    'toggle_prompt',
    'Enables or disables a prompt while keeping its history; activation respects the active-prompt ceiling.',
  ],
  [
    'remove_prompt',
    'Retires a prompt that has results (history preserved, re-activatable) and deletes one that has none.',
  ],
  [
    'run_now',
    'Triggers an immediate paid collection run over the current active prompt set; administrator accounts only, at most 5 per hour per workspace.',
  ],
];

export const AGENT_TRACKING_TOOLS: [name: string, description: string][] = [
  [
    'add_competitor',
    'Adds one tracked competitor: unique name, verified domains, and optional aliases; returns the assigned id.',
  ],
  [
    'remove_competitor',
    'Removes a competitor by name; refused when scored results would be destroyed.',
  ],
  [
    'list_competitors',
    'The tracked competitors with id, name, domains, and aliases.',
  ],
  [
    'enable_surface',
    'Turns on one AI surface for the next run; respects the surface ceiling.',
  ],
  [
    'disable_surface',
    'Turns one AI surface off; the last surface cannot be disabled.',
  ],
];

export const AGENT_PROMPT_WORKFLOW =
  'list_prompts to resolve ids, add_prompt / update_prompt / toggle_prompt / remove_prompt for row-scoped changes (no setup draft, no list rewrite; in-flight runs keep their frozen prompt set), then run_now when the next scheduled run is too far away and get_prompt_performance with range 1d to check the results. A new prompt is classified into a cohort from its text; add_prompt and update_prompt take an optional kind to override that, and the resolved cohort comes back in the response.';

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

// The one thing an agent gets wrong if it is not told: a headline that pools
// every prompt measures partly the questions that named the brand themselves.
// Body only: each surface supplies its own lead-in (a section label, a heading,
// a bolded bullet), so the same sentence never reads as a stray paragraph.
export const AGENT_PROMPT_COHORTS =
  'A prompt that names the brand is scored near 1.0 by construction, so a headline that pools every prompt flatters the brand. Every aggregate above takes a kind filter: branded (the prompt names your brand), competitor (it names only a tracked competitor), or discovery (it names neither, so the rate is unprompted visibility), comma-separated for more than one. Omit it for the blended figure, which every response labels in headlineScope. get_visibility_overview returns byCohort with all three at once, and get_digest carries the split in sections.prompts.cohorts. list_prompts reports each prompt cohort and the counts.';

export const AGENT_TOOLS: [name: string, description: string][] = [
  [
    'get_workspace_info',
    'The connected workspaces and, for the selected one: brand, tracked competitors, prompts, and enabled AI surfaces.',
  ],
  [
    'get_visibility_overview',
    'Mention rate, citation rate, position, and share of voice across surfaces, with a byCohort breakdown beside the blended figure.',
  ],
  [
    'get_competitor_landscape',
    'How the brand ranks against the competitors it tracks.',
  ],
  [
    'get_prompt_performance',
    'Per-prompt visibility, broken down by AI surface. Each prompt carries its cohort.',
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
    'A 30-day rollup of the workspace, the same one that grounds the dashboard chat, carrying the three-way prompt-cohort split.',
  ],
  [
    'get_run_history',
    'Recent run cycles with status, answer counts, dispatch state, and the frozen prompt count.',
  ],
  [
    'get_prompt_changes',
    'A per-prompt diff of the two most recent completed runs, including zero-visibility transitions.',
  ],
  [
    'get_prompt_citations',
    'The URLs cited for one prompt, with counts and an isOurs flag, in a single call.',
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
  [
    'Agent skill',
    'https://refd.ai/skills/refd/SKILL.md',
    'Installable SKILL.md',
  ],
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
