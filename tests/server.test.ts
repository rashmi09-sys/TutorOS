/** API route handlers called directly — the same code Next.js serves. */
import { describe, expect, it } from "vitest";
import { TEST_USER, authedPost, authedGet, sessionCookie } from "./helpers/auth";
import { POST as turn } from "@/app/api/turn/route";
import { GET as health } from "@/app/api/health/route";
import { openState, sealState } from "@/lib/server/sealed-state";
import { rateLimit } from "@/lib/server/rate-limit";
import type { SessionState } from "@/engine/types";

const URL_TURN = "http://x/api/turn";
const req = (body: unknown, ip = "1.1.1.1") => authedPost(URL_TURN, body, { "x-forwarded-for": ip });
const anon = (body: unknown) => new Request(URL_TURN, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" }, body: JSON.stringify(body) });

describe("sealed lesson state", () => {
  it("round-trips, and refuses any edit, another lesson or another user", () => {
    const s = { version: 1, sessionId: "a", turn: 3, mastery: { pKnown: 0.3 } };
    const sealed = sealState(s, "algebra", "u1");
    expect(sealed).not.toContain("pKnown");
    expect(openState(sealed, "algebra", "u1")).toEqual(s);
    expect(openState(sealed, "geometry", "u1")).toBeNull();
    expect(openState(sealed, "algebra", "u2")).toBeNull();
    const flipped = sealed.slice(0, -3) + (sealed.at(-3) === "A" ? "B" : "A") + sealed.slice(-2);
    expect(openState(flipped, "algebra", "u1")).toBeNull();
    expect(openState("s1.garbage", "algebra", "u1")).toBeNull();
    expect(openState(null, "algebra", "u1")).toBeNull();
  });
});

describe("/api/turn", () => {
  it("rejects requests without a valid session (no cookie, forged, expired)", async () => {
    expect((await turn(anon({ sealed: null, event: { type: "start" } }))).status).toBe(401);
    const forged = new Request(URL_TURN, { method: "POST", headers: { cookie: await sessionCookie({ secret: "y".repeat(40) }) }, body: JSON.stringify({ sealed: null, event: { type: "start" } }) });
    expect((await turn(forged)).status).toBe(401);
    const expired = new Request(URL_TURN, { method: "POST", headers: { cookie: await sessionCookie({ ttlS: -1 }) }, body: JSON.stringify({ sealed: null, event: { type: "start" } }) });
    expect((await turn(expired)).status).toBe(401);
  });

  it("starts a session, continues it from the sealed state, and returns only the redacted view", async () => {
    const r1 = await turn(await req({ sealed: null, event: { type: "start", id: "evt_aaaaaa" } }, "10.0.0.1"));
    expect(r1.status).toBe(200);
    expect(r1.headers.get("x-request-id")).toMatch(/^req_/);
    const d1 = await r1.json();
    expect(d1.teacher.mode).toBe("deterministic");
    expect(Object.keys(d1).sort()).toEqual(["duplicate", "requestId", "sealed", "teacher", "turnId", "utterance", "view"]);

    const r2 = await turn(await req({ sealed: d1.sealed, event: { type: "text", text: "x = 8", via: "keyboard", id: "evt_bbbbbb" } }, "10.0.0.1"));
    const d2 = await r2.json();
    expect(r2.status).toBe(200);
    // The decision is still made by the policy (checked from the server's own sealed state)…
    const full = openState<SessionState>(d2.sealed, "algebra", TEST_USER)!;
    expect(full.transcript.at(-1)!.rule).toBe("R6_PROBE_UNKNOWN");
    // …but nothing internal reaches the browser.
    const txt = JSON.stringify(d2);
    for (const leak of ['"trace"', '"rule"', "R6_PROBE", '"seed"', '"dialog"', "hintHistory", '"lastDiagnosis"', '"candidates"', '"prompt"']) expect(txt).not.toContain(leak);
    expect(d2.view.problems[0].answer).toBeUndefined(); // not reached yet
    expect(d2.view.problems[0].text).toBe("3x + 5 = 20");
  });

  it("a tampered or swapped sealed state gets 409; a state from another lesson too", async () => {
    const d1 = await (await turn(await req({ sealed: null, event: { type: "start", id: "evt_tamper1" } }, "10.0.0.4"))).json();
    const bad = d1.sealed.slice(0, 20) + (d1.sealed[20] === "A" ? "B" : "A") + d1.sealed.slice(21);
    const r = await turn(await req({ sealed: bad, event: { type: "text", text: "x = 5", via: "keyboard" } }, "10.0.0.4"));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("session_unverifiable");
    const cross = await turn(await req({ lesson: "geometry", sealed: d1.sealed, event: { type: "text", text: "x = 5", via: "keyboard" } }, "10.0.0.4"));
    expect(cross.status).toBe(409);
  });

  it("a duplicate event against the post-state is a no-op", async () => {
    const d1 = await (await turn(await req({ sealed: null, event: { type: "start", id: "evt_cccccc" } }, "10.0.0.2"))).json();
    const d2 = await (await turn(await req({ sealed: d1.sealed, event: { type: "text", text: "x = 8", via: "keyboard", id: "evt_dddddd" } }, "10.0.0.2"))).json();
    const d3 = await (await turn(await req({ sealed: d2.sealed, event: { type: "text", text: "x = 8", via: "keyboard", id: "evt_dddddd" } }, "10.0.0.2"))).json();
    expect(d3.duplicate).toBe(true);
    expect(d3.view.turn).toBe(d2.view.turn);
  });

  it("validates input, with a generic error (no schema details)", async () => {
    for (const body of [
      { sealed: null, event: { type: "text", text: "", via: "keyboard" } },
      { sealed: null, event: { type: "text", text: "x".repeat(501), via: "keyboard" } },
      { sealed: null, event: { type: "hack" } },
      { state: { version: 1 }, event: { type: "start" } },
    ]) {
      const r = await turn(await req(body, "10.0.0.3"));
      expect(r.status).toBe(400);
      expect(Object.keys(await r.json()).sort()).toEqual(["error", "requestId"]);
    }
    const bad = new Request(URL_TURN, { method: "POST", headers: { cookie: await sessionCookie() }, body: "{not json" });
    expect((await turn(bad)).status).toBe(400);
  });

  it("rate-limits a single client", async () => {
    let last = 200;
    for (let i = 0; i < 65; i++) last = (await turn(await req({ sealed: null, event: { type: "start" } }, "10.9.9.9"))).status;
    expect(last).toBe(429);
  });
});

describe("/api/health and the evaluation suites", () => {
  it("the suites still run from code (npm run eval): B passes, the answer-giver leaks", async () => {
    const { runSuite } = await import("@/engine/eval/runner");
    const { DeterministicTeacher } = await import("@/engine/llm/teacher");
    const t = new DeterministicTeacher();
    const B = await runSuite(t, "tutor-v1");
    const A = await runSuite(t, "baseline-answer-giver");
    expect(B.metrics.scenarios.passed).toBe(B.metrics.scenarios.total);
    expect(A.metrics.scenariosWithLeak).toBeGreaterThan(0);
  });
  it("health needs a session and says only which teacher and voice are active", async () => {
    expect((await health(new Request("http://x/api/health"))).status).toBe(401);
    const d = await (await health(await authedGet("http://x/api/health"))).json();
    expect(d).toEqual({ ok: true, teacher: { mode: "deterministic", name: "deterministic" }, voice: { provider: "browser", voice: null } });
  });
  it("rate limiter window", () => {
    for (let i = 0; i < 3; i++) expect(rateLimit("k", 3, 1000).ok).toBe(true);
    expect(rateLimit("k", 3, 1000).ok).toBe(false);
  });
});
