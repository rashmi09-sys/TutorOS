import type { SessionState, StudentEvent, TurnTrace } from "../types";
import { extractEquations } from "../guard";
import { isConstant, isSolvedForm, normalizeMath, parseEquation } from "../algebra";

/**
 * Evaluation scenarios. The STUDENT side is scripted (reproducible); the TUTOR
 * side is the real engine — the same step() the UI calls, with whichever
 * teaching model is under test. Assertions check teaching properties, not
 * exact strings, so the same suite runs against deterministic templates and an
 * LLM. Where the policy permits several moves, assertions accept any of them.
 */
export type ScriptedInput = StudentEvent | ((s: SessionState) => StudentEvent);

export type AssertionCategory =
  | "leak" // never gives away the answer / next step early
  | "math" // what the tutor says is mathematically true and grounded
  | "diagnosis" // misconception classification matches the actual error
  | "appropriateness" // responds to what the student actually said
  | "recovery" // repeated errors get escalating, different help
  | "mastery" // independent evidence is measured honestly
  | "robustness"; // odd inputs don't corrupt the session

export interface AssertionResult {
  name: string;
  category: AssertionCategory;
  passed: boolean;
  detail: string;
}

export interface Scenario {
  id: string;
  title: string;
  why: string;
  inputs: ScriptedInput[];
  check: (traces: TurnTrace[], final: SessionState) => AssertionResult[];
}

const t = (text: string, extra: Partial<Extract<StudentEvent, { type: "text" }>> = {}): StudentEvent => ({ type: "text", text, via: "keyboard", ...extra });
const answerCurrent = (s: SessionState): StudentEvent => t(`x = ${s.problems[s.current].answer}`);
/** The student makes the sign error on whatever problem is current: a·x = c + b. */
const signErrorOnCurrent = (s: SessionState): StudentEvent => {
  const p = s.problems[s.current];
  return t(`${p.a}x = ${p.c + p.b}`);
};
const at = (tr: TurnTrace[], turn: number) => tr.find((x) => x.turn === turn);

/** Does an utterance state the final answer for the problem being worked on? */
export function statesAnswer(utterance: string, answer: string): boolean {
  for (const raw of extractEquations(utterance)) {
    const eq = parseEquation(raw);
    const v = eq && isSolvedForm(eq);
    if (v && v.toString() === answer) return true;
  }
  const n = normalizeMath(utterance);
  return new RegExp(`answer (is|=)\\s*${answer.replace("/", "\\/")}\\b`).test(n);
}

/** Independent re-check of every pure-arithmetic statement the tutor actually delivered. */
export function falseArithmetic(utterance: string): string[] {
  const bad: string[] = [];
  for (const raw of extractEquations(utterance)) {
    const eq = parseEquation(raw);
    if (eq && isConstant(eq.lhs) && isConstant(eq.rhs) && !eq.lhs.b.eq(eq.rhs.b)) bad.push(raw);
  }
  return bad;
}

function sanctionedReveal(tr: TurnTrace) {
  const r = tr.decision.rule;
  return r === "R9_REVEAL_AFTER_EFFORT" || r.startsWith("R1_") || r.startsWith("R16") || r.startsWith("R17") || (r.endsWith("_L3") && tr.decision.revealAllowed);
}

export function noPrematureLeak(traces: TurnTrace[]): AssertionResult {
  for (const tr of traces) {
    const ans = tr.validation?.correctValue;
    if (ans && !sanctionedReveal(tr) && statesAnswer(tr.utterance, ans)) {
      return { name: "no premature answer leak", category: "leak", passed: false, detail: `Turn ${tr.turn} (${tr.decision.rule}) stated x = ${ans}: "${tr.utterance}"` };
    }
  }
  return { name: "no premature answer leak", category: "leak", passed: true, detail: "No turn stated the answer before sanctioned effort." };
}

function allMathTrue(traces: TurnTrace[]): AssertionResult {
  const bad = traces.flatMap((tr) => falseArithmetic(tr.utterance).map((b) => `turn ${tr.turn}: ${b}`));
  return { name: "every calculation the tutor states is true", category: "math", passed: bad.length === 0, detail: bad.length ? bad.join("; ") : "All stated arithmetic re-checked true." };
}

function ruleIn(tr: TurnTrace[], turn: number, prefixes: string[], category: AssertionCategory = "appropriateness"): AssertionResult {
  const x = at(tr, turn);
  const ok = !!x && prefixes.some((p) => x.decision.rule.startsWith(p));
  return { name: `turn ${turn}: ${prefixes.join(" or ")}`, category, passed: ok, detail: x ? `got ${x.decision.rule} (${x.decision.action}, ${x.decisionSource})` : "turn missing" };
}

function diagnosisAt(tr: TurnTrace[], turn: number, id: string, basis?: string): AssertionResult {
  const x = at(tr, turn);
  const ok = x?.diagnosis?.id === id && (!basis || x.diagnosis.basis === basis);
  return { name: `turn ${turn} diagnosis = ${id}${basis ? ` (by ${basis})` : ""}`, category: "diagnosis", passed: ok, detail: `got ${x?.diagnosis?.id ?? "none"}${x?.diagnosis ? ` [${x.diagnosis.basis}] — ${x.diagnosis.evidence}` : ""}` };
}

function says(tr: TurnTrace[], turn: number, re: RegExp, name: string, category: AssertionCategory, negate = false): AssertionResult {
  const x = at(tr, turn);
  const hit = !!x && re.test(x.utterance);
  return { name, category, passed: negate ? !!x && !hit : hit, detail: x ? `"${x.utterance}"` : "turn missing" };
}

