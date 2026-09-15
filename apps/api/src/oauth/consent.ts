import type {
  AuthRequest,
  ClientInfo,
  GrantSummary,
  OAuthHelpers,
} from '@cloudflare/workers-oauth-provider';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { app } from '../app';
import { readRequestSession } from '../auth/session';
import { getDb } from '../db/client';
import { entities, mcpConnections, users, workspaces } from '../db/schema';
import type { AppEnv } from '../env';
import { dashboardOriginForRequest } from '../lib/cors';
import { provisionWorkspace } from '../lib/workspace-provision';
import { MCP_SCOPE, MCP_SCOPES, MCP_WRITE_SCOPE } from './constants';
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
  // Multi-workspace read grants: the consent-time checked set, or the
  // all-workspace marker.
  allWorkspaces: z.boolean().optional(),
  workspaceIds: z.array(z.number().int().positive()).optional(),
});
const consentFormSchema = z.object({
  csrfToken: z.string().uuid(),
  decision: z.enum(['approve', 'deny']),
  workspaceIds: z
    .array(z.union([z.string().regex(/^[1-9]\d*$/), z.literal('create')]))
    .max(100),
  allWorkspaces: z.boolean(),
  newWorkspaceName: z.string().max(60).optional(),
  provisioningKey: z.string().uuid().optional(),
});
export const parseConsentForm = (form: FormData | null) =>
  consentFormSchema.safeParse({
    csrfToken: form?.get('csrf_token'),
    decision: form?.get('decision'),
    workspaceIds: form ? form.getAll('workspace_id').map(String) : [],
    allWorkspaces: form?.get('all_workspaces') === '1',
    newWorkspaceName: form?.get('new_workspace_name') ?? undefined,
    provisioningKey: form?.get('provisioning_key') ?? undefined,
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
    'Content-Security-Policy': `default-src 'none'; ${nonce ? `script-src 'nonce-${nonce}'; ` : ''}style-src 'unsafe-inline'; img-src https://www.google.com https://*.gstatic.com; form-action ${formActionSources(callbackUrl)}; frame-ancestors 'none'; base-uri 'none'`,
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

// Same favicon service the dashboard uses for brand logos.
const faviconUrl = (domain: string): string =>
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;

const workspaceAvatar = (workspace: {
  name: string;
  logoUrl: string | null;
}): string => {
  if (workspace.logoUrl) {
    return `<img class="ws-logo" src="${escapeHtml(workspace.logoUrl)}" alt="" width="20" height="20" loading="lazy">`;
  }
  const initial = escapeHtml(
    workspace.name.trim().charAt(0).toUpperCase() || '?',
  );
  return `<svg class="ws-logo" viewBox="0 0 20 20" aria-hidden="true"><rect width="20" height="20" rx="4" fill="rgba(127,127,127,.15)"/><text x="10" y="14" text-anchor="middle" font-size="11" fill="currentColor">${initial}</text></svg>`;
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
  const unique = [...new Set(scopes)];
  const known = MCP_SCOPES as readonly string[];
  if (!unique.every((scope) => known.includes(scope))) {
    return null;
  }
  // Canonical order; an omitted scope defaults to read-only.
  return MCP_SCOPES.filter((scope) => unique.includes(scope));
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

// Prior grants of the same client are revoked when they overlap the newly
// granted set: one connection per (client, workspace), so a grant covering a
// workspace again never doubles up. Legacy metadata carries only the single
// default id; dynamic all-workspace grants overlap everything.
const overlapsGrantedWorkspaces = (
  metadata: z.infer<typeof grantMetadataSchema>,
  workspaceIds: number[],
  coversAll: boolean,
): boolean =>
  coversAll ||
  metadata.allWorkspaces === true ||
  workspaceIds.includes(metadata.workspaceId) ||
  (metadata.workspaceIds ?? []).some((id) => workspaceIds.includes(id));

const revokePriorWorkspaceGrants = async (
  oauth: OAuthHelpers,
  env: AppEnv,
  userId: string,
  clientId: string,
  workspaceIds: number[],
  coversAll: boolean,
): Promise<void> => {
  const grants = await listUserGrants(oauth, userId);
  const matching = grants.filter((grant) => {
    if (grant.clientId !== clientId) {
      return false;
    }
    const metadata = grantMetadataSchema.safeParse(grant.metadata);
    return (
      metadata.success &&
      overlapsGrantedWorkspaces(metadata.data, workspaceIds, coversAll)
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

// An acted-upon authorization request must never re-open its consent form:
// approvals and denials mark the request consumed, keyed by a fingerprint of
// the protocol fields (state and code challenge make every attempt unique).
// Markers persist rather than expire: a stale link stays dead instead of
// resurrecting consent days later, and volume is bounded by consent posts.
export const authRequestFingerprint = async (authRequest: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string[];
  codeChallenge?: string;
  resource?: string | string[];
}): Promise<string> => {
  const identity = JSON.stringify([
    authRequest.clientId,
    authRequest.redirectUri,
    authRequest.state,
    authRequest.scope,
    authRequest.codeChallenge ?? null,
    authRequest.resource ?? null,
  ]);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(identity),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const consumedAuthKey = (fingerprint: string): string =>
  `auth_consumed:${fingerprint}`;

export const isAuthRequestConsumed = async (
  env: AppEnv,
  fingerprint: string,
): Promise<boolean> =>
  (await env.OAUTH_KV.get(consumedAuthKey(fingerprint))) !== null;

const markAuthRequestConsumed = (
  env: AppEnv,
  fingerprint: string,
): Promise<void> =>
  env.OAUTH_KV.put(consumedAuthKey(fingerprint), new Date().toISOString());

export const renderConsent = (
  request: Request,
  client: ClientInfo,
  ownedWorkspaces: {
    id: number;
    name: string;
    onboarded: boolean;
    logoUrl: string | null;
  }[],
  callbackUrl: string,
  scopes: string[],
): Response => {
  const token = createCsrfToken();
  const nonce = crypto.randomUUID();
  const action = new URL(request.url);
  const writeMode = scopes.includes(MCP_WRITE_SCOPE);
  const workspaceRows = ownedWorkspaces
    .map(
      (workspace, index) => `
        <label class="workspace">
          <input type="checkbox" name="workspace_id" value="${workspace.id}" ${index === 0 ? 'checked' : ''}>
          ${workspaceAvatar(workspace)}
          <span><strong>${escapeHtml(workspace.name)}</strong><small>${workspace.onboarded ? (writeMode ? 'Read plus setup' : 'Read-only') : 'Setup in progress'}</small></span>
        </label>`,
    )
    .join('');
  const createWorkspaceRow = writeMode
    ? [
        `
        <label class="workspace">
          <input type="checkbox" name="workspace_id" value="create" ${ownedWorkspaces.length === 0 ? 'checked' : ''}>
          <span><strong>Create a new workspace with this agent</strong><small>An empty workspace is provisioned on approval</small></span>
        </label>`,
      ].join('')
    : '';
  const name = escapeHtml(clientName(client));
  const target = escapeHtml(callbackTarget(callbackUrl) ?? 'unknown callback');
  const introCopy = writeMode
    ? 'Approve access to the workspaces you choose. Pick any number below, or allow all: the app can read your monitored AI visibility evidence and set up those workspaces with you, never account-wide access.'
    : 'Approve read-only access to the workspaces you choose. Pick any number below, or allow all: the app receives your monitored AI visibility evidence for those workspaces, never account-wide access.';
  const permissionRows = writeMode
    ? `<div class="permission-row"><strong>Read your AI visibility data</strong><small>Visibility, citations, competitors, tracked prompts, changes, and answer evidence.</small></div>
              <div class="permission-row"><strong>Configure tracking and start one report per approved workspace</strong><small>The app can set up the approved workspaces: brand, competitors, prompts, and surfaces, and start one provider-backed onboarding report per workspace. It cannot delete data, manage billing, or start further runs.</small></div>`
    : `<div class="permission-row"><strong>Read your AI visibility data</strong><small>Visibility, citations, competitors, tracked prompts, changes, and answer evidence. This app cannot change data or start paid runs.</small></div>`;

  return new Response(
    `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Connect ${name} · refd</title>
    <script nonce="${nonce}">try{const stored=localStorage.getItem("refd-theme");const theme=stored==="dark"||stored==="light"?stored:matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.dataset.theme=theme}catch{}</script>
    <style>
      :root{color-scheme:dark;--bg:#080809;--bg-subtle:#0d0d0f;--surface:#0a0a0c;--card:rgba(255,255,255,.025);--hover:rgba(255,255,255,.05);--primary:#f5f3ef;--secondary:#b7b3b0;--muted:#82808a;--border:rgba(255,255,255,.09);--border-strong:rgba(255,255,255,.18);--accent:#f02b3a;--accent-soft:rgba(240,43,58,.12);--inset:28px}
      :root[data-theme="light"]{color-scheme:light;--bg:#f7f4f0;--bg-subtle:#f0ebe6;--surface:#fffdfa;--card:rgba(39,28,30,.025);--hover:rgba(39,28,30,.05);--primary:#181416;--secondary:#50494c;--muted:#71676b;--border:rgba(39,28,30,.14);--border-strong:rgba(39,28,30,.24);--accent:#c8232f;--accent-soft:rgba(200,35,47,.09);--inset:28px}
      *{box-sizing:border-box}html,body{min-height:100%;background:var(--bg)}body{margin:0;color:var(--primary);font:14px/1.65 "Inter Variable",Inter,system-ui,sans-serif;overscroll-behavior-y:none}.rail{width:min(1120px,100%);min-height:100svh;margin:0 auto;border-inline:1px solid var(--border);display:flex;flex-direction:column}header{height:68px;display:flex;flex:none;align-items:center;justify-content:space-between;padding:0 32px;border-bottom:1px solid var(--border)}.brand{display:flex;align-items:center;gap:10px}.mark{width:18px;height:18px}.mark .dither{opacity:.35}.wordmark{font:15px "Departure Mono",ui-monospace,monospace}.theme{height:32px;padding:0 12px;border:1px solid var(--border);background:var(--card);color:var(--secondary);font:10px "Departure Mono",ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;transition:background 150ms,color 150ms,border-color 150ms}.theme:hover{background:var(--hover);color:var(--primary);border-color:var(--border-strong)}.layout{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);flex:1}.intro{padding:96px 48px 96px 32px;border-right:1px solid var(--border)}.eyebrow{font:11px "Departure Mono",ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}h1{max-width:430px;margin:22px 0 0;font-size:42px;line-height:1.05;font-weight:500;letter-spacing:-.04em;text-wrap:balance}.intro p{max-width:430px;margin:24px 0 0;color:var(--secondary);font-size:15px;line-height:1.7}.safety{margin-top:40px;border-block:1px solid var(--border)}.safety-row{display:grid;grid-template-columns:96px 1fr;gap:16px;padding:14px 0}.safety-row+.safety-row{border-top:1px solid var(--border)}.safety dt{font:10px "Departure Mono",ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}.safety dd{margin:0;color:var(--secondary);font-size:13px}.form-shell{align-self:start;margin:64px 32px;border:1px solid var(--border);background:var(--card)}.app-head,.form-body,.actions{padding:24px 28px}.app-head{border-bottom:1px solid var(--border);background:var(--surface)}.client-label{font:10px "Departure Mono",ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}h2{margin:10px 0 0;font-size:22px;line-height:1.2;font-weight:550;letter-spacing:-.025em}.permission{margin:0;border:1px solid var(--border);background:var(--surface)}.permission-row{padding:16px 18px}.permission strong,.workspace strong{display:block;font-weight:500}.permission small,.workspace small{display:block;margin-top:4px;color:var(--muted);font-size:12px;line-height:1.5}.section-label{margin:24px 0 10px;font:11px "Departure Mono",ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--secondary)}.workspaces{border:1px solid var(--border)}.workspace{display:flex;min-height:58px;align-items:center;gap:12px;padding:11px 14px;background:transparent;cursor:pointer;transition:background 150ms}.workspace+.workspace{border-top:1px solid var(--border)}.workspace:has(input:checked){background:var(--hover)}.workspace:hover:has(input:not(:disabled)){background:var(--hover)}.workspace:has(input:disabled){opacity:.45;cursor:default}
.new-name{margin-top:12px;width:100%;padding:10px 12px;border:1px solid var(--border);background:var(--card);color:var(--primary);font:inherit}
.new-name:focus{outline:none;border-color:var(--border-strong)}.workspace input{width:14px;height:14px;margin:0;accent-color:var(--primary)}.actions{display:flex;justify-content:flex-end;gap:10px;border-top:1px solid var(--border);background:var(--surface)}button.action{height:40px;border:1px solid var(--border-strong);padding:0 18px;background:var(--card);color:var(--primary);font:500 13px "Inter Variable",Inter,system-ui,sans-serif;cursor:pointer;transition:background 150ms,transform 150ms}.action:hover{background:var(--hover)}.action:active,.theme:active{transform:scale(.98)}.action.primary{border-color:var(--primary);background:var(--primary);color:var(--bg)}button:focus-visible,input:focus-visible{outline:2px solid var(--primary);outline-offset:-2px}.foot{height:56px;display:flex;flex:none;align-items:center;justify-content:space-between;padding:0 32px;border-top:1px solid var(--border);font:10px "Departure Mono",ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}@media(max-width:820px){header{height:56px;padding:0 20px}.layout{display:block}.intro{padding:64px 20px 40px;border-right:0;border-bottom:1px solid var(--border)}h1{font-size:34px}.safety{margin-top:32px}.form-shell{margin:32px 20px 64px}.foot{padding:0 20px}}@media(max-width:520px){:root{--inset:20px}.app-head,.form-body,.actions{padding:20px}.actions{flex-direction:column-reverse}.action{width:100%}.safety-row{grid-template-columns:76px 1fr}}
      .identity-warning{margin:0 var(--inset);padding:14px 0;border-bottom:1px solid var(--border);color:var(--secondary);font-size:12px}.identity-warning strong{display:block;color:var(--accent);font:10px "Departure Mono",ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase}.identity-warning p{margin:6px 0 0}.identity-warning code{color:var(--primary);font:11px "Departure Mono",ui-monospace,monospace;overflow-wrap:anywhere}
      .ws-logo{width:20px;height:20px;flex:none}
      .allow-all{position:relative;display:flex;gap:12px;align-items:flex-start;margin:0 0 12px;padding:12px 14px;border:1px solid var(--border);background:var(--hover);cursor:pointer}
      .allow-all input{position:absolute;opacity:0;width:0;height:0}
      .allow-all .switch{width:36px;height:20px;border:1px solid var(--border);background:var(--bg);position:relative;flex:none;margin-top:2px;transition:border-color 150ms}
      .allow-all .switch::after{content:"";position:absolute;top:3px;left:3px;width:12px;height:12px;background:var(--primary);transition:transform 150ms}
      .allow-all input:checked~.switch{border-color:var(--border-strong);background:var(--accent-soft)}
      .allow-all input:checked~.switch::after{transform:translateX(16px)}
      .allow-all input:focus-visible~.switch{outline:2px solid var(--primary);outline-offset:-2px}
      .allow-all-text strong{display:block;font-weight:500}
      .allow-all-text small{color:var(--secondary);font-size:12px}
      .allow-all-text small strong{display:inline}
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
          <p>${escapeHtml(introCopy)}</p>
          <dl class="safety">
            <div class="safety-row"><dt>access</dt><dd>${writeMode ? 'Read plus bounded setup' : 'Read-only visibility data'}</dd></div>
            <div class="safety-row"><dt>scope</dt><dd>The workspaces you check, or all of them</dd></div>
            <div class="safety-row"><dt>control</dt><dd>Revoke from Settings at any time</dd></div>
          </dl>
        </section>
        <form class="form-shell" method="post" action="${escapeHtml(`${action.pathname}${action.search}`)}">
          <input type="hidden" name="csrf_token" value="${token}">
          <div class="app-head"><div class="client-label">requesting app</div><h2>${name}</h2></div>
          <div class="identity-warning"><strong>unverified app</strong><p>This app identity is self-reported and has not been verified by refd. Continue only if you started this connection. After approval, refd will return you to <code>${target}</code>.</p></div>
          <div class="form-body">
            <div class="permission">${permissionRows}</div>
            <div class="section-label" id="workspace-group-label">choose workspaces</div>
            ${
              ownedWorkspaces.length > 0
                ? `
            <label class="allow-all">
              <input type="checkbox" name="all_workspaces" value="1" id="allow-all">
              <span class="switch" aria-hidden="true"></span>
              <span class="allow-all-text"><strong>Allow all workspaces</strong><small>This app sees every workspace on the account, including ones you create later. It always targets your default workspace: <strong>${escapeHtml(ownedWorkspaces[0]?.name ?? '')}</strong>.</small></span>
            </label>`
                : ''
            }
            <div class="workspaces" role="group" aria-labelledby="workspace-group-label">${workspaceRows}${createWorkspaceRow}</div>
            ${writeMode ? `<input class="new-name" id="new-workspace-name" type="text" name="new_workspace_name" maxlength="60" placeholder="Name for the new workspace" autocomplete="off" aria-label="New workspace name" hidden disabled>` : ''}
            <input type="hidden" name="provisioning_key" value="${crypto.randomUUID()}">
          </div>
          <div class="actions">
            <button class="action" type="submit" name="decision" value="deny">Cancel</button>
            <button class="action primary" type="submit" name="decision" value="approve">Connect app</button>
          </div>
        </form>
      </main>
      <footer class="foot"><span>open-source AI search monitoring</span><span>OAuth 2.1</span></footer>
    </div>
    <script nonce="${nonce}">const button=document.getElementById("theme-toggle");const setLabel=()=>{const current=document.documentElement.dataset.theme;button.textContent=current==="dark"?"light theme":"dark theme";button.setAttribute("aria-label",button.textContent)};setLabel();button.addEventListener("click",()=>{const next=document.documentElement.dataset.theme==="dark"?"light":"dark";document.documentElement.dataset.theme=next;try{localStorage.setItem("refd-theme",next)}catch{}setLabel()});const allowAll=document.getElementById("allow-all");const nameBoxes=[...document.querySelectorAll('input[name="workspace_id"]')].filter((box)=>box.value!=="create");const createRow=[...document.querySelectorAll('input[name="workspace_id"]')].find((box)=>box.value==="create");const workspaceName=document.getElementById("new-workspace-name");const syncWorkspaceName=()=>{if(!workspaceName)return;const creating=createRow?.checked===true;workspaceName.hidden=!creating;workspaceName.disabled=!creating;workspaceName.required=creating};if(allowAll){allowAll.addEventListener("change",()=>{nameBoxes.forEach((box)=>{box.disabled=allowAll.checked;if(allowAll.checked){box.checked=false}});if(allowAll.checked&&createRow){createRow.checked=false}if(createRow){createRow.disabled=allowAll.checked}syncWorkspaceName()})}if(createRow){createRow.addEventListener("change",()=>{if(createRow.checked){nameBoxes.forEach((box)=>{box.checked=false});if(allowAll){allowAll.checked=false}}syncWorkspaceName()})}nameBoxes.forEach((box)=>box.addEventListener("change",()=>{if(box.checked&&createRow){createRow.checked=false}if(box.checked&&allowAll){allowAll.checked=false}syncWorkspaceName()}));syncWorkspaceName()</script>
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
  const fingerprint = await authRequestFingerprint(authRequest);
  if (await isAuthRequestConsumed(env, fingerprint)) {
    return errorPage(
      409,
      'This authorization link was already used and has expired. Start a new connection from your app.',
    );
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
    const scope = grantedScopes(authRequest);
    const ownedWorkspaces = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        onboarded: workspaces.onboardingCompleted,
        brandDomains: entities.domains,
      })
      .from(workspaces)
      .leftJoin(
        entities,
        and(
          eq(entities.workspaceId, workspaces.id),
          eq(entities.isBrand, true),
        ),
      )
      .where(eq(workspaces.ownerUserId, user.id))
      .orderBy(workspaces.id);
    const workspaceChoices = ownedWorkspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      onboarded: workspace.onboarded,
      logoUrl: workspace.brandDomains?.[0]
        ? faviconUrl(workspace.brandDomains[0])
        : null,
    }));
    if (ownedWorkspaces.length === 0 && !scope?.includes(MCP_WRITE_SCOPE)) {
      return errorPage(
        409,
        'Finish setting up a workspace before connecting this app.',
      );
    }
    return renderConsent(
      request,
      client,
      workspaceChoices,
      authRequest.redirectUri,
      scope ?? [],
    );
  }

  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });
  }

  const form = await request.formData().catch(() => null);
  const parsed = parseConsentForm(form);
  if (
    !parsed.success ||
    !(await validCsrfToken(request, parsed.data.csrfToken))
  ) {
    return errorPage(400, 'The approval expired. Restart the connection.');
  }
  if (parsed.data.decision === 'deny') {
    await markAuthRequestConsumed(env, fingerprint);
    console.log(
      JSON.stringify({
        event: 'mcp_authorization_denied',
        clientId: client.clientId,
        userId: user.id,
      }),
    );
    return denyRedirect(authRequest);
  }
  const scope = grantedScopes(authRequest);
  const boundRequest = resourceRequest(authRequest, resourceUrl);
  if (!scope || !boundRequest) {
    return errorPage(400, 'The authorization request is invalid.');
  }

  const writeMode = scope.includes(MCP_WRITE_SCOPE);
  const selection = parsed.data.workspaceIds;
  let workspaceId: number;
  let workspaceIds: number[] | undefined;
  let allWorkspaces = false;
  let provisioned = false;
  if (parsed.data.allWorkspaces) {
    // Dynamic grant: default workspace is the consent-time first owned
    // workspace; the set resolves at request time so future workspaces join
    // with no re-approval.
    const owned = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.ownerUserId, user.id))
      .orderBy(workspaces.id)
      .limit(1);
    if (!owned[0]) {
      return errorPage(
        409,
        'Finish setting up a workspace before connecting this app.',
      );
    }
    workspaceId = owned[0].id;
    allWorkspaces = true;
  } else if (writeMode && selection.includes('create')) {
    // Never trust the form: provisioning is exclusive with checked ids, and
    // creation happens only inside this CSRF-validated approval. Denial,
    // invalid CSRF, or an exhausted entitlement creates nothing.
    if (selection.length > 1) {
      return errorPage(
        400,
        'Creating a workspace cannot combine with checked workspaces.',
      );
    }
    const name = parsed.data.newWorkspaceName?.trim();
    if (!name) {
      return errorPage(400, 'Name the new workspace.');
    }
    if (!parsed.data.provisioningKey) {
      return errorPage(400, 'The approval expired. Restart the connection.');
    }
    const created = await provisionWorkspace(
      env,
      { id: user.id, email: user.email },
      name,
      parsed.data.provisioningKey,
    );
    if (!created.ok) {
      return errorPage(409, created.error);
    }
    workspaceId = created.id;
    provisioned = true;
  } else {
    // Never trust checked ids from the form: intersect with owned workspaces.
    const checked = [
      ...new Set(selection.filter((value) => value !== 'create').map(Number)),
    ];
    if (checked.length === 0) {
      return errorPage(400, 'Choose at least one workspace.');
    }
    const owned = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(
        and(
          eq(workspaces.ownerUserId, user.id),
          inArray(workspaces.id, checked),
        ),
      )
      .orderBy(workspaces.id);
    if (owned.length === 0) {
      return errorPage(400, 'Choose at least one workspace.');
    }
    workspaceIds = owned.map((workspace) => workspace.id);
    const first = workspaceIds[0];
    if (first === undefined) {
      return errorPage(400, 'Choose at least one workspace.');
    }
    workspaceId = first;
  }
  const oauthUserId = String(user.id);
  await revokePriorWorkspaceGrants(
    oauth,
    env,
    oauthUserId,
    client.clientId,
    workspaceIds ?? [workspaceId],
    allWorkspaces,
  );

  const connectionId = crypto.randomUUID();
  const name = clientName(client);
  const { redirectTo } = await oauth.completeAuthorization({
    request: boundRequest,
    userId: oauthUserId,
    metadata: {
      connectionId,
      workspaceId,
      ...(workspaceIds ? { workspaceIds } : {}),
      ...(allWorkspaces ? { allWorkspaces: true } : {}),
    },
    scope,
    props: {
      callbackTarget: redirectTarget,
      clientName: name,
      connectionId,
      scopes: scope,
      userId: user.id,
      workspaceId,
      ...(workspaceIds ? { workspaceIds } : {}),
      ...(allWorkspaces ? { allWorkspaces: true } : {}),
    },
    revokeExistingGrants: false,
  });
  await markAuthRequestConsumed(env, fingerprint);
  console.log(
    JSON.stringify({
      event: 'mcp_authorization_approved',
      clientId: client.clientId,
      userId: user.id,
      allWorkspaces,
      workspaceIds: workspaceIds ?? [workspaceId],
      scopes: scope,
      provisioned,
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
