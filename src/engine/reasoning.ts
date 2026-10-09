import { equivalent, parseEquation, parseExpression } from "./algebra";
import { Fraction } from "./fraction";
import type { Problem } from "./problems";

/**
 * Checks the reasoning a student states alongside an answer
 * ("x = 5 because 20 divided by 4 is 5").
 *
 * A claim is sound when it is
 *   - an equation in x equivalent to the problem (a valid line of working), or
 *   - true arithmetic that uses only numbers from a valid solution path
 *     (a, |b|, c, c − b, x, a·x, a·x + b).
 * "20 ÷ 4 = 5" is true arithmetic, but 4 appears nowhere in solving 3x + 5 = 20,
 * so it is flagged as reasoning that doesn't come from this equation.
 */
export interface ClaimCheck {
  raw: string;
  ok: boolean;
  why?: string;
}

export function pathNumbers(problem: Problem): Set<string> {
  const a = new Fraction(problem.a);
  const b = new Fraction(problem.b);
  const c = new Fraction(problem.c);
  const [n, d] = problem.answer.split("/").map(Number);
  const x = new Fraction(n, d ?? 1);
  const vals = [a, b.valueOf() < 0 ? b.neg() : b, c, c.sub(b), x, a.mul(x), a.mul(x).add(b), new Fraction(1), new Fraction(0)];
  return new Set(vals.map((v) => (v.valueOf() < 0 ? v.neg() : v).toString())); // compared by magnitude
}

function numbersIn(raw: string): string[] {
  return (raw.match(/\d+(?:\.\d+)?/g) ?? []).map((s) => new Fraction(Number(s)).toString());
}

export function checkClaims(claims: string[], problem: Problem): ClaimCheck[] {
  const allowed = pathNumbers(problem);
  const pEq = parseEquation(problem.text)!;
  return claims.map((raw) => {
    const eq = parseEquation(raw);
    if (eq) {
      const hasX = !eq.lhs.a.isZero() || !eq.rhs.a.isZero();
      if (hasX) return equivalent(eq, pEq) ? { raw, ok: true } : { raw, ok: false, why: `“${raw}” isn't a true step for ${problem.text}` };
      if (!eq.lhs.b.eq(eq.rhs.b)) return { raw, ok: false, why: `“${raw}” isn't true` };
    } else if (!/[+\-*/]/.test(raw) || !parseExpression(raw)) {
      return { raw, ok: true }; // a bare number, or not maths we can judge
    }
    const foreign = numbersIn(raw).filter((n) => !allowed.has(n));
    if (foreign.length) return { raw, ok: false, why: `“${raw}” uses ${foreign.join(", ")}, which doesn't come from ${problem.text}` };
    return { raw, ok: true };
  });
}
