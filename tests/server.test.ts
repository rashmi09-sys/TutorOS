/** API route handlers called directly — the same code Next.js serves. */
import { describe, expect, it } from "vitest";
import { POST as turn } from "@/app/api/turn/route";
import { GET as health } from "@/app/api/health/route";
import { signState, verifyState } from "@/lib/server/session-token";
import { rateLimit } from "@/lib/server/rate-limit";

const req = (body: unknown, ip = "1.1.1.1") => new Request("http://x/api/turn", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });

describe("session signing", () => {
  it("verifies its own signature and rejects any edit", () => {
    const s = { version: 1, sessionId: "a", turn: 3, mastery: { pKnown: 0.3 } };
    const sig = signState(s);
    expect(verifyState(s, sig)).toBe(true);
    expect(verifyState({ ...s, mastery: { pKnown: 0.99 } }, sig)).toBe(false);
    expect(verifyState(s, null)).toBe(false);
  });
});

describe("/api/turn", () => {
  it("starts a session, continues it with the signed state, and rejects a tampered state", async () => {
    const r1 = await turn(req({ state: null, event: { type: "start", id: "evt_aaaaaa" } }, "10.0.0.1"));
    expect(r1.status).toBe(200);
    expect(r1.headers.get("x-request-id")).toMatch(/^req_/);
    const d1 = await r1.json();
    expect(d1.teacher.mode).toBe("deterministic");

    const r2 = await turn(req({ state: d1.state, stateSig: d1.stateSig, event: { type: "text", text: "x = 8", via: "keyboard", id: "evt_bbbbbb" } }, "10.0.0.1"));
    const d2 = await r2.json();
    expect(r2.status).toBe(200);
    expect(r2.headers.get("x-trace-id")).toBe(d2.trace.turnId);
    expect(d2.trace.decision.rule).toBe("R6_PROBE_UNKNOWN");

    const forged = { ...d2.state, mastery: { ...d2.state.mastery, pKnown: 0.99, status: "mastered" } };
    const r3 = await turn(req({ state: forged, stateSig: d2.stateSig, event: { type: "text", text: "x = 5", via: "keyboard" } }, "10.0.0.1"));
    expect(r3.status).toBe(409);
    expect((await r3.json()).error).toBe("session_unverifiable");
  });

  it("a duplicate event against the post-state is a no-op", async () => {
    const d1 = await (await turn(req({ state: null, event: { type: "start", id: "evt_cccccc" } }, "10.0.0.2"))).json();
    const d2 = await (await turn(req({ state: d1.state, stateSig: d1.stateSig, event: { type: "text", text: "x = 8", via: "keyboard", id: "evt_dddddd" } }, "10.0.0.2"))).json();
    const d3 = await (await turn(req({ state: d2.state, stateSig: d2.stateSig, event: { type: "text", text: "x = 8", via: "keyboard", id: "evt_dddddd" } }, "10.0.0.2"))).json();
    expect(d3.duplicate).toBe(true);
    expect(d3.state.turn).toBe(d2.state.turn);
  });

  it("validates input", async () => {
    expect((await turn(req({ state: null, event: { type: "text", text: "", via: "keyboard" } }, "10.0.0.3"))).status).toBe(400);
    expect((await turn(req({ state: null, event: { type: "text", text: "x".repeat(501), via: "keyboard" } }, "10.0.0.3"))).status).toBe(400);
    expect((await turn(req({ state: null, event: { type: "hack" } }, "10.0.0.3"))).status).toBe(400);
    const bad = new Request("http://x/api/turn", { method: "POST", body: "{not json" });
    expect((await turn(bad)).status).toBe(400);
  });

  it("rate-limits a single client", async () => {
    let last = 200;
    for (let i = 0; i < 65; i++) last = (await turn(req({ state: null, event: { type: "start" } }, "10.9.9.9"))).status;
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
  it("health reports deterministic mode and the dev signing key honestly", async () => {
    const d = await (await health()).json();
    expect(d.teacher.mode).toBe("deterministic");
    expect(d.status).toBe("degraded");
  });
  it("rate limiter window", () => {
    for (let i = 0; i < 3; i++) expect(rateLimit("k", 3, 1000).ok).toBe(true);
    expect(rateLimit("k", 3, 1000).ok).toBe(false);
  });
});
