import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { defaultMonitoringTier } from '../../shared/workspaces';
import { getDb } from '../db/client';
import { results, runs, users, workspaces } from '../db/schema';
import type { AppBindings } from '../env';
import { businessEmailError } from '../lib/email-policy';
import { parseBody } from '../lib/http';
import { emailField, singleLineText } from '../lib/sanitize';
import { configForUser } from '../lib/user-config';
import { revokeOwnedConnections } from '../oauth/revoke';
import { type AuthedBindings, requireAuth } from './middleware';
import { hashPassword, verifyPassword } from './password';
import {
  clearLoginFailures,
  isLoginBlocked,
  recordLoginFailure,
} from './rate-limit';
import { clearSession, issueSession } from './session';

const loginSchema = z.object({
  email: emailField(),
  password: z.string().min(1).max(200),
});

// Whether any owned workspace finished the onboarding wizard. Public pages
// label signed-in entry points "dashboard" vs "continue onboarding" with it.
const hasOnboardedWorkspace = async (
  db: ReturnType<typeof getDb>,
  userId: number,
) =>
  (
    await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(
        and(
          eq(workspaces.ownerUserId, userId),
          eq(workspaces.onboardingCompleted, true),
        ),
      )
      .limit(1)
  ).length > 0;

export const authRoutes = new Hono<AppBindings>();

authRoutes.post('/login', async (c) => {
  const body = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return c.json({ error: 'invalid credentials' }, 400);
  }
  const db = getDb(c.env);
  const email = body.data.email;
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const limitKeys = [`email:${email}`, `ip:${ip}`];

  if (await isLoginBlocked(db, limitKeys)) {
    return c.json({ error: 'too many attempts, try again later' }, 429);
  }

  const user = (await db.select().from(users).where(eq(users.email, email)))[0];
  // Same generic error whether the email or the password is wrong.
  if (
    !user ||
    !(await verifyPassword(body.data.password, user.salt, user.passwordHash))
  ) {
    await recordLoginFailure(db, limitKeys);
    return c.json({ error: 'invalid credentials' }, 401);
  }

  await clearLoginFailures(db, limitKeys);
  await issueSession(c, user);
  return c.json({
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    onboarded: await hasOnboardedWorkspace(db, user.id),
  });
});

const registerSchema = z.object({
  email: emailField(),
  password: z
    .string()
    .min(8, 'password must be at least 8 characters')
    .max(200),
});

authRoutes.post('/register', async (c) => {
  const data = await parseBody(c, registerSchema);
  // Business-email gate: free-provider + disposable/temporary domains are rejected.
  const reason = businessEmailError(data.email);
  if (reason) {
    return c.json({ error: reason }, 400);
  }
  const db = getDb(c.env);
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const limitKeys = [`register-ip:${ip}`];
  if (await isLoginBlocked(db, limitKeys)) {
    return c.json({ error: 'too many attempts, try again later' }, 429);
  }
  // Every attempt counts toward the window — throttles mass registration.
  await recordLoginFailure(db, limitKeys);

  const email = data.email;
  const { hash, salt } = await hashPassword(data.password);
  const inserted = await db
    .insert(users)
    .values({ email, passwordHash: hash, salt })
    .onConflictDoNothing({ target: users.email })
    .returning();
  const user = inserted[0];
  if (!user) {
    return c.json({ error: 'an account with this email already exists' }, 409);
  }
  // First workspace, named after the address's local part; rename in the UI.
  await db.insert(workspaces).values({
    name: email.split('@')[0] ?? 'my brand',
    ownerUserId: user.id,
    monitoringTier: defaultMonitoringTier(
      configForUser(email, c.env.ADMIN_EMAILS).isAdmin,
    ),
  });
  await issueSession(c, user);
  return c.json(
    {
      email: user.email,
      firstName: null,
      lastName: null,
      onboarded: false,
    },
    201,
  );
});

authRoutes.post('/logout', (c) => {
  clearSession(c);
  return c.json({ ok: true });
});

const me = new Hono<AuthedBindings>();
me.use(requireAuth);
me.get('/', async (c) => {
  const user = c.get('user');
  return c.json({
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    onboarded: await hasOnboardedWorkspace(getDb(c.env), user.id),
  });
});
authRoutes.route('/me', me);

const profileName = singleLineText(0, 80).transform((value) => value || null);

const accountProfileSchema = z.object({
  firstName: profileName,
  lastName: profileName,
});

const deleteAccountSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  confirmation: z
    .string()
    .max(100)
    .trim()
    .toLowerCase()
    .pipe(z.literal('delete my account')),
});

