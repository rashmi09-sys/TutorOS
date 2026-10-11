import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authSecret, safeNext, verifyToken } from "@/lib/auth/token";

/**
 * The authentication gate, enforced on the server for every request except static build assets:
 *  - no valid session → pages redirect to /signin (with a safe `next`), APIs get 401 JSON;
 *  - /signin and the sign-in/out endpoints are the only public routes;
 *  - state-changing API calls must come from this site (Origin check: CSRF protection on top of SameSite);
 *  - a signed-in visitor who opens /signin is sent to the app.
 * Route handlers and the app layout check the session again (defence in depth).
 */
const PUBLIC_API = new Set(["/api/auth/login", "/api/auth/logout"]);

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Content Security Policy with a fresh nonce per request: only this site's scripts carrying the nonce run (Next
 * adds it to its own scripts), nothing can be framed, and pages may only talk to this origin.
 * Styles allow inline attributes because KaTeX positions maths with style attributes.
 */
function csp(nonce: string, https: boolean) {
  const dev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob: data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** Continue to the page with the CSP on both the request (so Next can read the nonce) and the response. */
function pageWithCsp(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const policy = csp(nonce, req.nextUrl.protocol === "https:");
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", policy);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", policy);
  return res;
}

function noStore(res: NextResponse) {
  res.headers.set("cache-control", "no-store");
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const unsafe = !["GET", "HEAD", "OPTIONS"].includes(req.method);

  if (isApi && unsafe && !sameOrigin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: { "cache-control": "no-store" } });
  }

  const user = await verifyToken(req.cookies.get(AUTH_COOKIE)?.value, authSecret());

  if (pathname === "/signin") {
    if (user) return noStore(NextResponse.redirect(new URL(safeNext(req.nextUrl.searchParams.get("next")), req.url)));
    return pageWithCsp(req);
  }
  if (isApi && PUBLIC_API.has(pathname)) return NextResponse.next();
  if (user) return isApi ? NextResponse.next() : pageWithCsp(req);

  if (isApi) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  const to = new URL("/signin", req.url);
  const next = safeNext(pathname + search);
  if (next !== "/") to.searchParams.set("next", next);
  const res = NextResponse.redirect(to);
  // An invalid or expired cookie is removed so the browser stops sending it.
  if (req.cookies.has(AUTH_COOKIE)) res.cookies.set(AUTH_COOKIE, "", { path: "/", maxAge: 0 });
  return noStore(res);
}

export const config = {
  // Everything except Next's hashed build assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
