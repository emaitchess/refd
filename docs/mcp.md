# Remote MCP connector

refd exposes a remote Model Context Protocol server at:

```text
https://api.refd.ai/mcp
```

The hosted guide for agents lives at [refd.ai/agents](https://refd.ai/agents)
([markdown](https://refd.ai/agents.md)); this document is the same contract
with more protocol detail. The connector uses OAuth 2.1 with S256 PKCE. It
supports Client ID Metadata Documents, with Dynamic Client Registration as a
compatibility fallback. During authorization, refd asks you to choose the
workspaces a connection may act on: check any number of completed
workspaces, or flip **Allow all** so the agent sees every workspace on the
account, including ones created later. Write-scope approvals add an option to
provision a new workspace with the agent.

Two scopes exist:

- `data:read` (default): the analytics and evidence tools. Cannot change data
  or spend provider quota. A connection may cover several workspaces. All
  tools accept an optional `workspace` argument (the workspace id, from
  `get_workspace_info`); omit it to target the connection's default. A
  checked-set connection is pinned to the workspaces approved at consent
  time; an **Allow all** connection resolves the account's workspaces at
  request time, so new workspaces join with no re-approval.
- `data:write`: adds the setup tools for every approved workspace. The agent
  can draft, edit, and preview a workspace's setup, and `confirm_setup`
  starts exactly one provider-backed onboarding report per workspace; the
  same per-workspace draft versions and spend budgets that bound the
  dashboard apply. On onboarded workspaces the write scope also carries
  row-scoped prompt management (below) and `run_now`, an immediate paid run
  limited to administrator accounts. The consent screen discloses what write
  access allows before approval.

Write integrity does not rest on the token: setup mutations carry an
optimistic-concurrency version, and `confirm_setup` verifies a canonical
configuration hash recomputed server-side. Draft edits from the dashboard and
an agent collide loudly instead of overwriting one another.

OAuth app names and identity metadata are self-reported. The consent screen
labels the app as unverified and shows the normalized callback target. Approve
only a connection you started and confirm that the callback target belongs to
the app you intended to connect. Remote callbacks must use HTTPS; loopback HTTP
and app-specific URI schemes remain available for native clients.

## Official Registry

The domain-verified remote server is published in the official MCP Registry as
`ai.refd/refd`. Its canonical metadata lives in the repository root at
`server.json` and points clients to the Streamable HTTP endpoint above.

Registry versions are immutable. Any later metadata or transport change must
bump the semantic version in `server.json` before republishing. Domain
authentication uses the public proof at
`https://refd.ai/.well-known/mcp-registry-auth`; the private publishing key is
never stored in the repository.

## Connect from Claude

Claude custom connectors are available from **Customize → Connectors**. On an
individual plan, select **+ → Add custom connector**. On Team and Enterprise
plans, an Owner first adds it from **Organization settings → Connectors → Add →
Custom → Web**. Enter `https://api.refd.ai/mcp`; no client ID or secret is
needed. Select **Connect**, sign in to refd, choose the workspaces (or flip
**Allow all**), and approve the requested scopes.

Enable refd for a conversation from the **+ → Connectors** menu. Claude reaches
remote connectors from Anthropic's cloud, so a self-hosted endpoint must be
publicly reachable. See Anthropic's current
[remote connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## Connect from Claude Code

Add the Streamable HTTP server:

```bash
claude mcp add --transport http refd https://api.refd.ai/mcp
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
3. Enter `https://api.refd.ai/mcp` as the MCP endpoint and select OAuth.
4. Select **Scan Tools**, complete the refd authorization flow, and wait for the
   scan to finish.
5. Select **Create**, then enable the draft app in a new chat to test it.

ChatGPT snapshots the approved tool definitions. After a server tool or input
schema changes, an admin must refresh its actions before the new version is
available. Availability and menu names can change while the feature is in beta;
see OpenAI's current
[developer mode and MCP apps guide](https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta).

## Connect any MCP client

Any Streamable HTTP MCP client works: point it at the endpoint, and it
discovers authorization through the protected-resource metadata
(`/.well-known/oauth-protected-resource/mcp`). For clients configured with a
JSON file (opencode uses an `mcp` block; Claude Desktop, Cursor, and most
others use `mcpServers`):

```json
{
  "mcp": {
    "refd": { "type": "remote", "url": "https://api.refd.ai/mcp" }
  }
}
```

```json
{
  "mcpServers": {
    "refd": { "type": "http", "url": "https://api.refd.ai/mcp" }
  }
}
```

The first connection triggers the OAuth sign-in in a browser. Clients that
cannot open one, use a personal access token instead (next section) and send
it as `Authorization: Bearer` on every request, either as a custom-header
option in the client config or by talking to the endpoint directly.

### One-click install

Cursor and VS Code open with the server preconfigured and start the OAuth
sign-in:

- Cursor: `cursor://anysphere.cursor-deeplink/mcp/install?name=refd&config=eyJ0eXBlIjoiaHR0cCIsInVybCI6Imh0dHBzOi8vYXBpLnJlZmQuYWkvbWNwIn0=`
- VS Code: `vscode:mcp/install?name=refd&config=%7B%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fapi.refd.ai%2Fmcp%22%7D`

One command instead of a click:

```bash
claude mcp add-json refd '{"type":"http","url":"https://api.refd.ai/mcp"}'
claude mcp login refd
```

```bash
code --add-mcp '{"name":"refd","type":"http","url":"https://api.refd.ai/mcp"}'
```

## Headless and CI agents (personal access tokens)

OAuth needs a browser. Where there is none (CI, cron, servers, sandboxed
agents), generate a workspace-scoped read-only personal access token:

1. No workspace yet? Create an account (business email) at
   [dash.refd.ai/auth/create-account](https://dash.refd.ai/auth/create-account)
   and finish the onboarding wizard. Self-hosted: register on your own
   dashboard.
2. Open the workspace in refd, go to **Settings → Personal access tokens**,
   and create a token named after the agent or pipeline.
3. Copy the token once. It is stored only as a SHA-256 hash and cannot be
   retrieved again.
4. Call the MCP endpoint with it:

```bash
curl -X POST https://api.refd.ai/mcp \
  -H "Authorization: Bearer refd_..." \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"ci","version":"1"}}}'
```

The response is the normal `initialize` result: the token authenticates
exactly like an OAuth grant, with the same `data:read`-only, single-workspace
scope. Requests are rate-limited per token. Revoking the token in Settings
invalidates it on the next request; deleting the workspace or account removes
its tokens. Tokens never appear in logs, and a token cannot be listed,
exported, or narrowed to fewer prompts than the workspace tracks.

## Reading a cohort-filtered number

`kind` accepts a comma-separated string or a JSON array of cohort names, and an
unknown name is refused rather than dropped. Omitted, `get_visibility_overview`,
`get_competitor_landscape` and `get_attribute_performance` report the **discovery**
cohort, because a prompt naming the brand scores near 1.0 by construction and a
blend flatters the brand; `get_prompt_performance` and `get_citation_sources`
report **every** cohort. Read the `population` or `headlineScope` field rather than
assuming either, since the default differs by tool.

## Reading a declared intent

`funnelStage` and `questionType` are **declared on the prompt, never inferred**. The
cohort filter is different: it is provable from the text, because the same matcher that
scores a mention decides it. A funnel stage is not — no substring settles where a buyer
is in a journey, and a guessed value would be indistinguishable from a chosen one once
stored.

So:

- a prompt with no declared stage or type is in no bucket, and the response counts it
  under `undeclared` rather than defaulting it to awareness
- omitting the filter means **every declared value**, which is a different population from
  the cohort default of discovery; the response names both in `population` and
  `funnelStageScope`
- an empty bucket is reported with no rate, and sorts after the measured buckets
- set them with `add_prompt` (`funnelStage`, `questionType`) or `update_prompt`, where an
  explicit `null` clears the declaration and omitting the field leaves it alone

The two axes are independent: a question can be `commercial` at `awareness`.

## Reading a change event

Every event from `get_recent_changes` carries `measuredOver: 'shared-cells'`: the
engine compares only the prompt and surface cells present in **both** windows, so
an event is a comparison of the same questions even when the live prompt set has
changed. Set-relative events (share of voice, position) are withheld unless the
tracked entity and prompt sets are unchanged across the comparison.

`status` is `population-moved` when the prompt set has changed since the window was
measured. That is a valid report, not a failure: the events stand for the shared
cells, and `caveat` carries one sentence saying which case applies.
`liveSetUnchanged` says whether the questions are still tracked now, and
`populationMatches` is the older combined flag equal to it.

## Available tools

| Tool | Purpose |
| --- | --- |
| `get_workspace_info` | Connected workspaces, brand, competitors, and enabled AI surfaces |
| `get_visibility_overview` | Mention, citation, share-of-voice, position, sentiment, coverage, and surface metrics, plus a `byCohort` breakdown |
| `get_competitor_landscape` | Brand and competitor visibility comparison |
| `get_prompt_performance` | Buyer-question performance and zero-visibility prompts |
| `get_citation_sources` | Influential domains, cited brand URLs, unattributed sources, and source gaps |
| `get_recent_changes` | Material changes between the two latest comparable runs, plus the prompt population each event was measured on |
| `find_prompt_results` | Fuzzy prompt lookup with result IDs |
| `read_answer` | Clipped, ownership-checked AI answer evidence |
| `get_digest` | Complete grounded workspace snapshot |
| `get_run_history` | Recent run cycles, newest first: date, trigger, status, collected/total answers, dispatch state, entity-set hash, the frozen prompt count, `promptSetVersionId`, and `promptSetHash` |
| `get_intent_performance` | Visibility by declared funnel stage and question type, worst first on each axis: prompt count, measured prompts, answers, mention and citation rate. Both axes are declared on the prompt and never inferred; a prompt with neither is counted under `undeclared` |
| `get_prompt_set_timeline` | Every distinct prompt population the workspace has run against, oldest first: version id, prompt ids and count, surfaces, what changed to get there, and how many runs were collected on it. `sequence` is this workspace's own order while `versionId` is a global row id, so a sequence starting above 1 is not missing history; `historyComplete` is false when a run's population could not be recovered |
| `get_attribute_performance` | Per-attribute visibility, worst first: tracked prompts, prompts inside the reported population, active variants, answers, mention and citation rate, share of voice, and an `unmeasured` flag for an attribute measured by a single prompt |
| `get_prompt_changes` | Per-prompt diff of the two most recent completed runs: mention/citation rate deltas, zero-visibility transitions, and prompts that entered or exited the set |
| `get_prompt_citations` | The URLs cited for one prompt over a range, grouped by URL with counts and an isOurs flag |

Ranges accept `1d`, `3d`, `7d`, `30d`, `90d`, or `all` and default to `30d`.

**Prompt cohorts.** A prompt that names the brand is scored near 1.0 by
construction, so an aggregate that pools every prompt flatters the brand. The
aggregates that pool prompts therefore take a `kind` filter, comma-separated:

| Value | Prompts it keeps | How it is decided |
| --- | --- | --- |
| `brand_defining` | The prompt text names your brand | derived from the text |
| `alternative` | It names only a tracked competitor | derived from the text |
| `discovery` | It names neither, so the rate is unprompted visibility | derived, and the default for anything unclassified |
| `problem` | Declared: the prompt describes a buyer problem | you choose it, at setup or via `update_prompt` |
| `market_perception` | Declared: the prompt asks how the market frames the category | you choose it, at setup or via `update_prompt` |

`brand_defining`, `alternative` and `discovery` are derived from the prompt text by
the same matcher that scores a mention, so they are provable and always right.
`problem` and `market_perception` are **declared, not inferred**: telling a
problem-shaped question from a broad discovery one is a judgement about buyer
intent, and no keyword settles it, so the product does not guess. Set them in the
onboarding prompts step or with `update_prompt(kind)`. The two retired names
`branded` and `competitor` are refused rather than accepted as aliases, so a stale
caller gets a validation error instead of a silently empty cohort.

| Tool | Takes `kind`? |
| --- | --- |
| `get_visibility_overview` | yes, and returns every cohort at once in `byCohort` |
| `get_competitor_landscape` | yes |
| `get_citation_sources` | yes |
| `get_prompt_performance` | yes, applied to the prompt list, the per-surface splits, and `zeroVisibility` alike |
| `get_digest` | **no, by design** (see below) |

**Omitting `kind` does not hand you a blend.** `get_visibility_overview`,
`get_competitor_landscape` and `get_citation_sources` head their figures with the
**discovery** cohort, because a caller who asks nothing should not be handed a
number that brand-named questions inflated. A filter matching no prompt yields
empty rates rather than quietly falling back. A workspace with no discovery
prompts falls back to every cohort and says so in `population: "all"`.

`get_visibility_overview` returns three things:

| Field | What it is |
| --- | --- |
| `headline` | The figures for the named population, plus `population` and a plain-English `scope` |
| `byCohort` | All five cohorts at once: prompt count, answers, both rates, and both share-of-voice figures per cohort |
| `blended` | The old pooled figure, marked `deprecated: true`, kept so you can compare against an earlier reading |

So one call answers "how visible am I when nobody asked by name".

**This was a breaking change.** The top-level `mentionRate`, `citationRate`,
`shareOfVoice`, `citationShareOfVoice`, `averagePositionWhenMentioned`, `firstNamedShare`,
`prominence`, `sentiment` and `answers` fields now live under `headline` and
`blended`, an unfiltered call reports discovery rather than the blend, and
`headlineScope` became `headline.population` plus `headline.scope`.
`get_competitor_landscape` returns `population` and `populationScope`.

**Position is conditional on mention, and says so.** `averagePosition` is now
`averagePositionWhenMentioned`, reported with `positionedAnswers`, the count of
answers the mean covers. The mean is arithmetically correct but a surface where the
brand is mentioned in 3% of answers can still post exactly 1.0, because the surface
opens with the most prominent entity. Under the old name that read as a position the
brand holds across the surface, which is the reverse of the truth, and placed beside
a mention rate it invited a comparison the two figures do not support. There is no
threshold that hides it: leading with the brand when it names it is worth knowing.

`get_digest` deliberately takes no `kind`. It is a whole-workspace rollup that
already carries every cohort side by side in `sections.prompts.cohorts`, and
`buildDigest` has no cohort seam, so accepting a filter there would relabel a
blended number as cohort-specific while leaving it blended. Read
`sections.prompts.cohorts` instead.

Cohorts are classified from the prompt text by the same matcher that scores a
mention, so a prompt naming both the brand and a competitor is `branded`;
`list_prompts` reports each prompt's cohort and the per-cohort counts.

**Reading a trend honestly.** `get_run_history` reports `promptSetVersionId` per
run, and two runs sharing one version id were measured against the same
questions, which is the precondition for reading their numbers as a trend rather
than as two separate facts. `get_prompt_set_timeline` lists every population the
workspace has run against with what changed between them, so "which prompts were
live in week 32" is answerable and a direct comparison across a version boundary
can be recognised before it is made. A version is minted the first time a
population is measured, so a change with no subsequent run has no version yet:
it exists as a draft, not as a measurement.

**Reading a trend honestly.** `get_recent_changes` reports the population its
events were measured on next to the population tracked now: `promptCount` is the
former, `activePromptCount` the latter, and `populationMatches` is true only when
they are the same set. When the prompt set changed between the compared windows,
share-of-voice and position events are withheld, because a share moving with a
change of questions is not a visibility event. `populationNote` states which of
those cases applies in one sentence, and `get_run_history` carries
`promptSetHash` per run so a trend can be split where the population changed
instead of being read as one line. Contract: `docs/METRICS.md` "Prompt population
and trend honesty".

Every tool, read or setup, accepts an optional `workspace` argument (the
workspace id from `get_workspace_info`); an argument outside the connection's
granted set is rejected. The server also publishes
`refd://glossary/metrics`, a read-only resource with the definitions used by
the dashboard.

With the `data:write` scope, twelve setup tools plus `revoke_connection` cover
the whole lifecycle, and six prompt tools keep an onboarded workspace current.
`create_workspace` provisions a brand-new workspace; the other ten onboard
one:

| Tool | Purpose |
| --- | --- |
| `create_workspace` | Provisions a owned workspace. Only for connections approved with **Allow all workspaces**: a checked grant could never target a workspace created after approval. The optional `idempotencyKey` makes duplicate calls resolve to one workspace |
| `check_domain` | Verifies a domain resolves and where its redirect chain lands, with a www fallback. Run it on every brand and competitor domain before saving: a wrong domain silently breaks citation matching forever |
| `get_setup_state` | Setup wizard state: phase, editable draft, version, regen allowances, plus the caller's effective limits and the generation budget over the last 24h |
| `set_brand` | Sets or updates the tracked brand: name, domains, aliases |
| `draft_description` | Fetches the brand website and drafts description, summary, and target market |
| `suggest_competitors` | Generates editable competitor candidates from indexed company search; failures carry the cause and, when indexed pages exist, the raw candidate domains |
| `suggest_prompts` | Generates categorized, editable buyer-question candidates, steerable with `steering.total` and `steering.focus` |
| `update_setup` | Applies explicit edits to any draft field, including enabled surfaces. `removeSemantics` is `merge` (default: the draft is additions and edits, nothing tracked is touched) or `replace` (the submitted prompt list becomes the whole set, and anything it omits is retired with a `retiredBy: "setup-sync"` marker). A repeated prompt text in one submission is refused with a 409 naming the index, since prompt text is unique per workspace |
| `preview_setup` | Returns the exact canonical configuration, its hash, a per-surface expected-check breakdown, and `promptDiff`: the prompts that will be **added**, **updated** (with the category changing), **retired**, and left **untouched**, against the live set. Under `replace` this is where you see which questions stop being measured, before committing |
| `confirm_setup` | Commits the approved configuration and starts the one provider-backed onboarding report |
| `get_setup_report` | Live progress and the pinned setup report for the run group |
| `complete_setup` | Flips `onboardingCompleted` after the commit, the same gate the dashboard's "enter dashboard" click passes |
| `revoke_connection` | Revokes the OAuth grant the credential itself belongs to: tokens die and access to every approved workspace ends together. Requires `confirm: true`; it cannot touch any other connection or user. PATs revoke from Settings instead |

Every generation failure carries `detail` (the cause) and `guidance` (the next
action, including that a retry is free: failed drafts never consume the
per-step regeneration budget). Idempotency keys are any opaque string, not
necessarily a UUID.

Workflow: `create_workspace` (when granted), `get_setup_state`, `check_domain`
on each candidate domain, `set_brand`, `draft_description`, suggest or update
competitors and prompts, `preview_setup`, explicit user approval,
`confirm_setup`, then `get_setup_report` until the runs land, then
`complete_setup` to finish. Every mutation carries `expectedVersion` from the
latest state (a stale version returns a structured conflict naming what moved
it), the workflow is budgeted per user and workspace, and `confirm_setup` is
the only provider-spending setup action a connector can reach.

## Keeping an onboarded workspace current

After onboarding, tracking changes should be an operational task, not a setup
migration: eleven data:write tools manage tracked prompts, competitors, and
surfaces **row by row**, so a single change never rewrites the whole
configuration or touches the setup draft. All of them refuse a workspace whose
setup has neither committed nor completed (finish onboarding first); every one
takes the usual optional `workspace` selector. Brand edits keep using
`set_brand`, which already applies immediately to the live brand entity, before
or after onboarding.

| Tool | Purpose |
| --- | --- |
| `list_prompts` | Every tracked prompt with id, text, category, tags, cohort kind, active status, and answer counts, plus the active-prompt limit, the valid categories, and the per-cohort counts |
| `add_prompt` | Adds one prompt (8-500 chars, optional category from Discovery, Evaluation, Comparison, Decision, Authority that becomes its single tag) and returns the assigned id and the resolved cohort kind; a repeated text converges to the existing prompt instead of erroring. The optional `kind` (`branded`, `competitor`, `discovery`) overrides the classifier, which otherwise reads the prompt text against the tracked brand and competitors | The optional `attribute` names the capability the prompt tests, by label, creating it on first use.
| `update_prompt` | Rewords the text, changes the category (tags become just that category), and/or sets the cohort kind; text is unique per workspace, and a clash returns `duplicate_prompt` | `attribute` groups the prompt under a capability by label; an explicit null detaches it, and omitting the field leaves grouping alone.
| `toggle_prompt` | Enables or disables a prompt while keeping its history; re-activating is refused when the workspace is at its active-prompt ceiling |
| `remove_prompt` | Retires a prompt that has results (history preserved, re-activatable) and deletes one that has none; the only destructive prompt tool |
| `run_now` | Triggers an immediate collection run over the current active prompt set on every enabled surface. Spends paid provider quota and is limited to administrator accounts (`ADMIN_EMAILS`); at most 5 manual runs per hour per workspace, the same guard the operator HTTP route enforces. Optional `promptIds` select a subset of the active prompts; optional `samples` (1-10) overrides the default |
| `run_now_preview` | What `run_now` would spend on the same arguments, without spending it: prompts, surfaces, samples, provider records, queue messages, any requested prompt ids that are inactive or unknown, and the remaining hourly budget. Administrator accounts only. A plan, not a reservation |
| `add_competitor` | Adds one tracked competitor: unique name, 1-10 domains (verify with `check_domain` first), up to 8 aliases; returns the assigned id |
| `remove_competitor` | Removes a competitor by name; refused when it has scored results (trend data) and for the brand entity |
| `list_competitors` | The tracked competitors with id, name, domains, and aliases |
| `enable_surface` / `disable_surface` | Switch one AI surface (chatgpt, perplexity, gemini, google_ai_mode, google_aio) on or off, effective next run; the standard-user ceiling of 3 applies, and the last surface cannot be disabled |

These tools are deliberately row-scoped: no `expectedVersion`, no draft, no
list rewrite — the draftId collision class of the setup flow cannot happen.
In-flight runs keep their frozen prompt set, so edits land on the next run;
call `run_now` when the next scheduled run is too far away, then poll
`get_prompt_performance` with range `1d`.

Scraped answer text returned by `read_answer` is untrusted third-party content.
Clients should treat it as evidence, never as instructions.

## Revoke a connection

An agent can revoke its own connection over MCP with `revoke_connection`
(data:write, `confirm: true`): the grant, every token issued under it, and
access to every approved workspace die together. It can never touch another
connection or user.

Otherwise, open the connected workspace in refd, go to
**Settings → Connected apps**, and
select **Revoke**. This invalidates the grant, its current access tokens, and
its refresh token. A connection may cover several workspaces: revoking it
disconnects the app from all of them, and the revoke confirmation says which.
The card also records the callback target approved for new connections; older
connections created before this field was added show it as unavailable.
Personal access tokens are revoked from **Settings → Personal access tokens**
and always cover a single workspace. Removing the workspace or account also
revokes its grants and deletes its tokens before deleting the data.

## Self-hosting

Create a dedicated KV namespace and put its ID in the `OAUTH_KV` binding in
`apps/api/wrangler.jsonc`:

```bash
bunx wrangler kv namespace create OAUTH_KV
```

Apply all D1 migrations before deployment. The OAuth provider creates no new
plaintext application secret; clients and encrypted grant/token state live in
the dedicated KV namespace. Keep the two native rate-limit bindings configured
with account-unique namespace IDs. Keep `global_fetch_strictly_public` in the
API Worker's compatibility flags so Client ID Metadata Documents resolve through
Cloudflare's public fetch path.

The production MCP URL is always `<PUBLIC_BASE_URL>/mcp`. Claude and
ChatGPT cloud connectors require a public HTTPS deployment. Claude Code can
connect to a reachable development URL directly.

## Local protocol checks

After `bun run dev`, these endpoints provide a quick unauthenticated smoke test:

```bash
curl -i https://api.refdlocal.io/.well-known/oauth-protected-resource/mcp
curl -i https://api.refdlocal.io/.well-known/oauth-authorization-server
curl -i -X POST https://api.refdlocal.io/mcp \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}'
```

The discovery requests should return JSON. Authorization-server metadata should
report `client_id_metadata_document_supported: true`. The MCP request should
return `401 Unauthorized` with a `WWW-Authenticate` challenge because it has no
bearer token. A complete local OAuth flow additionally requires a registered
refd user and a client with a browser callback URL.

With a personal access token (Settings → Personal access tokens), the same
request on the deployed endpoint carrying
`-H "Authorization: Bearer refd_..."` returns a successful `initialize` result;
a revoked or malformed token returns `401` with the same challenge. Like OAuth
bearer tokens, tokens are audience-bound to the canonical resource, so an
origin that does not match `PUBLIC_BASE_URL` fails closed.
