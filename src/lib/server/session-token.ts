import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Tamper-evident client-held session state.
 *
 * The server stays stateless (works on serverless, replays perfectly), but the
 * state the browser sends back must carry an HMAC the server issued. A student
 * who edits their mastery estimate in devtools gets a 409, not a promotion.
 *
 * Without SESSION_SECRET we use a fixed development key and /api/health says so.
 */
const DEV_SECRET = "tutoros-dev-only-secret-change-me";

export function signingMode(): "configured" | "dev-default" {
  return process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32 ? "configured" : "dev-default";
}

function secret() {
  return signingMode() === "configured" ? process.env.SESSION_SECRET! : DEV_SECRET;
}

export function signState(state: unknown): string {
  return createHmac("sha256", secret()).update(JSON.stringify(state)).digest("base64url");
}

export function verifyState(state: unknown, sig: string | undefined | null): boolean {
  if (!sig) return false;
  const expected = Buffer.from(signState(state));
  const got = Buffer.from(sig);
  return expected.length === got.length && timingSafeEqual(expected, got);
}
