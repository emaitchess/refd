import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { loginAttempts } from '../db/schema';

const MAX_FAILURES = 5;
const WINDOW_SECONDS = 15 * 60;

const now = () => Math.floor(Date.now() / 1000);

export const isLoginBlocked = async (
  db: Db,
  keys: string[],
): Promise<boolean> => {
  for (const key of keys) {
    const row = (
      await db.select().from(loginAttempts).where(eq(loginAttempts.key, key))
    )[0];
    if (row && row.resetAt > now() && row.count >= MAX_FAILURES) {
      return true;
    }
  }
  return false;
};

export const recordLoginFailure = async (
  db: Db,
  keys: string[],
): Promise<void> => {
  for (const key of keys) {
    const row = (
      await db.select().from(loginAttempts).where(eq(loginAttempts.key, key))
    )[0];
    if (!row || row.resetAt <= now()) {
      await db
        .insert(loginAttempts)
        .values({ key, count: 1, resetAt: now() + WINDOW_SECONDS })
        .onConflictDoUpdate({
          target: loginAttempts.key,
          set: { count: 1, resetAt: now() + WINDOW_SECONDS },
        });
    } else {
      await db
        .update(loginAttempts)
        .set({ count: row.count + 1 })
        .where(eq(loginAttempts.key, key));
    }
  }
};

export const clearLoginFailures = async (
  db: Db,
  keys: string[],
): Promise<void> => {
  for (const key of keys) {
    await db.delete(loginAttempts).where(eq(loginAttempts.key, key));
  }
};
