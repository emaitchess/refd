# Plan: MCP Server (remote, OAuth 2.1)

Status: complete (all four phases executed 2026-07-28). Expose refd's read-only AI search intelligence to external AI agents over the
Model Context Protocol, so an agent can reason about any tracked brand's visibility in AI
answers and make informed search decisions — without ever mutating data or spending provider quota.

This doc is the tool-neutral plan; keep `CLAUDE.md` / `AGENTS.md` as the source of truth for
conventions.

Implementation note (2026-07-28): Cloudflare deprecated and feature-froze `McpAgent` after this
plan was written. New servers use the supported stateless `createMcpHandler()` path with MCP SDK
v2. The OAuth, tenancy, scope, and read-only decisions below are unchanged; the Durable Object is
no longer required.

## Locked decisions

- **Full OAuth 2.1 from the start** (not bearer API keys). refd is the OAuth Authorization
  Server *and* Resource Server. This makes the server connectable one-click from claude.ai /
  ChatGPT / Claude Code custom connectors, with Dynamic Client Registration so clients need no
  manual setup.
- **Per-workspace grants, chosen at consent time.** The authorization (consent) screen lists
  the signed-in user's workspaces and the user picks exactly one to grant. The chosen
  `workspaceId` is bound into the grant and every token minted from it. A token can only ever
  read one workspace; re-scoping requires a fresh authorization.
- **New Settings section — "Connected apps".** Per workspace, list who has access (app name,
  scopes, when granted, last used) with a per-connection **Revoke** action.
- **Read-only.** No tool mutates a table or triggers a paid run. Worst case for a
  prompt-injected downstream agent is a read within one workspace — a deliberate extension of
  the existing "the model never writes; writes are human-confirmed proposals" posture.

## Architecture

One Cloudflare Worker still does everything. We wrap the existing Hono app in Cloudflare's
official **`@cloudflare/workers-oauth-provider`**, which owns the OAuth endpoints and the token
lifecycle, and delegates:

- **API handler** → the MCP endpoint (a stateless `createMcpHandler()` server from the `agents`
  package, served over Streamable HTTP). The provider validates the bearer access token *before* the
  request reaches it and injects the grant's props (`{ userId, workspaceId, scopes }`) as
  authenticated MCP context.
- **Default handler** → the current Hono `app` (SPA + all existing `/api/*` routes) plus the
  consent UI.

```
MCP client (claude.ai / ChatGPT / Claude Code)
        │  1. discover  GET /.well-known/oauth-protected-resource   (RFC 9728)
        │               GET /.well-known/oauth-authorization-server (RFC 8414)
        │  2. register   POST /api/oauth/register                   (DCR, RFC 7591)
        │  3. authorize  GET  /api/oauth/authorize?...PKCE...        (OAuth 2.1 + PKCE S256)
        ▼
  @cloudflare/workers-oauth-provider  ──► defaultHandler (our consent page)
        │                                   • requires refd_session (else → /auth/sign-in?next=)
        │                                   • lists workspaces, user selects one
        │                                   • completeAuthorization({ userId, workspaceId })
        │  4. token      POST /api/oauth/token   → access (short-lived) + rotating refresh
        │  5. call       POST /api/mcp  Authorization: Bearer <access>
        ▼
   Stateless MCP handler  (props = { userId, workspaceId, scopes })
        └─► read-only tools → existing metric fns (routes/metrics.ts, routes/digest.ts)
                                and vetted accessors (routes/agent-tools.ts)
```

Why this stack: it is Cloudflare's canonical remote-MCP path, all pure-JS / workerd-safe (no
runtime WASM), and both libraries are officially maintained — matching the repo preference for
vetted security libraries over hand-rolled flows. `createMcpHandler()` provides the protocol
handshake, capability negotiation, current Streamable HTTP transport, and stateless compatibility
for published 2025 clients.

### Token → scope invariant

The `workspaceId` lives in the encrypted grant props, never in the request path or tool args.
Every tool resolves its workspace from `ctx.props.workspaceId` and ignores anything the caller
sends. This reproduces the `requireWorkspace` guarantee (owner-only, foreign = not found) and
eliminates the cross-tenant / IDOR class by construction. Tokens are also audience-bound to the
MCP resource (RFC 8707 resource indicators) so an access token can't be replayed at another
resource — the confused-deputy protection the MCP auth spec requires.

## Data model

