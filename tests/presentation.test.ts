/**
 * v3: observed operations, note anchoring/focus, and diagnostic humility.
 */
import { describe, expect, it } from "vitest";
import { parseEquation } from "@/engine/algebra";
import { observeOperation } from "@/engine/observe";
import { createSession, step } from "@/engine/engine";
import { DeterministicTeacher } from "@/engine/llm/teacher";
import { CONFIDENCE, diagnoseStep, diagnoseValue, normalize } from "@/engine/misconceptions";
import { runSuite } from "@/engine/eval/runner";
import { Fraction } from "@/engine/fraction";
import { lineTerms } from "@/lib/terms";

const eq = (s: string) => parseEquation(s)!;
const teacher = new DeterministicTeacher();

describe("observed operations (facts, computed from two lines)", () => {
  it.each([
    ["3x + 5 = 20", "3x = 15", "− 5 on both sides", true],
    ["3x = 15", "x = 5", "÷ 3 on both sides", true],
    ["3x + 5 = 20", "3x = 25", "left: − 5 · right: + 5", false],
    ["3x + 5 = 20", "3x = 20", "left: − 5 · right: unchanged", false],
    ["8x - 12 = 68", "8x = 80", "+ 12 on both sides", true],
    ["3x + 5 = 20", "x + 5/3 = 20/3", "÷ 3 on both sides", true],
  ])("%s → %s: %s", (a, b, summary, same) => {
    const o = observeOperation(eq(a), eq(b));
    expect(o.summary).toBe(summary);
    expect(o.sameOnBoth).toBe(same);
  });
  it("handles the x-term moving to the other side", () => {
    const o = observeOperation(eq("3x + 5 = 20"), eq("15 = 3x"));
    expect(o.swapped).toBe(true);
    expect(o.sameOnBoth).toBe(true);
  });
  it("describes changes it can't name as a plain before → after", () => {
    const o = observeOperation(eq("3x + 5 = 20"), eq("8x = 20"));
    expect(o.left.kind).toBe("other");
    expect(o.leftText).toBe("3x + 5 → 8x");
  });
});

describe("observed vs inferred in the engine", () => {
  it("a wrong step records the observed operation on the board AND keeps the misconception a hedged hypothesis", async () => {
    let s = createSession({ sessionId: "p" });
    s = (await step(s, { type: "start" }, { teacher })).state;
    const r = await step(s, { type: "text", text: "3x = 25", via: "keyboard" }, { teacher });
    const entry = r.state.board.find((b) => b.raw === "3x = 25")!;
    expect(entry.observed?.summary).toBe("left: − 5 · right: + 5");
    expect(r.trace.validation?.observed?.sameOnBoth).toBe(false);
    expect(r.trace.diagnosis?.evidence).toMatch(/^Observed: .*Consistent with/);
    expect(r.trace.diagnosis?.alternatives?.length).toBeGreaterThan(0);
    expect(r.trace.diagnosis!.confidence).toBeLessThanOrEqual(CONFIDENCE.stepUnique);
  });
  it("no diagnosis ever claims more than 0.7 confidence; value-only matches stay ≤ 0.55", () => {
    const n = normalize(eq("3x + 5 = 20"));
    for (const v of ["25/3", "15", "45", "12", "5/2", "5/3", "20/3", "1/5", "6", "8"]) {
      const [a, b] = v.split("/").map(Number);
      expect(diagnoseValue(new Fraction(a, b ?? 1), n).confidence).toBeLessThanOrEqual(0.55);
    }
    for (const raw of ["3x = 25", "3x = 20", "8x = 20", "x + 5 = 20/3", "3x = 14", "2x + 1 = 9"]) {
      expect(diagnoseStep(eq(raw), n).confidence).toBeLessThanOrEqual(0.7);
    }
  });
  it("student-facing text never names a misconception label", async () => {
    const res = await runSuite(teacher, "tutor-v1");
    const labels = ["misconception", "SIGN_ERROR", "COMBINED_UNLIKE", "inverse operation"];
    for (const t of res.results.flatMap((r) => r.traces)) for (const l of labels) expect(t.utterance.toLowerCase()).not.toContain(l.toLowerCase());
  });
});

describe("tutor notes are anchored to the line they're about, with the terms in focus", () => {
  it("a hint to subtract 5 sits beside 3x + 5 = 20 and points at + 5 and 20", async () => {
    let s = createSession({ sessionId: "a" });
    s = (await step(s, { type: "start" }, { teacher })).state;
    s = (await step(s, { type: "text", text: "x = 8", via: "keyboard" }, { teacher })).state;
    s = (await step(s, { type: "text", text: "I added 3 and 5", via: "keyboard" }, { teacher })).state;
    const r = await step(s, { type: "text", text: "3x = 25", via: "keyboard" }, { teacher });
    const note = r.state.transcript[r.state.transcript.length - 1];
    expect(note.rule).toMatch(/_L2$/);
    expect(note.anchor).toBe("p0-given");
    expect(note.focus).toEqual(["constant", "other-side"]);
    const terms = lineTerms("3x + 5 = 20");
    expect([...terms.left, ...terms.right].filter((t) => note.focus!.includes(t.role)).map((t) => `${t.op}${t.latex}`)).toEqual(["+5", "20"]);
  });
  it("a check of the student's own line is anchored to that line", async () => {
    let s = createSession({ sessionId: "b" });
    s = (await step(s, { type: "start" }, { teacher })).state;
    s = (await step(s, { type: "text", text: "3x = 25", via: "keyboard" }, { teacher })).state;
    const r = await step(s, { type: "text", text: "I'm sure 3x = 25 is right", via: "keyboard" }, { teacher });
    const note = r.state.transcript[r.state.transcript.length - 1];
    const line = r.state.board.find((b) => b.raw === "3x = 25")!;
    expect(note.anchor).toBe(line.id);
  });
  it("after solving, the next instruction sits beside the fresh problem", async () => {
    let s = createSession({ sessionId: "c" });
    s = (await step(s, { type: "start" }, { teacher })).state;
    const r = await step(s, { type: "text", text: "x = 5", via: "keyboard" }, { teacher });
    const note = r.state.transcript[r.state.transcript.length - 1];
    expect(note.anchor).toBe(`${r.state.problems[1].id}-given`);
  });
  it("term splitting keeps the student's own form", () => {
    expect(lineTerms("13 + 7x = 41").left.map((t) => t.role)).toEqual(["constant", "x-term"]);
    expect(lineTerms("15 = 3x").left.map((t) => t.role)).toEqual(["other-side"]);
    expect(lineTerms("8x - 12 = 68").left[1]).toMatchObject({ op: "−", role: "constant" });
  });
});
