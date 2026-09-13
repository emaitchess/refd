import { describe, expect, test } from 'bun:test';
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { AppEnv } from '../env';
import {
  handleOAuthDefault,
  oauthAuthorizationErrorResponse,
  parseConsentForm,
  renderConsent,
} from './consent';
import { MCP_SCOPE, MCP_WRITE_SCOPE } from './constants';

describe('OAuth consent', () => {
  test('parses the fields required to provision a workspace', () => {
    const form = new FormData();
    const csrfToken = crypto.randomUUID();
    const provisioningKey = crypto.randomUUID();
    form.set('csrf_token', csrfToken);
    form.set('decision', 'approve');
    form.set('workspace_id', 'create');
    form.set('new_workspace_name', 'refd.ai');
    form.set('provisioning_key', provisioningKey);

    const parsed = parseConsentForm(form);

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({
        csrfToken,
        decision: 'approve',
        workspaceIds: ['create'],
        allWorkspaces: false,
        newWorkspaceName: 'refd.ai',
        provisioningKey,
      });
    }
  });

  test('parses a checked set of workspaces for a read-only grant', () => {
    const form = new FormData();
    form.set('csrf_token', crypto.randomUUID());
    form.set('decision', 'approve');
    form.append('workspace_id', '2');
    form.append('workspace_id', '5');
    form.append('workspace_id', '2');

    const parsed = parseConsentForm(form);

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.workspaceIds).toEqual(['2', '5', '2']);
      expect(parsed.data.allWorkspaces).toBe(false);
    }
  });

  test('parses the allow-all switch', () => {
    const form = new FormData();
    form.set('csrf_token', crypto.randomUUID());
    form.set('decision', 'approve');
    form.set('all_workspaces', '1');

    const parsed = parseConsentForm(form);

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.allWorkspaces).toBe(true);
      expect(parsed.data.workspaceIds).toEqual([]);
    }
  });

  test('renders checkboxes and the allow-all switch for read-only grants', async () => {
    const response = renderConsent(
      new Request('https://api.refd.ai/oauth/authorize'),
      {
        clientId: 'test-client',
        clientName: 'Test client',
        redirectUris: ['https://client.example/oauth/callback'],
        tokenEndpointAuthMethod: 'none',
      },
      [
        { id: 1, name: 'Ready workspace', onboarded: true, logoUrl: null },
        { id: 2, name: 'Draft workspace', onboarded: false, logoUrl: null },
      ],
      'https://client.example/oauth/callback',
      [MCP_SCOPE],
    );
    const html = await response.text();

    expect(html).toContain('type="checkbox" name="workspace_id" value="1"');
    expect(html).toContain('type="checkbox" name="workspace_id" value="2"');
    expect(html).toContain('name="all_workspaces"');
    expect(html).toContain('Allow all workspaces');
    expect(html).toContain('every workspace on the account');
    expect(html).toContain('allowAll.addEventListener');
    expect(html).not.toContain('type="radio"');
  });

  test('renders checkboxes, the allow-all switch, and the create row for write grants', async () => {
    const response = renderConsent(
      new Request('https://api.refd.ai/oauth/authorize'),
      {
        clientId: 'test-client',
        clientName: 'Test client',
        redirectUris: ['https://client.example/oauth/callback'],
        tokenEndpointAuthMethod: 'none',
      },
      [{ id: 1, name: 'Ready workspace', onboarded: true, logoUrl: null }],
      'https://client.example/oauth/callback',
      [MCP_SCOPE, MCP_WRITE_SCOPE],
    );
    const html = await response.text();

    expect(html).toContain('type="checkbox" name="workspace_id" value="1"');
    expect(html).toContain('name="all_workspaces"');
    expect(html).toContain('Allow all workspaces');
    expect(html).toContain('Create a new workspace with this agent');
    expect(html).not.toContain('type="radio"');
  });

  test('omits the allow-all switch when the account has no workspaces yet', async () => {
    const response = renderConsent(
      new Request('https://api.refd.ai/oauth/authorize'),
      {
        clientId: 'test-client',
        clientName: 'Test client',
        redirectUris: ['https://client.example/oauth/callback'],
        tokenEndpointAuthMethod: 'none',
      },
      [],
      'https://client.example/oauth/callback',
      [MCP_SCOPE, MCP_WRITE_SCOPE],
    );
    const html = await response.text();

    expect(html).not.toContain('name="all_workspaces"');
    expect(html).toContain('Create a new workspace with this agent');
  });

  test('shows the workspace name input only when create is selected', async () => {
    const response = renderConsent(
      new Request('https://api.refd.ai/oauth/authorize'),
      {
        clientId: 'test-client',
        clientName: 'Test client',
        redirectUris: ['https://client.example/oauth/callback'],
        tokenEndpointAuthMethod: 'none',
      },
      [
        {
          id: 1,
          name: 'Existing workspace',
          onboarded: true,
          logoUrl:
            'https://www.google.com/s2/favicons?domain=example.com&sz=64',
        },
        {
          id: 2,
          name: 'Half-setup workspace',
          onboarded: false,
          logoUrl: null,
        },
      ],
      'https://client.example/oauth/callback',
      [MCP_SCOPE, MCP_WRITE_SCOPE],
    );
    const html = await response.text();

    expect(html).toContain('id="new-workspace-name"');
    expect(html).toContain('aria-label="New workspace name" hidden disabled');
    expect(html).toContain('workspaceName.hidden=!creating');
    expect(html).toContain('workspaceName.disabled=!creating');
    expect(html).toContain('workspaceName.required=creating');
  });

  test('lists incomplete workspaces so an agent can finish their setup', async () => {
    const response = renderConsent(
      new Request('https://api.refd.ai/oauth/authorize'),
      {
        clientId: 'test-client',
        clientName: 'Test client',
        redirectUris: ['https://client.example/oauth/callback'],
        tokenEndpointAuthMethod: 'none',
      },
      [
        { id: 1, name: 'Ready workspace', onboarded: true, logoUrl: null },
        { id: 2, name: 'Draft workspace', onboarded: false, logoUrl: null },
      ],
      'https://client.example/oauth/callback',
      [MCP_SCOPE, MCP_WRITE_SCOPE],
    );
    const html = await response.text();

    expect(html).toContain('Ready workspace');
    expect(html).toContain('Draft workspace');
    expect(html).toContain('Setup in progress');
    expect(html).toContain('value="2"');
  });

  test('renders a brand favicon when a domain exists and a letter avatar otherwise', async () => {
    const response = renderConsent(
      new Request('https://api.refd.ai/oauth/authorize'),
      {
        clientId: 'test-client',
        clientName: 'Test client',
        redirectUris: ['https://client.example/oauth/callback'],
        tokenEndpointAuthMethod: 'none',
      },
      [
        {
          id: 1,
          name: 'Branded',
          onboarded: true,
          logoUrl:
            'https://www.google.com/s2/favicons?domain=branded.example&sz=64',
        },
        { id: 2, name: 'Bare', onboarded: false, logoUrl: null },
      ],
      'https://client.example/oauth/callback',
      [MCP_SCOPE, MCP_WRITE_SCOPE],
    );
    const html = await response.text();

    expect(html).toContain(
      'class="ws-logo" src="https://www.google.com/s2/favicons?domain=branded.example&amp;sz=64"',
    );
    expect(html).toContain('viewBox="0 0 20 20"');
    expect(html).toContain('>B</text>');
  });

  test('requires a refd session before showing an authorization request', async () => {
    const request = new Request(
      'https://refd.ai/oauth/authorize?client_id=test&state=opaque',
    );
    const response = await handleOAuthDefault(
      request,
      { JWT_SECRET: 'test-secret' } as AppEnv,
      {} as ExecutionContext,
      {} as OAuthHelpers,
      'https://refd.ai/mcp',
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('Location') ?? '');
    expect(location.pathname).toBe('/auth/sign-in');
    expect(location.searchParams.get('next')).toBe(
      '/oauth/authorize?client_id=test&state=opaque',
    );
  });

  test('returns provider errors to a validated secure callback', () => {
    const response = oauthAuthorizationErrorResponse({
      name: 'AuthorizationError',
      code: 'invalid_scope',
      description: 'The requested scope is not supported.',
      redirectUri: 'https://client.example/oauth/callback',
      state: 'opaque',
      issuer: 'https://api.refd.ai',
    });
    expect(response?.status).toBe(302);
    const location = new URL(response?.headers.get('Location') ?? '');
    expect(location.origin).toBe('https://client.example');
    expect(location.searchParams.get('error')).toBe('invalid_scope');
    expect(location.searchParams.get('state')).toBe('opaque');
    expect(location.searchParams.get('iss')).toBe('https://api.refd.ai');
  });

  test('never redirects a provider error to an insecure callback', async () => {
    const response = oauthAuthorizationErrorResponse({
      name: 'AuthorizationError',
      code: 'invalid_request',
      description: 'Invalid redirect URI.',
      redirectUri: 'http://attacker.example/oauth/callback',
    });
    expect(response?.status).toBe(400);
    expect(response?.headers.get('Location')).toBeNull();
    expect(await response?.text()).toContain('Invalid redirect URI.');
  });
});
