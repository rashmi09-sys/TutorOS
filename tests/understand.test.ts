/**
 * Understanding moves described in words, and verifying them exactly.
 *
 *  - interpretDeterministic: everyday language → structured meaning, relative to the current equation
 *  - checkOperation: the exact verdict on that meaning (the only thing that decides if a move is right)
 *  - the conversation: memory, repeats, corrections and repair across turns
 *
 * Includes the regression for the reported failure (BODMAS multiplication → generic redirect).
 */
import { describe, expect, it } from "vitest";
import { checkOperation, interpretDeterministic, type MeaningContext } from "@/engine/understand";
import { normalize } from "@/engine/misconceptions";
import { parseEquation } from "@/engine/algebra";
import { createSession, step } from "@/engine/engine";
import { DeterministicTeacher } from "@/engine/llm/teacher";
import { statesAnswer } from "@/engine/eval/scenarios";
import type { SessionState } from "@/engine/types";

const N = (eq: string) => normalize(parseEquation(eq)!);
const E = N("3x + 5 = 20");
const read = (t: string, n = E, cx: MeaningContext = {}) => interpretDeterministic(t, n, cx);
const verdict = (t: string, n = E, cx: MeaningContext = {}) => {
  const m = read(t, n, cx);
  return m?.operation ? checkOperation(m.operation, n).verdict : null;
};

describe("interpretDeterministic: what the student meant", () => {
  it.each([
    ["I will do BODMAS multiplication.", "multiply", null, "evaluate", true],
    ["I said will do multiplication.", "multiply", null, "evaluate", false],
    ["I'll do multiplication first.", "multiply", null, "evaluate", true], // "multiplication first" is the order-of-operations idea
    ["BODMAS says multiplication.", "multiply", null, "evaluate", true],
    ["Shouldn't we multiply before adding?", "multiply", null, "evaluate", true],
    ["Take five away.", "subtract", "5", "plain", false],
    ["Move the five to the other side.", "subtract", "5", "move", false],
    ["Subtract five from both sides.", "subtract", "5", "plain", false],
    ["undo the addition", "subtract", "5", "undo", false],
    ["divide by 3", "divide", "3", "plain", false],
    ["Can we divide by three?", "divide", "3", "plain", false],
    ["I will do bod mass", "multiply", null, "evaluate", true], // speech-recognition spelling
  ])("%s → %s %s (%s)", (text, kind, operand, framing, bodmas) => {
    const m = read(text)!;
    expect(m).not.toBeNull();
    expect(m.operation?.kind).toBe(kind);
    expect(m.operation?.operand).toBe(operand);
    expect(m.operation?.framing).toBe(framing);
    expect(m.mentionsOrderOfOperations).toBe(bodmas);
    expect(m.source).toBe("lexicon");
  });

  it("an inferred number is marked as inferred, a said one as stated", () => {
    expect(read("take it away")?.operation?.operandSource ?? read("subtract")?.operation?.operandSource).toBe("inferred");
    expect(read("subtract 5")?.operation?.operandSource).toBe("stated");
  });

  it("multiplication is never given a number the student didn't say", () => {
    expect(read("I'll do multiplication")?.operation?.operand).toBeNull();
  });

  it("reads sides, questions and corrections", () => {
    expect(read("subtract 5 from the left side")?.operation?.sides).toBe("left");
    expect(read("minus 5 on both sides")?.operation?.sides).toBe("both");
    expect(read("Why can't we multiply?")?.act).toBe("why_not_operation");
    expect(read("Can we divide by three?")?.isQuestion).toBe(true);
    expect(read("No, I meant subtract.")?.isCorrection).toBe(true);
    expect(read("I said will do multiplication.")?.isCorrection).toBe(true);
  });

  it("pointing at a part is not an operation", () => {
    expect(read("the 5 first")).toMatchObject({ act: "choose_part", part: "constant", operation: null });
    expect(read("multiplication", E, { awaiting: "choose_part" })).toMatchObject({ act: "choose_part", part: "coefficient" });
    expect(read("the addition", E, { awaiting: "choose_part" })).toMatchObject({ act: "choose_part", part: "constant" });
  });

  it("leaves other kinds of message to other layers", () => {
    expect(read("what is 20 minus 5?")).toBeNull(); // arithmetic to work out
    expect(read("I added the 3 and the 5")).toBeNull(); // explaining past work
    expect(read("I'm confused")).toBeNull();
    expect(read("minus 3")).toBeNull(); // a signed answer, not "subtract 3"
    expect(read("minus 3", E, { awaiting: "operation" })?.operation?.kind).toBe("subtract");
  });
});

