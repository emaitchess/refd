import type {
  AuthRequest,
  ClientInfo,
  GrantSummary,
  OAuthHelpers,
} from '@cloudflare/workers-oauth-provider';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { app } from '../app';
import { readRequestSession } from '../auth/session';
import { getDb } from '../db/client';
import { mcpConnections, users, workspaces } from '../db/schema';
import type { AppEnv } from '../env';
import { dashboardOriginForRequest } from '../lib/cors';
import { MCP_SCOPE } from './constants';
import {
  callbackTarget,
  clearCsrfCookie,
  createCsrfToken,
  csrfCookie,
  escapeHtml,
  formActionSources,
  validCsrfToken,
} from './security';

const grantMetadataSchema = z.object({
  connectionId: z.string().uuid(),
  workspaceId: z.number().int().positive(),
});
const consentFormSchema = z.object({
  csrfToken: z.string().uuid(),
  decision: z.enum(['approve', 'deny']),
  workspaceId: z
    .string()
    .regex(/^[1-9]\d*$/)
    .optional(),
});
const clientNameSchema = z
  .string()
  .transform((value) => value.trim().slice(0, 120))
  .pipe(z.string().min(1));
const authorizationErrorSchema = z.object({
  name: z.literal('AuthorizationError'),
  code: z.enum([
    'invalid_request',
    'invalid_target',
    'unauthorized_client',
    'access_denied',
    'unsupported_response_type',
    'invalid_scope',
    'server_error',
    'temporarily_unavailable',
  ]),
  description: z.string().min(1).max(500),
  redirectUri: z.string().max(2048).url().optional(),
  state: z.string().max(2048).optional(),
  issuer: z.string().max(2048).url().optional(),
});
type AuthorizationErrorShape = z.infer<typeof authorizationErrorSchema>;
const logoRows = [
  '................',
  '................',
  '................',
  '....###.####....',
  '....###++++##...',
  '....####...##...',
  '....###....+#...',
  '....###.........',
  '....###.........',
  '....###.........',
  '....###.........',
  '....###.........',
  '....###.........',
  '....###.........',
  '................',
  '................',
];

const responseHeaders = (
  cookie?: string,
  nonce?: string,
  callbackUrl?: string,
): Headers => {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Security-Policy': `default-src 'none'; ${nonce ? `script-src 'nonce-${nonce}'; ` : ''}style-src 'unsafe-inline'; form-action ${formActionSources(callbackUrl)}; frame-ancestors 'none'; base-uri 'none'`,
    'Content-Type': 'text/html; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  if (cookie) {
    headers.set('Set-Cookie', cookie);
  }
  return headers;
};

const clientName = (client: ClientInfo): string => {
  const parsed = clientNameSchema.safeParse(client.clientName ?? 'MCP client');
  return parsed.success ? parsed.data : 'MCP client';
};

const logoMark = (): string => {
  const cells = logoRows.flatMap((row, y) =>
    [...row].flatMap((cell, x) =>
      cell === '.'
        ? []
        : [
            `<rect${cell === '+' ? ' class="dither"' : ''} x="${x}" y="${y}" width="1" height="1"/>`,
          ],
    ),
  );
  return `<svg class="mark" viewBox="0 0 16 16" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true">${cells.join('')}</svg>`;
};

