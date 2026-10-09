import { Fraction } from "./fraction";
import { NUMBER_WORDS } from "./algebra";
import type { Normal } from "./misconceptions";

/**
 * What the student MEANT, as structured data — the layer between raw text and the maths engine.
 *
 * Students describe moves in words far more often than they write equations: "take five away",
 * "move the 5 over", "I'll do BODMAS multiplication", "can we divide by three?", "no, I meant subtract".
 * Before this layer existed the engine had only two maths channels (an equation parser, and "a bare
 * number in a short message is the answer"), so these were read as off-topic — or worse, "take five
 * away" was read as the answer x = 5.
 *
 * The meaning says what the student proposes; it never says whether that is right. Every proposed
 * operation goes through `checkOperation` (exact arithmetic) before the policy reacts to it.
 *
 * Two interpreters produce the same structure:
 *  - `interpretDeterministic` — an explicit lexicon of operation words, numbers, sides and question /
 *    correction markers, resolved against the current equation. Limited coverage, fully testable.
 *  - an LLM interpreter (llm/teacher.ts), used only when configured and only when the lexicon is not
 *    confident; its output is schema-validated and its numbers must come from the text or the equation.
 */

export type OpKind = "add" | "subtract" | "multiply" | "divide";
export type Sides = "both" | "left" | "right" | "unspecified";

export interface ProposedOperation {
  kind: OpKind;
  /** The number to add/subtract/multiply/divide by, as an exact fraction string; null if not said and not inferable. */
  operand: string | null;
  operandSource: "stated" | "inferred" | null;
  sides: Sides;
  /** How the move was described: "undo …", "move the 5 to the other side", "do multiplication" (evaluate), or plainly. */
  framing: "undo" | "move" | "evaluate" | "plain";
}

export type MeaningAct =
  | "propose_operation" // "subtract 5 from both sides", "take five away", "I'll do multiplication"
  | "ask_operation" // "can we divide by three?", "shouldn't we multiply before adding?"
  | "why_not_operation" // "why can't we multiply?"
  | "choose_part"; // "the 5 first", "the addition" — which part of the equation to deal with first

export interface StudentMeaning {
  act: MeaningAct;
  operation: ProposedOperation | null;
  /** Which part of the current equation the student points at, when they name one. */
  part: "constant" | "coefficient" | null;
  mentionsOrderOfOperations: boolean;
  isQuestion: boolean;
  /** "No, I meant …", "I said …" — the student is correcting or re-stating. */
  isCorrection: boolean;
  /** 0..1: how sure the interpreter is that this is what the student meant. Below 0.5 the tutor asks instead. */
  confidence: number;
  /** Words that carried the meaning, for the console. */
  evidence: string[];
  source: "lexicon" | "llm";
}

/* ------------------------------------------------------------------ */
/* Deterministic interpretation                                        */
/* ------------------------------------------------------------------ */

