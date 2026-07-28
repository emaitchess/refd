import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui';
import {
  GLOSSARY_TERMS,
  type GlossaryDefinition,
  TERM_CATEGORIES,
} from '@/lib/glossary';
import { METRIC_CATEGORIES, METRIC_GLOSSARY } from '@/lib/metric-copy';
import { PROMPT_CATEGORY_GLOSSARY } from '@/lib/prompt-categories';
import { cn } from '@/lib/utils';

export const Help = () => (
  <>
    <PageHeader
      title="Help"
      description="Product guides, definitions, and practical reference for using refd."
    />
    <div className="grid items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="border border-border bg-bg-card lg:sticky lg:top-6">
        <div className="section-label border-border border-b bg-bg-elevated px-4 py-3 text-primary">
          Help library
        </div>
        <nav aria-label="Help pages" className="p-1.5">
          <div className="flex flex-col gap-0.5">
            <NavLink
              to="/help/glossary"
              className={({ isActive }) =>
                cn(
                  'flex min-h-11 items-center gap-2.5 px-2.5 text-[13px] transition-colors hover:bg-bg-card-hover hover:text-primary',
                  isActive
                    ? 'bg-accent-soft text-primary shadow-[inset_1px_0_0_var(--color-primary)]'
                    : 'text-secondary',
                )
              }
            >
              <DitherIcon name="info" size={13} className="shrink-0" />
              <span>
                <span className="block">Glossary</span>
                <span className="mt-0.5 block font-mono text-[9px] text-muted uppercase tracking-[0.08em]">
                  product terms and metrics
                </span>
              </span>
            </NavLink>
            <NavLink
              to="/help/mcp"
              className={({ isActive }) =>
                cn(
                  'flex min-h-11 items-center gap-2.5 px-2.5 text-[13px] transition-colors hover:bg-bg-card-hover hover:text-primary',
                  isActive
                    ? 'bg-accent-soft text-primary shadow-[inset_1px_0_0_var(--color-primary)]'
                    : 'text-secondary',
                )
              }
            >
              <DitherIcon name="power" size={13} className="shrink-0" />
              <span>
                <span className="block">MCP connector</span>
                <span className="mt-0.5 block font-mono text-[9px] text-muted uppercase tracking-[0.08em]">
                  connect AI assistants
                </span>
              </span>
            </NavLink>
          </div>
        </nav>
      </aside>
      <Outlet />
    </div>
  </>
);

const MCP_ENDPOINT = 'https://refd.ai/api/mcp';

const MCP_TOOLS = [
  {
    name: 'get_workspace_info',
    purpose:
      'Returns the connected brand, competitors, and enabled AI surfaces.',
  },
  {
    name: 'get_visibility_overview',
    purpose:
      'Summarizes mention rate, citation rate, share of voice, position, sentiment, coverage, and performance by surface.',
  },
  {
    name: 'get_competitor_landscape',
    purpose:
      'Compares the brand with every tracked competitor across visibility metrics.',
  },
  {
    name: 'get_prompt_performance',
    purpose:
      'Shows buyer-question performance and identifies prompts with zero visibility.',
  },
  {
    name: 'get_citation_sources',
    purpose:
      'Finds influential domains, cited brand URLs, unattributed sources, and source gaps.',
  },
  {
    name: 'get_recent_changes',
    purpose:
      'Reports material changes between the two latest comparable completed runs.',
  },
  {
    name: 'find_prompt_results',
    purpose:
      'Fuzzy-matches a tracked prompt and returns per-surface results with result IDs.',
  },
  {
    name: 'read_answer',
    purpose:
      'Reads clipped, ownership-checked AI answer evidence for a result ID.',
  },
  {
    name: 'get_digest',
    purpose:
      'Returns a complete grounded snapshot of the connected workspace in one call.',
  },
] as const;

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="mt-3 overflow-x-auto border border-border bg-bg px-4 py-3 font-mono text-[11px] text-secondary leading-relaxed">
    <code>{children}</code>
  </pre>
);

