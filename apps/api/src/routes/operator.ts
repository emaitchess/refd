import { Hono } from 'hono';
import type { AuthedBindings } from '../auth/middleware';
import { requireOperator } from '../auth/operator';
import { resetAndResumeRunDispatch } from '../ingest/dispatch';
import { parseId } from '../lib/http';

interface OperatorRouteDependencies {
  resetAndResumeRunDispatch: typeof resetAndResumeRunDispatch;
}

export const createOperatorRoutes = (
  dependencies: OperatorRouteDependencies = { resetAndResumeRunDispatch },
) => {
  const routes = new Hono<AuthedBindings>();

  routes.use(requireOperator);

  routes.post('/runs/:id/resume-dispatch', async (c) => {
    const runId = parseId(c.req.param('id'));
    if (runId === null) {
      return c.json({ error: 'invalid id' }, 400);
    }
    const result = await dependencies.resetAndResumeRunDispatch(c.env, runId);
    if (!result) {
      return c.json({ error: 'not found' }, 404);
    }
    if (result.state === 'legacy' || result.expectedMessages === null) {
      return c.json({ error: 'run has no recoverable dispatch plan' }, 409);
    }
    return c.json(result);
  });

  return routes;
};

export const operatorRoutes = createOperatorRoutes();
