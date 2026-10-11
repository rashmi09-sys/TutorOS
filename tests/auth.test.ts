/**
 * Sign-in, sessions and the server-side gate. Uses a random password generated for this run — never the real
 * one — and a fast scrypt cost so the suite stays quick (production hashes use the default cost).
 */
import { randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { TEST_USER, sessionCookie } from "./helpers/auth";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { middleware } from "@/middleware";
import { hashPassword, sameString, verifyPassword } from "@/lib/auth/password";
import { AUTH_COOKIE, authSecret, safeNext, signToken, ttlSeconds, verifyToken } from "@/lib/auth/token";
import { resetRateLimitsForTests } from "@/lib/server/rate-limit";
import { cueOf, algebraView, subjectView } from "@/lib/server/view";
import { MISCONCEPTIONS } from "@/engine/misconceptions";
import { MISCONCEPTION_LABELS } from "@/engine/misconception-labels";
import { createSession } from "@/engine/engine";
import { SUBJECTS, createSubjectSession } from "@/engine/subjects";

const PASSWORD = randomBytes(12).toString("base64url");
const ORIGIN = "http://app.test";

beforeAll(async () => {
  process.env.AUTH_PASSWORD_HASH = await hashPassword(PASSWORD, { N: 1 << 12 });
});
beforeEach(() => resetRateLimitsForTests());

let ipN = 0;
const loginReq = (body: unknown, ip = `10.50.0.${++ipN}`) =>
  new Request(`${ORIGIN}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip, origin: ORIGIN }, body: JSON.stringify(body) });

function cookieFrom(res: Response) {
  return res.headers.get("set-cookie") ?? "";
}

describe("password hashing", () => {
  it("verifies the right password only, and fails closed on malformed hashes", async () => {
    const h = await hashPassword("correct horse", { N: 1 << 12 });
    expect(h).toMatch(/^scrypt:4096:8:1:[\w-]{22}:[\w-]{86}$/);
    expect(h).not.toContain("correct");
    expect(await verifyPassword("correct horse", h)).toBe(true);
    expect(await verifyPassword("correct horsE", h)).toBe(false);
    expect(await verifyPassword("", h)).toBe(false);
    for (const bad of [null, "", "plain", "scrypt:1:1:1:a:b", h.replace("scrypt", "md5"), "scrypt:4096:8:1::", "scrypt:99999999:8:1:aaaaaaaaaaaaaaaaaaaaaa:bb"]) expect(await verifyPassword("correct horse", bad)).toBe(false);
    expect(await verifyPassword("x".repeat(300), h)).toBe(false);
    // Two hashes of the same password differ (random salt).
    expect(await hashPassword("same", { N: 1 << 12 })).not.toBe(await hashPassword("same", { N: 1 << 12 }));
  });
  it("compares usernames in constant time", () => {
    expect(sameString("Teacher", "Teacher")).toBe(true);
    expect(sameString("teacher", "Teacher")).toBe(false);
    expect(sameString("", "Teacher")).toBe(false);
  });
});

describe("session tokens", () => {
  const secret = "s".repeat(40);
  it("accepts its own unexpired token and nothing else", async () => {
    const now = Math.floor(Date.now() / 1000);
    const t = await signToken({ v: 1, u: "a", sid: "x", iat: now, exp: now + 60 }, secret);
    expect((await verifyToken(t, secret))?.u).toBe("a");
    expect(await verifyToken(t, "o".repeat(40))).toBeNull(); // other key
    expect(await verifyToken(t, secret, now + 61)).toBeNull(); // expired
    expect(await verifyToken(t, null)).toBeNull(); // no key configured
    const [body, sig] = t.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ v: 1, u: "admin", sid: "x", iat: now, exp: now + 1e6 })).toString("base64url");
    expect(await verifyToken(`${forgedBody}.${sig}`, secret)).toBeNull();
    expect(await verifyToken(`${body}.`, secret)).toBeNull();
    expect(await verifyToken(`${body}.${sig}.x`, secret)).toBeNull();
    expect(await verifyToken("garbage", secret)).toBeNull();
    expect(await verifyToken(`${body}.${sig}`.repeat(30), secret)).toBeNull();
  });
  it("needs a secret of at least 32 characters; TTL defaults to 8 hours", () => {
    expect(authSecret({ AUTH_SECRET: "short" })).toBeNull();
    expect(authSecret({})).toBeNull();
    expect(authSecret({ AUTH_SECRET: "k".repeat(32) })).toBe("k".repeat(32));
    expect(ttlSeconds({})).toBe(8 * 3600);
    expect(ttlSeconds({ AUTH_SESSION_TTL_HOURS: "2" })).toBe(7200);
    expect(ttlSeconds({ AUTH_SESSION_TTL_HOURS: "-1" })).toBe(8 * 3600);
    expect(ttlSeconds({ AUTH_SESSION_TTL_HOURS: "9999" })).toBe(8 * 3600);
  });
  it("only allows same-site paths after sign-in (no open redirect)", () => {
    expect(safeNext("/learn/algebra?x=1")).toBe("/learn/algebra?x=1");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/signin", "/signin?next=/x", "", null, undefined, "/a\nb"]) expect(safeNext(bad)).toBe("/");
  });
});

describe("POST /api/auth/login", () => {
  it("valid credentials: a fresh HttpOnly, SameSite=Lax session cookie scoped to the site", async () => {
    const res = await login(loginReq({ username: TEST_USER, password: PASSWORD, next: "/learn/physics" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: "/learn/physics" });
    const c = cookieFrom(res);
    expect(c).toMatch(new RegExp(`^${AUTH_COOKIE}=`));
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=lax/i);
    expect(c).toMatch(/Path=\//);
    expect(c).toMatch(/Max-Age=28800/);
    expect(c).not.toMatch(/Secure/); // not in tests; on in production (below)
    expect(c).not.toContain(PASSWORD);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const token = c.split(";")[0].split("=")[1];
    expect((await verifyToken(token, authSecret()))?.u).toBe(TEST_USER);
    // A second sign-in gets a different session id (no fixation)
    const c2 = cookieFrom(await login(loginReq({ username: TEST_USER, password: PASSWORD })));
    expect((await verifyToken(c2.split(";")[0].split("=")[1], authSecret()))!.sid).not.toBe((await verifyToken(token, authSecret()))!.sid);
  });

  it("sets Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(cookieFrom(await login(loginReq({ username: TEST_USER, password: PASSWORD })))).toMatch(/Secure/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("wrong password, wrong username, both, or blank: the same generic 401 and no cookie", async () => {
    const bodies = [
      { username: TEST_USER, password: PASSWORD + "x" },
      { username: "someone", password: PASSWORD },
      { username: TEST_USER.toUpperCase(), password: PASSWORD },
      { username: "", password: "" },
    ];
    const replies = [];
    for (const b of bodies) {
      const r = await login(loginReq(b));
      expect(r.status).toBe(401);
      expect(r.headers.get("set-cookie")).toBeNull();
      replies.push(await r.json());
    }
    expect(new Set(replies.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(replies[0]).toEqual({ error: "That username and password didn't match." });
  });

  it("malformed bodies get the same generic message, never a schema dump", async () => {
    for (const b of [{}, { username: 1 }, { username: "a", password: "x".repeat(300) }]) {
      const r = await login(loginReq(b));
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "That username and password didn't match." });
    }
  });

  it("rate-limits one client after 10 attempts, even with the right password", async () => {
    const ip = "10.60.0.1";
    for (let i = 0; i < 10; i++) expect((await login(loginReq({ username: "x", password: "y" }, ip))).status).toBe(401);
    const blocked = await login(loginReq({ username: TEST_USER, password: PASSWORD }, ip));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(blocked.headers.get("set-cookie")).toBeNull();
  }, 20_000);

  it("slows a distributed guesser: 20 failures for one username from many addresses lock that username for a while", async () => {
    for (let i = 0; i < 20; i++) await login(loginReq({ username: TEST_USER, password: `wrong${i}` }, `10.70.${i}.1`));
    expect((await login(loginReq({ username: TEST_USER, password: PASSWORD }, "10.70.99.1"))).status).toBe(429);
  }, 30_000);

  it("fails closed when sign-in isn't configured", async () => {
    const saved = process.env.AUTH_PASSWORD_HASH;
    delete process.env.AUTH_PASSWORD_HASH;
    try {
      const r = await login(loginReq({ username: TEST_USER, password: PASSWORD }));
      expect(r.status).toBe(503);
      expect(r.headers.get("set-cookie")).toBeNull();
    } finally {
      process.env.AUTH_PASSWORD_HASH = saved;
    }
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the cookie", async () => {
    const r = await logout();
    expect(r.status).toBe(200);
    const c = cookieFrom(r);
    expect(c).toMatch(new RegExp(`^${AUTH_COOKIE}=;`));
    expect(c).toMatch(/Max-Age=0/);
    expect(c).toMatch(/HttpOnly/i);
  });
});

describe("middleware (the server-side gate)", () => {
  const mw = async (path: string, init: { method?: string; cookie?: string; origin?: string | null } = {}) => {
    const headers = new Headers({ host: "app.test" });
    if (init.cookie) headers.set("cookie", init.cookie);
    if (init.origin !== null && init.origin !== undefined) headers.set("origin", init.origin);
    return middleware(new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? "GET", headers }));
  };

  it("unauthenticated: pages redirect to /signin with a safe next; APIs get 401", async () => {
    for (const p of ["/", "/learn/algebra", "/learn/physics?x=1"]) {
      const r = await mw(p);
      expect(r.status).toBe(307);
      const loc = new URL(r.headers.get("location")!);
      expect(loc.pathname).toBe("/signin");
      if (p !== "/") expect(loc.searchParams.get("next")).toBe(p);
    }
    for (const p of ["/api/turn", "/api/tts", "/api/health", "/api/anything-new"]) {
      const r = await mw(p, { method: p === "/api/health" ? "GET" : "POST", origin: ORIGIN });
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: "unauthorized" });
    }
  });

  it("a forged, expired or garbage cookie is treated as signed out (and cleared)", async () => {
    for (const cookie of [await sessionCookie({ secret: "z".repeat(40) }), await sessionCookie({ ttlS: -5 }), `${AUTH_COOKIE}=garbage`]) {
      const page = await mw("/", { cookie });
      expect(page.status).toBe(307);
      expect(page.headers.get("set-cookie")).toMatch(/Max-Age=0/);
      expect((await mw("/api/turn", { method: "POST", cookie, origin: ORIGIN })).status).toBe(401);
    }
  });

  it("session expiry: a token is accepted until it expires, then refused", async () => {
    const shortLived = await sessionCookie({ ttlS: 1 });
    expect((await mw("/", { cookie: shortLived })).status).toBe(200);
    vi.useFakeTimers({ now: Date.now() + 5_000 });
    try {
      expect((await mw("/", { cookie: shortLived })).status).toBe(307);
    } finally {
      vi.useRealTimers();
    }
  });

  it("authenticated: pages and APIs pass, with a per-request CSP nonce", async () => {
    const cookie = await sessionCookie();
    const page = await mw("/learn/algebra", { cookie });
    expect(page.status).toBe(200);
    const csp = page.headers.get("content-security-policy")!;
    expect(csp).toMatch(/script-src 'self' 'nonce-[\w+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    const page2 = await mw("/learn/algebra", { cookie });
    expect(page2.headers.get("content-security-policy")).not.toBe(csp);
    expect((await mw("/api/turn", { method: "POST", cookie, origin: ORIGIN })).status).toBe(200);
  });

  it("only the sign-in page and endpoints are public; a signed-in visitor skips /signin", async () => {
    expect((await mw("/signin")).status).toBe(200);
    expect((await mw("/api/auth/login", { method: "POST", origin: ORIGIN })).status).toBe(200);
    expect((await mw("/api/auth/logout", { method: "POST", origin: ORIGIN })).status).toBe(200);
    const r = await mw("/signin?next=/learn/geometry", { cookie: await sessionCookie() });
    expect(r.status).toBe(307);
    expect(new URL(r.headers.get("location")!).pathname).toBe("/learn/geometry");
    const evil = await mw("/signin?next=//evil.example", { cookie: await sessionCookie() });
    expect(new URL(evil.headers.get("location")!).host).toBe("app.test");
  });

  it("CSRF: state-changing API calls from another site, or with no Origin, are refused — even when signed in", async () => {
    const cookie = await sessionCookie();
    expect((await mw("/api/turn", { method: "POST", cookie, origin: "https://evil.example" })).status).toBe(403);
    expect((await mw("/api/turn", { method: "POST", cookie, origin: null })).status).toBe(403);
    expect((await mw("/api/auth/login", { method: "POST", origin: "https://evil.example" })).status).toBe(403);
    expect((await mw("/api/tts", { method: "POST", cookie, origin: "null" })).status).toBe(403);
  });
});

describe("what reaches the browser", () => {
  it("policy rule names become a small set of cues", () => {
    expect(cueOf("R1_GUIDED_SOLVED")).toBe("solved_guided");
    expect(cueOf("R0_PRESENT_PROBLEM")).toBe("fresh");
    expect(cueOf("R18_CONCEPT_ORDER")).toBe("idea");
    expect(cueOf("G_CORRECT")).toBe("ans_done");
    expect(cueOf("P_SUB_RIGHT")).toBe("ans_ok");
    expect(cueOf("G_RIGHT_FLAWED_WORKING")).toBe("ans_part");
    expect(cueOf("P_CONCEPT_CHECK")).toBeUndefined();
    expect(cueOf("R6_PROBE_UNKNOWN")).toBeUndefined();
  });
  it("views keep no seed, rules, dialogue, diagnosis or unreached answers", () => {
    const a = algebraView(createSession({ sessionId: "s", seed: 42 }));
    const g = subjectView(createSubjectSession(SUBJECTS.geometry, { sessionId: "g", seed: 42 }));
    for (const v of [a, g]) {
      const txt = JSON.stringify(v);
      for (const k of ['"seed"', '"rule"', '"dialog"', '"lastDiagnosis"', '"hintHistory"', '"answerText"', '"lastEventId"', '"modelCalls"']) expect(txt).not.toContain(k);
    }
    expect(a.problems.every((p) => p.answer === undefined)).toBe(true);
    expect(g.problems.every((p) => p.answer === undefined)).toBe(true);
    for (const p of g.problems) if (p.data.unknown === "C") expect(p.data.C).toBeUndefined();
  });
  it("the client-safe misconception labels match the catalogue exactly", () => {
    expect(MISCONCEPTION_LABELS).toEqual(Object.fromEntries(Object.entries(MISCONCEPTIONS).map(([k, v]) => [k, v.label])));
  });
});
