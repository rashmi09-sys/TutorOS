import type { Fraction } from "./fraction";
import type { Equation } from "./algebra";

/**
 * Current equation normalised to  A·x + B = C. A small module of its own so the page can use it without
 * pulling the misconception catalogue (probes, teaching focus) into the browser bundle.
 */
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
