import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";

/**
 * Password hashing with scrypt (Node's built-in; memory-hard). Stored format, in AUTH_PASSWORD_HASH only
 * (a server-side environment variable — never in code, the client bundle, Git or logs):
 *
 *   scrypt:<N>:<r>:<p>:<salt base64url>:<key base64url>
 *
 * (Colons, not dollar signs: `.env` loaders expand `$…` as variables and would corrupt the hash.)
 */
const KEYLEN = 64;
const DEFAULTS = { N: 1 << 15, r: 8, p: 1 };

function scryptAsync(pw: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(pw.normalize("NFKC"), salt, KEYLEN, { N, r, p, maxmem: 128 * N * r * 2 }, (e, k) => (e ? reject(e) : resolve(k))));
}

export async function hashPassword(password: string, opts: Partial<typeof DEFAULTS> = {}): Promise<string> {
  const { N, r, p } = { ...DEFAULTS, ...opts };
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, N, r, p);
  return `scrypt:${N}:${r}:${p}:${salt.toString("base64url")}:${key.toString("base64url")}`;
}

/** Constant-time check. False for any malformed hash (fail closed). */
export async function verifyPassword(password: string, stored: string | undefined | null): Promise<boolean> {
  if (!stored || password.length > 256) return false;
  const parts = stored.trim().split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every((x) => Number.isInteger(x) && x > 0) || N > 1 << 20 || r > 32 || p > 16) return false;
  try {
    const salt = Buffer.from(parts[4], "base64url");
    const want = Buffer.from(parts[5], "base64url");
    if (salt.length < 16 || want.length !== KEYLEN) return false;
    const got = await scryptAsync(password, salt, N, r, p);
    return timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

/** Constant-time string equality (for the username) — compares fixed-length digests. */
export function sameString(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
