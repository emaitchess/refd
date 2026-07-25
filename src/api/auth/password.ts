import { compare as bcryptCompare, hash as bcryptHash } from 'bcryptjs';

// bcrypt via bcryptjs (pure JS). workerd forbids runtime WASM compilation
// (so argon2/pbkdf2 wasm libs throw "Wasm code generation disallowed") and
// caps native WebCrypto PBKDF2 at 100k iterations, well under OWASP's target.
// bcrypt sidesteps both: it's pure JS, purpose-built for passwords, and its
// output embeds the cost + salt, so the work factor can be raised later without
// invalidating stored hashes. cost 12 measures ~200ms/hash on workerd.
const COST = 12;

export const hashPassword = async (
  password: string,
): Promise<{ hash: string; salt: string }> => {
  // bcrypt embeds its own salt in the hash; the salt column is retained for
  // schema compatibility and is not read back on verify.
  return { hash: await bcryptHash(password, COST), salt: '' };
};

// salt is ignored: bcrypt reads the salt and cost it needs from expectedHash.
export const verifyPassword = async (
  password: string,
  _salt: string,
  expectedHash: string,
): Promise<boolean> => {
  try {
    return await bcryptCompare(password, expectedHash);
  } catch {
    return false;
  }
};
