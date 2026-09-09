import { type Context, Hono } from 'hono';
import type { WorkspaceBindings } from '../auth/middleware';
import { getDb } from '../db/client';
import { parseBody } from '../lib/http';
import {
  brandSchema,
  type OnboardingFailure,
  patchSchema,
  regenBody,
} from '../onboarding/contracts';
import {
  commitOnboarding,
  completeOnboarding,
  draftDescription,
  fetchSiteMetadataState,
  loadOnboardingState,
  type OnboardingContext,
  saveBrand,
  suggestCompetitors,
  suggestPrompts,
  updateDraft,
} from '../onboarding/service';

export const onboardingRoutes = new Hono<WorkspaceBindings>();

const context = (c: Context<WorkspaceBindings>): OnboardingContext => ({
  db: getDb(c.env),
  env: c.env,
  workspaceId: c.get('workspace').id,
  workspaceName: c.get('workspace').name,
  userEmail: c.get('user').email,
  adminEmails: c.env.ADMIN_EMAILS,
});

// Soft-failure bodies are 200s by design; only hard failures map to a status.
const respond = <T extends object>(
  c: Context<WorkspaceBindings>,
  result: T | OnboardingFailure,
) => {
  if ('error' in result) {
    return c.json({ error: result.error }, result.status);
  }
  return c.json(result);
};

onboardingRoutes.get('/', async (c) => {
  return c.json(await loadOnboardingState(context(c)));
});

onboardingRoutes.get('/site-metadata', async (c) => {
  return c.json(await fetchSiteMetadataState(context(c)));
});

onboardingRoutes.post('/brand', async (c) => {
  const data = await parseBody(c, brandSchema);
  return c.json(await saveBrand(context(c), data));
});

onboardingRoutes.post('/extract', async (c) => {
  const { regenerate } = await parseBody(c, regenBody);
  return respond(c, await draftDescription(context(c), { regenerate }));
});

onboardingRoutes.post('/competitors', async (c) => {
  const { regenerate } = await parseBody(c, regenBody);
  return respond(c, await suggestCompetitors(context(c), { regenerate }));
});

onboardingRoutes.post('/prompts', async (c) => {
  const { regenerate } = await parseBody(c, regenBody);
  return respond(c, await suggestPrompts(context(c), { regenerate }));
});

onboardingRoutes.patch('/', async (c) => {
  const data = await parseBody(c, patchSchema);
  return respond(c, await updateDraft(context(c), data));
});

onboardingRoutes.post('/commit', async (c) => {
  return respond(c, await commitOnboarding(context(c)));
});

onboardingRoutes.post('/complete', async (c) => {
  return respond(c, await completeOnboarding(context(c)));
});
