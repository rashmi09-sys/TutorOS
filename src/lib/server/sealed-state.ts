import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * Sealed lesson state.
 *
 * The server stays stateless (works on serverless, survives reloads), but the browser never sees the full
 * lesson state: it holds an opaque, encrypted and authenticated blob (AES-256-GCM) that only the server can
 * open, plus a redacted view for drawing the page (see view.ts). Editing the blob, swapping it between
 * lessons or between users, or replaying it under another key is rejected.
 *
 * Key: HKDF-SHA256 from SESSION_SECRET (≥32 chars), else from AUTH_SECRET. Without either there is a
 * development key, and in production that is refused (sealing throws, so the turn route answers 500).
 */
const DEV_SECRET = "tutoros-dev-only-secret-change-me";
const VERSION = "s1";
const MAX_SEALED = 400_000; // characters

export function sealingMode(env: Record<string, string | undefined> = process.env): "session-secret" | "auth-secret" | "dev-default" {
  if ((env.SESSION_SECRET?.trim().length ?? 0) >= 32) return "session-secret";
  if ((env.AUTH_SECRET?.trim().length ?? 0) >= 32) return "auth-secret";
  return "dev-default";
}

let cached: { src: string; key: Buffer } | null = null;
function key(env: Record<string, string | undefined> = process.env): Buffer {
  const mode = sealingMode(env);
  if (mode === "dev-default" && env.NODE_ENV === "production") throw new Error("state key not configured");
  const src = mode === "session-secret" ? env.SESSION_SECRET!.trim() : mode === "auth-secret" ? env.AUTH_SECRET!.trim() : DEV_SECRET;
  if (cached?.src === src) return cached.key;
  const k = Buffer.from(hkdfSync("sha256", src, "tutoros-state", "tutoros sealed lesson state v1", 32));
  cached = { src, key: k };
  return k;
}

/** What the blob is bound to: the lesson and the signed-in user. */
function aad(lesson: string, user: string) {
  return createHash("sha256").update(`${lesson}\u0000${user}`).digest();
}

export function sealState(state: unknown, lesson: string, user: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  c.setAAD(aad(lesson, user));
  const body = Buffer.concat([c.update(deflateRawSync(Buffer.from(JSON.stringify(state)))), c.final()]);
  return `${VERSION}.${Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url")}`;
}

/** The state if the blob is authentic for this lesson and user; otherwise null. Never throws. */
export function openState<T = unknown>(sealed: string | null | undefined, lesson: string, user: string): T | null {
  if (!sealed || sealed.length > MAX_SEALED || !sealed.startsWith(`${VERSION}.`)) return null;
  try {
    const raw = Buffer.from(sealed.slice(VERSION.length + 1), "base64url");
    if (raw.length < 12 + 16 + 1) return null;
    const d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    d.setAAD(aad(lesson, user));
    d.setAuthTag(raw.subarray(12, 28));
    const plain = Buffer.concat([d.update(raw.subarray(28)), d.final()]);
    return JSON.parse(inflateRawSync(plain, { maxOutputLength: 4_000_000 }).toString("utf8")) as T;
  } catch {
    return null;
  }
}
