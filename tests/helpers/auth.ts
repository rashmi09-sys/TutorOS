/**
 * Test-only sign-in: random secrets for this process (never the real ones), and a helper that makes a valid
 * session cookie the way /api/auth/login does.
 */
import { randomBytes } from "node:crypto";
import { AUTH_COOKIE, signToken, newSessionId } from "@/lib/auth/token";

export const TEST_USER = "test-teacher";
process.env.AUTH_SECRET ||= randomBytes(32).toString("base64url");
process.env.AUTH_USERNAME ||= TEST_USER;

export async function sessionCookie(opts: { user?: string; ttlS?: number; iatOffsetS?: number; secret?: string } = {}) {
  const now = Math.floor(Date.now() / 1000) + (opts.iatOffsetS ?? 0);
  const token = await signToken({ v: 1, u: opts.user ?? TEST_USER, sid: newSessionId(), iat: now, exp: now + (opts.ttlS ?? 3600) }, opts.secret ?? process.env.AUTH_SECRET!);
  return `${AUTH_COOKIE}=${token}`;
}

/** A JSON POST with a valid session cookie (and the other headers given). */
export async function authedPost(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", cookie: await sessionCookie(), ...headers }, body: JSON.stringify(body) });
}

export async function authedGet(url: string) {
  return new Request(url, { headers: { cookie: await sessionCookie() } });
}
