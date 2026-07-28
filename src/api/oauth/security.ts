import { z } from 'zod';

const CSRF_COOKIE = '__Host-refd_oauth_csrf';
const CSRF_TTL_SECONDS = 10 * 60;
const callbackUrlSchema = z.string().max(2048).url();

const cookieValue = (request: Request, name: string): string | null => {
  const pair = (request.headers.get('Cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return pair ? pair.slice(name.length + 1) : null;
};

const constantTimeEqual = async (
  left: string,
  right: string,
): Promise<boolean> => {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let mismatch = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
};

export const createCsrfToken = (): string => crypto.randomUUID();

export const csrfCookie = (token: string): string =>
  `${CSRF_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${CSRF_TTL_SECONDS}`;

export const clearCsrfCookie = (): string =>
  `${CSRF_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

export const validCsrfToken = (
  request: Request,
  submitted: string,
): Promise<boolean> => {
  const stored = cookieValue(request, CSRF_COOKIE);
  return stored === null
    ? Promise.resolve(false)
    : constantTimeEqual(stored, submitted);
};

export const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export const formActionSources = (callbackUrl?: string): string => {
  const parsed = callbackUrlSchema.safeParse(callbackUrl);
  if (!parsed.success) {
    return "'self'";
  }
  const url = new URL(parsed.data);
  return url.protocol === 'http:' || url.protocol === 'https:'
    ? `'self' ${url.origin}`
    : "'self'";
};
