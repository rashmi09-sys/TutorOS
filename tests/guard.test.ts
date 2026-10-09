import { describe, expect, it } from "vitest";
import { guardUtterance, type GuardSpec } from "@/engine/guard";
import { Fraction } from "@/engine/fraction";
import { renderTemplate, TEMPLATE_KEYS } from "@/engine/language/templates";

const spec = (o: Partial<GuardSpec> = {}): GuardSpec => ({
  answer: new Fraction(5),
  problemText: "3x + 5 = 20",
  nextStepRaw: "3x = 15",
  revealAllowed: false,
  nextStepAllowed: false,
  groundedEquations: ["3x + 5 = 20"],
  ...o,
});

describe("output guard", () => {
  it("blocks answer leaks in symbols and in words", () => {
    expect(guardUtterance("So x = 5, well done.", spec()).violations[0].type).toBe("ANSWER_LEAK");
    expect(guardUtterance("The answer is five.", spec()).violations.map((v) => v.type)).toContain("ANSWER_LEAK");
    expect(guardUtterance("x would be 5 here", spec()).ok).toBe(false);
  });
  it("allows the answer when policy permits it", () => {
    expect(guardUtterance("So x = 5, well done.", spec({ revealAllowed: true })).ok).toBe(true);
  });
  it("blocks the next step result before the hint ladder allows it", () => {
    expect(guardUtterance("Subtract 5 to get 3x = 15. Now what?", spec()).violations[0].type).toBe("STEP_LEAK");
    expect(guardUtterance("Subtract 5 to get 3x = 15. Now what?", spec({ nextStepAllowed: true })).ok).toBe(true);
  });
  it("catches false arithmetic (hallucinated maths)", () => {
    expect(guardUtterance("Check: 3 × 8 + 5 = 28, not 20.", spec()).violations[0].type).toBe("FALSE_ARITHMETIC");
    expect(guardUtterance("Check: 3 × 8 + 5 = 29, not 20.", spec()).ok).toBe(true);
  });
  it("catches equations that are neither the student's nor true", () => {
    expect(guardUtterance("Remember 2x = 9 here.", spec()).violations[0].type).toBe("UNGROUNDED_EQUATION");
  });
  it("lets the tutor quote the student's own wrong equation", () => {
    expect(guardUtterance("You wrote 3x = 25 — let's test it.", spec({ groundedEquations: ["3x + 5 = 20", "3x = 25"] })).ok).toBe(true);
  });
  it("number coincidences are not leaks (the 5 in '+ 5' is not 'x = 5')", () => {
    expect(guardUtterance("What undoes the + 5 in 3x + 5 = 20?", spec()).ok).toBe(true);
  });
  it("enforces short turns", () => {
    expect(guardUtterance("word ".repeat(80), spec()).violations[0].type).toBe("TOO_LONG");
  });
  it("every template is defined and renders non-empty text", () => {
    const vars: Record<string, string> = {
      problem: "3x + 5 = 20", current: "3x + 5 = 20", lead: "Correct.", followup: "Lesson complete!", nextOp: "subtract 5 from both sides", nextResult: "3x = 15",
      concept: "x is a number we don't know yet.", step: "3x = 15", value: "8", check: "if x = 8, then 3 × 8 + 5 = 29, not 20", focus: "Undo the + 5.", probe: "What undoes + 5?",
      opsQuestion: "which would you undo first?", last: "Hi.", worked: "First, subtract 5.", raw: "3x + = 20", prev: "3x + 5 = 20", op: "subtract 5 from both sides", result: "3x = 15", arith: "20 − 5 = 15",
      flaw: "the 4 doesn't come from the equation", nextProblem: "13 + 7x = 41", micro: "Look at the left side.", part: "why we start with the + 5", opText: "Yes. Subtracting 5 undoes the + 5. What does the equation become?",
    };
    for (const k of TEMPLATE_KEYS) {
      const out = renderTemplate(k, vars, 0);
      expect(out.length, k).toBeGreaterThan(0);
      expect(out, k).not.toMatch(/\{\w+\}/); // no unfilled placeholders
    }
  });
});
