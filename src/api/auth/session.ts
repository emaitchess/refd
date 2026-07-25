import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';
import type { AppEnv } from '../env';

const COOKIE_NAME = 'refd_session';
export const SESSION_SECONDS = 24 * 60 * 60; // 24h per plan
const RENEW_BELOW_SECONDS = SESSION_SECONDS / 2; // sliding renewal past half-life

export interface SessionClaims {
  sub: number;
  email: string;
  tv: number; // tokenVersion — bumping it revokes all outstanding sessions
  iat: number;
  exp: number;
  [key: string]: unknown;
}

export const issueSession = async <E extends { Bindings: AppEnv }>(
  c: Context<E>,
  user: { id: number; email: string; tokenVersion: number },
): Promise<void> => {
  const now = Math.floor(Date.now() / 1000);
  const token = await sign(
    {
      sub: user.id,
      email: user.email,
      tv: user.tokenVersion,
      iat: now,
      exp: now + SESSION_SECONDS,
    } satisfies SessionClaims,
    c.env.JWT_SECRET,
  );
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_SECONDS,
  });
};

export const clearSession = <E extends { Bindings: AppEnv }>(
  c: Context<E>,
): void => {
  deleteCookie(c, COOKIE_NAME, { path: '/' });
};

export const readSession = async <E extends { Bindings: AppEnv }>(
  c: Context<E>,
): Promise<SessionClaims | null> => {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) {
    return null;
  }
  try {
    const claims = (await verify(
      token,
      c.env.JWT_SECRET,
      'HS256',
    )) as unknown as SessionClaims;
    return typeof claims.sub === 'number' && typeof claims.tv === 'number'
      ? claims
      : null;
  } catch {
    return null;
  }
};

export const shouldRenew = (claims: SessionClaims): boolean => {
  return claims.exp - Math.floor(Date.now() / 1000) < RENEW_BELOW_SECONDS;
};
