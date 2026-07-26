import { Hono } from 'hono';
import type { AuthedBindings } from '../auth/middleware';
import { configForUser } from '../lib/user-config';

export const configRoutes = new Hono<AuthedBindings>();

configRoutes.get('/', (c) =>
  c.json(configForUser(c.get('user').email, c.env.ADMIN_EMAILS)),
);
