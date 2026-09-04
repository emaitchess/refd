import {
  getOAuthApi,
  OAuthError,
  OAuthProvider,
  type OAuthProviderOptions,
  type TokenExchangeCallbackOptions,
} from '@cloudflare/workers-oauth-provider';
import { createMcpHandler } from 'agents/mcp/server';
import { getDb } from '../db/client';
import { mcpConnections } from '../db/schema';
import type { AppEnv } from '../env';
import { createRefdMcpServer } from '../mcp/server';
import { connectionPropsSchema } from './connection-props';
import { handleOAuthDefault } from './consent';
import {
  MCP_SCOPE,
  OAUTH_PROTOCOL_OPTIONS,
  oauthResourceUrl,
} from './constants';
import { limitMcpRequest, limitOAuthRequest } from './rate-limit';
import { hasSecureRegistrationRedirects } from './security';

const persistConnection = async (
  env: AppEnv,
  exchange: TokenExchangeCallbackOptions,
): Promise<void> => {
  const props = connectionPropsSchema.safeParse(exchange.props);
  if (
    !props.success ||
    String(props.data.userId) !== exchange.userId ||
    exchange.scope.length !== 1 ||
    exchange.scope[0] !== MCP_SCOPE
  ) {
    throw new OAuthError('server_error', {
      description: 'The authorization grant is invalid.',
    });
  }
  if (exchange.grantType !== 'authorization_code') {
    return;
  }
  try {
    await getDb(env)
      .insert(mcpConnections)
      .values({
        grantId: exchange.grantId,
        connectionKey: props.data.connectionId,
        workspaceId: props.data.workspaceId,
        userId: props.data.userId,
        clientId: exchange.clientId,
        clientName: props.data.clientName,
        callbackTarget: props.data.callbackTarget ?? null,
        scopes: exchange.scope,
      })
      .onConflictDoNothing({ target: mcpConnections.grantId });
    console.log(
      JSON.stringify({
        event: 'mcp_connection_created',
        clientId: exchange.clientId,
        userId: props.data.userId,
        workspaceId: props.data.workspaceId,
      }),
    );
  } catch {
    throw new OAuthError('temporarily_unavailable', {
      description: 'The connection could not be recorded. Try again.',
      statusCode: 503,
      headers: { 'Retry-After': '5' },
    });
  }
};

export const createOAuthOptions = (
  request: Request,
  env: AppEnv,
): OAuthProviderOptions<AppEnv> => {
  const resource = oauthResourceUrl(request.url, env.PUBLIC_BASE_URL);
  const authorizationServer = new URL(resource).origin;
  const resourceHostname = new URL(resource).hostname;
  const requestHostname = new URL(request.url).hostname;
  let options: OAuthProviderOptions<AppEnv>;
  options = {
    apiRoute: '/mcp',
    apiHandler: {
      fetch: async (apiRequest, apiEnv, ctx) => {
        const mcpHandler = createMcpHandler(
          () => createRefdMcpServer(apiEnv, ctx),
          {
            route: '/mcp',
            allowedHostnames: [...new Set([resourceHostname, requestHostname])],
            allowedOriginHostnames: [
              resourceHostname,
              '127.0.0.1',
              'localhost',
              'refdlocal.io',
              'api.refdlocal.io',
              'claude.ai',
              'chatgpt.com',
              'platform.openai.com',
            ],
            onerror: (error) => {
              console.error(
                JSON.stringify({
                  event: 'mcp_handler_error',
                  error: error.message,
                }),
              );
            },
          },
        );
        return mcpHandler(apiRequest, apiEnv, ctx);
      },
    },
    defaultHandler: {
      fetch: (defaultRequest, defaultEnv, ctx) =>
        handleOAuthDefault(
          defaultRequest,
          defaultEnv,
          ctx,
          getOAuthApi(options, defaultEnv),
          resource,
        ),
    },
    authorizeEndpoint: '/oauth/authorize',
    tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register',
    clientRegistrationCallback: ({ clientMetadata }) =>
      hasSecureRegistrationRedirects(clientMetadata)
        ? undefined
        : {
            description:
              'Redirect URIs must use HTTPS, a loopback HTTP address, or an app-specific URI scheme.',
          },
    ...OAUTH_PROTOCOL_OPTIONS,
    onError: (error) => {
      const current = new URL(request.url);
      const entry = JSON.stringify({
        event: 'oauth_protocol_error',
        code: error.code,
        status: error.status,
        path: current.pathname,
        requestOrigin: current.origin,
        internal: error.internal?.category,
      });
      if (error.status >= 500) {
        console.error(entry);
      } else {
        console.log(entry);
      }
    },
    resourceMetadata: {
      resource,
      authorization_servers: [authorizationServer],
      scopes_supported: [MCP_SCOPE],
      bearer_methods_supported: ['header'],
      resource_name: 'refd AI visibility data',
    },
    tokenExchangeCallback: (exchange) => persistConnection(env, exchange),
  };
  return options;
};

export const oauthFetch = async (
  request: Request,
  env: AppEnv,
  ctx: ExecutionContext,
): Promise<Response> => {
  const path = new URL(request.url).pathname;
  const limited =
    path === '/mcp'
      ? await limitMcpRequest(request, env)
      : await limitOAuthRequest(request, env);
  return (
    limited ??
    new OAuthProvider(createOAuthOptions(request, env)).fetch(request, env, ctx)
  );
};
