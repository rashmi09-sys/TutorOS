import { Fraction } from "./fraction";
import { equivalent, isConstant, isSolvedForm, normalizeMath, parseEquation, sameLine, type Equation } from "./algebra";
import type { GuardResult, GuardViolation } from "./types";

/**
 * Output guard for every tutor utterance — LLM-written or templated.
 *
 *  1. ANSWER_LEAK    — states the final answer before policy allows it.
 *  2. STEP_LEAK      — states the next step's result before the hint ladder allows it.
 *  3. FALSE_ARITHMETIC — any pure-number equation it states must be true.
 *  4. UNGROUNDED_EQUATION — any equation with x it states must be either an
 *     equation the student wrote (quoting is fine) or one equivalent to the
 *     problem that policy has allowed. This is how we stop hallucinated algebra.
 *  5. TOO_LONG — children's working memory: keep turns short.
 */
export interface GuardSpec {
  answer: Fraction;
  problemText: string;
  nextStepRaw: string;
  revealAllowed: boolean;
  nextStepAllowed: boolean;
  /** Equations that may be stated: the problem, the student's own (even wrong) equations, valid work so far. */
  groundedEquations: string[];
  maxWords?: number;
}

const ANSWER_PHRASES = /(?:the )?answer (?:is|=|would be|will be)\s*(-?\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)|\bx (?:would be|will be|must be|should be)\s*(-?\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)/g;

export function extractEquations(text: string): string[] {
  const out: string[] = [];
  // Split into clauses so "3 × 8 + 5 = 29, not 20" yields one equation.
  const clauses = normalizeMath(text.replace(/[“”"`$\\]/g, " ")).split(/[,;:!?\n]|\.(?!\d)|\bnot\b|\bbut\b|\band\b|\bso\b|\bthen\b|\bgives\b|\bbecomes\b|→/);
  for (const clause of clauses) {
    if (!clause.includes("=")) continue;
    // keep only math characters; words become separators
    const cleaned = clause.replace(/[a-z']{2,}/g, " | ");
    const segs = cleaned.match(/[0-9x=+\-*/(). ]+/g) ?? [];
    for (const s of segs) {
      const seg = s.trim().replace(/^[=+*/. ]+|[=+\-*/. ]+$/g, "").trim();
      if (seg.split("=").length === 2 && /[0-9x]/.test(seg.split("=")[0]) && /[0-9x]/.test(seg.split("=")[1])) out.push(seg);
    }
  }
  return out;
}

export function guardUtterance(text: string, spec: GuardSpec): GuardResult {
  const violations: GuardViolation[] = [];
  const problem = parseEquation(spec.problemText)!;
  const nextStep = parseEquation(spec.nextStepRaw);
  const grounded = spec.groundedEquations.map((g) => parseEquation(g)).filter((e): e is Equation => !!e);

  for (const raw of extractEquations(text)) {
    const eq = parseEquation(raw);
    if (!eq) continue;
    const pureNumbers = isConstant(eq.lhs) && isConstant(eq.rhs);
    if (pureNumbers) {
      if (!eq.lhs.b.eq(eq.rhs.b)) violations.push({ type: "FALSE_ARITHMETIC", detail: `"${raw}" is false.` });
      continue;
    }
    const solved = isSolvedForm(eq);
    const isQuoted = grounded.some((g) => sameLine(g, eq));
    if (solved && solved.eq(spec.answer) && !spec.revealAllowed && !isQuoted) {
      violations.push({ type: "ANSWER_LEAK", detail: `States final answer "${raw}".` });
      continue;
    }
    if (nextStep && sameLine(nextStep, eq) && !spec.nextStepAllowed && !isQuoted) {
      violations.push({ type: "STEP_LEAK", detail: `States next step result "${raw}" before hint ladder allows it.` });
      continue;
    }
    const equivalentToProblem = equivalent(eq, problem);
    if (!isQuoted && !equivalentToProblem) {
      violations.push({ type: "UNGROUNDED_EQUATION", detail: `"${raw}" is neither the student's own equation nor true for this problem.` });
    } else if (!isQuoted && equivalentToProblem && !spec.revealAllowed && !spec.nextStepAllowed && !sameLine(eq, problem)) {
      // A *new* true equation is effectively doing a step for the student.
      violations.push({ type: "STEP_LEAK", detail: `Introduces a new solving step "${raw}".` });
    }
  }

  if (!spec.revealAllowed) {
    const norm = normalizeMath(text);
    for (const m of norm.matchAll(ANSWER_PHRASES)) {
      const v = (m[1] ?? m[2]).replace(/\s/g, "");
      const [n, d] = v.split("/").map(Number);
      if (new Fraction(n, d ?? 1).eq(spec.answer)) violations.push({ type: "ANSWER_LEAK", detail: `Phrase "${m[0]}" reveals the answer.` });
    }
  }

  const words = text.trim().split(/\s+/).length;
  if (words > (spec.maxWords ?? 60)) violations.push({ type: "TOO_LONG", detail: `${words} words (max ${spec.maxWords ?? 60}).` });

  return { ok: violations.length === 0, violations };
}

