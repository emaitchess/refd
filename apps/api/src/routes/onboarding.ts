import { type Context, Hono } from 'hono';
import type { WorkspaceBindings } from '../auth/middleware';
import { getDb } from '../db/client';
import { parseBody } from '../lib/http';
import {
  brandRequestSchema,
  commitRequestSchema,
  confirmRequestSchema,
  generationRequestSchema,
  type OnboardingFailure,
  patchRequestSchema,
} from '../onboarding/contracts';
import {
  commitOnboarding,
  completeOnboarding,
  confirmSetup,
  draftDescription,
  fetchSiteMetadataState,
  loadOnboardingState,
  type OnboardingContext,
  previewSetup,
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
  userId: c.get('user').id,
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
  const data = await parseBody(c, brandRequestSchema);
  return respond(c, await saveBrand(context(c), data));
});

onboardingRoutes.post('/extract', async (c) => {
  const data = await parseBody(c, generationRequestSchema);
  return respond(c, await draftDescription(context(c), data));
});

onboardingRoutes.post('/competitors', async (c) => {
  const data = await parseBody(c, generationRequestSchema);
  return respond(c, await suggestCompetitors(context(c), data));
});

onboardingRoutes.post('/prompts', async (c) => {
  const data = await parseBody(c, generationRequestSchema);
  return respond(c, await suggestPrompts(context(c), data));
});

onboardingRoutes.patch('/', async (c) => {
  const data = await parseBody(c, patchRequestSchema);
  return respond(c, await updateDraft(context(c), data));
});

onboardingRoutes.post('/preview', async (c) => {
  return respond(c, await previewSetup(context(c)));
});

onboardingRoutes.post('/commit', async (c) => {
  const data = await parseBody(c, commitRequestSchema);
  return respond(c, await commitOnboarding(context(c), data));
});

onboardingRoutes.post('/confirm', async (c) => {
  const data = await parseBody(c, confirmRequestSchema);
  return respond(c, await confirmSetup(context(c), data));
});

onboardingRoutes.post('/complete', async (c) => {
  return respond(c, await completeOnboarding(context(c)));
});
