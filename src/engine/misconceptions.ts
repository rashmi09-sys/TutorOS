import { Fraction } from "./fraction";
import { parseEquation, sameLine, solve, type Equation } from "./algebra";

/**
 * Misconception taxonomy for two-step linear equations.
 *
 * Classification is *deterministic*: each misconception is a buggy procedure
 * we can execute. If the student's (implied) value matches exactly one buggy
 * procedure we have strong evidence; if it matches none we say so and PROBE
 * ("how did you get 8?") instead of inventing a diagnosis.
 *
 * Grounded in the well-documented algebra error literature (inverse-operation
 * sign errors, "3x means 3 + x", treating the equation as a computation rather
 * than a balance), but the ids below are our own.
 */
export type MisconceptionId =
  | "SIGN_ERROR_INVERSE_OP"
  | "FORGOT_TO_DIVIDE"
  | "MULTIPLIED_INSTEAD_OF_DIVIDING"
  | "COEFFICIENT_AS_ADDEND"
  | "COMBINED_UNLIKE_TERMS"
  | "UNDID_IN_WRONG_ORDER"
  | "ONE_SIDE_ONLY"
  | "INVERTED_DIVISION"
  | "EVALUATION_ORDER_CONFUSION"
  | "ARITHMETIC_SLIP"
  | "UNCLASSIFIED";

export type MisconceptionCategory = "conceptual" | "procedural" | "slip" | "unknown";

export interface MisconceptionInfo {
  id: MisconceptionId;
  label: string; // student-safe, plain language
  category: MisconceptionCategory;
  /** What the tutor should help the student notice — never the answer. */
  focus: string;
  /** A targeted probing question. {b} {a} {c} are filled from the current equation. */
  probe: string;
}

export const MISCONCEPTIONS: Record<MisconceptionId, MisconceptionInfo> = {
  SIGN_ERROR_INVERSE_OP: {
    id: "SIGN_ERROR_INVERSE_OP",
    label: "Used the same operation instead of its inverse",
    category: "conceptual",
    focus: "To undo adding a number, you subtract it (and vice versa).",
    probe: "On the left we have {bSigned}. What operation would undo that?",
  },
  FORGOT_TO_DIVIDE: {
    id: "FORGOT_TO_DIVIDE",
    label: "Stopped before undoing the multiplication",
    category: "procedural",
    focus: "{a}x means {a} times x — that multiplication still needs undoing.",
    probe: "You found what {a}x equals. Is {a}x the same thing as x?",
  },
  MULTIPLIED_INSTEAD_OF_DIVIDING: {
    id: "MULTIPLIED_INSTEAD_OF_DIVIDING",
    label: "Multiplied where dividing was needed",
    category: "conceptual",
    focus: "To undo 'times {a}', you divide by {a}.",
    probe: "x is being multiplied by {a}. What undoes multiplying by {a}?",
  },
  COEFFICIENT_AS_ADDEND: {
    id: "COEFFICIENT_AS_ADDEND",
    label: "Read a number next to x as adding instead of multiplying",
    category: "conceptual",
    focus: "{a}x means {a} × x, not {a} + x.",
    probe: "What does {a}x mean — is it {a} plus x, or {a} times x?",
  },
  COMBINED_UNLIKE_TERMS: {
    id: "COMBINED_UNLIKE_TERMS",
    label: "Added the x-term and the plain number together",
    category: "conceptual",
    focus: "{a}x and {bAbs} are different kinds of things — like apples and coins — so they can't be added into one term.",
    probe: "If x were 2, would {a}x {bOp} {bAbs} be the same as {aPlusB}x? Try it.",
  },
  UNDID_IN_WRONG_ORDER: {
    id: "UNDID_IN_WRONG_ORDER",
    label: "Divided only part of one side",
    category: "procedural",
    focus: "Whatever you do to one side, you do to the *whole* of both sides.",
    probe: "When you divided, did every part of both sides get divided by {a}?",
  },
  EVALUATION_ORDER_CONFUSION: {
    id: "EVALUATION_ORDER_CONFUSION",
    label: "Used the order for working out an expression (BODMAS) to solve an equation",
    category: "conceptual",
    focus: "BODMAS is the order for working out a value; to solve, we undo what was done to x in reverse order, so the last thing done comes off first.",
    probe: "On the left we have {bSigned}. What operation would undo that?",
  },
    ONE_SIDE_ONLY: {
    id: "ONE_SIDE_ONLY",
    label: "Changed one side but not the other",
    category: "conceptual",
    focus: "An equation is a balance: both sides must change the same way.",
    probe: "You removed the {bAbs} from the left. What has to happen on the right to keep it balanced?",
  },
  INVERTED_DIVISION: {
    id: "INVERTED_DIVISION",
    label: "Divided the wrong way round",
    category: "procedural",
    focus: "{a}x = {cMinusB} means x is {cMinusB} shared into {a} equal parts.",
    probe: "If {a} groups of x make {cMinusB}, is x bigger or smaller than 1?",
  },
  ARITHMETIC_SLIP: {
    id: "ARITHMETIC_SLIP",
    label: "Right idea, small calculation slip",
    category: "slip",
    focus: "The method looks right — one calculation is off.",
    probe: "Your method looks right. Can you double-check your arithmetic?",
  },
  UNCLASSIFIED: {
    id: "UNCLASSIFIED",
    label: "Not sure yet — need to hear the reasoning",
    category: "unknown",
    focus: "Understand the student's reasoning before correcting it.",
    probe: "Interesting — can you walk me through how you got that?",
  },
};