const account = new Hono<AuthedBindings>();
account.use(requireAuth);
account.patch('/', async (c) => {
  const data = await parseBody(c, accountProfileSchema);
  const db = getDb(c.env);
  const updated = await db
    .update(users)
    .set(data)
    .where(eq(users.id, c.get('user').id))
    .returning({ firstName: users.firstName, lastName: users.lastName });
  if (!updated[0]) {
    return c.json({ error: 'account not found' }, 404);
  }
  return c.json(updated[0]);
});

account.delete('/', async (c) => {
  const data = await parseBody(c, deleteAccountSchema);
  const db = getDb(c.env);
  const user = (
    await db
      .select()
      .from(users)
      .where(eq(users.id, c.get('user').id))
  )[0];
  if (!user) {
    return c.json({ error: 'account not found' }, 404);
  }
  if (
    !(await verifyPassword(data.currentPassword, user.salt, user.passwordHash))
  ) {
    return c.json({ error: 'current password is incorrect' }, 403);
  }
  await revokeOwnedConnections(c.env, user.id);

  const rawKeys = await db
    .select({ key: results.r2Key })
    .from(results)
    .innerJoin(runs, eq(results.runId, runs.id))
    .innerJoin(workspaces, eq(runs.workspaceId, workspaces.id))
    .where(eq(workspaces.ownerUserId, user.id));

  const statements = [
    `delete from citations where result_id in (
      select results.id from results
      join runs on results.run_id = runs.id
      join workspaces on runs.workspace_id = workspaces.id
      where workspaces.owner_user_id = ?
    )`,
    `delete from entity_scores where result_id in (
      select results.id from results
      join runs on results.run_id = runs.id
      join workspaces on runs.workspace_id = workspaces.id
      where workspaces.owner_user_id = ?
    )`,
    `delete from results where run_id in (
      select runs.id from runs
      join workspaces on runs.workspace_id = workspaces.id
      where workspaces.owner_user_id = ?
    )`,
    `delete from snapshots where run_id in (
      select runs.id from runs
      join workspaces on runs.workspace_id = workspaces.id
      where workspaces.owner_user_id = ?
    )`,
    `delete from runs where workspace_id in (
      select id from workspaces where owner_user_id = ?
    )`,
    `delete from prompts where workspace_id in (
      select id from workspaces where owner_user_id = ?
    )`,
    `delete from citations where entity_id in (
      select entities.id from entities
      join workspaces on entities.workspace_id = workspaces.id
      where workspaces.owner_user_id = ?
    )`,
    `delete from entity_scores where entity_id in (
      select entities.id from entities
      join workspaces on entities.workspace_id = workspaces.id
      where workspaces.owner_user_id = ?
    )`,
    `delete from entities where workspace_id in (
      select id from workspaces where owner_user_id = ?
    )`,
    `delete from mcp_connections where workspace_id in (
      select id from workspaces where owner_user_id = ?
    )`,
    'delete from workspaces where owner_user_id = ?',
    'delete from login_attempts where key = ?',
    'delete from users where id = ?',
  ].map((statement, index) =>
    c.env.DB.prepare(statement).bind(
      index === 11 ? `email:${user.email}` : user.id,
    ),
  );

  const keys = rawKeys.flatMap((row) => (row.key ? [row.key] : []));
  for (let start = 0; start < keys.length; start += 1000) {
    await c.env.RAW.delete(keys.slice(start, start + 1000));
  }
  await c.env.DB.batch(statements);
  clearSession(c);
  return c.json({ ok: true });
});
authRoutes.route('/account', account);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z
    .string()
    .min(8, 'new password must be at least 8 characters')
    .max(200),
});

const changePassword = new Hono<AuthedBindings>();
changePassword.use(requireAuth);
changePassword.post('/', async (c) => {
  const data = await parseBody(c, changePasswordSchema);
  const db = getDb(c.env);
  const user = (
    await db
      .select()
      .from(users)
      .where(eq(users.id, c.get('user').id))
  )[0];
  if (!user) {
    return c.json({ error: 'unauthenticated' }, 401);
  }
  if (
    !(await verifyPassword(data.currentPassword, user.salt, user.passwordHash))
  ) {
    return c.json({ error: 'current password is incorrect' }, 403);
  }
  const { hash, salt } = await hashPassword(data.newPassword);
  // Bump tokenVersion to revoke every outstanding session, then re-issue this
  // one so the current browser stays signed in.
  const tokenVersion = user.tokenVersion + 1;
  await db
    .update(users)
    .set({ passwordHash: hash, salt, tokenVersion })
    .where(eq(users.id, user.id));
  await issueSession(c, { id: user.id, email: user.email, tokenVersion });
  return c.json({ ok: true });
});
authRoutes.route('/change-password', changePassword);
