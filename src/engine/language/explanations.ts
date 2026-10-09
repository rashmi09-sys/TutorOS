import { Fraction } from "../fraction";
import type { PolicyContext } from "../policy";
import type { TeachingStage } from "../types";

/**
 * Micro-teaching content for a 12-year-old: one idea per turn, short, concrete, and computed from
 * the current equation (never free text). Each stage has several genuinely different explanations so
 * "explain it differently" gets a new angle, not the same words.
 *
 *   NOTICE — point at the important part of the equation.
 *   THINK  — one guiding question or a small analogy.
 *   TRY    — invite exactly one mathematical move.
 *
 * Nothing here states the next line or the answer: every text passes the same output guard as LLM
 * wording, and tests/micro.test.ts checks every variant for leaks and false arithmetic.
 */
export interface Micro {
  stage: TeachingStage;
  text: string;
  /** Extra equations this text states (only for small examples on other numbers). */
  equations: string[];
}

const neg = (f: Fraction) => f.valueOf() < 0;
const abs = (f: Fraction) => (neg(f) ? f.neg() : f);
const ax = (a: Fraction) => (a.eq(1) ? "x" : `${a}x`);

/** The current line in normal orientation (x-term on the left), so "15 = 3x" reads as "3x" and "15". */
function sides(ctx: PolicyContext) {
  const n = ctx.current;
  const [l, r] = ctx.currentRaw.split("=").map((x) => x.trim());
  if (/x/.test(l) && !/x/.test(r)) return { lhs: l, rhs: r };
  const b = abs(n.B);
  return { lhs: n.B.isZero() ? ax(n.A) : `${ax(n.A)} ${neg(n.B) ? "−" : "+"} ${b}`, rhs: n.C.toString() };
}

function line(ctx: PolicyContext) {
  const { lhs, rhs } = sides(ctx);
  return `${lhs} = ${rhs}`;
}

export function noticeVariants(ctx: PolicyContext): string[] {
  const n = ctx.current;
  const { lhs } = sides(ctx);
  if (n.B.isZero()) {
    return [
      `Look at ${line(ctx)}: x is multiplied by ${n.A}, and that's the only thing left to undo. What undoes multiplying?`,
      `${ax(n.A)} means ${n.A} lots of x. What is still attached to x?`,
      `Only one thing is left between you and x: the ${n.A} in front of it. What could you do about it?`,
    ];
  }
  const b = abs(n.B);
  const plus = !neg(n.B);
  if (n.A.eq(1)) {
    return [
      `Look at the left side, ${lhs}. x has ${b} ${plus ? "added to it" : "taken away from it"} — that's the only thing to undo. What would undo it?`,
      `Put your finger over the x in ${lhs}. What's left with it on that side?`,
    ];
  }
  return [
    `Look at the left side, ${lhs}. Two things happen to x there: it's multiplied by ${n.A}, and ${b} is ${plus ? "added" : "taken away"}. Which would you undo first?`,
    `Let's look at one piece only: the ${plus ? "+" : "−"} ${b} on the left. What is it doing to the ${ax(n.A)}?`,
    `Put your finger over the ${ax(n.A)} in ${lhs}. What else is on that side with it?`,
  ];
}

export function thinkVariants(ctx: PolicyContext): string[] {
  const n = ctx.current;
  const { lhs, rhs } = sides(ctx);
  if (n.B.isZero()) {
    const c = n.C;
    const out = [`Picture a balance with ${ax(n.A)} on one pan and ${rhs} on the other. If you split both pans into ${n.A} equal parts, what is in one part on each side?`];
    if (c.isInteger() && c.valueOf() > 0 && n.A.isInteger() && n.A.valueOf() > 1) {
      out.unshift(`Think of ${ax(n.A)} = ${rhs} as ${n.A} equal bags holding ${rhs} marbles altogether. How could you work out what's in one bag?`);
    }
    return out;
  }
  const b = abs(n.B);
  const plus = !neg(n.B);
  const out: string[] = [];
  if (!n.A.eq(1)) {
    out.push(
      `Think of getting dressed: x was multiplied by ${n.A} first, then ${b} was ${plus ? "added on" : "taken off"}. To undo, you go backwards — like taking off your shoes before your socks. Which comes off first?`,
    );
  }
  out.push(
    plus
      ? `Picture a balance: ${lhs} on one pan, ${rhs} on the other, perfectly level. If you take ${b} off the left pan, what has to happen to the right pan to keep it level?`
      : `Picture a balance: ${lhs} on one pan, ${rhs} on the other, perfectly level. If you put ${b} back on the left pan, what has to happen to the right pan to keep it level?`,
  );
  out.push(`Ask yourself: what is the last thing that was done to x on the left? That's the first thing to undo. What is it?`);
  return out;
}