export interface Diagnosis {
  id: MisconceptionId;
  category: MisconceptionCategory;
  confidence: number; // 0..1
  evidence: string;
  alsoMatches: MisconceptionId[];
  /** What the diagnosis is based on: the transformation written, a final value, the implied value of an unrecognised step, or the student's own words. */
  basis?: "step" | "value" | "implied-value" | "explanation";
  /** Other plausible explanations for the same observed work — a diagnosis is a hypothesis, not a finding. */
  alternatives?: string[];
}

/**
 * Confidence = how specifically the observed work matches this pattern, NOT the probability the
 * student holds this misconception. A step pattern is stronger evidence than a value (many routes
 * reach the same number); neither is confirmed until the student explains their thinking.
 * Calibrated conservatively; never shown to students.
 */
export const CONFIDENCE = { stepUnique: 0.7, stepAmbiguous: 0.45, valueUnique: 0.55, valueAmbiguous: 0.35, slip: 0.4, impliedValueFactor: 0.6 } as const;

export const ALTERNATIVES: Partial<Record<MisconceptionId, string>> = {
  SIGN_ERROR_INVERSE_OP: "a sign slip while writing (knows to subtract, wrote +)",
  ONE_SIDE_ONLY: "an unfinished step — meant to change the right side next",
  COMBINED_UNLIKE_TERMS: "a guess whose numbers happen to fit this pattern",
  FORGOT_TO_DIVIDE: "stopped early, intending to divide next",
  MULTIPLIED_INSTEAD_OF_DIVIDING: "a ×/÷ slip rather than a misunderstanding",
  COEFFICIENT_AS_ADDEND: "a subtraction slip",
  UNDID_IN_WRONG_ORDER: "meant to divide every term but missed one",
  INVERTED_DIVISION: "a slip in the order of the division",
  ARITHMETIC_SLIP: "a misunderstanding we haven't modelled",
};

/** Current equation normalised to  A·x + B = C. */
export interface Normal {
  A: Fraction;
  B: Fraction;
  C: Fraction;
}

export function normalize(eq: Pick<Equation, "lhs" | "rhs">): Normal {
  // Canonical orientation: the x-term on the left. "15 = 3x" must mean A=3, B=0, C=15,
  // otherwise the policy would tell the student to "subtract 15 from both sides".
  const swap = eq.lhs.a.isZero() && !eq.rhs.a.isZero();
  const lhs = swap ? eq.rhs : eq.lhs;
  const rhs = swap ? eq.lhs : eq.rhs;
  return { A: lhs.a.sub(rhs.a), B: lhs.b, C: rhs.b };
}

function safe(fn: () => Fraction | null): Fraction | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

const neg = (f: Fraction) => f.valueOf() < 0;
const abs = (f: Fraction) => (neg(f) ? f.neg() : f);
/** "20 + 5" / "68 − 12" — how C ± B reads when written out. */
const plusB = (C: Fraction, B: Fraction) => `${C} ${neg(B) ? "−" : "+"} ${abs(B)}`;
const minusB = (C: Fraction, B: Fraction) => `${C} ${neg(B) ? "+" : "−"} ${abs(B)}`;

