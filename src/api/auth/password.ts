// PBKDF2-SHA256 via WebCrypto — native in workerd and Bun; wasm KDFs (bcrypt/
// argon2) would burn worker CPU instead. OWASP-recommended iteration count.
const ITERATIONS = 600_000;
const KEY_BITS = 256;

export const toBase64 = (bytes: Uint8Array): string => {
  let bin = '';
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin);
};

export const fromBase64 = (b64: string): Uint8Array => {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

const derive = async (
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      iterations: ITERATIONS,
    },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
};

export const hashPassword = async (
  password: string,
): Promise<{ hash: string; salt: string }> => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt);
  return { hash: toBase64(hash), salt: toBase64(salt) };
};

export const verifyPassword = async (
  password: string,
  salt: string,
  expectedHash: string,
): Promise<boolean> => {
  const actual = await derive(password, fromBase64(salt));
  const expected = fromBase64(expectedHash);
  if (actual.length !== expected.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) {
    diff |= (actual[i] ?? 0) ^ (expected[i] ?? 0);
  }
  return diff === 0;
};