describe("checkOperation: exact verdicts", () => {
  it.each([
    ["I will do BODMAS multiplication.", "evaluation_order"],
    ["Why can't we multiply?", "evaluation_order"],
    ["Take five away.", "correct_next"],
    ["Move the five to the other side.", "correct_next"],
    ["Subtract five from both sides.", "correct_next"],
    ["No, I meant subtract.", "correct_next"],
    ["add 5 to both sides", "wrong_inverse"],
    ["subtract 5 from the left side", "one_side"],
    ["divide by 3", "divide_first"],
    ["subtract 7", "valid_unhelpful"],
  ])("3x + 5 = 20: %s → %s", (text, v) => expect(verdict(text)).toBe(v));

  it("the resulting equation is computed exactly, not described", () => {
    const m = read("add 5 to both sides")!;
    expect(checkOperation(m.operation!, E).result).toBe("3x + 10 = 25");
  });

  it("works on other equations: negative constants, constant first, no constant", () => {
    const neg = N("2x - 7 = 9");
    expect(verdict("add 7 to both sides", neg)).toBe("correct_next");
    expect(verdict("subtract 7", neg)).toBe("wrong_inverse");
    expect(verdict("move the 7 to the other side", neg)).toBe("correct_next");
    const first = N("13 + 7x = 41");
    expect(verdict("take away 13", first)).toBe("correct_next");
    expect(verdict("divide by 7", first)).toBe("divide_first");
    const none = N("4x = 12");
    expect(verdict("divide both sides by 4", none)).toBe("correct_next");
    expect(verdict("multiply both sides by 4", none)).toBe("wrong_inverse");
  });
});

/* ---------------- The conversation ---------------- */

const teacher = new DeterministicTeacher();
const GENERIC = [/park that for later/i, /let'?s stay with/i, /what'?s your next move/i];
const questions = (u: string) => (u.match(/\?/g) ?? []).length;

async function start() {
  const s = createSession({ sessionId: "understand", seed: 7 });
  return (await step(s, { type: "start" }, { teacher })).state;
}
async function talk(s: SessionState, ...lines: string[]) {
  const out = [];
  for (const text of lines) {
    const r = await step(s, { type: "text", text, via: "voice" }, { teacher });
    s = r.state;
    out.push(r);
  }
  return { s, out };
}

describe("regression: the reported BODMAS conversation", () => {
  it("recognises the multiplication proposal, explains BODMAS vs undoing, and points at the + 5 with one question", async () => {
    const { out } = await talk(await start(), "I'm stuck", "I will do BODMAS multiplication.");
    const r = out[1];
    expect((r.trace.intent as { kind?: string } | undefined)?.kind).toBe("OPERATION");
    expect(r.trace.opCheck?.verdict).toBe("evaluation_order");
    expect(r.trace.decision.rule).toBe("R31_OP_EVALUATION_ORDER");
    expect(r.utterance).toMatch(/multiplication/i);
    expect(r.utterance).toMatch(/BODMAS/);
    expect(r.utterance).toMatch(/\+ 5/);
    expect(questions(r.utterance)).toBe(1);
    for (const g of GENERIC) expect(r.utterance).not.toMatch(g);
    expect(r.trace.diagnosis?.id).toBe("EVALUATION_ORDER_CONFUSION");
  });

  it("“I said will do multiplication.” → acknowledges it heard them, connects to 3 times x, asks what undoes adding 5", async () => {
    const { out, s } = await talk(await start(), "I'm stuck", "I will do BODMAS multiplication.", "I said will do multiplication.");
    const r = out[2];
    expect(r.trace.decision.rule).toBe("R31b_OP_EVALUATION_ORDER_REPAIR");
    expect(r.trace.context?.repeat).toBe(true);
    expect(r.utterance).toMatch(/heard you say multiplication/i);
    expect(r.utterance).toMatch(/3 times x/);
    expect(r.utterance).toMatch(/What operation undoes adding 5\?$/);
    expect(questions(r.utterance)).toBe(1);
    expect(r.utterance).not.toBe(out[1].utterance);
    for (const g of GENERIC) expect(r.utterance).not.toMatch(g);
    // Nothing was solved or written for the student.
    expect(s.phase).toBe("GUIDED");
    expect(s.board.length).toBe(1);
  });

  it("the third time, the tutor stops re-explaining and names the move — still without doing the step", async () => {
    const { out } = await talk(await start(), "multiply", "multiply", "multiply");
    expect(out.map((r) => r.trace.decision.rule)).toEqual(["R31_OP_EVALUATION_ORDER", "R31b_OP_EVALUATION_ORDER_REPAIR", "R39_OP_REPEATED_NAME_MOVE"]);
    expect(out[2].utterance).toMatch(/subtracting 5 from both sides/);
    expect(out[2].utterance).not.toMatch(/3x = 15/);
    expect(new Set(out.map((r) => r.utterance)).size).toBe(3);
  });

  it("after the redirect, the right move is confirmed and the student does the step", async () => {
    const { out, s } = await talk(await start(), "I will do BODMAS multiplication.", "subtract 5", "3x = 15");
    expect(out[1].trace.decision.rule).toBe("R30_OP_RIGHT_MOVE");
    expect(out[1].utterance).not.toMatch(/3x = 15/); // the student writes the result, not the tutor
    expect(out[2].trace.decision.rule).toBe("R2_VALID_STEP");
    expect(s.lastValidRaw).toBe("3x = 15");
  });
});