/** The buggy procedures, each producing the value a student following it would reach, with evidence in the problem's own numbers. */
export function buggyValues(n: Normal): Array<{ id: MisconceptionId; value: Fraction | null; how: string }> {
  const { A, B, C } = n;
  const bAbs = abs(B);
  const added = neg(B) ? "subtracted" : "added"; // what the buggy route does to the right side
  const shouldHave = neg(B) ? "added" : "subtracted";
  const CmB = safe(() => C.sub(B));
  return [
    { id: "SIGN_ERROR_INVERSE_OP", value: B.isZero() ? null : safe(() => C.add(B).div(A)), how: `(${plusB(C, B)}) ÷ ${A} — the value you get by ${added === "added" ? "adding" : "subtracting"} ${bAbs} on the right instead of ${shouldHave === "added" ? "adding" : "subtracting"} it, then dividing.` },
    { id: "COMBINED_UNLIKE_TERMS", value: B.isZero() ? null : safe(() => C.div(A.add(B))), how: `${C} ÷ ${A.add(B)} — the value you get by combining ${A}x and ${bAbs} into ${A.add(B)}x.` },
    { id: "FORGOT_TO_DIVIDE", value: A.eq(1) ? null : CmB, how: `${B.isZero() ? `${C}` : `${minusB(C, B)} = ${CmB}`} — the value of ${A}x, as if the division by ${A} were skipped.` },
    { id: "MULTIPLIED_INSTEAD_OF_DIVIDING", value: A.eq(1) ? null : safe(() => C.sub(B).mul(A)), how: `${CmB} × ${A} — the value you get by multiplying by ${A} instead of dividing.` },
    { id: "COEFFICIENT_AS_ADDEND", value: A.eq(1) ? null : safe(() => C.sub(B).sub(A)), how: `${CmB} − ${A} — the value you get by subtracting ${A}, as if ${A}x meant ${A} + x.` },
    { id: "UNDID_IN_WRONG_ORDER", value: B.isZero() || A.eq(1) ? null : safe(() => C.div(A).sub(B)), how: `${C} ÷ ${A}, then ${neg(B) ? "+" : "−"} ${bAbs} — the value you get by dividing only part of the equation.` },
    { id: "ONE_SIDE_ONLY", value: B.isZero() ? null : safe(() => C.div(A)), how: `${C} ÷ ${A} — the value you get by removing ${neg(B) ? "−" : "+"} ${bAbs} from the left only.` },
    { id: "INVERTED_DIVISION", value: A.eq(1) ? null : safe(() => A.div(C.sub(B))), how: `${A} ÷ ${CmB} — the value you get by dividing the wrong way round.` },
  ];
}

function result(id: MisconceptionId, confidence: number, evidence: string, alsoMatches: MisconceptionId[] = [], basis: Diagnosis["basis"] = "value"): Diagnosis {
  const alternatives = [...alsoMatches.map((m) => MISCONCEPTIONS[m].label.toLowerCase()), ...(ALTERNATIVES[id] ? [ALTERNATIVES[id]!] : [])];
  return { id, category: MISCONCEPTIONS[id].category, confidence, evidence, alsoMatches, basis, alternatives };
}

/**
 * Diagnose a wrong FINAL VALUE (x = v) from the equation the student was working on.
 */
export function diagnoseValue(studentValue: Fraction, from: Normal): Diagnosis {
  const correct = from.C.sub(from.B).div(from.A);
  if (studentValue.eq(correct)) throw new Error("diagnoseValue called on a correct value");

  const matches = buggyValues(from).filter((c) => c.value && !c.value.eq(correct) && c.value.eq(studentValue));
  if (matches.length > 0) {
    const [first, ...rest] = matches;
    return result(first.id, rest.length === 0 ? CONFIDENCE.valueUnique : CONFIDENCE.valueAmbiguous, `Observed: x = ${studentValue}. Consistent with ${first.how}`, rest.map((r) => r.id));
  }
  // Arithmetic slip: the method is right but a computation is slightly off.
  const diff = Math.abs(studentValue.valueOf() - correct.valueOf());
  const lhsAtStudent = from.A.mul(studentValue).add(from.B);
  if (diff <= 2 || Math.abs(lhsAtStudent.valueOf() - from.C.valueOf()) <= 2) {
    return result("ARITHMETIC_SLIP", CONFIDENCE.slip, `Observed: x = ${studentValue}, which is close: it gives ${from.A}x ${from.B.isZero() ? "" : `${neg(from.B) ? "−" : "+"} ${abs(from.B)} `}= ${lhsAtStudent} instead of ${from.C}. Method likely right, calculation slightly off.`);
  }
  return result("UNCLASSIFIED", 0, `x = ${studentValue} matches none of the modelled mistakes — ask for reasoning instead of guessing.`);
}

