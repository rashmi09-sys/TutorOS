import { cookies } from "next/headers";
import { AUTH_COOKIE, authSecret, verifyToken, type AuthPayload } from "./token";

/**
 * Defence in depth: the middleware already turns away unauthenticated requests, and every protected route
 * handler checks again here, so a misconfigured matcher can't open an API.
 */
export async function currentUser(req?: Request): Promise<AuthPayload | null> {
  let token: string | undefined;
  if (req) token = readCookie(req.headers.get("cookie"), AUTH_COOKIE);
  else token = (await cookies()).get(AUTH_COOKIE)?.value;
  return verifyToken(token, authSecret());
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function unauthorized() {
  return Response.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
}