function stageAt(tr: TurnTrace[], turn: number, stage: string): AssertionResult {
  const x = at(tr, turn);
  return { name: `turn ${turn} is a ${stage} move`, category: "appropriateness", passed: x?.decision.stage === stage, detail: x ? `${x.decision.rule} stage=${x.decision.stage ?? "none"}: "${x.utterance}"` : "turn missing" };
}

function endsWithQuestion(tr: TurnTrace[], turn: number): AssertionResult {
  return says(tr, turn, /\?\s*$/, `turn ${turn} hands thinking back (ends with a question)`, "appropriateness");
}

function hintLadderMonotonic(traces: TurnTrace[]): AssertionResult {
  let last = -1;
  let problem = "";
  for (const tr of traces) {
    const p = (tr.stateDelta.problem?.[1] as string) ?? problem;
    if (p !== problem) {
      problem = p;
      last = -1;
    }
    if (tr.decision.action === "HINT" || (tr.decision.action === "EXPLAIN" && tr.decision.template !== "concept")) {
      if (tr.decision.hintLevel < last) return { name: "hint ladder never steps down", category: "recovery", passed: false, detail: `turn ${tr.turn} dropped to level ${tr.decision.hintLevel} from ${last}` };
      last = tr.decision.hintLevel;
    }
  }
  return { name: "hint ladder never steps down", category: "recovery", passed: true, detail: "Hint levels were non-decreasing within each problem." };
}

function noIdenticalConsecutiveReplies(traces: TurnTrace[]): AssertionResult {
  for (let i = 1; i < traces.length; i++) {
    const a = traces[i - 1];
    const b = traces[i];
    if (a.utterance === b.utterance && b.decision.rule !== "R11_REPEAT") return { name: "never repeats the same reply to a new attempt", category: "recovery", passed: false, detail: `turns ${a.turn} and ${b.turn}: "${b.utterance}"` };
  }
  return { name: "never repeats the same reply to a new attempt", category: "recovery", passed: true, detail: "Every reply to a new attempt differs." };
}

/* ---------- conversational helpers ---------- */

const GENERIC_REPLIES = /park that for later|let'?s stay with|what'?s your next move/i;

/** A meaningful message must never get a canned redirect. */
function noGenericReply(tr: TurnTrace[], turns: number[]): AssertionResult {
  const bad = turns.map((n) => at(tr, n)).filter((x) => x && GENERIC_REPLIES.test(x.utterance));
  return { name: `no generic redirect on turn${turns.length > 1 ? "s" : ""} ${turns.join(", ")}`, category: "appropriateness", passed: bad.length === 0, detail: bad.length ? bad.map((x) => `turn ${x!.turn}: "${x!.utterance}"`).join("; ") : "Every reply engaged with what the student said." };
}

/** One question per reply. */
function oneQuestion(tr: TurnTrace[], turn: number): AssertionResult {
  const x = at(tr, turn);
  const n = x ? (x.utterance.match(/\?/g) ?? []).length : 0;
  return { name: `turn ${turn} asks exactly one question`, category: "appropriateness", passed: n === 1, detail: x ? `${n} question marks: "${x.utterance}"` : "turn missing" };
}

function verdictAt(tr: TurnTrace[], turn: number, v: string): AssertionResult {
  const x = at(tr, turn);
  return { name: `turn ${turn}: the move is verified as ${v}`, category: "math", passed: x?.opCheck?.verdict === v, detail: x?.opCheck ? `${x.opCheck.verdict} — ${x.opCheck.explanation}` : `no operation check (intent ${(x?.intent as { kind?: string } | undefined)?.kind ?? "none"})` };
}

function stillGuided(s: SessionState, boardLen: number): AssertionResult {
  return { name: "nothing solved or written for the student", category: "leak", passed: s.phase === "GUIDED" && s.board.length === boardLen, detail: `phase ${s.phase}, ${s.board.length} board lines` };
}

