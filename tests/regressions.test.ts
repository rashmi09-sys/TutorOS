/**
 * One regression test per finding in docs/AUDIT.md. Each runs the real engine.
 */
import { describe, expect, it } from "vitest";
import { createSession, step } from "@/engine/engine";
import { DeterministicTeacher } from "@/engine/llm/teacher";
import { classifyIntent } from "@/engine/intent";
import { diagnoseStep, normalize } from "@/engine/misconceptions";
import { parseEquation } from "@/engine/algebra";
import { buildContext } from "@/engine/policy";
import { computeMetrics, runScenario } from "@/engine/eval/runner";
import { SCENARIOS } from "@/engine/eval/scenarios";
import type { SessionState } from "@/engine/types";

const teacher = new DeterministicTeacher();
async function first(text: string, prefix: string[] = []) {
  let s: SessionState = createSession({ sessionId: "reg", seed: 7 });
  s = (await step(s, { type: "start" }, { teacher })).state;
  for (const p of prefix) s = (await step(s, { type: "text", text: p, via: "keyboard" }, { teacher })).state;
  return step(s, { type: "text", text, via: "keyboard" }, { teacher });
}

describe("AUDIT #1 — step errors diagnosed by the transformation written", () => {
  const n = normalize(parseEquation("3x + 5 = 20")!);
  it("3x = 25 → sign error, with evidence about 20 + 5 = 25 (no invented division)", () => {
    const d = diagnoseStep(parseEquation("3x = 25")!, n);
    expect(d.id).toBe("SIGN_ERROR_INVERSE_OP");
    expect(d.basis).toBe("step");
    expect(d.evidence).toContain("20 + 5 = 25");
    expect(d.evidence).not.toMatch(/÷|divid/);
  });
  it("subtraction form: 4x − 7 = 13 written as 4x = 6 is the flipped sign error", () => {
    const d = diagnoseStep(parseEquation("4x = 6")!, normalize(parseEquation("4x - 7 = 13")!));
    expect(d.id).toBe("SIGN_ERROR_INVERSE_OP");
    expect(d.evidence).toContain("13 − 7 = 6");
  });
  it.each([
    ["3x = 20", "ONE_SIDE_ONLY"],
    ["8x = 20", "COMBINED_UNLIKE_TERMS"],
    ["x + 5 = 20/3", "UNDID_IN_WRONG_ORDER"],
    ["x + 5 = 17", "COEFFICIENT_AS_ADDEND"],
    ["3x = 14", "ARITHMETIC_SLIP"],
  ])("%s → %s (by step)", (raw, id) => {
    const d = diagnoseStep(parseEquation(raw)!, n);
    expect(d.id).toBe(id);
    expect(d.basis).toBe("step");
  });
  it("unrecognised step shapes fall back to the implied value, say so, and lower confidence", () => {
    const d = diagnoseStep(parseEquation("6x = 50")!, n); // = 3x = 25 scaled ×2 → same line, recognised
    expect(d.id).toBe("SIGN_ERROR_INVERSE_OP");
    const e = diagnoseStep(parseEquation("2x + 1 = 9")!, n);
    expect(e.basis).toBe("implied-value");
    expect(e.evidence).toMatch(/not recognised/);
  });
  it("the check shown for 3x = 25 uses the student's own line, not x = 25/3", async () => {
    const r = await first("I'm sure 3x = 25 is right");
    expect(r.utterance).toMatch(/25 \+ 5 = 30, not 20/);
    expect(r.utterance).not.toMatch(/25\/3/);
  });
});

describe("AUDIT #2/#3 — multi-clause answers and flawed reasoning", () => {
  it("grades the answer clause, and checks the reasoning clause separately", async () => {
    const r = await first("x = 5 because 20 divided by 4 is 5");
    expect(r.trace.decision.rule).toBe("R17_CORRECT_BUT_FLAWED_REASONING");
    expect(r.trace.validation?.claims?.[0]).toMatchObject({ ok: false });
    expect(r.state.mastery.observations[0]).toMatchObject({ assisted: true, note: "correct answer, invalid stated reasoning" });
  });
  it("sound reasoning is accepted as independent evidence", async () => {
    const r = await first("x = 5 because 20 - 5 = 15 and 15 / 3 = 5");
    expect(r.trace.decision.rule).toBe("R1_GUIDED_SOLVED");
    expect(r.state.mastery.observations[0]).toMatchObject({ assisted: false, kind: "pre-check" });
  });
});

