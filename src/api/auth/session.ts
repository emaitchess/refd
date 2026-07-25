import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { jwtVerify, SignJWT } from 'jose';
import type { AppEnv } from '../env';

const COOKIE_NAME = 'refd_session';
const ALG = 'HS256';
export const SESSION_SECONDS = 24 * 60 * 60; // 24h per plan
const RENEW_BELOW_SECONDS = SESSION_SECONDS / 2; // sliding renewal past half-life

export interface SessionClaims {
  sub: number;
  email: string;
  tv: number; // tokenVersion — bumping it revokes all outstanding sessions
  iat: number;
  exp: number;
}

const secretKey = (env: AppEnv): Uint8Array =>
  new TextEncoder().encode(env.JWT_SECRET);

export const issueSession = async <E extends { Bindings: AppEnv }>(
  c: Context<E>,
  user: { id: number; email: string; tokenVersion: number },
): Promise<void> => {
  const now = Math.floor(Date.now() / 1000);
  // sub is a string per RFC 7519; readSession parses it back to the user id.
  const token = await new SignJWT({ email: user.email, tv: user.tokenVersion })
    .setProtectedHeader({ alg: ALG })
    .setSubject(String(user.id))
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_SECONDS)
    .sign(secretKey(c.env));
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
    // algorithms pins HS256 so a forged token can't downgrade to "none".
    // jwtVerify also enforces exp, throwing (and returning null) when expired.
    const { payload } = await jwtVerify(token, secretKey(c.env), {
      algorithms: [ALG],
    });
    const sub = Number(payload.sub);
    if (
      !Number.isInteger(sub) ||
      typeof payload.tv !== 'number' ||
      typeof payload.email !== 'string' ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number'
    ) {
      return null;
    }
    return {
      sub,
      email: payload.email,
      tv: payload.tv,
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
};

export const shouldRenew = (claims: SessionClaims): boolean => {
  return claims.exp - Math.floor(Date.now() / 1000) < RENEW_BELOW_SECONDS;
};
