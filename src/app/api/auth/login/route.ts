import { NextResponse } from "next/server";
import { z } from "zod";
import { sameString, verifyPassword } from "@/lib/auth/password";
import { AUTH_COOKIE, authSecret, cookieOptions, newSessionId, safeNext, signToken, ttlSeconds } from "@/lib/auth/token";
import { clearHits, clientKey, isLimited, rateLimit, recordHit } from "@/lib/server/rate-limit";
import { hashId, logEvent } from "@/lib/server/log";

/**
 * POST /api/auth/login  { username, password, next? }
 *
 * - Credentials are checked only here, on the server: the username against AUTH_USERNAME (constant-time) and
 *   the password against the scrypt hash in AUTH_PASSWORD_HASH. The password itself is never stored anywhere.
 * - The password is always hashed, even for an unknown username, so timing doesn't reveal which part was wrong.
 * - Every failure gets the same message and status, after a short delay.
 * - Limits: 10 attempts per 15 minutes per client address (all attempts — hashing is deliberately costly), and
 *   20 failures per 15 minutes per username (slows a distributed guesser).
 * - Success issues a brand-new signed session (fresh id; nothing from before sign-in is reused).
 * Never logs the password, the username in clear, or the hash.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 15 * 60_000;
const PER_CLIENT = 10;
const PER_USER_FAILURES = 20;
const GENERIC = "That username and password didn't match.";

const Body = z.object({
  username: z.string().max(100),
  password: z.string().max(256),
  next: z.string().max(300).optional(),
});

function reply(body: unknown, status: number, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store", ...extra } });
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: Request) {
  const ip = clientKey(req);
  const perClient = rateLimit(`login:ip:${ip}`, PER_CLIENT, WINDOW_MS);
  if (!perClient.ok) {
    logEvent({ level: "warn", route: "login", result: "rate_limited", client: hashId(ip) });
    return reply({ error: "Too many sign-in attempts. Please wait a few minutes and try again." }, 429, { "retry-after": String(perClient.retryAfterS) });
  }
  if (Number(req.headers.get("content-length") ?? 0) > 4096) return reply({ error: GENERIC }, 400);

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return reply({ error: GENERIC }, 400);
  }

  const secret = authSecret();
  const expectedUser = process.env.AUTH_USERNAME?.trim();
  const hash = process.env.AUTH_PASSWORD_HASH?.trim();
  if (!secret || !expectedUser || !hash) {
    logEvent({ level: "error", route: "login", result: "not_configured" });
    return reply({ error: "Sign-in isn't available right now." }, 503);
  }

  const userKey = `login:user:${body.username.trim().toLowerCase()}`;
  const perUser = isLimited(userKey, PER_USER_FAILURES, WINDOW_MS);
  if (perUser.limited) {
    logEvent({ level: "warn", route: "login", result: "user_locked", client: hashId(ip) });
    return reply({ error: "Too many sign-in attempts. Please wait a few minutes and try again." }, 429, { "retry-after": String(perUser.retryAfterS) });
  }

  const passwordOk = await verifyPassword(body.password, hash); // always runs
  const userOk = sameString(body.username.trim(), expectedUser);
  if (!(passwordOk && userOk)) {
    recordHit(userKey);
    logEvent({ level: "warn", route: "login", result: "failed", client: hashId(ip) });
    await pause(250 + Math.floor(Math.random() * 250));
    return reply({ error: GENERIC }, 401);
  }

  clearHits(userKey);
  const now = Math.floor(Date.now() / 1000);
  const ttl = ttlSeconds();
  const token = await signToken({ v: 1, u: expectedUser, sid: newSessionId(), iat: now, exp: now + ttl }, secret);
  logEvent({ level: "info", route: "login", result: "ok", client: hashId(ip) });
  const res = reply({ ok: true, next: safeNext(body.next) }, 200);
  res.cookies.set(AUTH_COOKIE, token, cookieOptions(ttl));
  return res;
}