describe("AUDIT #4–#8 — the tutor answers what the student actually said", () => {
  it.each([
    ["I'm confused", "R8b_CONFUSED_SMALLER_STEP"],
    ["Why do we subtract 5?", "R18_CONCEPT_WHY_INVERSE_CONSTANT"],
    ["Can we divide first?", "R18_CONCEPT_ORDER"],
    ["I don't understand negative numbers", "R18_CONCEPT_NEGATIVES"],
    ["what is 3 times 5", "R21_ARITHMETIC_HANDBACK"],
    ["I think your answer is wrong", "R19_DISPUTE_NOTHING_SHOWN"],
    ["3x + = 20", "R20_MALFORMED_MATH"],
    ["What's the capital of France?", "R13_REDIRECT"],
    ["how do I start?", "R8_HELP_BEFORE_TRYING"],
  ])("%s → %s", async (text, rule) => {
    const r = await first(text);
    expect(r.trace.decision.rule).toBe(rule);
  });
  it("a question about arithmetic is never diagnosed as a misconception", async () => {
    const r = await first("what is 3 times 5");
    expect(r.trace.diagnosis).toBeUndefined();
  });
  it("malformed maths is not counted as an attempt and leaves the board alone", async () => {
    const r = await first("3x + = 20");
    expect(r.state.attempts).toBe(0);
    expect(r.state.board).toHaveLength(1);
  });
  it("the divide-first answer states a true, valid equation", async () => {
    const r = await first("Can we divide first?");
    expect(r.utterance).toContain("x + 5/3 = 20/3");
  });
  it("intent: 'is it 5?' is a tentative answer; 'I got 5' is an answer", () => {
    expect(classifyIntent("is it 5?")).toMatchObject({ kind: "ANSWER", value: "5", tentative: true });
    expect(classifyIntent("I got 5")).toMatchObject({ kind: "ANSWER", value: "5" });
  });
});

describe("AUDIT #9 — board notes say what was actually checked", () => {
  it("invalid steps are compared with the latest valid line", async () => {
    const r = await first("x = 12", ["3x = 15"]);
    const last = r.state.board[r.state.board.length - 1];
    expect(last.note).toBe("doesn't make 3x + 5 = 20 true");
    const r2 = await first("3x = 25");
    expect(r2.state.board.find((b) => b.latex === "3x = 25")?.note).toBe("not equivalent to 3x + 5 = 20");
  });
});

describe("AUDIT #10 — no fabricated cost or model usage", () => {
  it("deterministic mode reports zero model calls and unknown (null) cost, not $0", async () => {
    const res = await runScenario(SCENARIOS[0], teacher, "tutor-v1");
    const m = computeMetrics([res]);
    expect(m.modelCalls).toBe(0);
    expect(m.costUsd).toBeNull();
    expect(res.traces.flatMap((t) => t.llmCalls).every((c) => c.kind !== "model" && c.costUsd === null)).toBe(true);
  });
});

describe("AUDIT #11 — no mastery status without evidence", () => {
  it("guided success alone is 'insufficient evidence'", async () => {
    const r = await first("x = 5");
    expect(r.state.mastery.status).toBe("insufficient_evidence");
  });
});

describe("normalisation regression: 15 = 3x", () => {
  it("is oriented so the next move is dividing, not 'subtract 15'", async () => {
    let s = createSession({ sessionId: "o", seed: 1 });
    s = (await step(s, { type: "start" }, { teacher })).state;
    s = (await step(s, { type: "text", text: "15 = 3x", via: "keyboard" }, { teacher })).state;
    const ctx = buildContext(s);
    expect(ctx.next.operation).toBe("divide both sides by 3");
  });
});