const GuideSection = ({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) => (
  <section
    aria-labelledby={id}
    className="scroll-mt-24 border border-border bg-bg-card lg:scroll-mt-12"
  >
    <header className="border-border border-b bg-bg-elevated px-5 py-4">
      <h3 id={id} className="font-[550] text-[16px] text-primary">
        {title}
      </h3>
      {description ? (
        <p className="mt-1 max-w-3xl text-[12px] text-muted leading-relaxed">
          {description}
        </p>
      ) : null}
    </header>
    {children}
  </section>
);

export const McpGuide = () => (
  <section aria-labelledby="mcp-guide-title" className="min-w-0">
    <header className="border border-border bg-bg-card p-5">
      <p className="section-label text-primary">remote connector</p>
      <h2
        id="mcp-guide-title"
        className="mt-2 font-[550] text-[18px] text-primary tracking-[-0.02em]"
      >
        Connect refd to an AI assistant
      </h2>
      <p className="mt-2 max-w-3xl text-[13px] text-secondary leading-relaxed">
        refd exposes a read-only Model Context Protocol server. A connected AI
        assistant can inspect your visibility data and answer evidence without
        changing the workspace, starting provider runs, or spending provider
        quota.
      </p>
      <div className="mt-4 border border-border bg-bg">
        <div className="section-label border-border border-b px-3 py-2 text-muted">
          MCP endpoint
        </div>
        <code className="block overflow-x-auto px-3 py-3 font-mono text-[12px] text-primary">
          {MCP_ENDPOINT}
        </code>
      </div>
      <p className="mt-3 text-[12px] text-muted leading-relaxed">
        The connector uses OAuth 2.1 with PKCE and automatic client
        registration. You do not need to create a client ID, client secret, or
        API key.
      </p>
    </header>

    <div className="mt-4 flex flex-col gap-4">
      <GuideSection
        id="mcp-connect"
        title="Connect an assistant"
        description="Choose your client, enter the endpoint, then sign in to refd and approve one workspace."
      >
        <div className="grid lg:grid-cols-3">
          <article className="p-5 lg:border-border lg:border-r">
            <p className="section-label text-primary">Claude</p>
            <p className="mt-3 text-[12px] text-muted leading-relaxed">
              On an individual plan, add the connector from Customize. On Team
              and Enterprise plans, an owner first adds a Custom Web connector
              from Organization settings.
            </p>
            <ol className="mt-3 list-decimal space-y-2 pl-4 text-[12px] text-secondary leading-relaxed marker:font-mono marker:text-muted">
              <li>
                Open{' '}
                <strong className="font-[550] text-primary">Customize</strong>{' '}
                and then{' '}
                <strong className="font-[550] text-primary">Connectors</strong>.
              </li>
              <li>
                Add a custom web connector and enter{' '}
                <code className="font-mono text-[11px] text-primary">
                  {MCP_ENDPOINT}
                </code>
                .
              </li>
              <li>
                Select{' '}
                <strong className="font-[550] text-primary">Connect</strong>,
                sign in, choose a workspace, and approve read access.
              </li>
              <li>
                Enable refd for a conversation from the{' '}
                <strong className="font-[550] text-primary">
                  + Connectors
                </strong>{' '}
                menu.
              </li>
            </ol>
            <a
              href="https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp"
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex text-[12px] text-secondary underline decoration-border-strong underline-offset-4 hover:text-primary"
            >
              Claude connector reference
            </a>
          </article>

          <article className="border-border border-t p-5 lg:border-t-0 lg:border-r">
            <p className="section-label text-primary">Claude Code</p>
            <p className="mt-3 text-[12px] text-secondary leading-relaxed">
              Add the Streamable HTTP server, then start the OAuth login:
            </p>
            <CodeBlock>{`claude mcp add --transport http refd ${MCP_ENDPOINT}
claude mcp login refd`}</CodeBlock>
            <p className="mt-3 text-[12px] text-muted leading-relaxed">
              You can also authenticate from{' '}
              <code className="font-mono">/mcp</code>. Run{' '}
              <code className="font-mono">claude mcp logout refd</code> to clear
              stored credentials.
            </p>
            <a
              href="https://code.claude.com/docs/en/mcp"
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex text-[12px] text-secondary underline decoration-border-strong underline-offset-4 hover:text-primary"
            >
              Claude Code MCP reference
            </a>
          </article>

          <article className="border-border border-t p-5 lg:border-t-0">
            <p className="section-label text-primary">ChatGPT</p>
            <p className="mt-3 text-[12px] text-muted leading-relaxed">
              Custom MCP apps require developer mode. Workspace administrators
              and owners can create apps from Workspace settings. Authorized
              developers can create them from their personal Apps settings.
            </p>
            <ol className="mt-3 list-decimal space-y-2 pl-4 text-[12px] text-secondary leading-relaxed marker:font-mono marker:text-muted">
              <li>Enable developer mode for your account or workspace.</li>
              <li>
                Open <strong className="font-[550] text-primary">Apps</strong>,
                create an app, and enter{' '}
                <code className="font-mono text-[11px] text-primary">
                  {MCP_ENDPOINT}
                </code>
                .
              </li>
              <li>
                Select OAuth, scan the tools, and complete the refd
                authorization flow.
              </li>
              <li>Create the app, then enable it in a new conversation.</li>
            </ol>
            <p className="mt-3 text-[12px] text-muted leading-relaxed">
              ChatGPT snapshots tool definitions. Refresh the app actions after
              the server adds a tool or changes an input schema.
            </p>
            <a
              href="https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta"
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex text-[12px] text-secondary underline decoration-border-strong underline-offset-4 hover:text-primary"
            >
              ChatGPT apps reference
            </a>
          </article>
        </div>
      </GuideSection>

      <GuideSection
        id="mcp-authorization"
        title="Authorization and workspace access"
        description="Every connection has a narrow, explicit access boundary."
      >
        <div className="grid sm:grid-cols-2">
          {[
            {
              label: 'one workspace',
              text: 'You select exactly one workspace during authorization. The grant cannot read any other workspace, even if the client supplies another workspace ID.',
            },
            {
              label: 'read only',
              text: 'The data:read permission covers every published tool. It cannot edit prompts, entities, workspace settings, or account data.',
            },
            {
              label: 'no provider spend',
              text: 'The connector cannot start scheduled, manual, onboarding, or rescore runs. It only reads data that refd has already collected.',
            },
            {
              label: 'OAuth protected',
              text: 'Access uses OAuth 2.1 authorization codes with PKCE. Tokens are bound to the MCP endpoint and refresh credentials rotate.',
            },
          ].map((item, index) => (
            <article
              key={item.label}
              className={cn(
                'p-5',
                index > 0 && 'border-border border-t sm:border-t-0',
                index % 2 === 1 && 'sm:border-border sm:border-l',
                index > 1 && 'sm:border-border sm:border-t',
              )}
            >
              <p className="section-label text-primary">{item.label}</p>
              <p className="mt-2 text-[12px] text-secondary leading-relaxed">
                {item.text}
              </p>
            </article>
          ))}
        </div>
        <div className="border-border border-t px-5 py-4">
          <p className="text-[12px] text-muted leading-relaxed">
            To connect a different workspace, create another connection or
            authorize again and select the new workspace. Existing grants never
            change workspace in place.
          </p>
          <p className="mt-2 text-[12px] text-muted leading-relaxed">
            refd limits MCP traffic to 120 requests per bearer token each
            minute. Each OAuth endpoint allows 30 requests per network address
            and, where available, client ID each minute.
          </p>
        </div>
      </GuideSection>

      <GuideSection
        id="mcp-tools"
        title="Available tools"
        description="All tools are read-only and resolve their workspace from the authorized grant."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-left">
            <thead>
              <tr className="bg-bg-elevated">
                <th className="section-label w-[230px] border-border border-r px-5 py-3 text-muted">
                  tool
                </th>
                <th className="section-label px-5 py-3 text-muted">returns</th>
              </tr>
            </thead>
            <tbody>
              {MCP_TOOLS.map((tool) => (
                <tr key={tool.name} className="border-border border-t">
                  <td className="border-border border-r px-5 py-3 align-top">
                    <code className="font-mono text-[11px] text-primary">
                      {tool.name}
                    </code>
                  </td>
                  <td className="px-5 py-3 text-[12px] text-secondary leading-relaxed">
                    {tool.purpose}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid border-border border-t sm:grid-cols-2">
          <div className="p-5 sm:border-border sm:border-r">
            <p className="section-label text-primary">date ranges</p>
            <p className="mt-2 text-[12px] text-secondary leading-relaxed">
              Tools with a range accept <code className="font-mono">1d</code>,{' '}
              <code className="font-mono">3d</code>,{' '}
              <code className="font-mono">7d</code>,{' '}
              <code className="font-mono">30d</code>,{' '}
              <code className="font-mono">90d</code>, or{' '}
              <code className="font-mono">all</code>. The default is{' '}
              <code className="font-mono">30d</code>.
            </p>
          </div>
          <div className="border-border border-t p-5 sm:border-t-0">
            <p className="section-label text-primary">metric resource</p>
            <p className="mt-2 text-[12px] text-secondary leading-relaxed">
              The read-only{' '}
              <code className="font-mono">refd://glossary/metrics</code>{' '}
              resource gives assistants the same metric definitions used by the
              dashboard.
            </p>
          </div>
        </div>
        <div className="border-border border-t bg-bg-elevated px-5 py-4">
          <p className="text-[12px] text-muted leading-relaxed">
            AI answer text returned by{' '}
            <code className="font-mono">read_answer</code> is untrusted
            third-party content. Clients should use it as evidence, never as
            instructions.
          </p>
          <p className="mt-2 text-[12px] text-muted leading-relaxed">
            refd does not expose web search, arbitrary raw-payload access,
            onboarding, chat, authentication, account controls, operator tools,
            or any create, update, and delete actions through MCP.
          </p>
        </div>
      </GuideSection>

      <GuideSection
        id="mcp-manage"
        title="Manage and revoke connections"
        description="Connection controls belong to the workspace that granted access."
      >
        <div className="p-5">
          <p className="max-w-3xl text-[12px] text-secondary leading-relaxed">
            Open the connected workspace and go to{' '}
            <Link
              to="/settings"
              className="text-primary underline decoration-border-strong underline-offset-4 hover:text-secondary"
            >
              Settings
            </Link>
            . The Connected apps card shows each app, its permission, when it
            connected, and when it was last used.
          </p>
          <p className="mt-3 max-w-3xl text-[12px] text-muted leading-relaxed">
            Select <strong className="font-[550] text-primary">Revoke</strong>{' '}
            to immediately invalidate the grant, its access tokens, and its
            refresh token. Deleting a workspace or account also revokes its
            connections before deleting data.
          </p>
        </div>
      </GuideSection>

      <GuideSection
        id="mcp-self-hosting"
        title="Self-hosting and local checks"
        description="Cloud clients need a public HTTPS endpoint. Claude Code can connect to any development endpoint it can reach."
      >
        <div className="p-5">
          <p className="text-[12px] text-secondary leading-relaxed">
            Set <code className="font-mono">PUBLIC_BASE_URL</code> to the public
            origin and create the dedicated{' '}
            <code className="font-mono">OAUTH_KV</code> namespace. Keep both
            native rate-limit bindings configured with account-unique namespace
            IDs, apply every D1 migration, and deploy the Worker. The endpoint
            is always{' '}
            <code className="font-mono">&lt;PUBLIC_BASE_URL&gt;/api/mcp</code>.
          </p>
          <p className="mt-3 text-[12px] text-muted leading-relaxed">
            The OAuth provider stores registered clients and encrypted grant and
            token state in that namespace. No additional plaintext application
            secret is required.
          </p>
          <CodeBlock>{'bunx wrangler kv namespace create OAUTH_KV'}</CodeBlock>
          <p className="mt-5 text-[12px] text-secondary leading-relaxed">
            After <code className="font-mono">bun run dev</code>, these requests
            check discovery and bearer protection:
          </p>
          <CodeBlock>{`curl -i https://refdlocal.io/.well-known/oauth-protected-resource/api/mcp
curl -i https://refdlocal.io/.well-known/oauth-authorization-server
curl -i -X POST https://refdlocal.io/api/mcp \\
  -H 'Content-Type: application/json' \\
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}'`}</CodeBlock>
          <p className="mt-3 text-[12px] text-muted leading-relaxed">
            Both discovery requests should return JSON. The MCP request should
            return <code className="font-mono">401 Unauthorized</code> with a{' '}
            <code className="font-mono">WWW-Authenticate</code> challenge
            because it has no bearer token. A complete local OAuth flow also
            needs a registered refd user and a client with a browser callback
            URL.
          </p>
        </div>
      </GuideSection>

      <GuideSection id="mcp-troubleshooting" title="Troubleshooting">
        <dl>
          {[
            {
              question: 'The cloud connector cannot reach refd',
              answer:
                'Claude and ChatGPT connect from their own infrastructure. A self-hosted server must use a publicly reachable HTTPS origin with PUBLIC_BASE_URL set to that origin.',
            },
            {
              question: 'The connector opens the wrong workspace',
              answer:
                'Workspace access is fixed when you approve the connection. Revoke it in Connected apps, reconnect, and choose the intended workspace.',
            },
            {
              question: 'ChatGPT does not show a new or changed tool',
              answer:
                'Refresh or rescan the app actions. ChatGPT keeps a snapshot of the tool catalog from its last scan.',
            },
            {
              question: 'The protocol check returns 401',
              answer:
                'That is expected when the request has no OAuth bearer token. A protected MCP endpoint advertises its authorization metadata in the WWW-Authenticate response.',
            },
            {
              question: 'A revoked app still appears in the client',
              answer:
                'The client can retain its local connector entry, but refd rejects the revoked access and refresh tokens. Remove or reconnect the entry in that client.',
            },
          ].map((item, index) => (
            <div
              key={item.question}
              className={cn('px-5 py-4', index > 0 && 'border-border border-t')}
            >
              <dt className="font-[550] text-[13px] text-primary">
                {item.question}
              </dt>
              <dd className="mt-1 text-[12px] text-muted leading-relaxed">
                {item.answer}
              </dd>
            </div>
          ))}
        </dl>
      </GuideSection>
    </div>
  </section>
);

const GLOSSARY_CATEGORIES = [
  ...TERM_CATEGORIES,
  'Prompt categories',
  ...METRIC_CATEGORIES,
] as const;

const GLOSSARY_ENTRIES = [
  ...GLOSSARY_TERMS,
  ...PROMPT_CATEGORY_GLOSSARY,
  ...METRIC_GLOSSARY,
] satisfies GlossaryDefinition[];

const matchesQuery = (entry: GlossaryDefinition, query: string) => {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    return true;
  }
  return [entry.title, entry.category, entry.definition, entry.details].some(
    (value) => value.toLocaleLowerCase().includes(normalized),
  );
};

export const Glossary = () => {
  const [query, setQuery] = useState('');
  const { hash } = useLocation();
  const groups = useMemo(
    () =>
      GLOSSARY_CATEGORIES.map((category) => ({
        category,
        entries: GLOSSARY_ENTRIES.filter(
          (entry) => entry.category === category && matchesQuery(entry, query),
        ),
      })).filter((group) => group.entries.length > 0),
    [query],
  );

  useEffect(() => {
    if (!hash) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(decodeURIComponent(hash.slice(1)));
      target?.scrollIntoView({ block: 'start' });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [hash]);

  return (
    <section aria-labelledby="glossary-title" className="min-w-0">
      <header className="flex flex-wrap items-end justify-between gap-4 border border-border bg-bg-card p-5">
        <div>
          <h2
            id="glossary-title"
            className="font-[550] text-[18px] text-primary tracking-[-0.02em]"
          >
            Glossary
          </h2>
          <p className="mt-1 max-w-xl text-[12px] text-muted leading-relaxed">
            Definitions and usage notes for the product terms, prompt
            categories, metrics, and signals used in the dashboard.
          </p>
        </div>
        <label className="w-full sm:w-72">
          <span className="sr-only">Search glossary</span>
          <input
            type="search"
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="search the glossary"
          />
        </label>
      </header>

      {groups.length > 0 ? (
        <div className="mt-4 flex flex-col gap-4">
          {groups.map((group) => (
            <section
              key={group.category}
              aria-labelledby={`glossary-${group.category.toLocaleLowerCase().replaceAll(' ', '-')}`}
              className="border border-border bg-bg-card"
            >
              <h3
                id={`glossary-${group.category.toLocaleLowerCase().replaceAll(' ', '-')}`}
                className="section-label sticky top-12 z-10 border-border border-b bg-bg-elevated px-4 py-3 text-primary lg:top-0"
              >
                {group.category}
              </h3>
              <div>
                {group.entries.map((entry, index) => (
                  <article
                    key={entry.id}
                    id={entry.id}
                    tabIndex={-1}
                    className={cn(
                      'scroll-mt-24 px-4 py-4 transition-colors target:bg-accent-soft target:shadow-[inset_2px_0_0_var(--color-primary)] sm:px-5 lg:scroll-mt-12',
                      index > 0 && 'border-border border-t',
                    )}
                  >
                    <h4 className="font-[550] text-[14px] text-primary">
                      {entry.title}
                    </h4>
                    <p className="mt-1 text-[13px] text-secondary leading-relaxed">
                      {entry.definition}
                    </p>
                    <p className="mt-2 text-[12px] text-muted leading-relaxed">
                      {entry.details}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          title="no matching terms"
          hint="Try a product term, prompt category, metric, or signal."
          className="mt-4 min-h-56"
          action={
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setQuery('')}
            >
              clear search
            </button>
          }
        />
      )}
    </section>
  );
};
