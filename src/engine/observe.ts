import { Fraction } from "./fraction";
import type { Equation, Linear } from "./algebra";

/**
 * What the student DID to get from one line to the next — an observation, not an
 * interpretation. "Left: − 5, right: + 5" is a fact computed from the two lines.
 * Whether that came from a misunderstanding of inverse operations or a slip is a
 * hypothesis (see misconceptions.ts), and the UI keeps the two visibly separate.
 */
export type SideChange =
  | { kind: "none" }
  | { kind: "add"; k: Fraction } // k may be negative
  | { kind: "scale"; f: Fraction }
  | { kind: "other"; from: string; to: string };

export interface ObservedOperation {
  left: SideChange;
  right: SideChange;
  /** Same operation applied to both sides (a balanced move). */
  sameOnBoth: boolean;
  swapped: boolean;
  /** Plain-language, child-safe description, e.g. "− 5 on both sides" or "left: − 5 · right: + 5". */
  summary: string;
  leftText: string;
  rightText: string;
}

const neg = (f: Fraction) => f.valueOf() < 0;
const abs = (f: Fraction) => (neg(f) ? f.neg() : f);

function linText(l: Linear): string {
  const parts: string[] = [];
  if (!l.a.isZero()) parts.push(l.a.eq(1) ? "x" : l.a.eq(-1) ? "−x" : `${l.a}x`);
  if (!l.b.isZero() || !parts.length) parts.push(parts.length ? `${neg(l.b) ? "−" : "+"} ${abs(l.b)}` : `${l.b}`);
  return parts.join(" ");
}

function change(before: Linear, after: Linear, hint?: SideChange): SideChange {
  if (before.a.eq(after.a) && before.b.eq(after.b)) return { kind: "none" };
  // A constant-only side can be read as + k or × f; prefer whatever the other side did.
  if (before.a.isZero() && after.a.isZero() && !before.b.isZero() && hint?.kind === "scale" && before.b.mul(hint.f).eq(after.b)) return { kind: "scale", f: hint.f };
  if (before.a.eq(after.a)) return { kind: "add", k: after.b.sub(before.b) };
  if (!before.a.isZero() && !after.a.isZero()) {
    const f = after.a.div(before.a);
    if (before.b.mul(f).eq(after.b)) return { kind: "scale", f };
  }
  return { kind: "other", from: linText(before), to: linText(after) };
}

function opText(c: SideChange): string {
  switch (c.kind) {
    case "none":
      return "unchanged";
    case "add":
      return `${neg(c.k) ? "−" : "+"} ${abs(c.k)}`;
    case "scale":
      return c.f.n === 1 ? `÷ ${c.f.d}` : c.f.d === 1 ? `× ${c.f.n}` : `× ${c.f}`;
    case "other":
      return `${c.from} → ${c.to}`;
  }
}

function sameChange(a: SideChange, b: SideChange) {
  if (a.kind !== b.kind) return false;
  if (a.kind === "add" && b.kind === "add") return a.k.eq(b.k);
  if (a.kind === "scale" && b.kind === "scale") return a.f.eq(b.f);
  return a.kind === "none";
}

/** Compare the student's new line with the previous accepted line. */
export function observeOperation(prev: Equation, next: Equation): ObservedOperation {
  // If the student put the x-side on the other side ("15 = 3x"), compare like with like.
  const prevXLeft = !prev.lhs.a.isZero();
  const nextXLeft = !next.lhs.a.isZero() || next.rhs.a.isZero();
  const swapped = prevXLeft !== nextXLeft;
  const nl = swapped ? next.rhs : next.lhs;
  const nr = swapped ? next.lhs : next.rhs;
  const leftFirst = change(prev.lhs, nl);
  const right = change(prev.rhs, nr, leftFirst);
  const left = change(prev.lhs, nl, right);
  const sameOnBoth = left.kind !== "none" && left.kind !== "other" && sameChange(left, right);
  const leftText = opText(left);
  const rightText = opText(right);
  const summary = sameOnBoth ? `${leftText} on both sides` : left.kind === "none" && right.kind === "none" ? (swapped ? "sides swapped" : "rewritten") : `left: ${leftText} · right: ${rightText}`;
  return { left, right, sameOnBoth, swapped, summary: swapped && sameOnBoth ? `${summary} (sides swapped)` : summary, leftText, rightText };
}
