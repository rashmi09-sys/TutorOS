import { Fraction } from "./fraction";
import { parseEquation, solve, type Equation } from "./algebra";

/**
 * Problems are always two-step linear equations  a·x ± b = c  with an integer
 * solution. Transfer problems deliberately change *surface form* (constant on
 * the left, subtraction instead of addition, negative answers) so a correct
 * answer is evidence of the procedure, not of a memorised number.
 */
export interface Problem {
  id: string;
  text: string; // canonical ASCII, e.g. "3x + 5 = 20"
  latex: string;
  a: number; // coefficient of x
  b: number; // constant on the x-side (signed)
  c: number; // right-hand side
  answer: string; // fraction string, e.g. "5"
  form: "ax+b=c" | "ax-b=c" | "b+ax=c";
  role: "guided" | "transfer";
}

export function makeProblem(a: number, b: number, c: number, form: Problem["form"], role: Problem["role"], id: string): Problem {
  const text =
    form === "b+ax=c" ? `${b} + ${a}x = ${c}` : form === "ax-b=c" ? `${a}x - ${Math.abs(b)} = ${c}` : `${a}x + ${b} = ${c}`;
  const eq = parseEquation(text)!;
  const sol = solve(eq);
  if (sol.kind !== "unique") throw new Error(`Bad problem ${text}`);
  return { id, text, latex: text, a, b, c, answer: sol.x.toString(), form, role };
}

export function problemEquation(p: Problem): Equation {
  return parseEquation(p.text)!;
}

export function problemAnswer(p: Problem): Fraction {
  const [n, d] = p.answer.split("/").map(Number);
  return new Fraction(n, d ?? 1);
}

/** Deterministic PRNG so evaluation runs are reproducible. */
export function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export const GUIDED_PROBLEM = makeProblem(3, 5, 20, "ax+b=c", "guided", "p0");

/** Generate a fresh transfer problem that avoids previously seen numbers. */
export function generateTransferProblem(seed: number, index: number, seen: Problem[]): Problem {
  const rand = mulberry32(seed * 7919 + index * 104729);
  const forms: Problem["form"][] = ["b+ax=c", "ax-b=c", "ax+b=c"];
  for (let attempt = 0; attempt < 50; attempt++) {
    const form = forms[(index + attempt) % forms.length];
    const a = 2 + Math.floor(rand() * 8); // 2..9
    let x = 1 + Math.floor(rand() * 11); // 1..11
    if (index >= 1 && rand() < 0.35) x = -x; // negative answers in later items
    const k = 1 + Math.floor(rand() * 14); // magnitude of constant
    const b = form === "ax-b=c" ? -k : k;
    const c = a * x + b;
    const tooSimilar = seen.some((p) => p.a === a || p.answer === String(x) || Math.abs(p.b) === k);
    if (tooSimilar && attempt < 45) continue;
    return makeProblem(a, b, c, form, "transfer", `t${index + 1}`);
  }
  throw new Error("Could not generate transfer problem");
}
