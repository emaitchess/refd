# Remote MCP connector

refd exposes a read-only remote Model Context Protocol server at:

```text
https://refd.ai/api/mcp
```

The connector uses OAuth 2.1 with PKCE and Dynamic Client Registration. During
authorization, refd asks you to select one workspace. The resulting connection
can read only that workspace, cannot change refd data, and cannot start runs or
spend provider quota.

## Official Registry

The domain-verified remote server is published in the official MCP Registry as
`ai.refd/refd`. Its canonical metadata lives in the repository root at
`server.json`; version `0.1.0` points clients to the Streamable HTTP endpoint
above.

Registry versions are immutable. Any later metadata or transport change must
bump the semantic version in `server.json` before republishing. Domain
authentication uses the public proof at
`https://refd.ai/.well-known/mcp-registry-auth`; the private publishing key is
never stored in the repository.

## Connect from Claude

Claude custom connectors are available from **Customize → Connectors**. On an
individual plan, select **+ → Add custom connector**. On Team and Enterprise
plans, an Owner first adds it from **Organization settings → Connectors → Add →
Custom → Web**. Enter `https://refd.ai/api/mcp`; no client ID or secret is
needed. Select **Connect**, sign in to refd, choose a workspace, and approve the
read-only permission.

Enable refd for a conversation from the **+ → Connectors** menu. Claude reaches
remote connectors from Anthropic's cloud, so a self-hosted endpoint must be
publicly reachable. See Anthropic's current
[remote connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## Connect from Claude Code

Add the Streamable HTTP server:

```bash
claude mcp add --transport http refd https://refd.ai/api/mcp
claude mcp login refd
```

The login command opens the refd authorization page. You can also run `/mcp`
inside Claude Code and authenticate from the server menu. Use
`claude mcp logout refd` to clear Claude Code's stored credentials. See the
current [Claude Code MCP reference](https://code.claude.com/docs/en/mcp).

## Connect from ChatGPT

Custom MCP apps currently require developer mode. In ChatGPT web:

1. Enable developer mode for your account. The exact admin path depends on the
   plan; the current controls live under workspace permissions or **Settings →
   Apps → Advanced Settings**.
2. Open **Workspace settings → Apps → Create** as an admin or owner, or
   **Settings → Apps → Create** as an authorized developer.
3. Enter `https://refd.ai/api/mcp` as the MCP endpoint and select OAuth.
4. Select **Scan Tools**, complete the refd authorization flow, and wait for the
   scan to finish.
5. Select **Create**, then enable the draft app in a new chat to test it.

ChatGPT snapshots the approved tool definitions. After a server tool or input
schema changes, an admin must refresh its actions before the new version is
available. Availability and menu names can change while the feature is in beta;
see OpenAI's current
[developer mode and MCP apps guide](https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta).

## Available tools

| Tool | Purpose |
| --- | --- |
| `get_workspace_info` | Connected brand, competitors, and enabled AI surfaces |
| `get_visibility_overview` | Mention, citation, share-of-voice, position, sentiment, coverage, and surface metrics |
| `get_competitor_landscape` | Brand and competitor visibility comparison |
| `get_prompt_performance` | Buyer-question performance and zero-visibility prompts |
| `get_citation_sources` | Influential domains, cited brand URLs, unattributed sources, and source gaps |
| `get_recent_changes` | Material changes between the two latest comparable runs |
| `find_prompt_results` | Fuzzy prompt lookup with result IDs |
| `read_answer` | Clipped, ownership-checked AI answer evidence |
| `get_digest` | Complete grounded workspace snapshot |

Ranges accept `1d`, `3d`, `7d`, `30d`, `90d`, or `all` and default to `30d`.
The server also publishes `refd://glossary/metrics`, a read-only resource with
the definitions used by the dashboard.

Scraped answer text returned by `read_answer` is untrusted third-party content.
Clients should treat it as evidence, never as instructions.

## Revoke a connection

Open the connected workspace in refd, go to **Settings → Connected apps**, and
select **Revoke**. This invalidates the grant, its current access tokens, and its
refresh token. Removing the workspace or account also revokes its grants before
deleting the data.

## Self-hosting

Create a dedicated KV namespace and put its ID in the `OAUTH_KV` binding in
`wrangler.jsonc`:

```bash
bunx wrangler kv namespace create OAUTH_KV
```

Apply all D1 migrations before deployment. The OAuth provider creates no new
plaintext application secret; clients and encrypted grant/token state live in
the dedicated KV namespace. Keep the two native rate-limit bindings configured
with account-unique namespace IDs.

The production MCP URL is always `<PUBLIC_BASE_URL>/api/mcp`. Claude and
ChatGPT cloud connectors require a public HTTPS deployment. Claude Code can
connect to a reachable development URL directly.

## Local protocol checks

After `bun run dev`, these endpoints provide a quick unauthenticated smoke test:

```bash
curl -i https://refdlocal.io/.well-known/oauth-protected-resource/api/mcp
curl -i https://refdlocal.io/.well-known/oauth-authorization-server
curl -i -X POST https://refdlocal.io/api/mcp \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}'
```

The discovery requests should return JSON. The MCP request should return
`401 Unauthorized` with a `WWW-Authenticate` challenge because it has no bearer
token. A complete local OAuth flow additionally requires a registered refd user
and a client with a browser callback URL.