describe("conversation memory and repair", () => {
  it("“Take five away.” is a move, not the answer 5 — nothing is solved", async () => {
    const { out, s } = await talk(await start(), "Take five away.");
    expect((out[0].trace.intent as { kind?: string } | undefined)?.kind).toBe("OPERATION");
    expect(out[0].trace.decision.rule).toBe("R30_OP_RIGHT_MOVE");
    expect(s.phase).toBe("GUIDED");
    expect(statesAnswer(out[0].utterance, "5")).toBe(false);
  });

  it("a correction names what changed and is verified like any move", async () => {
    const { out } = await talk(await start(), "I'll do multiplication first.", "No, I meant subtract.");
    expect(out[1].trace.context?.correction).toBe(true);
    expect(out[1].utterance).toMatch(/^Got it: subtract, not multiply\./);
    expect(out[1].trace.opCheck?.verdict).toBe("correct_next");
  });

  it("records what the tutor is waiting for and its last question", async () => {
    const { s } = await talk(await start(), "I'm stuck");
    expect(s.dialog?.awaiting).toBe("choose_part");
    expect(s.dialog?.lastQuestion).toMatch(/Which one would you undo first\?/);
    const { out } = await talk(s, "multiplication");
    expect(out[0].trace.decision.rule).toBe("R38_PART_COEFFICIENT_FIRST"); // read as the answer to that question
  });

  it("“Wait, why?” after the BODMAS explanation answers about the + 5, not a generic redirect", async () => {
    const { out } = await talk(await start(), "I will do BODMAS multiplication.", "Wait, why?");
    expect(out[1].trace.decision.rule).toMatch(/^R18_CONCEPT/);
    for (const g of GENERIC) expect(out[1].utterance).not.toMatch(g);
  });

  it("frustration is met with help, not “park that for later”", async () => {
    const { out } = await talk(await start(), "this is stupid I hate this");
    expect(out[0].trace.decision.rule).toMatch(/^R8|^R9/);
    for (const g of GENERIC) expect(out[0].utterance).not.toMatch(g);
  });

  it("wrong inverse and one side only are shown with exact consequences", async () => {
    const { out } = await talk(await start(), "add 5 to both sides", "subtract 5 from the left side");
    expect(out[0].utterance).toMatch(/3x \+ 10 = 25/);
    expect(out[1].trace.decision.rule).toBe("R34_OP_ONE_SIDE");
    expect(out[1].utterance).toMatch(/right side/);
  });

  it("each event id is applied exactly once (voice resend, double tap)", async () => {
    const s0 = await start();
    const ev = { type: "text" as const, text: "I will do BODMAS multiplication.", via: "voice" as const, id: "ev-1" };
    const a = await step(s0, ev, { teacher });
    const b = await step(a.state, ev, { teacher });
    expect(b.duplicate).toBe(true);
    expect(b.state.turn).toBe(a.state.turn);
  });

  it("voice and typing take the same path", async () => {
    const s0 = await start();
    const v = await step(s0, { type: "text", text: "Take five away.", via: "voice" }, { teacher });
    const k = await step(s0, { type: "text", text: "Take five away.", via: "keyboard" }, { teacher });
    expect(v.trace.decision.rule).toBe(k.trace.decision.rule);
    expect(v.utterance).toBe(k.utterance);
  });
});