const errorPage = (status: number, message: string): Response =>
  new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connection error · refd</title>
    <style>
      :root{color-scheme:dark;--bg:#080809;--surface:#0a0a0c;--primary:#f5f3ef;--secondary:#b7b3b0;--border:rgba(255,255,255,.09);--accent:#f02b3a}
      @media(prefers-color-scheme:light){:root{color-scheme:light;--bg:#f7f4f0;--surface:#fffdfa;--primary:#181416;--secondary:#50494c;--border:rgba(39,28,30,.14);--accent:#c8232f}}
      *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--primary);font:14px/1.65 "Inter Variable",Inter,system-ui,sans-serif}.rail{width:min(1120px,100%);min-height:100svh;margin:0 auto;border-inline:1px solid var(--border)}header{height:68px;display:flex;align-items:center;padding:0 32px;border-bottom:1px solid var(--border)}.wordmark{font:15px "Departure Mono",ui-monospace,monospace}main{max-width:620px;padding:96px 32px}.eyebrow{font:11px "Departure Mono",ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}h1{margin:18px 0 0;font-size:36px;line-height:1.08;font-weight:500;letter-spacing:-.035em}p{max-width:540px;margin:20px 0 0;color:var(--secondary)}@media(max-width:640px){header{height:56px;padding:0 20px}main{padding:64px 20px}h1{font-size:30px}}
    </style>
  </head>
  <body>
    <div class="rail">
      <header><span class="wordmark">refd</span></header>
      <main>
        <div class="eyebrow">connected apps</div>
        <h1>Connection could not be completed.</h1>
        <p>${escapeHtml(message)}</p>
      </main>
    </div>
  </body>
</html>`,
    { status, headers: responseHeaders() },
  );

const redirect = (location: string, cookie?: string): Response => {
  const headers = new Headers({ Location: location });
  if (cookie) {
    headers.set('Set-Cookie', cookie);
  }
  return new Response(null, { status: 302, headers });
};

const parsedAuthorizationError = (
  error: unknown,
): AuthorizationErrorShape | null => {
  const parsed = authorizationErrorSchema.safeParse(error);
  return parsed.success ? parsed.data : null;
};

// The provider attaches `redirectUri`/`state`/`issuer` only after exact client
// redirect validation, so a redirect here is OAuth-safe; anything else renders
// locally. The callback check is defense-in-depth against a future shape drift.
export const oauthAuthorizationErrorResponse = (
  error: AuthorizationErrorShape,
): Response => {
  if (!error.redirectUri || !callbackTarget(error.redirectUri)) {
    return errorPage(400, error.description);
  }
  const location = new URL(error.redirectUri);
  location.searchParams.set('error', error.code);
  location.searchParams.set('error_description', error.description);
  if (error.state) {
    location.searchParams.set('state', error.state);
  }
  if (error.issuer) {
    location.searchParams.set('iss', error.issuer);
  }
  return redirect(location.toString(), clearCsrfCookie());
};

const parseAuthorizationRequest = async (
  oauth: OAuthHelpers,
  request: Request,
): Promise<AuthRequest | Response> => {
  try {
    return await oauth.parseAuthRequest(request);
  } catch (error) {
    const authorizationError = parsedAuthorizationError(error);
    if (!authorizationError) {
      throw error;
    }
    const response = oauthAuthorizationErrorResponse(authorizationError);
    console.log(
      JSON.stringify({
        event: 'mcp_authorization_rejected',
        code: authorizationError.code,
        safeRedirect: response.status === 302,
      }),
    );
    return response;
  }
};

// Send unauthenticated users to the dashboard's sign-in page, returning them to
// this exact authorize URL afterward. Split deployment: sign-in lives on the
// dashboard origin and `next` is the absolute API authorize URL. Bridge (no
// dashboard origin): sign-in is same-origin and `next` is a path.
const signInRedirect = (request: Request, env: AppEnv): Response => {
  const current = new URL(request.url);
  const dashboardOrigin = dashboardOriginForRequest(request.url, env);
  const signIn = new URL('/auth/sign-in', dashboardOrigin ?? current.origin);
  const next = dashboardOrigin
    ? current.toString()
    : `${current.pathname}${current.search}`;
  signIn.searchParams.set('next', next);
  return redirect(signIn.toString());
};

const authenticatedUser = async (request: Request, env: AppEnv) => {
  const claims = await readRequestSession(request, env);
  if (!claims) {
    return null;
  }
  const user = (
    await getDb(env)
      .select({
        id: users.id,
        email: users.email,
        tokenVersion: users.tokenVersion,
      })
      .from(users)
      .where(eq(users.id, claims.sub))
      .limit(1)
  )[0];
  return user && user.tokenVersion === claims.tv ? user : null;
};

const grantedScopes = (request: AuthRequest): string[] | null => {
  const scopes = request.scope.length > 0 ? request.scope : [MCP_SCOPE];
  return scopes.length === 1 && scopes[0] === MCP_SCOPE ? scopes : null;
};

const resourceRequest = (
  request: AuthRequest,
  resourceUrl: string,
): AuthRequest | null => {
  const requested = request.resource
    ? Array.isArray(request.resource)
      ? request.resource
      : [request.resource]
    : [];
  if (requested.some((resource) => resource !== resourceUrl)) {
    return null;
  }
  return { ...request, resource: resourceUrl };
};

const listUserGrants = async (
  oauth: OAuthHelpers,
  userId: string,
): Promise<GrantSummary[]> => {
  const grants: GrantSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await oauth.listUserGrants(userId, { cursor, limit: 1000 });
    grants.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  return grants;
};

const revokePriorWorkspaceGrants = async (
  oauth: OAuthHelpers,
  env: AppEnv,
  userId: string,
  clientId: string,
  workspaceId: number,
): Promise<void> => {
  const grants = await listUserGrants(oauth, userId);
  const matching = grants.filter((grant) => {
    const metadata = grantMetadataSchema.safeParse(grant.metadata);
    return (
      grant.clientId === clientId &&
      metadata.success &&
      metadata.data.workspaceId === workspaceId
    );
  });
  for (const grant of matching) {
    await oauth.revokeGrant(grant.id, userId);
    await getDb(env)
      .update(mcpConnections)
      .set({ revokedAt: Date.now() })
      .where(eq(mcpConnections.grantId, grant.id));
  }
};

const denyRedirect = (request: AuthRequest): Response => {
  const location = new URL(request.redirectUri);
  location.searchParams.set('error', 'access_denied');
  location.searchParams.set('state', request.state);
  if (request.issuer) {
    location.searchParams.set('iss', request.issuer);
  }
  return redirect(location.toString(), clearCsrfCookie());
};

const renderConsent = (
  request: Request,
  client: ClientInfo,
  ownedWorkspaces: { id: number; name: string }[],
  callbackUrl: string,
): Response => {
  const token = createCsrfToken();
  const nonce = crypto.randomUUID();
  const action = new URL(request.url);
  const workspaceRows = ownedWorkspaces
    .map(
      (workspace, index) => `
        <label class="workspace">
          <input type="radio" name="workspace_id" value="${workspace.id}" ${index === 0 ? 'checked' : ''} required>
          <span><strong>${escapeHtml(workspace.name)}</strong><small>Only this workspace</small></span>
        </label>`,
    )
    .join('');
  const name = escapeHtml(clientName(client));
  const target = escapeHtml(callbackTarget(callbackUrl) ?? 'unknown callback');

  return new Response(
    `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Connect ${name} · refd</title>
    <script nonce="${nonce}">try{const stored=localStorage.getItem("refd-theme");const theme=stored==="dark"||stored==="light"?stored:matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.dataset.theme=theme}catch{}</script>
    <style>
      :root{color-scheme:dark;--bg:#080809;--bg-subtle:#0d0d0f;--surface:#0a0a0c;--card:rgba(255,255,255,.025);--hover:rgba(255,255,255,.05);--primary:#f5f3ef;--secondary:#b7b3b0;--muted:#82808a;--border:rgba(255,255,255,.09);--border-strong:rgba(255,255,255,.18);--accent:#f02b3a;--accent-soft:rgba(240,43,58,.12)}
      :root[data-theme="light"]{color-scheme:light;--bg:#f7f4f0;--bg-subtle:#f0ebe6;--surface:#fffdfa;--card:rgba(39,28,30,.025);--hover:rgba(39,28,30,.05);--primary:#181416;--secondary:#50494c;--muted:#71676b;--border:rgba(39,28,30,.14);--border-strong:rgba(39,28,30,.24);--accent:#c8232f;--accent-soft:rgba(200,35,47,.09)}
      *{box-sizing:border-box}html,body{min-height:100%;background:var(--bg)}body{margin:0;color:var(--primary);font:14px/1.65 "Inter Variable",Inter,system-ui,sans-serif;overscroll-behavior-y:none}.rail{width:min(1120px,100%);min-height:100svh;margin:0 auto;border-inline:1px solid var(--border);display:flex;flex-direction:column}header{height:68px;display:flex;flex:none;align-items:center;justify-content:space-between;padding:0 32px;border-bottom:1px solid var(--border)}.brand{display:flex;align-items:center;gap:10px}.mark{width:18px;height:18px}.mark .dither{opacity:.35}.wordmark{font:15px "Departure Mono",ui-monospace,monospace}.theme{height:32px;padding:0 12px;border:1px solid var(--border);background:var(--card);color:var(--secondary);font:10px "Departure Mono",ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;transition:background 150ms,color 150ms,border-color 150ms}.theme:hover{background:var(--hover);color:var(--primary);border-color:var(--border-strong)}.layout{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);flex:1}.intro{padding:96px 48px 96px 32px;border-right:1px solid var(--border)}.eyebrow{font:11px "Departure Mono",ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}h1{max-width:430px;margin:22px 0 0;font-size:42px;line-height:1.05;font-weight:500;letter-spacing:-.04em;text-wrap:balance}.intro p{max-width:430px;margin:24px 0 0;color:var(--secondary);font-size:15px;line-height:1.7}.safety{margin-top:40px;border-block:1px solid var(--border)}.safety-row{display:grid;grid-template-columns:96px 1fr;gap:16px;padding:14px 0}.safety-row+.safety-row{border-top:1px solid var(--border)}.safety dt{font:10px "Departure Mono",ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}.safety dd{margin:0;color:var(--secondary);font-size:13px}.form-shell{align-self:start;margin:64px 32px;border:1px solid var(--border);background:var(--card)}.app-head,.form-body,.actions{padding:24px 28px}.app-head{border-bottom:1px solid var(--border);background:var(--surface)}.client-label{font:10px "Departure Mono",ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}h2{margin:10px 0 0;font-size:22px;line-height:1.2;font-weight:550;letter-spacing:-.025em}.permission{margin:0;border:1px solid var(--border);background:var(--surface)}.permission-row{padding:16px 18px}.permission strong,.workspace strong{display:block;font-weight:500}.permission small,.workspace small{display:block;margin-top:4px;color:var(--muted);font-size:12px;line-height:1.5}.section-label{margin:24px 0 10px;font:10px "Departure Mono",ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--secondary)}.workspaces{border:1px solid var(--border)}.workspace{display:flex;min-height:58px;align-items:center;gap:13px;padding:11px 14px;background:transparent;cursor:pointer;transition:background 150ms}.workspace+.workspace{border-top:1px solid var(--border)}.workspace:hover,.workspace:has(input:checked){background:var(--hover)}.workspace input{width:14px;height:14px;margin:0;accent-color:var(--primary)}.actions{display:flex;justify-content:flex-end;gap:10px;border-top:1px solid var(--border);background:var(--surface)}button.action{height:40px;border:1px solid var(--border-strong);padding:0 18px;background:var(--card);color:var(--primary);font:500 13px "Inter Variable",Inter,system-ui,sans-serif;cursor:pointer;transition:background 150ms,transform 150ms}.action:hover{background:var(--hover)}.action:active,.theme:active{transform:scale(.98)}.action.primary{border-color:var(--primary);background:var(--primary);color:var(--bg)}button:focus-visible,input:focus-visible{outline:2px solid var(--primary);outline-offset:-2px}.foot{height:56px;display:flex;flex:none;align-items:center;justify-content:space-between;padding:0 32px;border-top:1px solid var(--border);font:10px "Departure Mono",ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}@media(max-width:820px){header{height:56px;padding:0 20px}.layout{display:block}.intro{padding:64px 20px 40px;border-right:0;border-bottom:1px solid var(--border)}h1{font-size:34px}.safety{margin-top:32px}.form-shell{margin:32px 20px 64px}.foot{padding:0 20px}}@media(max-width:520px){.app-head,.form-body,.actions{padding:20px}.actions{flex-direction:column-reverse}.action{width:100%}.safety-row{grid-template-columns:76px 1fr}}
      .identity-warning{margin:0 20px;padding:14px 0;border-bottom:1px solid var(--border);color:var(--secondary);font-size:12px}.identity-warning strong{display:block;color:var(--accent);font:10px "Departure Mono",ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase}.identity-warning p{margin:6px 0 0}.identity-warning code{color:var(--primary);font:11px "Departure Mono",ui-monospace,monospace;overflow-wrap:anywhere}
    </style>
  </head>
  <body>
    <div class="rail">
      <header>
        <div class="brand" aria-label="refd">${logoMark()}<span class="wordmark">refd</span></div>
        <button class="theme" type="button" id="theme-toggle">theme</button>
      </header>
      <main class="layout">
        <section class="intro">
          <div class="eyebrow">connected apps</div>
          <h1>Share the right data with the right app.</h1>
          <p>Approve read-only access to one workspace. The app receives your monitored AI visibility evidence, never account-wide access.</p>
          <dl class="safety">
            <div class="safety-row"><dt>access</dt><dd>Read-only visibility data</dd></div>
            <div class="safety-row"><dt>scope</dt><dd>One workspace per connection</dd></div>
            <div class="safety-row"><dt>control</dt><dd>Revoke from Settings at any time</dd></div>
          </dl>
        </section>
        <form class="form-shell" method="post" action="${escapeHtml(`${action.pathname}${action.search}`)}">
          <input type="hidden" name="csrf_token" value="${token}">
          <div class="app-head"><div class="client-label">requesting app</div><h2>${name}</h2></div>
          <div class="identity-warning"><strong>unverified app</strong><p>This app identity is self-reported and has not been verified by refd. Continue only if you started this connection. After approval, refd will return you to <code>${target}</code>.</p></div>
          <div class="form-body">
            <div class="permission"><div class="permission-row"><strong>Read your AI visibility data</strong><small>Visibility, citations, competitors, tracked prompts, changes, and answer evidence. This app cannot change data or start paid runs.</small></div></div>
            <div class="section-label">choose a workspace</div>
            <div class="workspaces">${workspaceRows}</div>
          </div>
          <div class="actions">
            <button class="action" type="submit" name="decision" value="deny">Cancel</button>
            <button class="action primary" type="submit" name="decision" value="approve">Connect app</button>
          </div>
        </form>
      </main>
      <footer class="foot"><span>open-source AI search monitoring</span><span>OAuth 2.1</span></footer>
    </div>
    <script nonce="${nonce}">const button=document.getElementById("theme-toggle");const setLabel=()=>{const current=document.documentElement.dataset.theme;button.textContent=current==="dark"?"light theme":"dark theme";button.setAttribute("aria-label",button.textContent)};setLabel();button.addEventListener("click",()=>{const next=document.documentElement.dataset.theme==="dark"?"light":"dark";document.documentElement.dataset.theme=next;try{localStorage.setItem("refd-theme",next)}catch{}setLabel()})</script>
  </body>
</html>`,
    { headers: responseHeaders(csrfCookie(token), nonce, callbackUrl) },
  );
};

const authorize = async (
  request: Request,
  env: AppEnv,
  oauth: OAuthHelpers,
  resourceUrl: string,
): Promise<Response> => {
  const user = await authenticatedUser(request, env);
  if (!user) {
    return signInRedirect(request, env);
  }

  const parsedRequest = await parseAuthorizationRequest(oauth, request);
  if (parsedRequest instanceof Response) {
    return parsedRequest;
  }
  const authRequest = parsedRequest;
  const client = await oauth.lookupClient(authRequest.clientId);
  if (!client) {
    return errorPage(400, 'The requesting app is not registered.');
  }
  const redirectTarget = callbackTarget(authRequest.redirectUri);
  if (!redirectTarget) {
    return errorPage(400, 'The app requested an insecure callback.');
  }
  if (!resourceRequest(authRequest, resourceUrl)) {
    return errorPage(400, 'The app requested a different protected resource.');
  }
  if (!grantedScopes(authRequest)) {
    return errorPage(400, 'The app requested an unsupported permission.');
  }

  const db = getDb(env);
  if (request.method === 'GET') {
    const ownedWorkspaces = await db
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.ownerUserId, user.id))
      .orderBy(workspaces.id);
    if (ownedWorkspaces.length === 0) {
      return errorPage(409, 'Create a workspace before connecting this app.');
    }
    return renderConsent(
      request,
      client,
      ownedWorkspaces,
      authRequest.redirectUri,
    );
  }

  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });
  }

  const form = await request.formData().catch(() => null);
  const parsed = consentFormSchema.safeParse({
    csrfToken: form?.get('csrf_token'),
    decision: form?.get('decision'),
    workspaceId: form?.get('workspace_id') ?? undefined,
  });
  if (
    !parsed.success ||
    !(await validCsrfToken(request, parsed.data.csrfToken))
  ) {
    return errorPage(400, 'The approval expired. Restart the connection.');
  }
  if (parsed.data.decision === 'deny') {
    console.log(
      JSON.stringify({
        event: 'mcp_authorization_denied',
        clientId: client.clientId,
        userId: user.id,
      }),
    );
    return denyRedirect(authRequest);
  }
  if (!parsed.data.workspaceId) {
    return errorPage(400, 'Choose a workspace.');
  }

  const workspaceId = Number(parsed.data.workspaceId);
  const workspace = (
    await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(
        and(
          eq(workspaces.id, workspaceId),
          eq(workspaces.ownerUserId, user.id),
        ),
      )
      .limit(1)
  )[0];
  if (!workspace) {
    return errorPage(404, 'Workspace not found.');
  }

  const scope = grantedScopes(authRequest);
  const boundRequest = resourceRequest(authRequest, resourceUrl);
  if (!scope || !boundRequest) {
    return errorPage(400, 'The authorization request is invalid.');
  }
  const oauthUserId = String(user.id);
  await revokePriorWorkspaceGrants(
    oauth,
    env,
    oauthUserId,
    client.clientId,
    workspace.id,
  );

  const connectionId = crypto.randomUUID();
  const name = clientName(client);
  const { redirectTo } = await oauth.completeAuthorization({
    request: boundRequest,
    userId: oauthUserId,
    metadata: { connectionId, workspaceId: workspace.id },
    scope,
    props: {
      callbackTarget: redirectTarget,
      clientName: name,
      connectionId,
      scopes: scope,
      userId: user.id,
      workspaceId: workspace.id,
    },
    revokeExistingGrants: false,
  });
  console.log(
    JSON.stringify({
      event: 'mcp_authorization_approved',
      clientId: client.clientId,
      userId: user.id,
      workspaceId: workspace.id,
    }),
  );
  return redirect(redirectTo, clearCsrfCookie());
};

export const handleOAuthDefault = async (
  request: Request,
  env: AppEnv,
  ctx: ExecutionContext,
  oauth: OAuthHelpers,
  resourceUrl: string,
): Promise<Response> => {
  if (new URL(request.url).pathname !== '/oauth/authorize') {
    return app.fetch(request, env, ctx);
  }
  try {
    return await authorize(request, env, oauth, resourceUrl);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'mcp_authorization_failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return errorPage(400, 'The authorization request is invalid or expired.');
  }
};
