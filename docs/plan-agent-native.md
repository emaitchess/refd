# Plan: Agent-Native refd

Status: active, partially shipped (2026-07-28). Make refd a platform an autonomous AI agent can discover,
authenticate to, set up a brand's AI-visibility monitoring on, pay for, and read results from —
end to end, without a human opening the dashboard. This is the sequel to `docs/plan-mcp.md`
(read-only MCP over OAuth, shipped); it builds the
0-to-1 write + payment + identity layers on top.

This doc is the tool-neutral plan; `CLAUDE.md` / `AGENTS.md` remain the source of truth for
conventions. Layer 1 and part of Layer 0 are shipped; Layers 2–4 remain proposed.

## The thesis, and the honest version of it

The product that measures how brands show up to AI should itself be fully operable *by* AI. That
is a real wedge and it dogfoods the whole thesis. But "any agent signs up and runs monitoring on
its own" collides with the one constraint the entire codebase is built around: **BrightData spend
and abuse control.** A run costs real money (~180 provider records; ~$6.75/workspace/month at the
hosted ceiling), which is exactly why runs are `requireOperator`-gated and rate-limited today.

So the honest reframe, and the design principle for everything below:

> Agent-native does **not** mean "anonymous agents spend refd's provider budget." It means a
> principal — a human delegating to an agent, **or** a verified, paying agent — can drive refd
> end to end through a typed, safe interface, and **the party that triggers spend is the party
> that pays for it.** Payment is not a bolt-on; it is the primitive that makes autonomous
> provisioning safe. No payment, no run — which is a *stronger* abuse guard than the email gate.

That single inversion (gate paid actions behind payment instead of behind an operator allowlist)
is what turns "agent-native" from a liability into the safest possible autonomous path.

## What "agent-ready" actually requires (grounded, not hype)

Scored against the isitagentready.com rubric (Discoverability, Content Accessibility, Bot Access
Control, Protocol Discovery, Commerce) and cross-checked against what AI systems *actually
consume* in 2026. refd already passes more of this than most sites.

| Rubric area | Signal | refd today | Verdict / action |
| --- | --- | --- | --- |
| Discoverability | robots.txt + sitemap | ✅ `public/robots.txt`, generated `sitemap.xml` | Keep. |
| Discoverability | `Link:` discovery headers | ✅ Homepage advertises the OAuth protected-resource description and `llms.txt` | Keep covered by the agent-readiness scan. |
| Discoverability | DNS-AID (DNS for AI discovery) | ✅ DNSSEC-signed ServiceMode SVCB at `_mcp._agents.refd.ai` | Keep the MCP target stable and monitor the evolving draft. |
| Content Accessibility | Markdown content negotiation | ✅ `/` serves `text/markdown` when explicitly requested; `index.md`, `llms.txt`, and `llms-full.txt` remain directly available | Keep covered by the agent-readiness scan. Note: `llms.txt` is **write-only** in practice (no major crawler fetches it; Google says on record it ignores it). Useful for coding agents pasting docs, not a discovery channel. Do not oversell it. |
| Content Accessibility | schema.org / JSON-LD | ❌ | **Add.** This is the one machine-readable description AI answer engines *do* read (Google/Bing/ChatGPT). `Organization` + `SoftwareApplication` on the landing page. |
| Bot Access Control | AI-bot rules + Content Signals | ✅ `Content-Signal: ai-train=yes, search=yes, ai-input=yes` | Correct posture — being crawled/cited is on-brand for a visibility product. Keep. |
| Bot Access Control | Web Bot Auth (verify agent identity) | ❌ | **Add** for the agent-native tier (see Identity). Cloudflare-native, Workers-friendly, shipping. |
| Protocol Discovery | MCP server + OAuth PRM (RFC 9728) | ✅ Shipped (`docs/plan-mcp.md`) | Keep the read-only, workspace-scoped contract stable. |
| Protocol Discovery | Official MCP Registry | ✅ `ai.refd/refd` version `0.1.0` is active and domain-verified | Keep `server.json` versioned and verify downstream directory ingestion. |
| Protocol Discovery | Agent manifest + API catalog | ⚠️ OAuth well-known metadata exists; no general manifest or OpenAPI catalog | **Add** a discovery manifest + OpenAPI catalog. |
| Commerce | agent payments (x402 + card) | ❌ | **Add** two rails — Stripe payment link (human-in-the-loop, card) and x402 (autonomous, crypto), caller's choice. The unlock (see Payments). |

