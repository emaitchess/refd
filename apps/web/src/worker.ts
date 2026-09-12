import { handleHomepage } from './homepage';

// The discovery manifest has no file extension, and Cloudflare serves
// extensionless assets as text/html (a `_headers` Content-Type override is not
// honored for them). Re-serve it as application/json so agents can parse it.
const AGENT_MANIFEST_PATH = '/.well-known/agent';

const serveAgentManifest = async (env: Env): Promise<Response> => {
  const asset = await env.ASSETS.fetch(
    new Request(`https://refd.ai${AGENT_MANIFEST_PATH}`),
  );
  const headers = new Headers(asset.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(asset.body, {
    status: asset.status,
    statusText: asset.statusText,
    headers,
  });
};

// The website Worker fronts the static Astro build (ASSETS). Its dynamic jobs:
// homepage Markdown negotiation, pinning the JSON content-type on the
// extensionless agent manifest, and catching agents that guess `refd.ai/mcp`
// as the connector endpoint (the real endpoint lives on api.refd.ai) by
// sending them to the setup guide. Everything else serves straight from assets.
export default {
  fetch: async (
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> => {
    if (new URL(request.url).pathname === AGENT_MANIFEST_PATH) {
      return serveAgentManifest(env);
    }
    if (new URL(request.url).pathname === '/mcp') {
      return Response.redirect(new URL('/agents', request.url), 308);
    }
    return (
      (await handleHomepage(request, (assetRequest) =>
        env.ASSETS.fetch(assetRequest),
      )) ?? env.ASSETS.fetch(request)
    );
  },
} satisfies ExportedHandler<Env>;