/**
 * Diagnose a wrong STEP (an equation that is not equivalent to the line before)
 * by the transformation the student actually wrote — not by the value it implies.
 * Falls back to the implied value, and says so, when the step's shape isn't recognised.
 */
export function diagnoseStep(studentEq: Equation, from: Normal): Diagnosis {
  const { A, B, C } = from;
  const bAbs = abs(B);
  const sgn = (f: Fraction) => (neg(f) ? "−" : "+");
  const cands: Array<{ id: MisconceptionId; eq: string; evidence: string }> = [];
  const add = (id: MisconceptionId, eq: string | null, evidence: string) => {
    if (eq) cands.push({ id, eq, evidence });
  };
  const ax = (k: Fraction) => (k.eq(1) ? "x" : `${k}x`);
  if (!B.isZero()) {
    const CpB = C.add(B);
    add("SIGN_ERROR_INVERSE_OP", `${ax(A)} = ${CpB}`, `Observed: "${sgn(B)} ${bAbs}" removed from the left; right side became ${CpB} (${plusB(C, B)} = ${CpB}). Consistent with ${neg(B) ? "subtracting" : "adding"} ${bAbs} where ${neg(B) ? "adding" : "subtracting"} was needed.`);
    add("ONE_SIDE_ONLY", `${ax(A)} = ${C}`, `Observed: "${sgn(B)} ${bAbs}" removed from the left; right side still ${C}. Consistent with changing only one side.`);
    const AB = A.add(B);
    if (!AB.isZero()) add("COMBINED_UNLIKE_TERMS", `${ax(AB)} = ${C}`, `Observed: ${A}x and ${sgn(B)} ${bAbs} became ${AB}x. Consistent with adding an x-term and a plain number together.`);
    if (!A.eq(1)) {
      add("UNDID_IN_WRONG_ORDER", `x ${sgn(B)} ${bAbs} = ${C.div(A)}`, `Observed: right side ${C} became ${C.div(A)} (÷ ${A}); left side became x ${sgn(B)} ${bAbs}, with ${bAbs} not divided. Consistent with dividing only part of a side.`);
      add("ONE_SIDE_ONLY", `x ${sgn(B.div(A))} ${abs(B.div(A))} = ${C}`, `Observed: left side divided by ${A}; right side still ${C}. Consistent with changing only one side.`);
      add("COEFFICIENT_AS_ADDEND", `x ${sgn(B)} ${bAbs} = ${C.sub(A)}`, `Observed: ${A} subtracted from both sides (${A}x became x). Consistent with reading ${A}x as ${A} + x.`);
    }
  } else if (!A.eq(1)) {
    add("COEFFICIENT_AS_ADDEND", `x = ${C.sub(A)}`, `Observed: ${C} − ${A} = ${C.sub(A)}. Consistent with subtracting ${A} instead of dividing — reading ${A}x as ${A} + x.`);
    add("MULTIPLIED_INSTEAD_OF_DIVIDING", `x = ${C.mul(A)}`, `Observed: ${C} × ${A} = ${C.mul(A)}. Consistent with multiplying where dividing was needed.`);
    if (!C.isZero()) add("INVERTED_DIVISION", `x = ${A.div(C)}`, `Observed: ${A} ÷ ${C}. Consistent with dividing the wrong way round.`);
    add("FORGOT_TO_DIVIDE", `x = ${C}`, `Observed: ${A}x became x, right side still ${C}. Consistent with dropping the ${A} without dividing.`);
  }
  const matched = cands.filter((c) => {
    const e = parseEquation(c.eq);
    return e && sameLine(e, studentEq);
  });
  if (matched.length) {
    const [first, ...rest] = matched;
    return result(first.id, rest.length ? CONFIDENCE.stepAmbiguous : CONFIDENCE.stepUnique, first.evidence, rest.map((r) => r.id), "step");
  }
  // Right operation, wrong arithmetic: same shape as the correct next line, constant slightly off.
  const s = normalize(studentEq);
  if (!B.isZero() && s.A.eq(A) && s.B.isZero()) {
    const target = C.sub(B);
    if (!s.C.eq(target) && Math.abs(s.C.valueOf() - target.valueOf()) <= 2)
      return result("ARITHMETIC_SLIP", CONFIDENCE.slip, `Observed: ${s.A}x = ${s.C} — the shape of the next line, with the right side off by ${Math.abs(s.C.valueOf() - target.valueOf())} from ${minusB(C, B)}. Consistent with an arithmetic slip.`, [], "step");
  }
  if (B.isZero() && s.A.eq(1) && s.B.isZero()) {
    const target = safe(() => C.div(A));
    if (target && !s.C.eq(target) && Math.abs(s.C.valueOf() - target.valueOf()) <= 1)
      return result("ARITHMETIC_SLIP", CONFIDENCE.slip, `Observed: x = ${s.C} — off by ${Math.abs(s.C.valueOf() - target.valueOf())} from ${C} ÷ ${A}. Consistent with an arithmetic slip.`, [], "step");
  }
  // Unrecognised shape: fall back to the implied value, and lower confidence because the basis is weaker.
  const sol = solve(studentEq);
  if (sol.kind !== "unique") {
    return result("UNCLASSIFIED", 0, `"${studentEq.raw}" has ${sol.kind === "none" ? "no solution" : "every number as a solution"}; its step pattern isn't recognised.`, [], "step");
  }
  const byValue = diagnoseValue(sol.x, from);
  return {
    ...byValue,
    confidence: Math.round(byValue.confidence * CONFIDENCE.impliedValueFactor * 100) / 100,
    evidence: `Step pattern not recognised; judged by the value it implies (x = ${sol.x}). ${byValue.evidence}`,
    basis: "implied-value",
  };
}

