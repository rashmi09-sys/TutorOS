/**
 * The browser never receives the answers to problems the student hasn't reached. A test that needs to answer
 * a check problem works it out from the problem itself, the way a student who knows the topic would.
 */
type Data = Record<string, number | string>;

/** Algebra: a·x + b = c (b signed) → x. */
export function solveLinear(p: { a: number; b: number; c: number }): string {
  const x = (p.c - p.b) / p.a;
  return Number.isInteger(x) ? String(x) : `${p.c - p.b}/${p.a}`;
}

/** Geometry: the missing angle. */
export function solveTriangle(p: { kind: string; data: Data }): number {
  const d = p.data;
  if (d.unknown === "AB") return (180 - Number(d.p)) / 2;
  return 180 - Number(d.A) - Number(d.B);
}

/** Physics, net-force questions: size and direction. */
export function solveNetForce(p: { kind: string; data: Data }): { value: number; direction: "right" | "left" } {
  const right = Number(p.data.right), left = Number(p.data.left);
  if (p.data.missing === "right") return { value: left - right, direction: "right" };
  return { value: Math.abs(right - left), direction: right >= left ? "right" : "left" };
}
