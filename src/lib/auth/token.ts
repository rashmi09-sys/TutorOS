/**
 * Signed session tokens for the sign-in cookie. Web Crypto only, so the same code runs in the middleware
 * (Edge runtime) and in Node route handlers.
 *
 * Token: base64url(JSON payload) "." base64url(HMAC-SHA256(payload, AUTH_SECRET))
 * Payload: { v: 1, u: username, sid: random id, iat, exp } (seconds). Nothing secret is inside.
 * A token is valid only if the signature matches and it hasn't expired. A fresh random `sid` is issued at
 * every sign-in (no session fixation: a token from before sign-in is never upgraded).
 */
export const AUTH_COOKIE = "tutoros_auth";
export const DEFAULT_TTL_HOURS = 8;

export interface AuthPayload {
  v: 1;
  u: string;
  sid: string;
  iat: number;
  exp: number;
}

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
};

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** The signing secret, or null if it is missing or too short (then nobody can sign in — fail closed). */
export function authSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.AUTH_SECRET?.trim();
  return s && s.length >= 32 ? s : null;
}

export function ttlSeconds(env: Record<string, string | undefined> = process.env): number {
  const h = Number(env.AUTH_SESSION_TTL_HOURS);
  return Math.round((Number.isFinite(h) && h > 0 && h <= 24 * 7 ? h : DEFAULT_TTL_HOURS) * 3600);
}

export async function signToken(p: AuthPayload, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(p)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

/** The payload if the token is authentic and unexpired; otherwise null. Never throws. */
export async function verifyToken(token: string | undefined | null, secret: string | null, nowS = Math.floor(Date.now() / 1000)): Promise<AuthPayload | null> {
  if (!token || !secret || token.length > 2048) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(sig), enc.encode(body)); // constant-time
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body))) as AuthPayload;
    if (p.v !== 1 || typeof p.u !== "string" || typeof p.exp !== "number" || typeof p.iat !== "number") return null;
    if (p.exp <= nowS || p.iat > nowS + 60) return null;
    return p;
  } catch {
    return null;
  }
}

export function newSessionId() {
  return b64url(crypto.getRandomValues(new Uint8Array(18)));
}

/** Cookie attributes: HttpOnly, SameSite=Lax, Secure in production, whole site, expires with the token. */
export function cookieOptions(maxAgeS: number, env: Record<string, string | undefined> = process.env) {
  return { httpOnly: true, sameSite: "lax" as const, secure: env.NODE_ENV === "production", path: "/", maxAge: maxAgeS };
}

/** Only same-site relative paths are allowed as a post-sign-in destination (no open redirects). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\u0000-\u001f]/.test(next) || next.startsWith("/signin")) return "/";
  return next.slice(0, 300);
}
