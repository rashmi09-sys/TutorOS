import { Fraction } from "./fraction";

/**
 * Deterministic algebra for single-variable linear equations.
 *
 * The LLM never decides whether mathematics is correct. Every student step,
 * every final answer, and every equation the tutor itself states is checked
 * here, with exact rational arithmetic.
 */

/** A linear expression  a·x + b  over the rationals. */
export interface Linear {
  a: Fraction;
  b: Fraction;
}

export interface Equation {
  lhs: Linear;
  rhs: Linear;
  raw: string;
}

export type Solution =
  | { kind: "unique"; x: Fraction }
  | { kind: "none" }
  | { kind: "all" };

export const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
};

/**
 * Normalise typed or *spoken* math into a parseable string.
 * Speech recognisers produce "x equals five", "three x minus 4", "15 divided by 3".
 */
export function normalizeMath(input: string): string {
  let s = ` ${input.toLowerCase()} `;
  s = s
    .replace(/[×✕✖]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/[−–—]/g, "-")
    .replace(/\bdivided by\b/g, "/")
    .replace(/\bover\b/g, "/")
    .replace(/\btimes\b|\bmultiplied by\b/g, "*")
    .replace(/\bplus\b/g, "+")
    .replace(/\bminus\b|\bnegative\b/g, "-")
    .replace(/\bequals\b|\bequal to\b|\bis equal to\b|\bequal\b/g, "=")
    .replace(/\bex\b|\beggs\b/g, "x");
  s = s.replace(/\b([a-z]+)\b/g, (w) => (w in NUMBER_WORDS ? String(NUMBER_WORDS[w]) : w));
  // "twenty 5" -> "25" style compounds from speech
  s = s.replace(/\b(20|30|40|50) ([1-9])\b/g, (_m, t, u) => String(Number(t) + Number(u)));
  return s.trim();
}

type Tok =
  | { t: "num"; v: Fraction }
  | { t: "x" }
  | { t: "op"; v: "+" | "-" | "*" | "/" }
  | { t: "(" }
  | { t: ")" };

function tokenize(src: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " ") {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const lit = src.slice(i, j);
      if (!/^\d+(\.\d+)?$|^\.\d+$/.test(lit)) return null;
      out.push({ t: "num", v: new Fraction(Number(lit)) });
      i = j;
      continue;
    }
    if (c === "x") {
      out.push({ t: "x" });
      i++;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/") {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (c === "(" || c === ")") {
      out.push({ t: c });
      i++;
      continue;
    }
    return null; // any other character -> not pure linear math
  }
  // Insert implicit multiplication: 3x, 2(x+1), x(3), )(
  const res: Tok[] = [];
  for (let k = 0; k < out.length; k++) {
    const prev = res[res.length - 1];
    const cur = out[k];
    const prevEndsValue = prev && (prev.t === "num" || prev.t === "x" || prev.t === ")");
    const curStartsValue = cur.t === "num" || cur.t === "x" || cur.t === "(";
    if (prevEndsValue && curStartsValue) res.push({ t: "op", v: "*" });
    res.push(cur);
  }
  return res;
}

class Parser {
  private i = 0;
  constructor(private toks: Tok[]) {}

  parse(): Linear | null {
    const e = this.expr();
    if (!e || this.i !== this.toks.length) return null;
    return e;
  }
  private peek() {
    return this.toks[this.i];
  }
  private peekOp(...ops: string[]): string | null {
    const t = this.toks[this.i];
    return t && t.t === "op" && ops.includes(t.v) ? t.v : null;
  }
  private expr(): Linear | null {
    let left = this.term();
    if (!left) return null;
    let op: string | null;
    while ((op = this.peekOp("+", "-"))) {
      this.i++;
      const right = this.term();
      if (!right) return null;
      left = op === "+" ? { a: left.a.add(right.a), b: left.b.add(right.b) } : { a: left.a.sub(right.a), b: left.b.sub(right.b) };
    }
    return left;
  }
  private term(): Linear | null {
    let left = this.unary();
    if (!left) return null;
    let op: string | null;
    while ((op = this.peekOp("*", "/"))) {
      this.i++;
      const right = this.unary();
      if (!right) return null;
      if (op === "*") {
        // Linear only: one side must be constant.
        if (!left.a.isZero() && !right.a.isZero()) return null;
        if (left.a.isZero()) left = { a: right.a.mul(left.b), b: right.b.mul(left.b) };
        else left = { a: left.a.mul(right.b), b: left.b.mul(right.b) };
      } else {
        if (!right.a.isZero() || right.b.isZero()) return null;
        left = { a: left.a.div(right.b), b: left.b.div(right.b) };
      }
    }
    return left;
  }
  private unary(): Linear | null {
    const t = this.peek();
    if (t?.t === "op" && (t.v === "-" || t.v === "+")) {
      this.i++;
      const inner = this.unary();
      if (!inner) return null;
      return t.v === "-" ? { a: inner.a.neg(), b: inner.b.neg() } : inner;
    }
    return this.atom();
  }
  private atom(): Linear | null {
    const t = this.toks[this.i++];
    if (!t) return null;
    if (t.t === "num") return { a: new Fraction(0), b: t.v };
    if (t.t === "x") return { a: new Fraction(1), b: new Fraction(0) };
    if (t.t === "(") {
      const e = this.expr();
      if (!e || this.toks[this.i++]?.t !== ")") return null;
      return e;
    }
    return null;
  }
}

