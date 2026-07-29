import { handleHomepage } from './homepage';

// The website Worker fronts the static Astro build (ASSETS). Its only dynamic
// job is homepage content negotiation: `GET / ` with `Accept: text/markdown`
// serves /index.md so AI agents get a clean Markdown representation. Everything
// else is served straight from static assets.
export default {
  fetch: async (
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> =>
    (await handleHomepage(request, (assetRequest) =>
      env.ASSETS.fetch(assetRequest),
    )) ?? env.ASSETS.fetch(request),
} satisfies ExportedHandler<Env>;
