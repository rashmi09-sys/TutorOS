import { describe, expect, it } from "vitest";
import { assistedCompletion, initialMastery, observe } from "@/engine/mastery";

describe("mastery (BKT)", () => {
  it("one correct answer is never mastery", () => {
    const m = observe(initialMastery(), "p0", true, false);
    expect(m.status).not.toBe("mastered");
  });
  it("requires two consecutive independent transfer successes", () => {
    let m = observe(initialMastery(), "p0", true, false);
    m = observe(m, "t1", true, true);
    expect(m.status).toBe("insufficient_evidence"); // one fresh problem isn't enough evidence either way
    m = observe(m, "t2", true, true);
    expect(m.status).toBe("mastered");
  });
  it("assisted completion raises the estimate a little but resets the streak", () => {
    let m = observe(initialMastery(), "t1", true, true);
    const before = m.pKnown;
    m = assistedCompletion(m, "t2");
    expect(m.pKnown).toBeGreaterThan(before);
    expect(m.consecutiveUnassisted).toBe(0);
  });
  it("an error lowers the estimate", () => {
    expect(observe(initialMastery(), "p0", false, false).pKnown).toBeLessThan(0.3);
  });
  it("reports insufficient evidence until two independent fresh attempts exist", () => {
    let m = observe(initialMastery(), "p0", true, false); // pre-check only
    expect(m.status).toBe("insufficient_evidence");
    m = observe(m, "t1", false, true);
    expect(m.status).toBe("insufficient_evidence");
    m = observe(m, "t2", true, true);
    expect(m.status).toBe("developing");
  });
  it("assisted completions never count toward the independent streak", () => {
    let m = observe(initialMastery(), "t1", true, true);
    m = assistedCompletion(m, "t2");
    m = observe(m, "t3", true, true);
    expect(m.consecutiveUnassisted).toBe(1);
    expect(m.status).not.toBe("mastered");
  });
});
