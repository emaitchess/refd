export const MCP_SCOPE = 'data:read';

export const OAUTH_PROTOCOL_OPTIONS = {
  scopesSupported: [MCP_SCOPE],
  allowImplicitFlow: false,
  allowPlainPKCE: false,
  allowTokenExchangeGrant: false,
  clientIdMetadataDocumentEnabled: true,
  accessTokenTTL: 60 * 60,
  refreshTokenTTL: 30 * 24 * 60 * 60,
};

export const oauthResourceUrl = (
  requestUrl: string,
  publicBaseUrl?: string,
): string => {
  const request = new URL(requestUrl);
  const local =
    request.hostname === 'localhost' ||
    request.hostname === '127.0.0.1' ||
    request.hostname.endsWith('refdlocal.io');
  if (local || !publicBaseUrl) {
    return new URL('/mcp', request.origin).toString();
  }
  try {
    return new URL('/mcp', publicBaseUrl).toString();
  } catch {
    return new URL('/mcp', request.origin).toString();
  }
};
