import { NextResponse } from "next/server";
import { AUTH_COOKIE, cookieOptions } from "@/lib/auth/token";

/**
 * POST /api/auth/logout — clears the session cookie. Works whether or not the session is still valid, so an
 * expired session can always sign out cleanly. (Tokens are stateless: see SECURITY.md for revocation.)
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  res.cookies.set(AUTH_COOKIE, "", { ...cookieOptions(0), maxAge: 0 });
  return res;
}
