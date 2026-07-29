import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { emailField } from '../lib/sanitize';
import type { WorkspaceBindings } from './middleware';

const MAX_ADMIN_EMAILS = 100;
const adminEmailsValue = z.string().max(10_000);
const operatorEmail = emailField();

export const isOperatorEmail = (
  email: string,
  rawAdminEmails: unknown,
): boolean => {
  const candidate = operatorEmail.safeParse(email);
  const configured = adminEmailsValue.safeParse(rawAdminEmails);
  if (!candidate.success || !configured.success) {
    return false;
  }
  const entries = configured.data.split(',');
  if (entries.length > MAX_ADMIN_EMAILS) {
    return false;
  }
  return entries.some((entry) => {
    const parsed = operatorEmail.safeParse(entry);
    return parsed.success && parsed.data === candidate.data;
  });
};

export const requireOperator = createMiddleware<WorkspaceBindings>(
  async (c, next) => {
    if (!isOperatorEmail(c.get('user').email, c.env.ADMIN_EMAILS)) {
      return c.json({ error: 'operator access required' }, 403);
    }
    await next();
  },
);