export function tryVariants(ctx: PolicyContext): string[] {
  const n = ctx.current;
  const op = ctx.next.operation;
  if (n.B.isZero()) {
    return [
      `Try this one move: split both sides into ${n.A} equal parts — that is, divide both sides by ${n.A}. What line do you get?`,
      `Your move: ${op}. Write the line you get.`,
    ];
  }
  const b = abs(n.B);
  const plus = !neg(n.B);
  return [
    `Try this one move: ${plus ? `take ${b} away from` : `add ${b} to`} the left side — and do exactly the same to the right side. Write the new line.`,
    `Your move: ${op}. Just write what the equation looks like after that.`,
  ];
}

/** "Another way to see it" for a step the tutor has already shown (only used once nextStep is allowed). */
export function shownStepAgain(ctx: PolicyContext): string {
  return `Another way to see it: ${ctx.next.operation}, then work out the right side: ${ctx.next.arithmetic}. That gives ${ctx.next.resultRaw}. What would you do next?`;
}

/**
 * A small worked example on different numbers that uses the same kind of move the student needs next.
 * Numbers are chosen so neither the example's steps nor its answer coincide with the student's step or answer.
 */
export function smallExample(ctx: PolicyContext, variant: number): Micro {
  const n = ctx.current;
  const answer = ctx.correct;
  const stepValue = n.C.sub(n.B); // e.g. 15 in 3x = 15
  const avoid = (v: number) => answer.eq(v) || stepValue.eq(v) || n.C.eq(v);
  if (n.B.isZero()) {
    const ps = [2, 4, 5, 3, 6].filter((p) => !n.A.eq(p));
    const p = ps[variant % ps.length];
    const t = [3, 4, 6, 7, 2, 9].find((v) => !avoid(v) && !avoid(p * v))!;
    const eq1 = `${p}x = ${p * t}`;
    const eq2 = `x = ${t}`;
    return {
      stage: "THINK",
      text: `Here's a small one: ${eq1}. Divide both sides by ${p}, and you get ${eq2}. Now try the same kind of move on ${line(ctx)}.`,
      equations: [eq1, eq2],
    };
  }
  const plus = !neg(n.B);
  const b = abs(n.B);
  const ks = [3, 2, 4, 6, 7].filter((k) => !b.eq(k) && !n.A.eq(k));
  const k = ks[variant % ks.length];
  const t = [4, 6, 7, 9, 2, 3].find((v) => !avoid(v) && !avoid(plus ? v + k : v - k) && (plus || v - k > 0))!;
  const m = plus ? t + k : t - k;
  const eq1 = `x ${plus ? "+" : "-"} ${k} = ${m}`;
  const eq2 = `x = ${t}`;
  return {
    stage: "THINK",
    text: plus
      ? `Here's a smaller one: ${eq1}. Take ${k} away from both sides and you get ${eq2}. Yours has an extra step, but the first move works the same way. What's your next line?`
      : `Here's a smaller one: ${eq1}. Add ${k} to both sides and you get ${eq2}. Yours has an extra step, but the first move works the same way. What's your next line?`,
    equations: [eq1, eq2],
  };
}

/** Pick variant `i` of a list, skipping the one used last time when possible. */
export function pick<T>(list: T[], i: number): T {
  return list[((i % list.length) + list.length) % list.length];
}
