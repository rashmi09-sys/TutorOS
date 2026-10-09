import { describe, expect, it } from "vitest";
import { createSession, step, MAX_TURNS } from "@/engine/engine";
import { DeterministicTeacher } from "@/engine/llm/teacher";
import { runSuite } from "@/engine/eval/runner";
import { SCENARIOS } from "@/engine/eval/scenarios";
import { RULES } from "@/engine/rules";
import { generateTransferProblem, GUIDED_PROBLEM } from "@/engine/problems";

const teacher = new DeterministicTeacher();

describe("engine", () => {
  it("is a pure reducer: input state is not mutated; traces carry request and trace ids", async () => {
    const s0 = createSession({ sessionId: "s1" });
    const frozen = JSON.stringify(s0);
    const r = await step(s0, { type: "start", id: "evt_000001" }, { teacher, requestId: "req-1" });
    expect(JSON.stringify(s0)).toBe(frozen);
    expect(r.trace.requestId).toBe("req-1");
    expect(r.trace.turnId).toBe("s1-t1");
  });

  it("idempotency: re-sending an already-applied event id changes nothing", async () => {
    let s = createSession({ sessionId: "s2" });
    s = (await step(s, { type: "start", id: "evt_start1" }, { teacher })).state;
    const r1 = await step(s, { type: "text", text: "x = 8", via: "keyboard", id: "evt_answer1" }, { teacher });
    const dup = await step(r1.state, { type: "text", text: "x = 8", via: "keyboard", id: "evt_answer1" }, { teacher });
    expect(dup.duplicate).toBe(true);
    expect(dup.state).toBe(r1.state);
    expect(dup.state.attempts).toBe(1);
    // A retry against the PRE-state (response was lost) recomputes the same deterministic turn once.
    const retry = await step(s, { type: "text", text: "x = 8", via: "keyboard", id: "evt_answer1" }, { teacher });
    expect(retry.state).toEqual(r1.state);
  });

  it("caps session length", async () => {
    const s = { ...createSession({ sessionId: "s3" }), turn: MAX_TURNS + 1 };
    const r = await step(s, { type: "text", text: "x = 8", via: "keyboard" }, { teacher });
    expect(r.trace.decision.rule).toBe("R15_SESSION_COMPLETE");
  });

  it("every policy decision lists the permitted candidates and the chosen one is among them", async () => {
    const res = await runSuite(teacher, "tutor-v1");
    for (const t of res.results.flatMap((r) => r.traces)) expect(t.candidates.map((c) => c.id)).toContain(t.decision.id);
  });

  it("transfer problems are fresh, integer-valued and reproducible from the seed", () => {
    const a = generateTransferProblem(7, 0, [GUIDED_PROBLEM]);
    expect(a).toEqual(generateTransferProblem(7, 0, [GUIDED_PROBLEM]));
    expect(a.text).not.toBe(GUIDED_PROBLEM.text);
    expect(Number.isInteger(Number(a.answer))).toBe(true);
  });
});

describe("evaluation suite", () => {
  it("B · tutor-v1 (deterministic) passes every scenario", async () => {
    const res = await runSuite(teacher, "tutor-v1");
    const failed = res.results.filter((r) => !r.passed).map((r) => `${r.id}: ${r.assertions.filter((a) => !a.passed).map((a) => a.detail).join("; ")}`);
    expect(failed).toEqual([]);
    expect(res.metrics.scenariosWithLeak).toBe(0);
    expect(res.metrics.falseMathStatements).toBe(0);
  });
  it("A · the naive answer-giver is caught leaking (the suite has teeth)", async () => {
    const res = await runSuite(teacher, "baseline-answer-giver");
    expect(res.metrics.scenariosWithLeak).toBeGreaterThanOrEqual(8);
    expect(res.passed).toBeLessThan(res.total);
  });
  it("scenario ids are unique and every assertion has a category", async () => {
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    const res = await runSuite(teacher, "tutor-v1");
    for (const a of res.results.flatMap((r) => r.assertions)) expect(a.category).toBeTruthy();
  });
  it("every rule the engine emitted is documented in the console's rule table", async () => {
    const res = await runSuite(teacher, "tutor-v1");
    const documented = RULES.map((r) => r.id.replace(/(_L1\/2\/3|\*)$/, ""));
    const emitted = new Set(res.results.flatMap((r) => r.traces.map((t) => t.decision.rule)));
    for (const rule of emitted) expect(documented.some((d) => rule === d || rule.startsWith(d)), rule).toBe(true);
  });
});