The OAuth provider stores clients, grants, and tokens in a KV namespace (hashed at rest). We add
one small **mirror table** purely so the Settings UI can query grants *by workspace* and show
friendly names + `lastUsedAt` (KV alone isn't queryable by workspace):

`mcp_connections`
- `id` (pk), `grantId` (provider grant id, unique), `connectionKey` (encrypted-props
  connection id, unique), `workspaceId` (FK, indexed),
  `userId` (FK), `clientId`, `clientName`, `scopes` (json),
  `createdAt`, `lastUsedAt` (nullable), `revokedAt` (nullable).

The grant metadata and encrypted props are written on `completeAuthorization`. The mirror row is
written by `tokenExchangeCallback` when the authorization code is successfully exchanged, because
that is the first installed-library callback that exposes the provider's stable `grantId`.
`lastUsedAt` is bumped (best-effort, throttled) on MCP calls;
`revokedAt` set when revoked from Settings or via the provider's revocation endpoint. Mirror
rows are deleted with the workspace by the existing explicit workspace-deletion cleanup in
`routes/workspaces.ts` DELETE and account deletion in `auth/routes.ts`.

Drizzle: add to `src/api/db/schema.ts`, `bun run db:generate`, migration lands in `drizzle/`.

## Endpoints exposed (MCP tools)

All read-only, all scoped to `ctx.props.workspaceId`, all args validated with Zod `safeParse`
(lenient per the CLAUDE.md trust-boundary rule). Ranges reuse the existing `rangeSchema`
(`1d/3d/7d/30d/90d/all`). Each wraps existing, tested code — no new query logic.

| MCP tool | Wraps | Input | Returns / why it matters for AEO |
| --- | --- | --- | --- |
| `get_workspace_info` | `entities` + `settings` | — | Brand name/domain, tracked competitors, enabled surfaces. Orientation. |
| `get_visibility_overview` | `routes/overview.ts` + digest `overview`/`surfaces` | `range` | Brand mention rate, citation rate, SOV, avg position, per-surface split. "How visible am I in AI answers?" |
| `get_competitor_landscape` | `routes/competitors.ts` | `range` | Every entity's mention/citation rate, SOV, position, sentiment. Share-of-voice vs rivals. |
| `get_prompt_performance` | `routes/prompts.ts` | `range` | Per buyer-question rates + **zero-visibility prompts**. Which questions the brand loses. |
| `get_citation_sources` | `routes/sources.ts` | `range` | Top cited domains, our cited URLs, and the **gap list** (domains AI cites where we're absent). The actionable "go get cited here" output. |
| `get_recent_changes` | `routes/changes.ts` | — | Thresholded material changes between the last two completed runs. Trend/alert signal. |
| `find_prompt_results` | `agent-tools.ts` `get_prompt_results` | `prompt` | Fuzzy-match a tracked prompt → per-surface result rows + `resultId`s. Lookup before `read_answer`. |
| `read_answer` | `agent-tools.ts` `read_answer` | `resultId` | The actual AI answer text (ownership-checked, R2-backed, clipped). Evidence/quotes. |
| `get_digest` | `routes/digest.ts` `buildDigest` | `range` | Full grounded snapshot in one call. One-shot context. |

**MCP resources:** expose the metric glossary from `src/app/lib/metric-copy.ts`
as a read resource so agents know what "SOV", "citation rate", etc. mean.

**Scopes:** ship one scope, `data:read`, covering all tools (human-readable on the consent
screen as "Read your AI visibility data"). Granular scopes (`visibility:read`, `answers:read`)
can be added later without breaking clients.

### Deliberately NOT exposed

- Any mutation — no prompt/entity/workspace/settings create-update-delete.
- The `/runs` operator levers (they spend BrightData quota) — stay `requireOperator`-only.
- Onboarding, chat, auth/account routes, and raw-by-arbitrary-key R2 dumps (only the
  ownership-checked `read_answer` reads answer text).
- Cross-workspace access — structurally impossible given the per-grant scope.
- `search_web` (Exa) — costs spend and isn't refd's unique value; the calling agent has its own
  web search. Left off; trivial to add behind an opt-in later.

## Consent screen (workspace selection)

Rendered by the default handler at `GET /api/oauth/authorize`:

1. Parse the OAuth request with the provider's `OAuthHelpers.parseAuthRequest`.
2. Require a valid `refd_session` cookie (reuse `readSession`). If absent → 302 to the SPA
   `/auth/sign-in?next=<authorize-url>`; after login the SPA returns the user here.
3. Render a standalone approval page (monochrome chrome per DESIGN.md): the
   requesting **app name** (from the registered client), the requested **scope** in plain
   language, and a **workspace picker** (radio list of the user's workspaces from D1, owner-only).
4. On approve (POST to the authorize route, CSRF-protected), call
   `completeAuthorization({ userId, metadata, scope, props: { userId, workspaceId } })` and 302
   back to the client's redirect URI with the auth code. The token-exchange callback mirrors the
   connection into D1 once the client exchanges that code.
5. On deny → error redirect per OAuth.

## Settings — "Connected apps"

New card in the workspace Settings page (`/settings` router + `pages/Settings` UI), below the
surfaces card. Reads `GET /api/w/:workspaceId/connections` → `mcp_connections` rows for this
workspace where `revokedAt is null`, each showing: app name, scopes, granted date, last used.
Each row has a **Revoke** action → `DELETE /api/w/:workspaceId/connections/:id` which calls the
provider's grant-revocation helper and stamps `revokedAt` (revoked access tokens stop working
immediately; refresh is invalidated). Both endpoints are workspace-scoped and owner-only via the
existing `requireWorkspace`. Toasts via `useToast()`; no em dashes in copy.

## Security & standards checklist

- **OAuth 2.1**: authorization-code flow, **PKCE S256 mandatory**, exact redirect-URI match,
  short-lived access tokens, rotating refresh tokens, revocation endpoint (RFC 7009).
- **Discovery**: RFC 9728 protected-resource metadata + RFC 8414 auth-server metadata so clients
  auto-configure; **DCR** (RFC 7591) so clients self-register.
- **Audience binding** (RFC 8707) so an access token is valid only at `/api/mcp` — no token
  pass-through / confused deputy.
- **At rest**: provider stores clients/tokens hashed in KV; we store no plaintext secret.
- **Least privilege**: read-only tools + single-workspace scope = minimal blast radius even if a
  downstream agent is prompt-injected by scraped answer text (which is returned as data, with
  tool descriptions flagging it as untrusted third-party content).
- **Input validation**: Zod `safeParse` on every tool arg; bounded strings/ints/ranges.
- **Rate limiting**: Cloudflare native Rate Limiting bindings enforce 120 MCP requests per
  token fingerprint per minute and 30 OAuth requests per IP/client/path per minute.
- **No cookie auth on the MCP path**: MCP is bearer-only, so no CSRF surface there; the consent
  POST is the only cookie-authenticated write and is CSRF-protected.
- **Errors**: structured JSON-RPC / OAuth errors, no internal detail leakage.

## Infra & config changes

- **Deps** (`bun add`): `@cloudflare/workers-oauth-provider`, `@modelcontextprotocol/server`,
  `agents`. Verify each imports cleanly on workerd (`bun run check` + a dev boot) before wiring —
  no runtime-WASM transitive deps.
- **`wrangler.jsonc`**:
  - Add a **KV namespace** binding (e.g. `OAUTH_KV`) for the provider's store.
  - Extend `assets.run_worker_first` so OAuth/discovery paths hit the worker, not the SPA:
    add `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource*`,
    and the `/api/oauth/*` + `/api/mcp` routes (the last two are already under `/api/*`).
- **`src/api/index.ts`**: wrap the default export in the OAuth provider while preserving
  `scheduled` and `queue`:
  ```
  const oauth = new OAuthProvider({
    apiRoute: '/api/mcp',
    apiHandler: createMcpHandler(createRefdMcpServer),
    defaultHandler: app,                          // existing Hono app + consent UI
    authorizeEndpoint: '/api/oauth/authorize',
    tokenEndpoint: '/api/oauth/token',
    clientRegistrationEndpoint: '/api/oauth/register',
    scopesSupported: ['data:read'],
  });
  export default { fetch: oauth.fetch, scheduled, queue };
  ```
- **Secrets**: no new provider secrets required beyond what the KV/DO bindings give; the
  provider manages its own signing/encryption material in KV.

(The installed provider's `parseAuthRequest`, `completeAuthorization`, grant list/revoke helpers,
and `tokenExchangeCallback` signatures were confirmed during Phase 1.)

## Work breakdown

- **Phase 1 — OAuth core: complete.** Dependencies, KV binding, worker composition,
  discovery, DCR, S256 PKCE authorization, consent workspace picker, token/refresh lifecycle,
  revocation, login return path, mirror migrations, and session/CSRF tests are implemented.
- **Phase 2 — MCP tools: complete.** All nine read-only tools use centralized grant resolution,
  validated schemas, existing metric/digest primitives, ownership-checked evidence reads, and
  the metric-glossary resource. The connector guide covers Claude, Claude Code, ChatGPT, local
  checks, and self-hosting.
- **Phase 3 — Settings UI: complete.** The Connected apps card and workspace-scoped
  list/revoke API show client, permission, grant time, and last use. Workspace and account
  deletion revoke provider grants before deleting mirror rows.
- **Phase 4 — Hardening: complete.** Native rate limits, throttled `lastUsedAt`, structured
  authorization/tool/revocation/error events, host/origin restrictions, token fingerprints,
  argument/scope tests, a 25-request parallel load smoke, and a full isolated-worker OAuth/MCP
  flow are complete.

## Testing

- Automated validation completed on 2026-07-28:
  - 196 unit tests, including tool arguments, immutable workspace scope, consent session/CSRF,
    OAuth policy, and rate limits.
  - TypeScript, Biome, production Vite build, Worker startup analysis, and a clean six-migration
    D1 apply.
  - Full isolated-worker flow: registration, DCR, S256 PKCE, consent, access and refresh tokens,
    MCP initialization, nine-tool discovery, glossary discovery, scoped `get_workspace_info`,
    `lastUsedAt`, cross-workspace Settings isolation, 25 parallel requests, Settings revocation,
    and rejection of both the revoked access and refresh tokens.
- Final product smoke: connect a deployed HTTPS endpoint from claude.ai, Claude Code, or
  ChatGPT using `docs/mcp.md`. This is the deployment/user acceptance check, not an
  implementation dependency.

## Open questions / future

- Granular per-tool scopes and read/annotate tiers.
- Rescope-in-place (switch a grant's workspace) vs. always re-authorize (current plan: re-auth).
- Optional `search_web` tool behind explicit opt-in.
- Org/team grants once a workspace membership model exists (today ownership is the only tenancy
  boundary).