Deliberately **not** chasing: `agents.json` (Wildcard — abandoned, single-vendor, dead since
Aug 2025), AP2 (framework/spec stage; its crypto path routes back to x402 anyway), ACP
(Stripe/OpenAI — card-rails *retail checkout*, wrong shape for "an agent paying a Worker for
data/compute"). A2A `agent-card.json` is real but solves agent-to-agent interop, not our
buyer-facing use case — revisit only if refd ever exposes itself as a callable A2A agent.

## The two hard gates

Everything an agent needs from refd is easy (read metrics, generate prompts — the engine already
exists) *except* the two gates that protect the business:

1. **Identity** — who is this caller, and are they allowed to provision / spend?
2. **Payment** — who pays for the provider spend a run incurs?

Solve these two and the rest is plumbing over code that already exists. The plan is organized so
each layer is independently shippable and useful on its own.

## Layered plan

### Layer 0 — Agent-readiness surface (partially shipped)

Static + tiny-handler work that makes refd legible to agents and moves the isitagentready score
now, independent of the harder layers.

- **DNS-AID (shipped):** `_mcp._agents.refd.ai` publishes a DNSSEC-signed ServiceMode SVCB
  record targeting `refd.ai` on port 443 with `mcp`, `h2`, and `h3` ALPNs. It passes the
  isitagentready validator, but remains supplementary discovery while the DNS-AID draft evolves.
- **`Link:` discovery headers (shipped):** the homepage advertises the OAuth
  protected-resource metadata with `rel="service-desc"` and `llms.txt` with
  `rel="describedby"`.
- **Markdown negotiation (shipped):** `/` streams `index.md` with
  `Content-Type: text/markdown` when the request explicitly accepts it, while
  browser requests keep the HTML landing page. Both representations emit
  `Vary: Accept`.
- **Official MCP Registry (shipped):** `server.json` publishes the
  domain-verified `ai.refd/refd` remote server. Version `0.1.0` is active and
  points to `https://refd.ai/api/mcp`.
- **`schema.org` JSON-LD** on the landing page: `Organization` and `SoftwareApplication`
  (name, description, offers once pricing is public, sameAs → GitHub). This is the description
  AI answer engines actually read.
- **`/.well-known/agent` discovery manifest** (JSON): points to the MCP endpoint, the OAuth
  protected-resource metadata, the OpenAPI catalog, pricing, and docs. One small worker route
  (extend `run_worker_first`), or a static asset where possible.
- **Public OpenAPI catalog** of the agent-facing endpoints (generated from the same Zod schemas),
  served at a stable path and linked from the manifest — the "API Catalog" rubric item, and the
  thing OpenAPI-driven agents ingest.
- Keep `llms.txt` / markdown negotiation as-is; add a crawlable, indexable **"Build with refd /
  Agent access"** HTML page (per GTM §16 and the SSR guidance) that documents discovery, auth,
  tools, and pricing. Doubles as SEO for the agent-native narrative.

### Layer 1 — Read MCP over OAuth (shipped)

Implemented by `docs/plan-mcp.md`: OAuth 2.1 Authorization + Resource Server, per-workspace grants,
read-only tools, RFC 9728 discovery, and "Connected apps" in Settings. This is the authenticated
spine every later layer reuses. Preserve its read-only, workspace-scoped contract through the
first marketplace review cycle.

### Layer 2 — Setup / write tools (human-delegated 0→1)

The realization that makes this cheap: **the autonomous 0-to-1 engine already exists.** The
onboarding router already does, as server logic, every step of setting a brand up from nothing:

- `POST /onboarding/brand` — create the brand entity from a domain.
- `GET /onboarding/site-metadata` — Browser Rendering fetch of the site.
- `POST /onboarding/extract` — Workers AI drafts the brand description from site text.
- `POST /onboarding/competitors` — Exa + LLM discover competitors.
- `POST /onboarding/prompts` — LLM generates buyer-question prompts.
- `PATCH /onboarding` / `POST /commit` / `POST /complete` — save, materialize, fire the first run.

Today these are gated behind the human wizard UI. Layer 2 exposes them as **MCP write tools**,
reusing the Home-chat **proposal pattern** (`routes/chat.ts`, `routes/agent-tools.ts`): the agent
proposes; the change is validated through the *same* sanitizers, dedupe, and entitlement limits as
the human routes before it touches a table. The model never writes directly.

Proposed setup tools (all workspace-scoped by the OAuth grant, all write-validated):

| Tool | Wraps | Effect |
| --- | --- | --- |
| `set_brand` | `onboarding/brand` + `site-metadata` + `extract` | Set the brand domain; auto-draft its description. |
| `suggest_competitors` | `onboarding/competitors` | Discover + stage competitors (agent confirms). |
| `suggest_prompts` | `onboarding/prompts` | Generate buyer-question prompts (agent confirms). |
| `add_prompt` / `add_competitor` | `prompts` / `entities` POST | Explicit adds, entitlement-bounded. |
| `configure_surfaces` | `settings` PATCH | Choose enabled surfaces within the plan cap. |

Scope: a new `data:write` OAuth scope, shown distinctly on the consent screen ("Set up and edit
this workspace's monitoring"), grantable independently of `data:read`. Still **no run trigger
here** — running is Layer 3, because running costs money. A human-delegated agent can now take an
*existing* workspace from empty to fully configured with zero UI. That alone is a strong story and
carries no new spend risk.

### Layer 3 — Payments: two rails, the caller's choice

The unlock. When an agent wants a paid action, refd offers **two payment rails and the human/agent
picks** — a card link (Stripe) or machine-native crypto (x402). Both gate the same actions; both
follow the same out-of-band shape as the OTP flow (agent initiates → the payer authorizes
elsewhere → agent polls → proceeds). The default for a human-in-the-loop agent is Stripe; the
default for a wallet-holding autonomous agent is x402.

- **The first visibility report is free — same as the platform.** Onboarding's preliminary
  `onboard` run (cheap subset: 1 prompt/category, sample=1) is free in the dashboard, so it is free
  via the agent too. `run_visibility_report` on a fresh, un-reported workspace carries **no
  payment**; it mirrors the platform's free first report exactly. Free reports are bounded the same
  way a free human signup is — one per workspace, and (for the autonomous 4b path) rate-limited per
  verified agent identity so the free tier can't be farmed for provider spend.
- **What's paid:** only spend *beyond* that free first report —
  - `run_monitoring` — any additional on-demand full run after the free report.
  - recurring monitoring — ongoing daily cron access for the workspace.

#### Rail A — Stripe payment link (human-in-the-loop, card, the default)

The natural fit for 4a, and for most humans, who have a card rather than a crypto wallet. It also
**unifies agent-triggered billing with the hosted product's own Stripe billing** — one source of
truth for what a workspace is entitled to, whether a human or an agent set it up.

1. **Agent → `create_payment(workspace, action)`.** refd creates a Stripe **Checkout Session**
   (`mode=payment` for a one-off run) or a **subscription** (recurring monitoring), scoped to that
   workspace + action, and returns `{ paymentUrl, paymentId }`.
2. **Human** opens the link in a browser and pays with a card. The agent never holds the card, so —
   exactly like the OTP — **the human's payment *is* the consent/accountability gate for spend**;
   the agent can't self-authorize it.
3. **Stripe → refd webhook** (`checkout.session.completed` / subscription lifecycle),
   signature-verified with `constructEventAsync` (async WebCrypto, workerd-safe). refd marks the
   action authorized / credits the workspace, in a `payments` record.
4. **Agent polls `get_payment_status(paymentId)`** (or just retries the run tool) until authorized,
   then proceeds.

Why this is clean for recurring: a **Stripe subscription maps directly onto the existing
`monitoringTier` / `monitoringEndsAt` fields and `scheduledMonitoringEligible`** — an active
subscription flips the workspace to a paid tier and the nightly cron picks it up with *no new
metering path*. This is the $79/mo hosted monitoring plan from GTM, reached through the agent
instead of the dashboard. Stripe on Workers is well-trodden: the SDK with a fetch HTTP client, or
the REST API directly.

#### Rail B — x402 (machine-native, crypto, autonomous)

For wallet-holding agents and the 4b no-human path, where there is no human to open a browser.
x402 is the production-adopted, Linux-Foundation-governed agent-payment standard with **first-party
Cloudflare Workers support that is literally Hono middleware**, dropping straight into refd's app.

- **Server side:** `x402-hono` `paymentMiddleware()` gates the paid routes; `agents/x402`
  `paidTool` charges per MCP tool call. Point at Coinbase's public facilitator
  (`https://x402.org/facilitator`); settle USDC on **Base** (`base-sepolia` in dev, `base` in
  prod). No merchant-of-record, no PCI — just a wallet address. Target x402 **V2** headers
  (`PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`); confirm the SDK isn't emitting
  the legacy V1 `X-PAYMENT` header.
- **Recurring is a prepaid balance, not a subscription** here, because x402's recurring/deferred
  scheme is still a *proposal*. The agent tops up a **workspace credit balance** via x402
  (`add_credits`), and refd **meters BrightData spend against it** per run. Overspend is
  structurally impossible (a workspace can't run past its balance — a hard cost cap), and "has
  positive balance" becomes a `createRun` eligibility input alongside the current tiers. New
  `workspace_credits` + `credit_ledger` tables; every debit references the run that spent it.

#### Common properties

- **The paid tool is the paywall — for paid actions only.** The free first report runs with no
  payment. An `run_monitoring` / recurring call on an unpaid workspace returns a **402 with a
  machine-readable price plus both rail options** (a Stripe `paymentUrl` and x402
  `PAYMENT-REQUIRED`), letting the caller choose; the run proceeds once either clears.
- **Runaway spend is impossible.** Every *paid* run is pay-per-action (Stripe one-off / x402
  per-call), subscription-gated (Stripe), or drawn from a finite prepaid balance (x402); the one
  free run per workspace is bounded. Prompt-injection can at worst propose a spend the payer must
  actively authorize.
- **One entitlement surface.** However payment arrives, it resolves to the same place — the
  workspace's `monitoringTier` / balance that `createRun` and the cron already read.

### Layer 4 — Agent-native identity and provisioning

The last gate: a *net-new* brand with no existing account. There are two paths, and the
**human-in-the-loop one is primary** — it keeps a real human owner, preserves the business-email
trust signal, and carries a genuine consent step, so it should be the default an agent reaches
for. The fully-autonomous agent-principal path is the fallback for when there is genuinely no
human to loop in.

#### 4a — Human-in-the-loop signup (email-OTP, the primary path)

The insight: the human never has to touch the refd UI to sign up, but a human must still *consent*.
An emailed one-time code is exactly that — the human provides their email to the agent, retrieves a
code from their own inbox, and hands it back. Possession of the inbox **is** the consent gate; the
agent cannot self-serve an account for someone who didn't participate.

This is, in standards terms, an **OAuth 2.0 Device Authorization Grant (RFC 8628)** shape — a
client with no browser starts an authorization and a human verifies out-of-band — with **email OTP
as the verification channel** instead of a "visit this URL and type this code" screen. Flow:

1. **Agent → refd: `start_signup(email, requested_scopes)`.** refd runs the existing
   business-email policy (`lib/email-policy.ts`), rate-limits per email + per agent + per IP
   (reuse the `login_attempts` D1 pattern), generates a **6-character code** (unambiguous
   alphabet, e.g. no `0/O/1/I`), stores only its **hash** with a short TTL (~10 min) and an
   attempt counter, emails it to the human, and returns an opaque `signup_id` (the device-code
   analog). The response is **enumeration-safe** — identical whether or not the email already has
   an account — and the agent is told, in the tool description, to relay *what it is asking the
   human to authorize* (the scopes) so the human's consent is informed.
2. **Human:** reads the code from their inbox and gives it back to the agent (or, higher-security
   variant below, types it into a minimal refd page directly).
3. **Agent → refd: `complete_signup(signup_id, code)`.** refd verifies the code with a
   constant-time compare (reuse `secretsEqual` from `webhooks.ts`), enforcing single-use, expiry,
   and the attempt cap (lock the `signup_id` after N tries). On success it **creates the user +
   first workspace** (email-verified, no password set) and, because the human just consented to
   *this* agent by relaying the code, **completes an OAuth authorization in the same step** —
   minting the workspace-scoped grant so the agent flows straight into the Layer 2 setup tools.
   The grant appears in "Connected apps" (from `docs/plan-mcp.md`) so the human can revoke it.
4. **Either party continues.** The agent proceeds with setup, the **free first visibility report**,
   and reads — paid runs (Layer 3) apply only to additional or recurring monitoring. The human has
   a real account they can use directly whenever they want.

**Direct human access later, still zero-friction:** the account is created passwordless. Reuse the
same email-OTP as a **passwordless login channel** (request code → enter code → session), so the
human can always get in without ever having "set up" anything; setting a password in Settings stays
optional. One email-code mechanism serves signup, agent-authorization, and direct login.

**Security properties** (all reuse existing repo patterns): business-email gate preserved; code
hashed at rest, short-lived, single-use, attempt- and rate-limited; enumeration-safe responses;
constant-time compare; the human-consent gate is inbox possession. Passing the OTP back through
the agent is acceptable for *account creation* (the human actively participates and the code only
authorizes what the human was told). For deployments that want the code to never transit the
agent, offer the out-of-band variant — `start_signup` returns a short verification URL, the human
types the code (or clicks a magic link) on a minimal refd page, and the agent **polls**
`complete_signup` for completion (pure RFC 8628). Make which variant is required a config choice.

**New infra — this path needs transactional email, which refd does not have today.** No email
provider is wired in and the current `register` flow does no email verification at all. Add one
HTTP-API provider that runs cleanly on workerd (no WASM): **Resend or Postmark** recommended
(transactional deliverability, simple HTTP send; MailChannels' free Workers tier is gone). This is
the one real dependency this feature introduces, and it also lets refd optionally add email
verification to the ordinary human `register` flow later.

#### 4b — Fully autonomous agent-principal (fallback, no human available)

When there is no human to loop in, two things substitute for the business-email trust signal:

- **Verified agent identity — Web Bot Auth.** The agent signs its requests (RFC 9421 HTTP Message
  Signatures) and publishes keys at `/.well-known/http-message-signatures-directory`; refd
  verifies at the edge (Cloudflare-native, Workers examples exist; already how Cloudflare's
  Verified Bots / Signed Agents work). This gives an accountable operator identity for an
  otherwise-anonymous caller — the "who is this" answer.
- **Payment as accountability — x402.** A funded x402 payment is skin in the game; a spammer can't
  provision-and-run for free. Payment answers "is this real / who bears the cost."

Together they enable a **pay-to-provision** flow — an *agent principal* (not a human) can:

1. Register as an agent client (OAuth DCR / Client ID Metadata Document + Web Bot Auth signature).
2. `provision_workspace` — create a workspace owned by the agent principal (new `owner_type =
   'agent'` alongside the current human `ownerUserId`; tenancy still single-owner, so
   `requireWorkspace` semantics extend cleanly).
3. Run the Layer 2 setup tools to configure the brand 0→1.
4. `run_visibility_report` — get the **free** first report back over MCP (no payment, same as a
   human signup).
5. Only to go beyond it: `add_credits` via x402 for additional runs or ongoing monitoring; the
   metered balance gates paid runs and the cron.

Prefer 4a whenever a human email is obtainable: an owned account is easier to govern, bill, and
support than an ownerless agent-provisioned one.

This is genuine 0-to-1 with no UI and no human — but bounded: verified identity, finite prepaid
spend, one workspace per grant, read/write only within it.

## Guardrails / non-goals (what we deliberately refuse)

- **No unfunded autonomous runs, ever.** Provider spend is always either pay-per-call or debited
  from a finite prepaid balance. This is the core safety property; nothing overrides it.
- **No anonymous provisioning.** Agent provisioning requires a verified agent identity (Web Bot
  Auth) *and* funded payment. "Free anonymous agent signs up and burns the budget" is exactly the
  thing this design exists to prevent.
- **No direct table writes by a model.** Every agent write goes through the existing
  proposal/sanitizer/entitlement path. Web content is untrusted; a prompt-injected agent can at
  worst propose a validated change within one funded workspace.
- **Human-owned workspaces are unaffected.** Agent access to them stays behind the OAuth consent +
  "Connected apps" revoke flow from `docs/plan-mcp.md`. Agent-owned workspaces are a separate
  principal type with their own lifecycle.
- **Data ownership / revocation** for agent-owned workspaces needs an explicit policy (retention,
  who can claim/export, dormant-workspace cleanup when credits hit zero). Flagged as an open
  question, not hand-waved.

## Sequencing & dependencies

- **Shipped foundation:** Layer 1, plus the Layer 0 crawl controls, markdown negotiation,
  homepage `Link:` discovery, DNS-AID record, and official Registry entry.
- **Now / parallel:** finish Layer 0 with JSON-LD, a discovery manifest, an API catalog, and a
  crawlable agent-access page.
- **Then:** Layer 2 (setup tools, human-delegated) → Layer 3 (payment rails: Stripe first, then
  x402) → Layer 4 (4a email-OTP signup first, then 4b Web Bot Auth + pay-to-provision). Each is
  independently useful: 2 gives no-UI setup, 3 gives paid runs beyond the free report, 4a opens
  human-in-the-loop signup, 4b opens fully autonomous provisioning. Ship the human-in-the-loop half
  of each layer before the fully-autonomous half.

## Infra & dependencies (deltas beyond `docs/plan-mcp.md`)

- **Deps:** a transactional **email provider** (Resend or Postmark — HTTP API, workerd-safe) for
  the Layer 4a OTP, which refd has no equivalent of today; **Stripe** (SDK with fetch HTTP client,
  or REST directly) for Rail A; `x402-hono` (or `@x402/hono`) + `@x402/evm` + `agents/x402` for
  Rail B; Cloudflare's `web-bot-auth` TS package for signature verification. Verify each on workerd
  (`bun run check` + dev boot) — no runtime-WASM transitive deps.
- **Config:** the email provider API key (new secret); **`STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`**
  and the price IDs; a wallet address (Worker var), facilitator URL, network (`base` /
  `base-sepolia`), and per-action prices; whether OTP entry is agent-relayed or out-of-band. Web Bot
  Auth key directory published as a static asset.
- **Schema:** `signup_requests` (email, code hash, expiry, attempts, requested scopes, agent
  client) for the OTP flow; `payments` (Stripe session/subscription ↔ workspace + action + status)
  for Rail A; `workspace_credits`, `credit_ledger` for Rail B; an `owner_type` discriminator on
  `workspaces`, and an agent-principal / agent-client table. All via `bun run db:generate`.
- **`createRun`:** keep the first `onboard` run free; add a "sufficient balance or valid payment"
  precondition to *additional/recurring* runs alongside the existing entitlement checks, and ledger
  a debit on paid spend.
- **Account model:** support a password-less, email-verified user (nullable password hash) plus
  email-OTP as a passwordless login channel; the ordinary human `register` flow is unchanged unless
  we opt to add verification to it too.

## Open questions

- Pricing per paid action (additional run vs. recurring monitoring) vs. actual BrightData cost +
  margin — set with the hosted-plan decision in GTM, not guessed here. The first report is free.
- OTP entry mode: agent-relayed (frictionless, code transits the agent) vs. out-of-band page
  (higher security, human types the code on a minimal refd page). Ship one, make it configurable.
- Agent-owned workspace lifecycle (**4b only** — the 4a human-owned path resolves this): retention,
  export, claim-by-human, zero-credit dormancy.
- Whether to also expose refd as a callable **A2A agent** (agent-to-agent) once buyer-facing
  agents want to *delegate* "monitor this brand" rather than call tools directly.
- Web Bot Auth is on early-WG IETF drafts (wire details may shift); keep the verifier swappable.