/** Fill template placeholders from the current normalised equation. */
export function fillTemplate(t: string, n: Normal): string {
  const bAbs = n.B.valueOf() < 0 ? n.B.neg() : n.B;
  const map: Record<string, string> = {
    a: n.A.toString(),
    c: n.C.toString(),
    bAbs: bAbs.toString(),
    bOp: n.B.valueOf() < 0 ? "−" : "+",
    bSigned: n.B.valueOf() < 0 ? `“− ${bAbs}”` : `“+ ${bAbs}”`,
    aPlusB: safe(() => n.A.add(n.B))?.toString() ?? "?",
    cMinusB: safe(() => n.C.sub(n.B))?.toString() ?? "?",
  };
  return t.replace(/\{(\w+)\}/g, (_m, k) => map[k] ?? `{${k}}`);
}

/**
 * Heuristic classifier for a free-text explanation ("I added 3 and 5").
 * Used in local mode, and as the fallback when the LLM classifier fails
 * validation. Returns UNCLASSIFIED rather than guessing.
 */
export function classifyExplanationHeuristic(text: string, n: Normal): Diagnosis {
  const t = text.toLowerCase();
  const a = n.A.toString();
  const bAbs = (n.B.valueOf() < 0 ? n.B.neg() : n.B).toString();
  const mentions = (num: string) => new RegExp(`(^|[^0-9])${num.replace("/", "\\/")}([^0-9]|$)`).test(t);
  const addWords = /\badd|plus|\+|together|combine/.test(t);
  const subWords = /subtract|minus|take away|took away|takeaway|took off|-/.test(t);
  const mulWords = /times|multipl|\*|×/.test(t);
  const result = (id: MisconceptionId, evidence: string, confidence = 0.6): Diagnosis => ({
    id,
    category: MISCONCEPTIONS[id].category,
    confidence,
    evidence,
    alsoMatches: [],
    basis: "explanation",
  });
  if (addWords && mentions(a) && mentions(bAbs) && a !== bAbs) return result("COMBINED_UNLIKE_TERMS", `Explanation adds ${a} and ${bAbs}.`);
  if (n.B.valueOf() > 0 && addWords && mentions(bAbs)) return result("SIGN_ERROR_INVERSE_OP", `Explanation adds ${bAbs} where it should be subtracted.`);
  if (n.B.valueOf() < 0 && subWords && mentions(bAbs)) return result("SIGN_ERROR_INVERSE_OP", `Explanation subtracts ${bAbs} where it should be added.`);
  if (subWords && mentions(a)) return result("COEFFICIENT_AS_ADDEND", `Explanation subtracts the coefficient ${a}.`);
  if (mulWords && mentions(a)) return result("MULTIPLIED_INSTEAD_OF_DIVIDING", `Explanation multiplies by ${a}.`);
  if (/guess|random|no idea|just felt/.test(t)) return result("UNCLASSIFIED", "Student says they guessed.", 0.3);
  return result("UNCLASSIFIED", "No modelled pattern found in explanation.", 0);
}