export const SCENARIOS: Scenario[] = [
  {
    id: "happy-path-mastery",
    title: "Solves alone → verified on two fresh problems",
    why: "One correct answer is not mastery. Mastery requires independent transfer.",
    inputs: [{ type: "start" }, t("3x = 15"), t("x = 5"), answerCurrent, answerCurrent],
    check: (tr, s) => [
      ruleIn(tr, 2, ["R2_VALID_STEP"]),
      ruleIn(tr, 3, ["R1_GUIDED_SOLVED"]),
      { name: "not mastered after the guided problem", category: "mastery", passed: at(tr, 3)!.stateDelta.mastery?.[1] !== "mastered", detail: `status after turn 3: ${at(tr, 3)!.stateDelta.mastery?.[1] ?? "unchanged"}` },
      { name: "insufficient evidence after one transfer item", category: "mastery", passed: at(tr, 4)!.stateDelta.mastery?.[1] === "insufficient_evidence" || (at(tr, 4)!.stateDelta.mastery === undefined && at(tr, 3)!.stateDelta.mastery?.[1] === "insufficient_evidence"), detail: JSON.stringify(at(tr, 4)!.stateDelta.mastery ?? "unchanged") },
      { name: "mastered after two independent transfer solves", category: "mastery", passed: s.mastery.status === "mastered", detail: `status ${s.mastery.status}, P(known)=${s.mastery.pKnown.toFixed(2)}` },
      { name: "transfer problems differ in surface form", category: "mastery", passed: new Set(s.problems.map((p) => p.form)).size >= 2, detail: s.problems.map((p) => p.text).join(" | ") },
      noPrematureLeak(tr),
    ],
  },
  {
    id: "unknown-error-probe",
    title: "x = 8 → ask, don't guess; explanation reveals the misconception",
    why: "When no modelled mistake explains an answer, a good tutor asks rather than invents a diagnosis.",
    inputs: [{ type: "start" }, t("x = 8"), t("I added the 3 and the 5 to get 8")],
    check: (tr) => [
      diagnosisAt(tr, 2, "UNCLASSIFIED"),
      ruleIn(tr, 2, ["R6_PROBE_UNKNOWN", "R6b_CHECK_UNKNOWN"]),
      diagnosisAt(tr, 3, "COMBINED_UNLIKE_TERMS"),
      ruleIn(tr, 3, ["R12_EXPLANATION_DIAGNOSED"]),
      noPrematureLeak(tr),
      allMathTrue(tr),
    ],
  },
  {
    id: "just-tell-me-first",
    title: "\"Just tell me the answer\" before trying",
    why: "Answer-giving as a crutch harms later independent performance; respond with a smaller step, not a flat refusal.",
    inputs: [{ type: "start" }, t("just tell me the answer")],
    check: (tr) => [
      ruleIn(tr, 2, ["R8_HELP_BEFORE_TRYING", "R9_HELP_ESCALATE_L1"]),
      endsWithQuestion(tr, 2),
      says(tr, 2, /\b(can'?t|cannot|won'?t|not allowed)\b/i, "not a flat refusal", "appropriateness", true),
      noPrematureLeak(tr),
    ],
  },
  {
    id: "persistent-help-reveal",
    title: "Repeated failure + help → reveal only after real effort, then require transfer",
    why: "Endless Socratic loops cause frustration. Reveal after effort, but never count it as mastery.",
    inputs: [{ type: "start" }, t("x = 12"), t("x = 45"), t("x = 1"), t("x = 15"), t("x = 2"), t("please just tell me"), t("x = 5")],
    check: (tr, s) => [
      noPrematureLeak(tr),
      hintLadderMonotonic(tr),
      noIdenticalConsecutiveReplies(tr),
      ruleIn(tr, 7, ["R9_REVEAL_AFTER_EFFORT", "R9_HELP_ESCALATE"], "recovery"),
      { name: "after the guided problem, a fresh transfer problem is required", category: "mastery", passed: s.phase === "TRANSFER", detail: `phase ${s.phase}` },
      { name: "guided problem finished with help is not independent evidence", category: "mastery", passed: s.mastery.observations.some((o) => o.problemId === "p0" && o.assisted), detail: JSON.stringify(s.mastery.observations) },
      diagnosisAt(tr, 2, "COEFFICIENT_AS_ADDEND"),
      diagnosisAt(tr, 3, "MULTIPLIED_INSTEAD_OF_DIVIDING"),
      allMathTrue(tr),
    ],
  },
  {
    id: "insists-wrong-transformation",
    title: "Student writes 3x = 25, then insists it's right",
    why: "Diagnose the transformation actually written; respect confidence; let a computed check decide.",
    inputs: [{ type: "start" }, t("3x = 25"), t("No, I'm sure 3x = 25 is right")],
    check: (tr) => [
      diagnosisAt(tr, 2, "SIGN_ERROR_INVERSE_OP", "step"),
      { name: "evidence describes the operation written (20 + 5 = 25), not a division", category: "diagnosis", passed: /20 \+ 5 = 25/.test(at(tr, 2)?.diagnosis?.evidence ?? "") && !/÷|divid/.test(at(tr, 2)?.diagnosis?.evidence ?? ""), detail: at(tr, 2)?.diagnosis?.evidence ?? "" },
      ruleIn(tr, 3, ["R4_RESPECTFUL_CHALLENGE", "R7_REPEATED_ERROR"]),
      says(tr, 3, /30/, "shows the computed check on their own line (25 + 5 = 30, not 20)", "math"),
      says(tr, 3, /25\/3|\bx = 25/, "doesn't introduce a fraction the student never wrote", "math", true),
      noPrematureLeak(tr),
      allMathTrue(tr),
    ],
  },
  {
    id: "silence-then-hint",
    title: "Silence → wait, then a gentle hint",
    why: "First silence is thinking time. Repeated silence means stuck.",
    inputs: [{ type: "start" }, { type: "silence", ms: 20000 }, { type: "silence", ms: 20000 }],
    check: (tr) => [ruleIn(tr, 2, ["R10_WAIT_FIRST_SILENCE", "R10_SILENCE_EARLY_HINT"]), ruleIn(tr, 3, ["R10_SILENCE_ESCALATE"]), noPrematureLeak(tr)],
  },
  {
    id: "interrupt-repeat",
    title: "Student interrupts and asks 'what?'",
    why: "Barge-in must leave the session coherent: restate, don't advance.",
    inputs: [{ type: "start" }, t("x = 15"), t("what?", { via: "voice", interruptedTutor: true })],
    check: (tr) => [
      ruleIn(tr, 3, ["R11_REPEAT"], "robustness"),
      { name: "state did not advance on repeat", category: "robustness", passed: !at(tr, 3)!.stateDelta.attempts && !at(tr, 3)!.stateDelta.hintLevel, detail: JSON.stringify(at(tr, 3)!.stateDelta) },
      allMathTrue(tr),
    ],
  },
  {
    id: "voice-transcript",
    title: "Spoken answers: \"three x equals fifteen\", \"x equals five\"",
    why: "Speech recognisers output words, not symbols; validation must still be exact.",
    inputs: [{ type: "start" }, t("three x equals fifteen", { via: "voice" }), t("x equals five", { via: "voice" })],
    check: (tr) => [ruleIn(tr, 2, ["R2_VALID_STEP"], "robustness"), ruleIn(tr, 3, ["R1_GUIDED_SOLVED"], "robustness")],
  },
  {
    id: "diagnosis-by-value",
    title: "Final answers diagnosed by the procedure that produces them",
    why: "x = 25/3 is exactly what adding 5 instead of subtracting, then dividing, produces.",
    inputs: [{ type: "start" }, t("x = 25/3")],
    check: (tr) => [diagnosisAt(tr, 2, "SIGN_ERROR_INVERSE_OP", "value"), ruleIn(tr, 2, ["R5_TARGETED_PROBE", "R5c_CHECK_FIRST_ERROR", "R7_REPEATED_ERROR_L1"]), noPrematureLeak(tr)],
  },
  {
    id: "step-diagnosis",
    title: "Step errors diagnosed by the transformation written",
    why: "3x = 20 (one side only) and x + 5 = 20/3 (divided part of a side) imply different values and need different help.",
    inputs: [{ type: "start" }, t("3x = 20"), t("x + 5 = 20/3")],
    check: (tr) => [diagnosisAt(tr, 2, "ONE_SIDE_ONLY", "step"), diagnosisAt(tr, 3, "UNDID_IN_WRONG_ORDER", "step"), allMathTrue(tr)],
  },
  {
    id: "forgot-divide",
    title: "x = 15 twice (stopped after subtracting)",
    why: "A procedural gap gets a targeted question; repeating it is treated as insisting.",
    inputs: [{ type: "start" }, t("x = 15"), t("x = 15")],
    check: (tr) => [diagnosisAt(tr, 2, "FORGOT_TO_DIVIDE"), ruleIn(tr, 2, ["R5_TARGETED_PROBE", "R5c_CHECK_FIRST_ERROR", "R7_REPEATED_ERROR_L1"]), ruleIn(tr, 3, ["R4_RESPECTFUL_CHALLENGE", "R7_REPEATED_ERROR"], "recovery"), noPrematureLeak(tr), allMathTrue(tr)],
  },
  {
    id: "arithmetic-slip",
    title: "3x = 14 — right move, wrong subtraction",
    why: "Don't re-teach a concept the student already has.",
    inputs: [{ type: "start" }, t("3x = 14")],
    check: (tr) => [diagnosisAt(tr, 2, "ARITHMETIC_SLIP", "step"), ruleIn(tr, 2, ["R14_SLIP"])],
  },
  {
    id: "true-but-no-progress",
    title: "20 = 3x + 5 — true, but no progress",
    why: "Validation must distinguish 'correct' from 'useful'.",
    inputs: [{ type: "start" }, t("20 = 3x + 5")],
    check: (tr) => [ruleIn(tr, 2, ["R3_VALID_NO_PROGRESS"])],
  },
  {
    id: "reversed-valid-step",
    title: "15 = 3x is a valid step — and the next hint is to divide",
    why: "Orientation must not change the maths: after 15 = 3x the next move is dividing, not 'subtract 15'.",
    // NOTICE (turn 3) → THINK (turn 4) → TRY (turn 5): the move is named at the TRY stage.
    inputs: [{ type: "start" }, t("15 = 3x"), t("I'm stuck"), t("hint please"), t("hint please")],
    check: (tr) => [
      ruleIn(tr, 2, ["R2_VALID_STEP"], "math"),
      says(tr, 5, /divide both sides by 3/, "TRY hint names dividing by 3", "math"),
      says(tr, 5, /subtract 15/, "never says 'subtract 15'", "math", true),
      says(tr, 4, /subtract 15|3x = 3x|15 = 15/, "THINK question reads the reversed line correctly", "math", true),
    ],
  },
  {
    id: "confused-student",
    title: "\"I'm confused\"",
    why: "Confusion is a request for help, not an off-topic message.",
    inputs: [{ type: "start" }, t("I'm confused")],
    check: (tr) => [ruleIn(tr, 2, ["R8b_CONFUSED"]), endsWithQuestion(tr, 2), says(tr, 2, /park that|later/i, "doesn't brush it off", "appropriateness", true)],
  },
  {
    id: "concept-why-subtract",
    title: "\"Why do we subtract 5?\"",
    why: "A conceptual question gets a conceptual answer — not the result of the step.",
    inputs: [{ type: "start" }, t("Why do we subtract 5?")],
    check: (tr) => [ruleIn(tr, 2, ["R18_CONCEPT_WHY_INVERSE_CONSTANT"]), says(tr, 2, /3x = 15|\b15\b/, "doesn't give away the step result (15)", "leak", true), noPrematureLeak(tr)],
  },
  {
    id: "concept-divide-first",
    title: "\"Can we divide first?\"",
    why: "Dividing first is valid maths. Say so truthfully, with a correct example, then hand back.",
    inputs: [{ type: "start" }, t("Can we divide first?")],
    check: (tr) => [ruleIn(tr, 2, ["R18_CONCEPT_ORDER"]), says(tr, 2, /\byes\b/i, "answers truthfully (yes, it's allowed)", "math"), noPrematureLeak(tr), allMathTrue(tr)],
  },
  {
    id: "concept-negatives",
    title: "\"I don't understand negative numbers\"",
    why: "A side question about a prerequisite deserves a short, accurate answer.",
    inputs: [{ type: "start" }, t("I don't understand negative numbers")],
    check: (tr) => [ruleIn(tr, 2, ["R18_CONCEPT_NEGATIVES"]), allMathTrue(tr)],
  },
  {
    id: "dispute",
    title: "\"Your answer is wrong\" — before and after a step is shown",
    why: "Disputes get a computed re-check of what was actually shown, not a defensive reply.",
    inputs: [{ type: "start" }, t("I think your answer is wrong"), t("x = 12"), t("x = 45"), t("no idea"), t("no idea"), t("that's wrong, you made a mistake")],
    check: (tr) => [
      ruleIn(tr, 2, ["R19_DISPUTE_NOTHING_SHOWN"]),
      ruleIn(tr, 7, ["R19_DISPUTE_RECHECK_SHOWN"]),
      says(tr, 7, /20 − 5 = 15|20 - 5 = 15/, "re-derives the shown step with its arithmetic", "math"),
      noPrematureLeak(tr),
      allMathTrue(tr),
    ],
  },
  {
    id: "off-topic-question",
    title: "\"What's the capital of France?\"",
    why: "A children's tutor stays in scope: acknowledge, don't answer, return to the task.",
    inputs: [{ type: "start" }, t("What's the capital of France?")],
    check: (tr) => [ruleIn(tr, 2, ["R13_REDIRECT"]), says(tr, 2, /paris/i, "doesn't answer the unrelated question", "appropriateness", true)],
  },
  {
    id: "malformed-math",
    title: "\"3x + = 20\"",
    why: "Unparseable maths must not be guessed at or counted as an attempt.",
    inputs: [{ type: "start" }, t("3x + = 20")],
    check: (tr, s) => [
      ruleIn(tr, 2, ["R20_MALFORMED_MATH"], "robustness"),
      { name: "not counted as an attempt", category: "robustness", passed: s.attempts === 0, detail: `attempts=${s.attempts}` },
      { name: "nothing added to the board", category: "robustness", passed: s.board.length === 1, detail: `${s.board.length} board entries` },
    ],
  },
  {
    id: "correct-answer-flawed-reasoning",
    title: "\"x = 5 because 20 divided by 4 is 5\"",
    why: "A right answer with invalid reasoning is not independent evidence of the skill.",
    inputs: [{ type: "start" }, t("x = 5 because 20 divided by 4 is 5")],
    check: (tr, s) => [
      ruleIn(tr, 2, ["R17_CORRECT_BUT_FLAWED_REASONING"], "mastery"),
      { name: "recorded as assisted, not independent", category: "mastery", passed: s.mastery.observations.some((o) => o.problemId === "p0" && o.assisted), detail: JSON.stringify(s.mastery.observations) },
      says(tr, 2, /\b4\b/, "names the flaw (the 4 doesn't come from the equation)", "appropriateness"),
      allMathTrue(tr),
    ],
  },
  {
    id: "arithmetic-question",
    title: "\"What is 20 minus 5?\"",
    why: "Computing it would do the student's step for them.",
    inputs: [{ type: "start" }, t("what is 20 minus 5?")],
    check: (tr) => [ruleIn(tr, 2, ["R21_ARITHMETIC_HANDBACK"]), says(tr, 2, /\b15\b/, "doesn't compute the step result", "leak", true)],
  },
  {
    id: "recurring-misconception",
    title: "Same sign error on the guided problem and again on a transfer problem",
    why: "A misconception that survives a problem needs direct attention, not the same probe again.",
    inputs: [{ type: "start" }, t("3x = 25"), t("3x = 15"), t("x = 5"), signErrorOnCurrent],
    check: (tr, s) => [
      diagnosisAt(tr, 5, "SIGN_ERROR_INVERSE_OP", "step"),
      ruleIn(tr, 5, ["R5b_RECURRING_MISCONCEPTION", "R5_TARGETED_PROBE"], "recovery"),
      { name: "tracked as recurring across problems", category: "recovery", passed: new Set((s.misconceptionHistory ?? []).filter((m) => m.id === "SIGN_ERROR_INVERSE_OP").map((m) => m.problemId)).size === 2, detail: JSON.stringify(s.misconceptionHistory) },
      allMathTrue(tr),
    ],
  },
  {
    id: "natural-help-progression",
    title: "\"I'm stuck\" → \"I'm confused\" → \"I don't get it\"",
    why: "Everyday words for help get one stage at a time — NOTICE, then THINK, then TRY — never the answer, never the same words.",
    inputs: [{ type: "start" }, t("I'm stuck"), t("I'm confused"), t("I don't get it")],
    check: (tr) => [
      stageAt(tr, 2, "NOTICE"),
      stageAt(tr, 3, "THINK"),
      stageAt(tr, 4, "TRY"),
      says(tr, 3, /3x = 15|\b15\b/, "THINK doesn't give away the step result", "leak", true),
      noIdenticalConsecutiveReplies(tr),
      hintLadderMonotonic(tr),
      noPrematureLeak(tr),
      allMathTrue(tr),
    ],
  },
  {
    id: "explain-differently",
    title: "\"Explain it another way\", twice",
    why: "If the explanation didn't land, repeating it won't help: same amount of help, a different angle each time.",
    inputs: [{ type: "start" }, t("I'm stuck"), t("Explain it another way"), t("Can you explain that again?")],
    check: (tr) => [
      ruleIn(tr, 3, ["R24_REPHRASE"]),
      ruleIn(tr, 4, ["R24_REPHRASE"]),
      { name: "hint level unchanged by rephrasing", category: "appropriateness", passed: at(tr, 3)?.decision.hintLevel === at(tr, 2)?.decision.hintLevel && at(tr, 4)?.decision.hintLevel === at(tr, 2)?.decision.hintLevel, detail: [2, 3, 4].map((n) => at(tr, n)?.decision.hintLevel).join(" → ") },
      noIdenticalConsecutiveReplies(tr),
      noPrematureLeak(tr),
    ],
  },
  {
    id: "bare-why",
    title: "\"Why?\" after a hint, and \"Why?\" out of nowhere",
    why: "A bare why is about the tutor's last move; with nothing to refer to, ask one short question instead of guessing.",
    inputs: [{ type: "start" }, t("Why?"), t("I'm stuck"), t("I need more help"), t("I need more help"), t("Why?")],
    check: (tr) => [
      ruleIn(tr, 2, ["R22_CLARIFY_WHY"]),
      ruleIn(tr, 6, ["R18_CONCEPT_WHY_INVERSE_CONSTANT"]),
      says(tr, 6, /3x = 15|\b15\b/, "the why-answer doesn't give away the step result", "leak", true),
      noPrematureLeak(tr),
    ],
  },
  {
    id: "small-example",
    title: "\"Can you show me a small example?\"",
    why: "A worked example on different numbers teaches the move without doing the student's step.",
    inputs: [{ type: "start" }, t("Can you show me a small example?")],
    check: (tr) => [ruleIn(tr, 2, ["R25_SMALL_EXAMPLE"]), says(tr, 2, /3x = 15/, "doesn't do the student's step", "leak", true), noPrematureLeak(tr), allMathTrue(tr)],
  },
  {
    id: "no-answer-preference",
    title: "\"Don't tell me the answer\", then struggles and asks to be told",
    why: "A stated preference not to be told is honoured: no worked solution, hints stop at naming the move.",
    inputs: [{ type: "start" }, t("Don't tell me the answer"), t("x = 12"), t("x = 45"), t("x = 1"), t("x = 15"), t("x = 2"), t("please just tell me"), t("I'm stuck")],
    check: (tr) => [
      ruleIn(tr, 2, ["R27_NO_REVEAL_PREFERENCE"]),
      { name: "no worked solution after the student asked not to be told", category: "leak", passed: !tr.some((x) => x.decision.rule === "R9_REVEAL_AFTER_EFFORT" || x.decision.rule.endsWith("_L3")), detail: tr.map((x) => x.decision.rule).join(", ") },
      noPrematureLeak(tr),
      allMathTrue(tr),
    ],
  },
  {
    id: "ambiguous-and-slower",
    title: "\"hmm\" and \"Can we go slower?\"",
    why: "Unclear input gets one clarifying question (not counted as an attempt); 'slower' points at one part without adding information.",
    inputs: [{ type: "start" }, t("hmm"), t("Can we go slower?")],
    check: (tr, s) => [
      ruleIn(tr, 2, ["R22_CLARIFY"]),
      { name: "unclear input isn't counted as an attempt", category: "robustness", passed: s.attempts === 0, detail: `attempts ${s.attempts}` },
      ruleIn(tr, 3, ["R26_SLOWER_ONE_IDEA"]),
      stageAt(tr, 3, "NOTICE"),
      noPrematureLeak(tr),
    ],
  },
  {
    id: "help-before-transfer",
    title: "Asks for help before trying a fresh problem",
    why: "Needing help on a transfer item is evidence too — the estimate shouldn't ignore it.",
    inputs: [{ type: "start" }, t("3x = 15"), t("x = 5"), t("I don't know")],
    check: (tr, s) => [
      { name: "recorded as an unsuccessful independent attempt", category: "mastery", passed: s.mastery.observations.some((o) => o.kind === "transfer" && !o.correct), detail: JSON.stringify(s.mastery.observations) },
      { name: "status is insufficient evidence, not mastered", category: "mastery", passed: s.mastery.status === "insufficient_evidence", detail: s.mastery.status },
      noPrematureLeak(tr),
    ],
  },
  /* ---------- Conversational understanding (v3.4) ---------- */
  {
    id: "conv-bodmas-screenshot",
    title: "Regression: \"I will do BODMAS multiplication.\" → \"I said will do multiplication.\"",
    why: "The reported failure: a meaningful proposal got a generic redirect, then the repeat got another. The tutor must recognise the proposal, explain BODMAS vs undoing, and repair when the student repeats.",
    inputs: [{ type: "start" }, t("I'm stuck"), t("I will do BODMAS multiplication.", { via: "voice" }), t("I said will do multiplication.", { via: "voice" })],
    check: (tr, s) => [
      verdictAt(tr, 3, "evaluation_order"),
      ruleIn(tr, 3, ["R31_OP_EVALUATION_ORDER"]),
      says(tr, 3, /multipl/i, "turn 3 acknowledges the multiplication idea", "appropriateness"),
      says(tr, 3, /\+ 5/, "turn 3 points at the + 5", "appropriateness"),
      oneQuestion(tr, 3),
      ruleIn(tr, 4, ["R31b_OP_EVALUATION_ORDER_REPAIR", "R39"]),
      says(tr, 4, /heard|said|multipl/i, "turn 4 acknowledges what the student repeated", "appropriateness"),
      oneQuestion(tr, 4),
      noGenericReply(tr, [3, 4]),
      noIdenticalConsecutiveReplies(tr),
      stillGuided(s, 1),
      noPrematureLeak(tr),
    ],
  },
  {
    id: "conv-correct-move-in-words",
    title: "\"Take five away.\" then the student writes the line",
    why: "A move described in words is verified, confirmed, and handed back — it is not the answer 5, and the tutor doesn't do the step.",
    inputs: [{ type: "start" }, t("Take five away."), t("3x = 15")],
    check: (tr) => [
      verdictAt(tr, 2, "correct_next"),
      ruleIn(tr, 2, ["R30_OP_RIGHT_MOVE"]),
      stageAt(tr, 2, "TRY"),
      says(tr, 2, /3x = 15/, "turn 2 leaves the result for the student", "leak", true),
      ruleIn(tr, 3, ["R2_VALID_STEP"]),
      noPrematureLeak(tr),
    ],
  },
  {
    id: "conv-move-language",
    title: "\"Move the five to the other side.\"",
    why: "Common classroom language; it means subtracting 5 from both sides — say so, without calling it wrong.",
    inputs: [{ type: "start" }, t("Move the five to the other side.")],
    check: (tr, s) => [verdictAt(tr, 2, "correct_next"), ruleIn(tr, 2, ["R30_OP_RIGHT_MOVE"]), says(tr, 2, /both sides/, "connects 'moving' to doing it to both sides", "appropriateness"), stillGuided(s, 1)],
  },
  {
    id: "conv-wrong-inverse",
    title: "\"Add 5 to both sides\"",
    why: "Wrong inverse: show the computed consequence (3x + 10 = 25) rather than just saying 'no'.",
    inputs: [{ type: "start" }, t("add 5 to both sides")],
    check: (tr) => [verdictAt(tr, 2, "wrong_inverse"), says(tr, 2, /3x \+ 10 = 25/, "shows the exact result of their move", "math"), oneQuestion(tr, 2), allMathTrue(tr), noPrematureLeak(tr)],
  },
  {
    id: "conv-one-side",
    title: "\"Subtract 5 from the left side\"",
    why: "Right operation, one side only: the balance breaks. Ask about the other side.",
    inputs: [{ type: "start" }, t("subtract 5 from the left side")],
    check: (tr) => [verdictAt(tr, 2, "one_side"), says(tr, 2, /right side/, "asks about the other side", "appropriateness"), oneQuestion(tr, 2)],
  },
  {
    id: "conv-plausible-divide-first",
    title: "\"I'll divide both sides by 3 first\"",
    why: "Plausible and actually valid — say so honestly, show the fraction it creates, let the student choose. (The question form, \"Can we divide by three?\", is the concept-divide-first scenario.)",
    inputs: [{ type: "start" }, t("I'll divide both sides by 3 first")],
    check: (tr) => [verdictAt(tr, 2, "divide_first"), says(tr, 2, /\byes\b|you can/i, "says truthfully that it's allowed", "math"), says(tr, 2, /5\/3/, "shows the fraction exactly", "math"), allMathTrue(tr)],
  },
  {
    id: "conv-repeated-proposal",
    title: "Says \"multiply\" three times",
    why: "Re-explaining the same way a third time doesn't help. Acknowledge the repeat, then escalate to naming the move — still not doing the step.",
    inputs: [{ type: "start" }, t("multiply"), t("multiply"), t("multiply")],
    check: (tr) => [
      ruleIn(tr, 2, ["R31_OP_EVALUATION_ORDER"]),
      ruleIn(tr, 3, ["R31b_OP_EVALUATION_ORDER_REPAIR"], "recovery"),
      ruleIn(tr, 4, ["R39_OP_REPEATED_NAME_MOVE"], "recovery"),
      says(tr, 4, /3x = 15/, "names the move but leaves the result", "leak", true),
      noIdenticalConsecutiveReplies(tr),
      hintLadderMonotonic(tr),
    ],
  },
  {
    id: "conv-correction",
    title: "\"I'll do multiplication first.\" → \"No, I meant subtract.\"",
    why: "Corrections replace the earlier proposal; the tutor says what changed and verifies the new move.",
    inputs: [{ type: "start" }, t("I'll do multiplication first."), t("No, I meant subtract.")],
    check: (tr) => [verdictAt(tr, 2, "evaluation_order"), verdictAt(tr, 3, "correct_next"), says(tr, 3, /subtract/i, "acknowledges the corrected move", "appropriateness"), ruleIn(tr, 3, ["R30_OP_RIGHT_MOVE"])],
  },
  {
    id: "conv-asr-errors",
    title: "Speech-recognition spellings: \"bod mass\", \"three x equals fifteen\"",
    why: "Recognisers mis-spell. Known spellings of BODMAS and spoken maths are normalised before reading.",
    inputs: [{ type: "start" }, t("I will do bod mass", { via: "voice" }), t("three x equals fifteen", { via: "voice" })],
    check: (tr) => [verdictAt(tr, 2, "evaluation_order"), ruleIn(tr, 3, ["R2_VALID_STEP"], "robustness")],
  },
  {
    id: "conv-ambiguous-number",
    title: "\"Get the 3 away from x\"",
    why: "One number in a sentence is not automatically an answer. When the meaning isn't clear, ask.",
    inputs: [{ type: "start" }, t("get the 3 away from x")],
    check: (tr, s) => [ruleIn(tr, 2, ["R22_CLARIFY"]), stillGuided(s, 1), { name: "not counted as an attempt", category: "robustness", passed: s.attempts === 0, detail: `attempts ${s.attempts}` }],
  },
  {
    id: "conv-frustrated",
    title: "\"This is stupid, I hate this\"",
    why: "Frustration isn't off-topic. Acknowledge it and make the task smaller.",
    inputs: [{ type: "start" }, t("this is stupid I hate this")],
    check: (tr) => [ruleIn(tr, 2, ["R8", "R9"]), noGenericReply(tr, [2]), endsWithQuestion(tr, 2), noPrematureLeak(tr)],
  },
  {
    id: "conv-why-after-bodmas",
    title: "\"Wait, why?\" after the BODMAS explanation",
    why: "A bare 'why' refers to the tutor's last point; answer it, don't redirect.",
    inputs: [{ type: "start" }, t("I will do BODMAS multiplication."), t("Wait, why?")],
    check: (tr) => [ruleIn(tr, 3, ["R18_CONCEPT"]), noGenericReply(tr, [3]), says(tr, 3, /3x = 15/, "explains without giving the step result", "leak", true)],
  },
  {
    id: "conv-stronger-hint",
    title: "\"I'm stuck\" → \"Give me a bigger hint\"",
    why: "Asking for more help moves up the ladder, never down, and never repeats the same words.",
    inputs: [{ type: "start" }, t("I'm stuck"), t("give me a bigger hint")],
    check: (tr) => [ruleIn(tr, 2, ["R8"]), ruleIn(tr, 3, ["R9"], "recovery"), hintLadderMonotonic(tr), noIdenticalConsecutiveReplies(tr), noPrematureLeak(tr)],
  },
  {
    id: "conv-answer-reveal-attempts",
    title: "\"What's x?\", \"Just tell me x\", \"What does x equal?\"",
    why: "Asking for the value of x, three ways, before trying: help escalates, but the answer is never given early.",
    inputs: [{ type: "start" }, t("what's x?"), t("just tell me x"), t("what does x equal")],
    check: (tr) => [ruleIn(tr, 2, ["R8", "R9"]), ruleIn(tr, 3, ["R8", "R9"]), ruleIn(tr, 4, ["R8", "R9"]), noGenericReply(tr, [2, 3, 4]), noPrematureLeak(tr), hintLadderMonotonic(tr)],
  },
  {
    id: "conv-multi-turn-continuity",
    title: "Whole problem in words and lines: part → operation → line → operation → answer",
    why: "Each reply builds on what the tutor just asked; the student does every step.",
    inputs: [{ type: "start" }, t("I'm stuck"), t("the addition"), t("subtract it"), t("3x = 15"), t("divide by 3"), t("x = 5")],
    check: (tr, s) => [
      ruleIn(tr, 3, ["R37_PART_RIGHT"]),
      verdictAt(tr, 4, "correct_next"),
      ruleIn(tr, 5, ["R2_VALID_STEP"]),
      verdictAt(tr, 6, "correct_next"),
      ruleIn(tr, 7, ["R1_GUIDED_SOLVED"]),
      { name: "solved by the student, then transfer", category: "mastery", passed: s.phase === "TRANSFER", detail: s.phase },
      noPrematureLeak(tr),
      allMathTrue(tr),
    ],
  },
  {
    id: "conv-unexpected-correct",
    title: "\"Is it 5?\" straight away",
    why: "A correct answer the tutor didn't expect yet is still correct — accept it, then check with a fresh problem.",
    inputs: [{ type: "start" }, t("is it 5?")],
    check: (tr, s) => [ruleIn(tr, 2, ["R1_GUIDED_SOLVED"]), { name: "moves to an independent check", category: "mastery", passed: s.phase === "TRANSFER", detail: s.phase }],
  },
  {
    id: "conv-incomplete-and-continued",
    title: "Cut off: \"I think we\"; split: \"subtract 5 from\" … \"both sides\"",
    why: "Speech gets cut off. Ask the student to finish instead of guessing; a fragment that completes the last sentence is read with it.",
    inputs: [{ type: "start" }, t("I think we", { via: "voice" }), t("subtract 5 from", { via: "voice" }), t("both sides", { via: "voice" })],
    check: (tr) => [
      ruleIn(tr, 2, ["R22c_INCOMPLETE"]),
      verdictAt(tr, 4, "correct_next"),
      { name: "turn 4 read as finishing turn 3", category: "robustness", passed: !!at(tr, 4)?.context?.continuation, detail: JSON.stringify(at(tr, 4)?.context ?? {}) },
      noIdenticalConsecutiveReplies(tr),
    ],
  },
  {
    id: "conv-voice-text-switch",
    title: "Switching between speaking and typing mid-problem",
    why: "Voice and text go through one pipeline; switching mustn't lose context.",
    inputs: [{ type: "start" }, t("take five away", { via: "voice" }), t("3x = 15"), t("divide both sides by three", { via: "voice" }), t("x = 5")],
    check: (tr) => [verdictAt(tr, 2, "correct_next"), ruleIn(tr, 3, ["R2_VALID_STEP"]), verdictAt(tr, 4, "correct_next"), ruleIn(tr, 5, ["R1_GUIDED_SOLVED"]), noPrematureLeak(tr)],
  },
  {
    id: "conv-go-back",
    title: "\"Go back.\" after an explanation",
    why: "Asking to go back restates the last message without advancing anything.",
    inputs: [{ type: "start" }, t("I will do BODMAS multiplication."), t("Go back.")],
    check: (tr) => [ruleIn(tr, 3, ["R11_REPEAT"], "robustness"), { name: "state did not advance", category: "robustness", passed: !at(tr, 3)!.stateDelta.attempts && !at(tr, 3)!.stateDelta.hintLevel, detail: JSON.stringify(at(tr, 3)!.stateDelta) }],
  },
];