export function parseExpression(src: string): Linear | null {
  const toks = tokenize(normalizeMath(src));
  if (!toks || toks.length === 0) return null;
  try {
    return new Parser(toks).parse();
  } catch {
    return null;
  }
}

export function parseEquation(src: string): Equation | null {
  const norm = normalizeMath(src);
  const parts = norm.split("=");
  if (parts.length !== 2) return null;
  const lhs = parseExpression(parts[0]);
  const rhs = parseExpression(parts[1]);
  if (!lhs || !rhs) return null;
  return { lhs, rhs, raw: src.trim() };
}

export function solve(eq: Pick<Equation, "lhs" | "rhs">): Solution {
  const a = eq.lhs.a.sub(eq.rhs.a);
  const b = eq.rhs.b.sub(eq.lhs.b);
  if (a.isZero()) return b.isZero() ? { kind: "all" } : { kind: "none" };
  return { kind: "unique", x: b.div(a) };
}

/** Two equations are equivalent iff they have the same solution set. */
export function equivalent(e1: Pick<Equation, "lhs" | "rhs">, e2: Pick<Equation, "lhs" | "rhs">): boolean {
  const s1 = solve(e1);
  const s2 = solve(e2);
  if (s1.kind !== s2.kind) return false;
  return s1.kind !== "unique" || s1.x.eq((s2 as { x: Fraction }).x);
}

export function evaluate(l: Linear, x: Fraction): Fraction {
  return l.a.mul(x).add(l.b);
}

export function isConstant(l: Linear) {
  return l.a.isZero();
}

/** Is this equation of the solved form  x = k  (either orientation)? */
export function isSolvedForm(eq: Equation): Fraction | null {
  const { lhs, rhs } = eq;
  if (lhs.a.eq(1) && lhs.b.isZero() && rhs.a.isZero()) return rhs.b;
  if (rhs.a.eq(1) && rhs.b.isZero() && lhs.a.isZero()) return lhs.b;
  return null;
}

/** How many "moves" are left to solve — a crude progress measure for steps. */
export function complexity(eq: Equation): number {
  let c = 0;
  if (!eq.lhs.a.isZero() && !eq.lhs.b.isZero()) c++;
  if (!eq.rhs.a.isZero() && !eq.rhs.b.isZero()) c++;
  if (!eq.lhs.a.isZero() && !eq.rhs.a.isZero()) c++;
  const coef = eq.lhs.a.isZero() ? eq.rhs.a : eq.lhs.a;
  if (!coef.eq(1)) c++;
  return c;
}

export function linearToLatex(l: Linear): string {
  const parts: string[] = [];
  if (!l.a.isZero()) {
    if (l.a.eq(1)) parts.push("x");
    else if (l.a.eq(-1)) parts.push("-x");
    else parts.push(`${l.a.toLatex()}x`);
  }
  if (!l.b.isZero() || parts.length === 0) {
    if (parts.length === 0) parts.push(l.b.toLatex());
    else if (l.b.valueOf() < 0) parts.push(`- ${l.b.neg().toLatex()}`);
    else parts.push(`+ ${l.b.toLatex()}`);
  }
  return parts.join(" ");
}

export function equationToLatex(eq: Pick<Equation, "lhs" | "rhs">): string {
  return `${linearToLatex(eq.lhs)} = ${linearToLatex(eq.rhs)}`;
}

/**
 * Render what the student actually typed as LaTeX (we show their work, not a
 * silently simplified version of it).
 */
export function rawToLatex(raw: string): string {
  return normalizeMath(raw)
    .replace(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g, "\\frac{$1}{$2}")
    .replace(/\*/g, " \\cdot ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse a bare final answer: "5", "x = 5", "x=25/3", "five". */
export function parseAnswer(src: string): Fraction | null {
  const eq = parseEquation(src);
  if (eq) return isSolvedForm(eq);
  const n = normalizeMath(src);
  if (/x/.test(n)) return null;
  const e = parseExpression(n);
  if (e && isConstant(e)) return e.b;
  return null;
}

/** Same equation up to scaling (e.g. "3x = 15" vs "15 = 3x"). */
export function sameLine(a: Equation, b: Equation): boolean {
  const ka = { x: a.lhs.a.sub(a.rhs.a), c: a.lhs.b.sub(a.rhs.b) };
  const kb = { x: b.lhs.a.sub(b.rhs.a), c: b.lhs.b.sub(b.rhs.b) };
  // proportional vectors (x, c), and same "shape" (which side holds the constant) is ignored on purpose
  if (ka.x.isZero() || kb.x.isZero()) return ka.x.isZero() && kb.x.isZero() && ka.c.isZero() === kb.c.isZero();
  const shapeA = describeShape(a);
  const shapeB = describeShape(b);
  return ka.c.div(ka.x).eq(kb.c.div(kb.x)) && shapeA === shapeB;
}

/** Distinguish "3x + 5 = 20" from "3x = 15" — equivalent, but different lines of work. */
function describeShape(e: Equation): string {
  const terms = [e.lhs.a, e.lhs.b, e.rhs.a, e.rhs.b].map((f) => (f.isZero() ? 0 : 1)).join("");
  const coef = e.lhs.a.sub(e.rhs.a);
  return `${terms.replace(/0110|1001/, "split")}:${coef.valueOf() === 1 || coef.valueOf() === -1 ? "unit" : "scaled"}`;
}
