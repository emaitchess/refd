import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  type AuthedBindings,
  requireAuth,
  requireJsonForMutations,
  requireWorkspace,
  type WorkspaceBindings,
} from './auth/middleware';
import { authRoutes } from './auth/routes';
import type { AppBindings } from './env';
import { applyApiResponseHeaders } from './lib/response-headers';
import { changesRoutes } from './routes/changes';
import { chatRoutes } from './routes/chat';
import { competitorRoutes } from './routes/competitors';
import { configRoutes } from './routes/config';
import { entityRoutes } from './routes/entities';
import { faviconRoutes } from './routes/favicon';
import { imageRoutes } from './routes/image';
import { onboardingRoutes } from './routes/onboarding';
import { overviewRoutes } from './routes/overview';
import { promptRoutes } from './routes/prompts';
import { runRoutes } from './routes/runs';
import { settingsRoutes } from './routes/settings';
import { sourceRoutes } from './routes/sources';
import { webhookRoutes } from './routes/webhooks';
import { workspaceRoutes } from './routes/workspaces';

export const app = new Hono<AppBindings>();

app.use('/api/*', async (c, next) => {
  await next();
  applyApiResponseHeaders(c.res.headers);
});
// BrightData's callback is public but shared-secret verified. Mount it before
// the JSON mutation guard so the secret is always the cheapest check.
app.route('/api/webhooks', webhookRoutes);
app.use('/api/*', requireJsonForMutations);

app.get('/api/health', (c) => c.json({ ok: true }));
app.route('/api/auth', authRoutes);

// Everything else requires a session; data routes additionally require an
// owned workspace (/api/w/:workspaceId/...).
const authed = new Hono<AuthedBindings>();
authed.use(requireAuth);
authed.route('/config', configRoutes);
authed.route('/workspaces', workspaceRoutes);
// Favicon proxy: session-gated, workspace-agnostic (used across onboarding and
// the dashboard), so it hangs off /api/favicon rather than a workspace scope.
authed.route('/favicon', faviconRoutes);
// Image proxy (brand OG/preview images): same reason as favicon — the strict
// img-src CSP forbids third-party image hosts, so route them same-origin.
authed.route('/image', imageRoutes);

const scoped = new Hono<WorkspaceBindings>();
scoped.use(requireWorkspace);
scoped.route('/overview', overviewRoutes);
scoped.route('/changes', changesRoutes);
scoped.route('/prompts', promptRoutes);
scoped.route('/sources', sourceRoutes);
scoped.route('/competitors', competitorRoutes);
scoped.route('/runs', runRoutes);
scoped.route('/entities', entityRoutes);
scoped.route('/onboarding', onboardingRoutes);
scoped.route('/settings', settingsRoutes);
scoped.route('/chat', chatRoutes);
authed.route('/w/:workspaceId', scoped);
app.route('/api', authed);

app.notFound((c) => c.json({ error: 'not found' }, 404));
app.onError((error, c) => {
  // Deliberate aborts (e.g. parseBody's 400) carry their own response.
  if (error instanceof HTTPException) {
    return error.getResponse();
  }
  console.error('unhandled api error', error);
  return c.json({ error: 'internal error' }, 500);
});
