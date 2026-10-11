import { describe, expect, it } from "vitest";
import { createSession, step } from "@/engine/engine";
import { DeterministicTeacher } from "@/engine/llm/teacher";
import type { SessionState } from "@/engine/types";
import { problemEvidence } from "@/lib/evidence";

/**
 * The Grade 7 journey the lesson is built around, driven through the real engine with the deterministic
 * teacher: 3x + 5 = 20 with a plausible mistake, a hint, an equivalent correct line, the solution, then
 * 4x + 3 = 19 on the student's own, then the recorded evidence.
 */
const teacher = new DeterministicTeacher();
let n = 0;
async function say(s: SessionState, text: string) {
  return step(s, { type: "text", text, via: "keyboard", id: `evt_j${++n}` }, { teacher });
}
async function begin() {
  const s = createSession({ sessionId: `journey-${++n}` });
  return (await step(s, { type: "start", id: `evt_s${n}` }, { teacher })).state;
}
const currentText = (s: SessionState) => s.problems[s.current].text;

describe("algebra journey: 3x + 5 = 20, then 4x + 3 = 19 on your own", () => {
  it("a wrong first step gets a hint that doesn't give the answer away; the line is marked, not accepted", async () => {
    const s = await begin();
    expect(currentText(s)).toBe("3x + 5 = 20");
    const r = await say(s, "3x = 25");
    expect(["HINT", "ASK", "EXPLAIN"]).toContain(r.trace.decision.action);
    expect(r.utterance).not.toMatch(/x\s*=\s*5\b/);
    expect(r.state.board.filter((b) => b.status === "invalid")).toHaveLength(1);
    expect(r.state.board.some((b) => b.status === "valid" || b.status === "final")).toBe(false);
  });

  it("accepts mathematically equivalent correct lines, not one fixed wording", async () => {
    for (const line of ["3x = 15", "15 = 3x", "3x=15", "three x equals fifteen"]) {
      const r = await say(await begin(), line);
      expect(r.state.board.filter((b) => b.status === "valid"), line).toHaveLength(1);
    }
    for (const line of ["x = 5", "5 = x", "x=5.0"]) {
      const r = await say(await begin(), line);
      // A bare answer is checked exactly; it is right, so it is never marked as a wrong line.
      expect(r.state.board.filter((b) => b.status === "invalid"), line).toHaveLength(0);
    }
  });

  it("an unexpected message doesn't move the lesson or mark the board", async () => {
    const s = await begin();
    const r = await say(s, "what is your favourite colour");
    expect(r.state.current).toBe(0);
    expect(r.state.board).toHaveLength(s.board.length);
    expect(r.utterance.length).toBeGreaterThan(0);
  });

  it("full journey: mistake → targeted question → correction → solved → 4x + 3 = 19 assessed independently → evidence", async () => {
    let s = await begin();
    s = (await say(s, "3x = 25")).state;
    s = (await say(s, "15 = 3x")).state;
    const solved = await say(s, "x = 5");
    s = solved.state;
    expect(solved.trace.decision.action).toBe("ASSESS");
    expect(s.current).toBe(1);
    expect(currentText(s)).toBe("4x + 3 = 19");
    expect(s.problems[1].role).toBe("transfer");

    // The fresh problem: a wrong attempt first is recorded as "not right", even though it is fixed afterwards.
    const wrong = await say(s, "4x = 22");
    expect(wrong.state.board.filter((b) => b.problemId === s.problems[1].id && b.status === "invalid")).toHaveLength(1);

    // A clean run on a second session: right first time, no help.
    let t = await begin();
    t = (await say(t, "3x = 15")).state;
    t = (await say(t, "x = 5")).state;
    t = (await say(t, "4x = 16")).state;
    const graded = await say(t, "x = 4");
    t = graded.state;
    expect(graded.trace.decision.action).toBe("ASSESS");
    const ev = problemEvidence(t);
    expect(ev[0]).toMatchObject({ text: "3x + 5 = 20", role: "guided", solved: true, firstTry: null, independent: false });
    expect(ev[1]).toMatchObject({ text: "4x + 3 = 19", role: "transfer", solved: true, firstTry: "right", independent: true, hints: 0, wrongLines: 0 });
    expect(ev[1].steps.length).toBeGreaterThanOrEqual(2);

    // The session with the mistake on 3x + 5 = 20 records it there, and only there.
    const evS = problemEvidence(wrong.state);
    expect(evS[0].wrongLines).toBe(1);
    // The first error got a targeted question (the student found the fix), which is not counted as a hint.
    expect(evS[0].hints).toBe(0);
    expect(evS[0].noticed.length).toBe(1);
    expect(evS[1].firstTry).toBe("not right");
    expect(evS[1].independent).toBe(false);
  });

  it("asking for help on the fresh problem is recorded honestly: not counted as independent", async () => {
    let s = await begin();
    s = (await say(s, "3x = 15")).state;
    s = (await say(s, "x = 5")).state;
    s = (await say(s, "I'm stuck")).state;
    s = (await say(s, "4x = 16")).state;
    s = (await say(s, "x = 4")).state;
    const ev = problemEvidence(s)[1];
    expect(ev.text).toBe("4x + 3 = 19");
    expect(ev.independent).toBe(false);
    expect(ev.firstTry).not.toBe("right");
    expect(ev.hints).toBeGreaterThanOrEqual(1);
  });
});