const OP_WORDS: Array<[OpKind, RegExp]> = [
  ["multiply", /\b(multipl\w*|times|product)\b/],
  ["divide", /\b(divid\w*|division|split\w*|share\w*)\b/],
  ["subtract", /\b(subtract\w*|minus|take\w* (it |that |the \w+ |\d+ )?(away|off)|take away|remov\w*|get rid of|getting rid of|deduct\w*|less)\b/],
  ["add", /\b(add\b|adding|addition|plus|put\w* (it |that |the \w+ |\d+ )?back)\b/],
];
const MOVE = /\b(move|moving|bring|bringing|shift|shifting|transfer|carry|send|throw|chuck)\b[^.?!]*\b(other side|across|over|right side|left side)\b|\bto the other side\b/;
const ORDER_OF_OPS = /\b(bodmas|bidmas|pemdas|bedmas|order of operations?|(multipl\w*|times) (comes |goes )?(first|before)|before (adding|addition|you add|we add))\b/;
const UNDO = /\b(undo|undoing|reverse|get rid of|cancel)\b/;
const EVALUATE = /\b(do|doing|did|use|using|apply|follow)\b[^.?!]{0,20}\b(multiplication|division|addition|subtraction|bodmas|pemdas|bidmas)\b|\b(bodmas|pemdas|bidmas)\b/;
const QUESTION = /\?\s*$|^(can|could|should|shouldn'?t|shall|do|does|is|are|may|would|will|why|what if|how about)\b/;
const WHY_NOT = /\bwhy (can'?t|cannot|don'?t|shouldn'?t|not|wouldn'?t|isn'?t)\b|\bwhy (do|did|would|should) (we|you|i) not\b/;
const CORRECTION = /^(no+|nope|wait|sorry|oops|actually)\b[, ]*|\bi (said|meant|mean|told you)\b|\bi already said\b|\blike i said\b|\bnot \w+,? (i meant|but)\b/;
const PAST_REASONING = /\bi (added|subtracted|took|multiplied|divided|did|got|put|moved|removed|combined)\b|\bbecause\b/;
const SIDES_BOTH = /\bboth sides?\b|\beach side\b|\bevery side\b|\bboth\b/;
const SIDE_LEFT = /\b(from |on |to )?(the )?left( side| hand side)?( only| just)?\b|\bonly (on |from )?the left\b/;
const SIDE_RIGHT = /\b(from |on |to )?(the )?right( side| hand side)?( only| just)?\b|\bonly (on |from )?the right\b/;
const PART_CONSTANT_WORDS = /\b(the (plus|minus|addition|adding|subtraction|number on its own|constant|added (bit|part|number)))\b/;
const PART_COEFF_WORDS = /\b(the (multiplication|times|coefficient|number in front|number next to x))\b/;

export function numbersIn(text: string): number[] {
  const t = ` ${text.toLowerCase()} `.replace(/\b([a-z]+)\b/g, (w) => (w in NUMBER_WORDS ? ` ${NUMBER_WORDS[w]} ` : w));
  // Numbers glued to x ("3x") are coefficients being referred to, not operands; keep them separately.
  return Array.from(t.matchAll(/(?<![\d.x])(\d+(?:\.\d+)?)(?!\s*x\b)(?![\d.])/g)).map((m) => Number(m[1]));
}

const abs = (f: Fraction) => (f.valueOf() < 0 ? f.neg() : f);

/**
 * Read an operation proposal from everyday language, relative to the current equation.
 * Returns null when the text isn't about an operation at all (other layers handle it).
 */
export interface MeaningContext {
  /** What the tutor's last message was waiting for (see engine `awaitingFor`). */
  awaiting?: Awaiting;
}

/** What the tutor's last message asked the student for. */
export type Awaiting = "choose_part" | "operation" | "line" | "reasoning" | "reflection" | "open";

const BARE_PART = /^(um+,? |er+,? |i think |maybe )?(the )?(addition|adding|plus|subtraction|subtracting|minus|multiplication|multiplying|times|division|dividing)( one| part| bit)?( first)?[.!?]*$/;

export function interpretDeterministic(raw: string, current: Normal, cx: MeaningContext = {}): StudentMeaning | null {
  const t = raw
    .trim()
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/\b([a-z]+)\b/g, (w) => (w in NUMBER_WORDS ? String(NUMBER_WORDS[w]) : w)) // "five" → "5"
    // Common speech-recognition spellings of the order-of-operations acronyms ("bod mass", "bodmass", "b o d m a s").
    .replace(/\b(b ?o ?d ?m ?a ?s{1,2}|bod ?m[ua]s{1,2}|bod ?mos|bid ?mass?|bed ?mass?|pem ?d[au]s{1,2})\b/g, (w) => (/^p/.test(w) ? "pemdas" : /^bi/.test(w) ? "bidmas" : /^be/.test(w) ? "bedmas" : "bodmas"));
  if (!t) return null;
  if (PAST_REASONING.test(t) && !CORRECTION.test(t)) return null; // explaining what they did → explanation path
  // "What is 20 minus 5?" is arithmetic to work out, not a move on the equation.
  if (/\d+\s*(minus|plus|times|divided by|multiplied by|take away|[-+*/×÷−])\s*\d+/.test(t)) return null;
  // Answering "which would you undo first?" with just "multiplication" names a PART of the equation.
  if (cx.awaiting === "choose_part" && BARE_PART.test(t)) {
    const coeff = /multipl|times|divi/.test(t);
    return { act: "choose_part", operation: null, part: coeff ? "coefficient" : "constant", mentionsOrderOfOperations: false, isQuestion: /\?\s*$/.test(t), isCorrection: false, confidence: 0.8, evidence: [t.replace(/[.!?]+$/, ""), "answering: which part first?"], source: "lexicon" };
  }

  // A bare signed number ("minus 3") is usually an answer. Read it as "subtract 3" only when the tutor just
  // asked for an operation, or the number is the constant being undone ("minus 5" for 3x + 5 = 20).
  const bare = t.match(/^(?:minus|negative|take away) (\d+(?:\.\d+)?)[.!?]*$/);
  if (bare && cx.awaiting !== "operation" && !abs(current.B).eq(Number(bare[1]))) return null;

  const evidence: string[] = [];
  const kinds = OP_WORDS.filter(([, re]) => re.test(t)).map(([k, re]) => {
    evidence.push(t.match(re)![0]);
    return k;
  });
  const move = MOVE.test(t);
  const orderOps = ORDER_OF_OPS.test(t);
  if (orderOps) evidence.push(t.match(ORDER_OF_OPS)![0]);
  if (move) evidence.push(t.match(MOVE)![0]);
  const nums = numbersIn(t);
  const bAbs = abs(current.B);
  const partConstantByNumber = !current.B.isZero() && nums.some((n) => bAbs.eq(n)) && /\bthe \d+\b|\bthat \d+\b|\b\d+ first\b/.test(t);
  const part: StudentMeaning["part"] = PART_CONSTANT_WORDS.test(t) || partConstantByNumber ? "constant" : PART_COEFF_WORDS.test(t) ? "coefficient" : null;

  if (!kinds.length && !move && !orderOps && !part) return null;

  const isQuestion = QUESTION.test(t);
  const whyNot = WHY_NOT.test(t);
  const isCorrection = CORRECTION.test(t);

  // Which operation? "the addition"/"the plus" name a PART, not an operation the student wants to do.
  let kind: OpKind | null = null;
  const opKinds = kinds.filter((k) => !(part === "constant" && (k === "add" || k === "subtract") && PART_CONSTANT_WORDS.test(t) && !/\b(subtract|take|remov|minus)\b/.test(t)) && !(part === "coefficient" && k === "multiply" && PART_COEFF_WORDS.test(t)));
  if (opKinds.length === 1) kind = opKinds[0];
  else if (opKinds.length > 1) {
    // "multiply before adding" → the proposal is the first-named operation; "BODMAS says multiplication" → multiply.
    const firstIdx = (k: OpKind) => t.search(OP_WORDS.find(([kk]) => kk === k)![1]);
    kind = [...opKinds].sort((a, b) => firstIdx(a) - firstIdx(b))[0];
  } else if (orderOps) kind = "multiply";

  let framing: ProposedOperation["framing"] = UNDO.test(t) ? "undo" : move ? "move" : EVALUATE.test(t) || orderOps ? "evaluate" : "plain";

  // "Move the 5 to the other side" → the term moved is undone on both sides.
  if (move && !kind) {
    if (part === "coefficient") kind = "divide";
    else kind = current.B.valueOf() >= 0 ? "subtract" : "add";
  }
  // "undo the multiplication" → divide; "undo the addition" → subtract (the inverse of the named part).
  if (framing === "undo" && part && !opKinds.length) kind = part === "constant" ? (current.B.valueOf() >= 0 ? "subtract" : "add") : "divide";
  if (framing === "undo" && !part && kind && opKinds.length === 1 && /\bundo (the )?(multipl|times)/.test(t)) kind = "divide";
  if (framing === "undo" && !part && kind && opKinds.length === 1 && /\bundo (the )?(addition|adding|plus)/.test(t)) kind = "subtract";

  // Choosing a part without saying what to do with it ("the 5 first").
  if (!kind && part) {
    return { act: "choose_part", operation: null, part, mentionsOrderOfOperations: orderOps, isQuestion, isCorrection, confidence: 0.75, evidence: [...evidence, part === "constant" ? `the ${current.B.valueOf() < 0 ? "−" : "+"} ${bAbs}` : "the multiplication"], source: "lexicon" };
  }
  if (!kind) return null;

  // Operand: a stated number (not the x-coefficient written as "3x"), else inferred from the only candidate.
  let operand: string | null = null;
  let operandSource: ProposedOperation["operandSource"] = null;
  const stated = nums.filter((n) => n !== 0 || kind === "add" || kind === "subtract");
  if (stated.length === 1) {
    operand = new Fraction(stated[0]).toString();
    operandSource = "stated";
  } else if (stated.length > 1) {
    // "subtract 5 from 20" names the operand first.
    operand = new Fraction(stated[0]).toString();
    operandSource = "stated";
  } else if ((kind === "subtract" || kind === "add") && !current.B.isZero() && framing !== "evaluate") {
    operand = bAbs.toString();
    operandSource = "inferred";
  } else if (kind === "divide" && !current.A.eq(1)) {
    operand = current.A.toString();
    operandSource = "inferred";
  }
  if (framing === "evaluate" && stated.length) framing = "plain"; // "multiply by 3" is a concrete move

  const sides: Sides = SIDES_BOTH.test(t) || move ? "both" : SIDE_LEFT.test(t) && !SIDE_RIGHT.test(t) ? "left" : SIDE_RIGHT.test(t) && !SIDE_LEFT.test(t) ? "right" : "unspecified";
  const act: MeaningAct = whyNot ? "why_not_operation" : isQuestion ? "ask_operation" : "propose_operation";
  // Confidence: an operation word plus (a number, a side, or a clear frame) is strong; a lone word is weaker.
  const signals = [opKinds.length > 0 || move, operandSource === "stated", sides !== "unspecified", orderOps, framing !== "plain"].filter(Boolean).length;
  const confidence = Math.min(0.95, 0.5 + 0.15 * signals);
  return { act, operation: { kind, operand, operandSource, sides, framing }, part, mentionsOrderOfOperations: orderOps, isQuestion, isCorrection, confidence, evidence, source: "lexicon" };
}

/* ------------------------------------------------------------------ */
/* Deterministic verification                                          */
/* ------------------------------------------------------------------ */

export type OperationVerdict =
  | "correct_next" // undoes the outermost operation, on both sides — the standard next move
  | "divide_first" // valid, but divides the constant too: fractions
  | "evaluation_order" // BODMAS / "do multiplication" — evaluating, not undoing
  | "wrong_inverse" // adds where it should subtract (or multiplies where it should divide)
  | "one_side" // applied to one side only: the equation would no longer balance
  | "valid_unhelpful" // keeps the balance but doesn't isolate x (e.g. subtract 7)
  | "incomplete"; // operation named but not enough to act on (which number?)

export interface OperationCheck {
  verdict: OperationVerdict;
  /** The equation that would result, when the move is fully specified (computed exactly; used for checks, never to do the student's step). */
  result: string | null;
  /** The operation the standard method needs now, for the policy and the console. */
  needed: string;
  /** Plain-language statement of what the move does, computed here. */
  explanation: string;
}

const fmt = (A: Fraction, B: Fraction, C: Fraction) => {
  const ax = A.eq(1) ? "x" : A.eq(-1) ? "-x" : `${A}x`;
  const lhs = B.isZero() ? ax : `${ax} ${B.valueOf() < 0 ? "-" : "+"} ${abs(B)}`;
  return `${lhs} = ${C}`;
};

export function neededOperation(n: Normal): { kind: OpKind; operand: Fraction; text: string } {
  if (!n.B.isZero()) {
    const neg = n.B.valueOf() < 0;
    return { kind: neg ? "add" : "subtract", operand: abs(n.B), text: neg ? `add ${abs(n.B)} to both sides` : `subtract ${abs(n.B)} from both sides` };
  }
  return { kind: "divide", operand: n.A, text: `divide both sides by ${n.A}` };
}

/** Verify a proposed operation against the current equation with exact arithmetic. */
export function checkOperation(op: ProposedOperation, n: Normal): OperationCheck {
  const need = neededOperation(n);
  const base = { needed: need.text };
  // "Multiply" with no number, or "do the multiplication / BODMAS": the student is applying the order for
  // working OUT an expression, not undoing what was done to x.
  if (op.kind === "multiply" && op.operandSource !== "stated" && !n.B.isZero()) {
    return { ...base, verdict: "evaluation_order", result: null, explanation: `"Doing the multiplication" is how ${n.A.eq(1) ? "x" : `${n.A}x`} was built; to solve, the last thing done to x comes off first.` };
  }
  if (op.operand == null && op.kind === "multiply" && n.B.isZero()) op = { ...op, operand: n.A.toString(), operandSource: "inferred" }; // "multiply" on 3x = 15 means by the 3
  if (op.operand == null) return { ...base, verdict: "incomplete", result: null, explanation: `${op.kind} — but by which number?` };
  const [p, q] = op.operand.split("/").map(Number);
  const k = new Fraction(p, q ?? 1);
  let A = n.A;
  let B = n.B;
  let C = n.C;
  if (op.kind === "subtract") {
    B = B.sub(k);
    C = C.sub(k);
  } else if (op.kind === "add") {
    B = B.add(k);
    C = C.add(k);
  } else if (op.kind === "multiply") {
    A = A.mul(k);
    B = B.mul(k);
    C = C.mul(k);
  } else {
    if (k.isZero()) return { ...base, verdict: "incomplete", result: null, explanation: "Dividing by 0 isn't possible." };
    A = A.div(k);
    B = B.div(k);
    C = C.div(k);
  }
  const result = fmt(A, B, C);
  if (op.sides === "left" || op.sides === "right") {
    return { ...base, verdict: "one_side", result: null, explanation: `Doing it to the ${op.sides} side only changes one side but not the other, so the two sides would no longer be equal.` };
  }
  if (op.kind === need.kind && k.eq(need.operand)) {
    return { ...base, verdict: "correct_next", result, explanation: need.kind === "divide" ? `Dividing both sides by ${k} undoes multiplying by ${k}.` : `${need.kind === "subtract" ? "Subtracting" : "Adding"} ${k} on both sides undoes the ${n.B.valueOf() < 0 ? "−" : "+"} ${k}.` };
  }
  if (op.kind === "divide" && k.eq(n.A) && !n.B.isZero()) {
    return { ...base, verdict: "divide_first", result, explanation: `Dividing every term by ${k} is allowed, but the ${abs(n.B)} becomes ${abs(n.B).div(k)}.` };
  }
  const constantWrong = !n.B.isZero() && k.eq(abs(n.B)) && ((op.kind === "add" && n.B.valueOf() > 0) || (op.kind === "subtract" && n.B.valueOf() < 0));
  const coefWrong = op.kind === "multiply" && k.eq(n.A);
  if (constantWrong || coefWrong) {
    return { ...base, verdict: "wrong_inverse", result, explanation: constantWrong ? `${op.kind === "add" ? "Adding" : "Subtracting"} ${k} on both sides keeps it balanced but gives ${result}: the ${k} isn't gone.` : `Multiplying both sides by ${k} gives ${result}: x is further from being alone.` };
  }
  if (op.kind === "multiply" && op.framing !== "plain") {
    return { ...base, verdict: "evaluation_order", result, explanation: `Multiplying is how ${n.A}x was built; to solve, the last thing done to x comes off first.` };
  }
  return { ...base, verdict: "valid_unhelpful", result, explanation: `That keeps the two sides equal (${result}) but x isn't any more on its own.` };
}

/** Is this meaning the same proposal as the student's previous one (a repeat, possibly because we misunderstood)? */
export function sameProposal(a: { kind?: OpKind | null; part?: string | null } | undefined, b: StudentMeaning): boolean {
  if (!a) return false;
  if (b.operation && a.kind) return a.kind === b.operation.kind;
  if (b.part && a.part) return a.part === b.part;
  return false;
}
