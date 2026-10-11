import { Fraction } from "./fraction";
import { parseEquation, evaluate, type Equation } from "./algebra";
import { MISCONCEPTIONS, fillTemplate, normalize, type MisconceptionId, type Normal } from "./misconceptions";
import type { Problem } from "./problems";
import type { Decision, FocusRole, Observation, SessionState, TeachingMemory, TeachingStage } from "./types";
import { affectLine } from "./affect";
import { answerLead, confusionLead } from "./leads";
import { noticeVariants, pick, shownStepAgain, smallExample, thinkVariants, tryVariants } from "./language/explanations";

/**
 * The teaching policy: an explicit, inspectable rule table.
 *
 * For every validated observation it returns the set of PERMITTED decisions,
 * best default first. Each decision fixes the action, the hint level, the facts
 * that may be used and whether the answer / next step may be revealed.
 *
 *  - Deterministic mode uses the default (first) candidate.
 *  - LLM mode may choose any candidate (e.g. a check instead of a probe for a
 *    frustrated student) and writes the wording — but cannot create a new
 *    action, skip a rung of the hint ladder, or unlock a reveal.
 *
 * Principles (sources in docs/RESEARCH.md): make the student do the thinking;
 * when we don't know why they're wrong, ask; escalate help gradually and bottom
 * out on the next step only; verify mastery on fresh problems without help.
 */

export const REVEAL_AFTER_ATTEMPTS = 5;

export interface NextStep {
  operation: string; // "subtract 5 from both sides"
  resultRaw: string; // "3x = 15"
  resultEq: Equation;
  arithmetic: string; // "20 − 5 = 15"
}

const isNeg = (f: Fraction) => f.valueOf() < 0;
const absF = (f: Fraction) => (isNeg(f) ? f.neg() : f);
const ax = (a: Fraction) => (a.eq(1) ? "x" : `${a}x`);

export function nextStepFrom(n: Normal): NextStep {
  if (!n.B.isZero()) {
    const neg = isNeg(n.B);
    const bAbs = absF(n.B);
    const rhs = n.C.sub(n.B);
    const raw = `${ax(n.A)} = ${rhs}`;
    return {
      operation: neg ? `add ${bAbs} to both sides` : `subtract ${bAbs} from both sides`,
      resultRaw: raw,
      resultEq: parseEquation(raw)!,
      arithmetic: `${n.C} ${neg ? "+" : "−"} ${bAbs} = ${rhs}`,
    };
  }
  const val = n.C.div(n.A);
  const raw = `x = ${val}`;
  return { operation: `divide both sides by ${n.A}`, resultRaw: raw, resultEq: parseEquation(raw)!, arithmetic: `${n.C} ÷ ${n.A} = ${val}` };
}

export interface PolicyContext {
  problem: Problem;
  current: Normal; // latest valid form of the student's work
  currentRaw: string;
  correct: Fraction;
  next: NextStep;
  isFinalStep: boolean; // next step yields the answer
}

export function buildContext(state: SessionState): PolicyContext {
  const problem = state.problems[state.current];
  const eq = parseEquation(state.lastValidRaw) ?? parseEquation(problem.text)!;
  const current = normalize(eq);
  const correct = current.C.sub(current.B).div(current.A);
  return { problem, current, currentRaw: state.lastValidRaw || problem.text, correct, next: nextStepFrom(current), isFinalStep: current.B.isZero() };
}

type Partial2 = Omit<Decision, "id" | "facts" | "templateVars" | "revealAllowed" | "nextStepAllowed" | "allowedEquations" | "assistive"> & Partial<Decision>;
function d(p: Partial2): Decision {
  return {
    id: p.rule,
    facts: [],
    templateVars: {},
    revealAllowed: false,
    nextStepAllowed: false,
    allowedEquations: [],
    assistive: p.action === "HINT" || p.action === "EXPLAIN",
    ...p,
  };
}

/** Shared, deterministically computed template variables for this turn. */
function baseVars(state: SessionState, obs: Observation, ctx: PolicyContext): Record<string, string> {
  const { problem, current: n, next } = ctx;
  const bAbs = absF(n.B);
  const v: Record<string, string> = {
    problem: problem.text,
    current: ctx.currentRaw,
    nextOp: next.operation,
    nextResult: next.resultRaw,
    a: n.A.toString(),
    c: problem.c.toString(),
    bAbs: bAbs.toString(),
    bOp: isNeg(n.B) ? "−" : "+",
    value: obs.studentValue ?? "",
    step: (obs.studentRaw ?? "").replace(/(\d)\s+x\b/g, "$1x"), // spoken "3 x = 15" reads back as "3x = 15"
  };
  v.opsQuestion = n.B.isZero()
    ? `in ${ctx.currentRaw}, x is being multiplied by ${n.A}. What undoes multiplying?`
    : `the left side of ${ctx.currentRaw} has a multiplication and ${isNeg(n.B) ? "a subtraction" : "an addition"}. Which one would you undo first?`;
  const check = obs.check?.text;
  if (check) v.check = check;
  v.did = didWords(obs);
  v.back = state.dialog?.lastQuestion || (n.B.isZero() ? `What undoes multiplying by ${n.A}?` : "What would you do first?");
  return v;
}

/** What the student just did, in words, from the observed operation ("took 5 away from both sides"). */
function didWords(obs: Observation): string {
  const o = obs.observed;
  if (!o || !o.sameOnBoth) return "";
  if (o.left.kind === "add") return isNeg(o.left.k) ? `took ${absF(o.left.k)} away from both sides` : `added ${o.left.k} to both sides`;
  if (o.left.kind === "scale") {
    const f = o.left.f;
    const inv = new Fraction(1).div(f);
    return f.valueOf() !== 0 && Math.abs(f.valueOf()) < 1 && inv.d === 1 ? `divided both sides by ${inv}` : `multiplied both sides by ${f}`;
  }
  return "";
}

/** The teaching memory, with defaults for sessions saved before it existed. */
export function teachingOf(state: SessionState): TeachingMemory {
  return state.teaching ?? { objective: "", confusion: 0, strategies: [], hintHistory: [], answerRequests: 0, affect: 0, offTopic: 0 };
}

/** Can the current line be drawn as a balance (bags of x and unit blocks, small whole numbers)? */
export function balanceDrawable(n: Normal) {
  const ok = (f: Fraction) => f.d === 1;
  return ok(n.A) && ok(n.B) && ok(n.C) && n.A.valueOf() >= 1 && n.A.valueOf() <= 9 && n.B.valueOf() >= 0 && n.C.valueOf() >= n.B.valueOf() && n.C.valueOf() <= 40;
}

/** Opening words for a help turn: a feeling first, then an answer request, then how many times they've been stuck. */
function helpLead(obs: Observation, tm: TeachingMemory, conf: number, visual: boolean): string {
  if (obs.affect === "worried" || obs.affect === "frustrated") return affectLine(obs.affect, "algebra", tm.affect);
  if (obs.request === "answer") return answerLead(tm.answerRequests);
  return confusionLead(conf, visual);
}

export function candidates(state: SessionState, obs: Observation, ctx: PolicyContext): Decision[] {
  return rawCandidates(state, obs, ctx).map((d) => withPresentation(d, obs, ctx));
}

/** Turns about the student's own line (checks of it, questions about how they got it). Probes about a term of the
 *  current accepted line ("what undoes + 5?") anchor to that line instead, so the highlighted term is the one named. */
const STUDENT_LINE_TEMPLATES = new Set(["probe_unknown", "verify_check", "insist_check", "contrast_check", "hint1_check", "slip", "valid_step", "no_progress", "correct_flawed"]);
const CONSTANT_SIDE: MisconceptionId[] = ["SIGN_ERROR_INVERSE_OP", "ONE_SIDE_ONLY", "COMBINED_UNLIKE_TERMS", "UNDID_IN_WRONG_ORDER"];

/**
 * Presentation metadata (UI only — never affects teaching): which line a turn is about and
 * which terms of it, so the board can point at "+ 5" and "20" when the hint is about them.
 * Deterministic, derived from the decision and the validated observation.
 */
function withPresentation(d: Decision, obs: Observation, ctx: PolicyContext): Decision {
  const studentLine = STUDENT_LINE_TEMPLATES.has(d.template) && (obs.kind === "invalid" || obs.kind === "valid_step" || obs.kind === "valid_no_progress" || obs.kind === "correct_flawed");
  const constantLeft = !ctx.current.B.isZero();
  const aboutConstant: FocusRole[] = ["constant", "other-side"];
  const aboutCoefficient: FocusRole[] = ["x-term", "other-side"];
  const dg = obs.diagnosis?.id;
  let focus: FocusRole[] = [];
  switch (d.template) {
    case "hint2":
    case "explain_step":
    case "explain_final":
    case "reveal":
      focus = constantLeft ? aboutConstant : aboutCoefficient;
      break;
    case "help_choice":
    case "confused_choice":
      focus = constantLeft ? ["x-term", "constant"] : ["x-term"];
      break;
    case "op":
      focus = d.templateVars.opFocus === "coefficient" ? ["x-term"] : d.templateVars.opFocus === "constant" ? ["constant", "other-side"] : [];
      break;
    case "micro":
    case "slower":
      focus = d.stage === "NOTICE" ? (constantLeft ? ["constant"] : ["x-term"]) : d.stage === "TRY" ? (constantLeft ? aboutConstant : aboutCoefficient) : constantLeft ? ["x-term", "constant"] : ["x-term"];
      break;
    case "probe_targeted":
    case "recurring":
    case "address_misconception":
    case "hint1":
    case "insist_focus":
      focus = dg && CONSTANT_SIDE.includes(dg) ? aboutConstant : dg ? aboutCoefficient : [];
      break;
    case "verify_check":
    case "insist_check":
    case "contrast_check":
    case "hint1_check":
    case "slip":
      focus = ["other-side"];
      break;
    case "concept":
      focus = obs.topic === "why_inverse_constant" ? ["constant"] : obs.topic === "why_divide" ? ["x-term"] : obs.topic === "order" ? ["x-term", "constant"] : obs.topic === "balance" ? ["equals"] : obs.topic === "what_is_x" ? ["x-term"] : [];
      break;
  }
  return { ...d, anchor: studentLine ? "student" : "current", focus };
}

function rawCandidates(state: SessionState, obs: Observation, ctx: PolicyContext): Decision[] {
  const { problem, current } = ctx;
  const vars = baseVars(state, obs, ctx);
  const level = state.hintLevel;
  const isTransfer = problem.role === "transfer";
  const esc = (rule: string, reason: string) => escalate(state, ctx, vars, rule, reason, obs);

  switch (obs.kind) {
    case "start":
      return [
        d({
          action: "ASK",
          rule: "R0_PRESENT_PROBLEM",
          reason: "New session: present the problem and ask for the student's first move, without telling them the method.",
          hintLevel: 0,
          goal: "Greet briefly, present the equation, and ask what they would do first. Do not mention any operation.",
          facts: [`Equation: ${problem.text}`],
          template: "present",
          templateVars: vars,
        }),
      ];

    case "after_complete":
      return [d({ action: "RECAP", rule: "R15_SESSION_COMPLETE", reason: "Lesson finished; no new content after closure.", hintLevel: 0, goal: "Say the lesson is complete and invite them to start a new one.", template: "complete", templateVars: vars, assistive: false })];

    case "repeat":
      return [
        d({
          action: "RECAP",
          rule: "R11_REPEAT",
          reason: obs.interruptedTutor ? "Student interrupted the tutor and asked to hear it again — restate briefly; do not advance state." : "Student asked to repeat — restate the last prompt; do not advance state.",
          hintLevel: level,
          goal: "Restate the previous message in fewer, simpler words. Add nothing new.",
          facts: [`Previous tutor message: ${state.lastTutorText}`],
          template: "repeat",
          templateVars: { ...vars, last: state.lastTutorText },
          allowedEquations: state.lastTutorGrounded ?? [],
          revealAllowed: !!state.revealedLast,
          nextStepAllowed: !!state.revealedLast,
          assistive: false,
        }),
      ];

    case "empty":
    case "silence": {
      if (state.silences === 0 && obs.kind === "silence") {
        return [
          d({ action: "WAIT", rule: "R10_WAIT_FIRST_SILENCE", reason: "First silence: thinking time is productive. Reassure; offer (not force) help.", hintLevel: level, goal: "Reassure them that taking time is fine, and offer a hint if they want one. One sentence.", template: "wait", templateVars: vars }),
          esc("R10_SILENCE_EARLY_HINT", "Alternative: the student may be stuck rather than thinking — offer the next rung now."),
        ];
      }
      return [esc("R10_SILENCE_ESCALATE", "Repeated silence: student is likely stuck — move one rung up the hint ladder.")];
    }

    case "off_topic":
      return [
        d({
          action: "ASK",
          rule: "R13_REDIRECT",
          reason: "Off-topic message. This tutor only helps with the current lesson (a deliberate scope limit for a children's product): acknowledge warmly, return to the step.",
          hintLevel: level,
          goal: "Acknowledge briefly without answering the unrelated question, and bring them back to the current equation with a question.",
          facts: [`Current equation: ${ctx.currentRaw}`],
          template: obs.question ? "redirect_question" : "redirect",
          templateVars: vars,
          // Variety comes from the template variant (turn number); the count lets the tone get firmer, not sillier.
        }),
      ];

    case "malformed":
      return [
        d({
          action: "ASK",
          rule: "R20_MALFORMED_MATH",
          reason: "Input looks like maths but can't be parsed. Ask them to rewrite it; nothing is recorded as an attempt.",
          hintLevel: level,
          goal: "Say you couldn't read it as maths and ask them to write it with one equals sign. Don't guess what they meant.",
          template: "malformed",
          templateVars: { ...vars, raw: obs.studentRaw ?? "" },
        }),
      ];

    case "arithmetic_question":
      return [
        d({
          action: "ASK",
          rule: "R21_ARITHMETIC_HANDBACK",
          reason: "Student asked the tutor to compute. Doing the arithmetic for them would do their step; hand it back and promise to check.",
          hintLevel: level,
          goal: "Encourage them to work out the calculation themselves and say you'll check the result. Do not compute it.",
          template: "arithmetic_back",
          templateVars: vars,
        }),
      ];

    case "dispute": {
      const shown = state.lastShown;
      return [
        d({
          action: "VERIFY",
          rule: shown ? "R19_DISPUTE_RECHECK_SHOWN" : "R19_DISPUTE_NOTHING_SHOWN",
          reason: shown
            ? "Student disputes the tutor. Re-derive the last shown step with its arithmetic (computed, not generated) and ask which part looks wrong."
            : "Student disputes the tutor, but no answer or step has been given yet. Say so, and ask what looks wrong.",
          hintLevel: level,
          goal: shown ? `Show the check: from ${shown.prevRaw}, ${shown.operation} gives ${shown.resultRaw} because ${shown.arithmetic}. Ask which part looks wrong.` : "Say you haven't given an answer yet, that every board line is checked exactly, and ask which part looks wrong to them.",
          facts: shown ? [`${shown.prevRaw} → ${shown.operation} → ${shown.resultRaw} (${shown.arithmetic})`] : [],
          template: shown ? "dispute_shown" : "dispute_none",
          templateVars: shown ? { ...vars, prev: shown.prevRaw, op: shown.operation, result: shown.resultRaw, arith: shown.arithmetic } : vars,
          allowedEquations: shown ? [shown.prevRaw, shown.resultRaw] : [],
          revealAllowed: !!shown && !!parseEquation(shown.resultRaw) && /^x =/.test(shown.resultRaw),
          nextStepAllowed: !!shown,
          assistive: false,
        }),
      ];
    }

    case "concept": {
      const c = conceptAnswer(obs.topic!, ctx);
      return [
        d({
          action: "EXPLAIN",
          rule: `R18_CONCEPT_${obs.topic!.toUpperCase()}`,
          reason: "A conceptual question deserves a direct answer. Explain the idea (never the result of their next step), then hand the problem back.",
          hintLevel: level,
          goal: `Answer the question using these facts, briefly, then hand the problem back with a question: ${c.text}`,
          facts: [c.text],
          template: "concept",
          templateVars: { ...vars, concept: c.text },
          allowedEquations: c.equations,
          assistive: true,
        }),
      ];
    }

    case "why": {
      if (obs.topic) {
        const c = conceptAnswer(obs.topic, ctx);
        return [
          d({
            action: "EXPLAIN",
            rule: `R18_CONCEPT_${obs.topic.toUpperCase()}`,
            reason: `A bare "why?" — resolved from the tutor's previous turn to "${obs.topic}". Explain the idea (never the step result), then hand the problem back.`,
            hintLevel: level,
            goal: `Answer "why" about the previous move using these facts, briefly, then hand the problem back: ${c.text}`,
            facts: [c.text],
            template: "concept",
            templateVars: { ...vars, concept: c.text },
            allowedEquations: c.equations,
            assistive: true,
          }),
        ];
      }
      const part = current.B.isZero() ? `why we divide by ${current.A}` : `why we start with the ${vars.bOp} ${vars.bAbs}`;
      return [
        d({
          action: "CLARIFY",
          rule: "R22_CLARIFY_WHY",
          reason: `"Why?" with nothing specific to refer back to. Ask one short clarifying question instead of guessing.`,
          hintLevel: level,
          goal: `Ask which part they mean: why we do the same thing to both sides, or ${part}.`,
          template: "clarify_why",
          templateVars: { ...vars, part },
          assistive: false,
        }),
      ];
    }

    case "ambiguous":
      if (obs.incomplete) {
        return [
          d({
            action: "CLARIFY",
            rule: "R22c_INCOMPLETE",
            reason: "The message stops mid-sentence (likely cut off, or the student paused). Ask them to finish; don't guess the rest.",
            hintLevel: level,
            goal: "Say you caught only the start of their sentence, quote it, and ask them to finish it.",
            template: "incomplete",
            templateVars: { ...vars, raw: (obs.studentRaw ?? "").replace(/[.…\-—\s]+$/, "") },
            assistive: false,
          }),
        ];
      }
      return [
        d({
          action: "CLARIFY",
          rule: "R22_CLARIFY",
          reason: "Short and unclear, not maths and not a known request. Ask one clarifying question rather than guess.",
          hintLevel: level,
          goal: "Say you're not sure what they mean and offer two options: a small hint, or explaining the last part another way.",
          template: "clarify",
          templateVars: { ...vars, raw: obs.studentRaw ?? "" },
          assistive: false,
        }),
      ];

    case "ack":
      return [
        d({
          action: "ASK",
          rule: "R23_ACK_TRY",
          reason: "The student acknowledged. Invite them to make the next move themselves.",
          hintLevel: level,
          goal: "Encourage them to go ahead and write their next line. One short sentence.",
          template: "ack_try",
          templateVars: vars,
          assistive: false,
          stage: "TRY",
        }),
      ];

    case "no_answer":
      return [
        d({
          action: "ASK",
          rule: "R27_NO_REVEAL_PREFERENCE",
          reason: "The student asked not to be told the answer. Honour it for this lesson: no worked solution, and hints stop at naming the move.",
          hintLevel: level,
          goal: "Agree warmly, promise only nudges, and invite their next line.",
          template: "no_reveal_ack",
          templateVars: vars,
          assistive: false,
          stage: "TRY",
        }),
      ];

    case "slower": {
      const text = pick(noticeVariants(ctx), (state.explainVariant ?? 0) + 1);
      return [
        d({
          action: "ASK",
          rule: "R26_SLOWER_ONE_IDEA",
          reason: "The student asked to go slower. Don't add information: point at one part of the equation only (read-aloud pace also slows).",
          hintLevel: level,
          goal: `Agree to go one piece at a time and point at a single part: ${text}`,
          facts: [text],
          template: "slower",
          templateVars: { ...vars, micro: text },
          assistive: true,
          stage: "NOTICE",
        }),
      ];
    }

    case "rephrase": {
      const k = (state.explainVariant ?? 0) + 1;
      const shown = state.hintLevel >= 3;
      const stage: TeachingStage = state.lastStage ?? (level >= 2 ? "TRY" : level === 1 ? "THINK" : "NOTICE");
      const text = shown ? shownStepAgain(ctx) : stage === "TRY" && level >= 2 ? pick(tryVariants(ctx), k) : stage === "THINK" || (stage === "TRY" && level < 2) ? pick(thinkVariants(ctx), k) : pick(noticeVariants(ctx), k);
      const st: TeachingStage = shown ? "TRY" : stage === "TRY" && level < 2 ? "THINK" : stage;
      return [
        d({
          action: "RETEACH",
          rule: `R24_REPHRASE_${shown ? "SHOWN_STEP" : st}`,
          reason: `Asked for a different explanation. Same amount of help (hint level ${level}), new angle — never the same wording again.`,
          hintLevel: level,
          goal: `Explain the same idea a different way, at the ${st} stage: ${text}`,
          facts: [text],
          template: "micro",
          templateVars: { ...vars, micro: text },
          nextStepAllowed: shown,
          revealAllowed: shown && ctx.isFinalStep,
          allowedEquations: shown ? [ctx.next.resultRaw] : [],
          assistive: true,
          stage: st,
        }),
      ];
    }

    case "example": {
      const ex = smallExample(ctx, state.explainVariant ?? 0);
      return [
        d({
          action: "EXPLAIN",
          rule: "R25_SMALL_EXAMPLE",
          reason: "Asked for an example. Work a smaller equation with different numbers that needs the same kind of move, then hand theirs back. Their step and answer stay unsaid.",
          hintLevel: Math.max(level, 1),
          goal: `Show this small example and hand the problem back: ${ex.text}`,
          facts: [ex.text],
          template: "micro",
          templateVars: { ...vars, micro: ex.text },
          allowedEquations: ex.equations,
          assistive: true,
          stage: "THINK",
        }),
      ];
    }

    case "thinking":
      return [
        d({
          action: "WAIT",
          rule: "R10b_WAIT_ON_REQUEST",
          reason: "The student said they're thinking. That's an explicit signal, so the move is to wait: no new information and no new question.",
          hintLevel: level,
          goal: "Say, in one short sentence, to take their time and that you'll check their line when they're ready. No question, no hint.",
          template: "wait_thinking",
          templateVars: vars,
          assistive: false,
        }),
      ];

    case "affect": {
      const tm = teachingOf(state);
      const lead = affectLine(obs.affect!, "algebra", tm.affect);
      return [
        d({
          action: "ENCOURAGE",
          rule: `R40_ENCOURAGE_${obs.affect!.toUpperCase()}`,
          reason: `The student said how they feel (${obs.affect}), not something about the maths. Acknowledge it briefly — humour only about the subject, never about them — then hand the same question back.`,
          hintLevel: level,
          goal: `Acknowledge how they feel in one short sentence (${lead}), then ask: ${vars.back}`,
          facts: [lead],
          template: "affect",
          templateVars: { ...vars, lead },
          assistive: false,
          strategy: "encourage",
        }),
      ];
    }

    case "operation":
      return operationCandidates(state, obs, ctx, vars);

    case "valid_step":
      return [
        d({
          action: "ASK",
          rule: "R2_VALID_STEP",
          reason: "Correct, progress-making step. Name what they did so they can repeat it, then hand the next move back.",
          hintLevel: 0,
          goal: "Specifically praise the step they just did (what operation, on both sides), then ask what they'd do next. Don't say what to do next.",
          facts: [`Student's step: ${obs.studentRaw}`, "Their equation is still balanced."],
          template: "valid_step",
          templateVars: vars,
          assistive: false,
        }),
      ];

    case "valid_no_progress":
      return [
        d({
          action: "ASK",
          rule: "R3_VALID_NO_PROGRESS",
          reason: "Equivalent but not simpler: true, but doesn't move toward isolating x.",
          hintLevel: level,
          goal: "Confirm it's still true, then ask how they could get x more on its own.",
          facts: [`Student's equation: ${obs.studentRaw}`],
          template: "no_progress",
          templateVars: vars,
          assistive: false,
        }),
      ];

    case "correct_answer": {
      const assisted = state.hintsGiven > 0 || state.attempts > 0 || state.helpRequests > 0;
      return [
        d({
          // Solving the guided problem opens an independent check; solving a check grades it.
          action: "ASSESS",
          rule: !isTransfer ? "R1_GUIDED_SOLVED" : assisted ? "R1_TRANSFER_SOLVED_ASSISTED" : "R1_TRANSFER_SOLVED_INDEPENDENT",
          reason: !isTransfer
            ? "Guided problem solved. This is not mastery evidence on its own — verify on a fresh problem with a different surface form."
            : assisted
              ? "Transfer problem solved with help — practice, not evidence of independent skill."
              : "Transfer problem solved on the first attempt with no help — independent evidence.",
          hintLevel: 0,
          goal: "Acknowledge the correct answer specifically.",
          facts: [`They solved ${problem.text}.`],
          revealAllowed: true,
          template: !isTransfer ? "guided_solved" : assisted ? "transfer_solved_assisted" : "transfer_solved",
          templateVars: vars,
          assistive: false,
        }),
      ];
    }

    case "correct_flawed":
      return [
        d({
          action: "VERIFY",
          rule: "R17_CORRECT_BUT_FLAWED_REASONING",
          reason: "The answer is right but the stated reasoning is invalid. Confirm the answer by substitution, name the flaw, and don't count it as independent evidence.",
          hintLevel: 0,
          goal: "Say the answer is right and show the substitution check, then gently say the reasoning given doesn't work and why.",
          facts: [obs.check?.text ?? "", obs.flaw ?? ""].filter(Boolean),
          revealAllowed: true,
          template: "correct_flawed",
          templateVars: { ...vars, flaw: obs.flaw ?? "" },
          assistive: false,
        }),
      ];

    case "help":
    case "confused": {
      const confused = obs.kind === "confused";
      const tm = teachingOf(state);
      const conf = tm.confusion + 1; // including this message
      const asksAnswer = obs.request === "answer";
      const visualNext = !tm.strategies.includes("visual") && balanceDrawable(current);
      const lead = helpLead(obs, tm, conf, visualNext);
      const choice = d({
        action: "ASK",
        rule: confused ? "R8b_CONFUSED_SMALLER_STEP" : "R8_HELP_BEFORE_TRYING",
        reason: confused
          ? "Student says they're confused. Acknowledge it and shrink the task to a single choice (NOTICE: point at the two parts of the left side)."
          : `Asked for help (${obs.request ?? "help"}) before trying. Doing the step for them would replace their thinking (the 'crutch' effect), so shrink the first step into one choice (NOTICE) instead of refusing.`,
        hintLevel: Math.max(level, 1),
        goal: `${lead ? `Start with: "${lead}" ` : ""}Acknowledge the feeling without lecturing. Don't refuse rigidly. Offer one small choice about which part of the left side to deal with first.`,
        facts: [`Equation: ${ctx.currentRaw}`],
        template: lead ? "choice_plain" : confused ? "confused_choice" : obs.request === "stuck" ? "choice_dont_know" : "help_choice",
        templateVars: { ...vars, lead },
        assistive: true,
        stage: "NOTICE",
        strategy: "simplify",
      });
      if (state.attempts === 0 && state.hintLevel === 0) return [choice, esc(confused ? "R8b_CONFUSED_ESCALATE" : "R9_HELP_ESCALATE", "Alternative: go straight to the first rung of the hint ladder.")];
      // A worked solution once holding back has stopped helping: real effort (wrong attempts), or every other
      // approach tried and the student still stuck, or repeated requests for the answer after effort.
      const effort = state.attempts >= REVEAL_AFTER_ATTEMPTS && !confused;
      const exhausted = conf >= 5 && state.hintLevel >= 3;
      const askedAgain = asksAnswer && tm.answerRequests >= 2 && state.hintLevel >= 2 && state.attempts >= 2;
      if ((effort || exhausted || askedAgain) && !state.noReveal) {
        return [
          d({
            action: "EXPLAIN",
            rule: "R9_REVEAL_AFTER_EFFORT",
            reason: effort
              ? `After ${state.attempts} genuine attempts and a request for help, persisting causes frustration without learning. Show the worked solution, then require an independent transfer problem.`
              : exhausted
                ? `Stuck ${conf} times in a row on this problem after a simpler question, another explanation, a picture and a worked first move. Withholding more won't help: show the worked solution, then a fresh problem to do alone.`
                : `Asked for the answer ${tm.answerRequests + 1} times after real attempts and big hints. Show the worked solution, then a fresh problem to do alone.`,
            hintLevel: 3,
            goal: "Walk through the remaining steps clearly and briefly, then say they'll try a similar one themselves.",
            facts: [`Steps: ${workedSteps(current)}`, `Answer: x = ${ctx.correct}`],
            revealAllowed: true,
            nextStepAllowed: true,
            allowedEquations: workedEquations(current),
            template: "reveal",
            templateVars: { ...vars, answer: ctx.correct.toString(), worked: workedSteps(current) },
            strategy: "worked",
          }),
          esc("R9_HELP_ESCALATE", "Alternative: one more rung instead of the full solution."),
        ];
      }
      return [escalate(state, ctx, vars, confused ? "R8b_CONFUSED_ESCALATE" : "R9_HELP_ESCALATE", "Help requested after effort: the next rung of support, not the answer.", obs, { lead, conf })];
    }

    case "explanation": {
      const dg = obs.diagnosis;
      if (!dg || dg.id === "UNCLASSIFIED") {
        return [
          d({ action: "ASK", rule: "R12_EXPLANATION_UNCLEAR", reason: "Reasoning not matched to a known pattern. Ask a narrower question rather than assume.", hintLevel: level, goal: "Thank them for explaining, then ask what the first thing they did to the equation was.", template: "probe_narrow", templateVars: vars }),
        ];
      }
      const info = MISCONCEPTIONS[dg.id];
      const focus = fillTemplate(info.focus, current);
      return [
        d({ action: "HINT", rule: "R12_EXPLANATION_DIAGNOSED", reason: `Explanation reveals "${info.label}". Address the idea directly, then hand the step back.`, hintLevel: Math.max(1, level), goal: `Thank them for explaining. Gently address this idea: ${focus} Then ask them to try again.`, facts: [focus], template: "address_misconception", templateVars: { ...vars, focus } }),
      ];
    }

    case "invalid": {
      const dg = obs.diagnosis!;
      const info = MISCONCEPTIONS[dg.id];
      const focus = dg.id === "UNCLASSIFIED" ? "" : fillTemplate(info.focus, current);
      const checkDecision = (rule: string, reason: string, template = "verify_check") =>
        d({
          action: "VERIFY",
          rule,
          reason,
          hintLevel: level,
          goal: `Test their work with this computed check and ask what it tells them: ${obs.check!.text}`,
          facts: [obs.check!.text],
          template,
          templateVars: { ...vars, focus },
          assistive: false,
          strategy: "check",
        });

      // The same wrong line again: the last approach didn't convince them. Change strategy instead of repeating it.
      const tmem = teachingOf(state);
      const same = !!obs.repeatedClaim && (tmem.strategies.includes("check") || tmem.strategies.includes("visual"));
      if (same) {
        const tm = tmem;
        if (!tm.strategies.includes("visual") && balanceDrawable(current)) {
          return [
            d({
              action: "VISUALIZE",
              rule: "R7d_SAME_MISTAKE_VISUAL",
              reason: `The same wrong line (${obs.studentRaw}) a second time: the previous explanation didn't convince them. Switch modality — the balance on the whiteboard — instead of repeating it.`,
              hintLevel: Math.max(level, 1),
              goal: `Say you see the same line again, so you'll try a picture. Describe the balance for ${ctx.currentRaw} and ask whether their line matches what's left after taking the same thing off both sides.`,
              facts: [`Balance: ${current.A} bags of x and ${current.B} blocks on the left, ${current.C} blocks on the right.`],
              template: "visual_same_line",
              templateVars: { ...vars, ...balanceVars(current) },
              assistive: true,
              stage: "THINK",
              strategy: "visual",
              visual: "balance",
            }),
            esc("R7_REPEATED_ERROR", "Alternative: move up the hint ladder."),
          ];
        }
        return [escalate(state, ctx, vars, "R7_REPEATED_ERROR", `The same wrong line (${obs.studentRaw}) again after a picture: move up the ladder with a different approach.`, obs, { lead: "Same line again — let me come at it differently.", conf: 0 })];
      }
      if (obs.insistent) {
        const out = [
          obs.check
            ? checkDecision("R4_RESPECTFUL_CHALLENGE", obs.repeatedClaim ? "The same wrong value again: the probe didn't change their mind. Switch strategy — let the mathematics decide with a computed check." : "Student is confident in a wrong step. Don't overrule — let the mathematics decide with a computed check.", obs.repeatedClaim ? "repeat_check" : "insist_check")
            : d({ action: "VERIFY", rule: "R4_RESPECTFUL_CHALLENGE", reason: "Student is confident in a wrong step; no simple numeric check exists, so test the idea.", hintLevel: Math.max(level, 1), goal: `Respect their confidence and test this idea with them: ${focus}`, facts: [focus], template: "insist_focus", templateVars: { ...vars, focus } }),
        ];
        out.push(esc("R7_REPEATED_ERROR", "Alternative: move up the hint ladder."));
        return out;
      }
      if (level >= 3 && obs.check) {
        return [checkDecision("R7b_CONTRAST_AFTER_BOTTOM_OUT", "Error persists after the next step was shown. Repeating the same explanation won't help — show the computed check and ask them to compare.", "contrast_check")];
      }
      if (dg.id === "UNCLASSIFIED") {
        const out = [d({ action: "ASK", rule: "R6_PROBE_UNKNOWN", reason: "Wrong, and no modelled misconception explains it. Ask for their reasoning instead of guessing a diagnosis.", hintLevel: level, goal: "Without saying it's wrong harshly, ask them to walk you through how they got their answer.", template: "probe_unknown", templateVars: { ...vars, value: obs.studentValue ?? obs.studentRaw ?? "" } })];
        if (obs.check) out.push(checkDecision("R6b_CHECK_UNKNOWN", "Alternative: let a computed check show the mismatch, then ask."));
        if (state.attempts > 0) out.push(esc("R7_REPEATED_ERROR", "Alternative: repeated error — move up the hint ladder."));
        return out;
      }
      if (dg.id === "ARITHMETIC_SLIP" && state.attempts === 0) {
        return [d({ action: "ASK", rule: "R14_SLIP", reason: "Looks like a calculation slip, not a misunderstanding. Ask them to re-check before teaching anything.", hintLevel: level, goal: "Say the method sounds right and ask them to double-check the arithmetic.", template: "slip", templateVars: vars, facts: [dg.evidence] })];
      }
      const recurring = recurringElsewhere(state, dg.id, problem.id);
      if (recurring && state.attempts === 0) {
        return [
          d({ action: "HINT", rule: "R5b_RECURRING_MISCONCEPTION", reason: `"${info.label}" also happened on an earlier problem. A probe didn't fix it then — address the idea directly now.`, hintLevel: Math.max(level, 1), goal: `Say it looks like the same mix-up as earlier and address this idea: ${focus}`, facts: [focus], template: "recurring", templateVars: { ...vars, focus } }),
          d({ action: "ASK", rule: "R5_TARGETED_PROBE", reason: "Alternative: targeted question.", hintLevel: level, goal: `Ask: ${fillTemplate(info.probe, current)}`, template: "probe_targeted", templateVars: { ...vars, probe: fillTemplate(info.probe, current) } }),
        ];
      }
      if (state.attempts === 0) {
        const out = [
          d({ action: "ASK", rule: "R5_TARGETED_PROBE", reason: `First error, diagnosed as "${info.label}" (${dg.category}, basis: ${dg.basis ?? "value"}). A targeted question lets them find it themselves.`, hintLevel: level, goal: `Ask this kind of question without giving the answer: ${fillTemplate(info.probe, current)}`, facts: [focus], template: "probe_targeted", templateVars: { ...vars, probe: fillTemplate(info.probe, current) }, strategy: "probe" }),
        ];
        if (obs.check) out.push(checkDecision("R5c_CHECK_FIRST_ERROR", "Alternative: a computed check instead of a question."));
        out.push(esc("R7_REPEATED_ERROR", "Alternative: move straight to a conceptual nudge."));
        return out;
      }
      const out = [esc("R7_REPEATED_ERROR", `Repeated error (${info.label}). Move up the hint ladder.`)];
      if (obs.check) out.push(checkDecision("R7c_CHECK_REPEATED", "Alternative: a computed check before giving more help."));
      return out;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Moves described in words                                            */
/* ------------------------------------------------------------------ */

const VERB: Record<string, string> = { add: "add", subtract: "subtract", multiply: "multiply", divide: "divide" };
const NOUN: Record<string, string> = { add: "adding", subtract: "subtracting", multiply: "multiplication", divide: "dividing" };
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

/**
 * The student proposed (or asked about) a move in words. The maths engine has already classified the
 * move (`obs.opCheck`); here the policy turns that verdict into ONE teaching move that responds to what
 * the student actually said, acknowledges a repeat or a correction, and ends with one question.
 * All numbers and equations come from the current equation and the exact check — none are generated.
 */
function operationCandidates(state: SessionState, obs: Observation, ctx: PolicyContext, vars: Record<string, string>): Decision[] {
  const m = obs.meaning!;
  const c = obs.opCheck;
  const n = ctx.current;
  const level = state.hintLevel;
  const neg = isNeg(n.B);
  const bAbs = absF(n.B);
  const noConst = n.B.isZero();
  const partDesc = noConst ? `× ${n.A}` : `${neg ? "−" : "+"} ${bAbs}`;
  const partVerbing = noConst ? `multiplying by ${n.A}` : neg ? `taking away ${bAbs}` : `adding ${bAbs}`;
  const needMove = noConst ? `dividing both sides by ${n.A}` : neg ? `adding ${bAbs} to both sides` : `subtracting ${bAbs} from both sides`;
  const prev = state.dialog?.lastProposal;
  const said = m.operation ? VERB[m.operation.kind] : null;
  const prefix = obs.repair
    ? "Sorry, I missed that the first time. "
    : obs.correction && said
      ? prev?.kind && prev.kind !== m.operation?.kind
        ? `Got it: ${said}, not ${VERB[prev.kind]}. `
        : `Got it: ${said}. `
      : "";
  const mk = (p: { rule: string; action: Decision["action"]; reason: string; text: string; stage?: Decision["stage"]; hintLevel?: number; assistive?: boolean; allowed?: string[]; focus?: "constant" | "coefficient" | ""; facts?: string[] }) =>
    d({
      action: p.action,
      rule: p.rule,
      reason: p.reason,
      hintLevel: p.hintLevel ?? level,
      goal: `Respond to the move the student described, using these facts, and end with exactly one question: ${p.text}`,
      facts: [...(p.facts ?? []), c ? `Maths check: ${c.verdict} — ${c.explanation}` : ""].filter(Boolean),
      template: "op",
      templateVars: { ...vars, opText: prefix + p.text, opFocus: p.focus ?? "constant" },
      allowedEquations: p.allowed ?? [],
      assistive: p.assistive ?? false,
      stage: p.stage,
    });

  // Pointing at a part of the equation ("the 5 first", or just "multiplication" when asked which first).
  if (m.act === "choose_part" || !m.operation) {
    if (noConst || m.part === "constant") {
      return [
        mk({
          rule: "R37_PART_RIGHT",
          action: "ASK",
          reason: `The student chose the ${noConst ? "only remaining operation" : `${partDesc} — the last thing done to x`} as the first thing to deal with. That's right; let them name the operation that undoes it.`,
          text: noConst ? `Yes — the ${partDesc} is all that's left. What operation undoes ${partVerbing}?` : `Yes — the ${partDesc} first, because it was the last thing done to x. What operation would undo it?`,
          stage: "THINK",
          focus: noConst ? "coefficient" : "constant",
        }),
      ];
    }
    const frac = bAbs.div(n.A);
    return [
      mk({
        rule: "R38_PART_COEFFICIENT_FIRST",
        action: "HINT",
        reason: "The student chose the multiplication first. Allowed (divide every term), but it creates fractions; the constant was applied last, so undoing it first is cleaner. Explain, don't overrule.",
        text: `You could start with the multiplication — dividing every part by ${n.A} — but then the ${bAbs} turns into ${frac}. The ${partDesc} was the last thing done to x, so it's easier to undo first. What operation undoes ${partVerbing}?`,
        stage: "THINK",
        hintLevel: Math.max(level, 1),
        assistive: true,
        focus: "constant",
      }),
    ];
  }

  // Third time round the same unhelpful proposal: the explanation isn't landing. Stop re-explaining and
  // name the move directly (one rung up the hint ladder) — still without doing the step for them.
  const WRONG = ["evaluation_order", "wrong_inverse", "one_side", "valid_unhelpful"];
  if (obs.repeat && (state.dialog?.repeats ?? 0) >= 1 && c && WRONG.includes(c.verdict)) {
    const after = noConst ? `That undoes the ${partDesc} and leaves x on its own.` : `That undoes the ${partDesc}; the ${n.A} times x comes after.`;
    return [
      mk({
        rule: "R39_OP_REPEATED_NAME_MOVE",
        action: "HINT",
        reason: `The student has proposed the same move (${m.operation.kind}) three times; re-explaining isn't working. Escalate: name the needed move (${c.needed}) directly, but leave the step itself to the student.`,
        text: `You've said ${NOUN[m.operation.kind]} a few times, so let me be more direct. The first move here is ${needMove}. ${after} What does the equation become?`,
        stage: "TRY",
        hintLevel: Math.max(level, 2),
        assistive: true,
        focus: noConst ? "coefficient" : "constant",
      }),
    ];
  }

  switch (c!.verdict) {
    case "correct_next": {
      const op = m.operation;
      const how =
        op.framing === "move"
          ? `“Moving the ${noConst ? n.A : bAbs} across” really means ${needMove}, so the two sides stay equal.`
          : `${cap(needMove.replace(/ (from|to) both sides| both sides/, ""))} undoes the ${partDesc}${op.sides === "unspecified" ? ", as long as you do it to both sides" : ", and doing it to both sides keeps them equal"}.`;
      return [
        mk({
          rule: "R30_OP_RIGHT_MOVE",
          action: "ASK",
          reason: `The student named the right next move (${c!.needed})${op.operandSource === "inferred" ? `, with the number inferred from the equation (${op.operand})` : ""}. Confirm why it works and let them carry it out — don't do the step for them.`,
          text: obs.continuation
            ? `Right: ${needMove} keeps them equal and undoes the ${partDesc}. Go ahead: what does the equation become?`
            : `${m.isQuestion ? "Yes, that's exactly the move. " : "Yes. "}${how} Go ahead: what does the equation become?`,
          stage: "TRY",
          focus: noConst ? "coefficient" : "constant",
        }),
      ];
    }
    case "divide_first": {
      const frac = bAbs.div(n.A);
      return [
        mk({
          rule: "R32_OP_DIVIDE_FIRST",
          action: "ASK",
          reason: "Dividing first is mathematically valid (every term divided), but turns the constant into a fraction. Say yes honestly, explain the trade-off, let the student choose.",
          text: `${m.isQuestion || m.act === "why_not_operation" ? "Yes, you can. " : "You can. "}Dividing every part by ${n.A} keeps it balanced, but the ${bAbs} turns into ${frac}, which gets messy. Undoing the ${partDesc} first keeps whole numbers. Which would you like to do?`,
          stage: "THINK",
          focus: "coefficient",
        }),
      ];
    }
    case "evaluation_order": {
      const intro = obs.repeat
        ? `Yes, I heard you say multiplication. You're thinking about the ${n.A} times x part — that matters, and we'll get to it. But first we need to undo the ${partDesc}.`
        : m.isQuestion || m.act === "why_not_operation"
          ? `Good question. BODMAS is the order for working out a value, like ${n.A} × 2 ${neg ? "−" : "+"} ${bAbs}. Solving goes the other way: we undo what was done to x, last thing first, and the ${partDesc} was done last.`
          : m.mentionsOrderOfOperations
            ? `I see why you're thinking of multiplication — BODMAS is the order for working out an expression. Here we're doing the opposite: undoing what was done to x, so we go in reverse, and the ${partDesc} was the last thing done.`
            : `I see why multiplication comes to mind — x is being multiplied by ${n.A}. But to solve, we undo what was done to x in reverse order, and the ${partDesc} was the last thing done.`;
      return [
        mk({
          rule: obs.repeat ? "R31b_OP_EVALUATION_ORDER_REPAIR" : "R31_OP_EVALUATION_ORDER",
          action: "HINT",
          reason: obs.repeat
            ? "The student repeated the multiplication proposal: our last reply may not have landed. Acknowledge that we heard them, connect to their idea (the 3·x), then redirect to the constant with one question."
            : "The student proposes multiplying first — the order for EVALUATING an expression (BODMAS), not for SOLVING. Acknowledge why it makes sense, explain the difference simply, point at the constant, ask one question.",
          text: `${intro} What operation undoes ${partVerbing}?`,
          stage: "THINK",
          hintLevel: Math.max(level, 1),
          assistive: true,
          focus: "constant",
        }),
      ];
    }
    case "wrong_inverse": {
      const k = m.operation.operand;
      const text =
        m.operation.kind === "multiply"
          ? `That keeps both sides equal, but it gives ${c!.result}: x is further from being on its own. What undoes ${partVerbing}?`
          : `That keeps both sides equal, but look: it gives ${c!.result}. The ${k} isn't gone — it grew. What undoes ${partVerbing}?`;
      return [mk({ rule: "R33_OP_WRONG_INVERSE", action: "VERIFY", reason: `The proposed move (${m.operation.kind} ${k}) is the operation itself, not its inverse. Show the computed result so the student sees it, then ask for the inverse.`, text, allowed: c!.result ? [c!.result] : [], facts: c!.result ? [`Result of the proposed move: ${c!.result}`] : [] })];
    }
    case "one_side": {
      const side = m.operation.sides;
      const other = side === "left" ? "right" : "left";
      return [
        mk({
          rule: "R34_OP_ONE_SIDE",
          action: "VERIFY",
          reason: "The move is right but applied to one side only: the equation would stop balancing.",
          text: `If you ${VERB[m.operation.kind]} ${m.operation.operand ?? ""} on the ${side} side only, that side changes but the ${other} side doesn't — and they stop being equal. What do you need to do to the ${other} side as well?`.replace(/\s+/g, " "),
        }),
      ];
    }
    case "valid_unhelpful":
      return [
        mk({
          rule: "R35_OP_VALID_UNHELPFUL",
          action: "ASK",
          reason: "The move keeps the equation true but doesn't move toward isolating x.",
          text: `That would keep both sides equal (${c!.result}), but x isn't any closer to being on its own. Which part of ${ctx.currentRaw} is stuck to x?`,
          allowed: c!.result ? [c!.result] : [],
        }),
      ];
    case "incomplete":
    default:
      return [
        mk({
          rule: "R36_OP_WHICH_NUMBER",
          action: "ASK",
          reason: "An operation was named but not the number, and the number can't be inferred safely. Ask — don't guess.",
          text: `${cap(VERB[m.operation.kind])} ${m.operation.kind === "divide" || m.operation.kind === "multiply" ? "by " : ""}which number?`,
        }),
      ];
  }
}

/** Default decision = first candidate. Kept for callers that just want the rule-table answer. */
export function decide(state: SessionState, obs: Observation, ctx: PolicyContext): Decision {
  return candidates(state, obs, ctx)[0];
}

function recurringElsewhere(state: SessionState, id: MisconceptionId, problemId: string) {
  return (state.misconceptionHistory ?? []).some((m) => m.id === id && m.problemId !== problemId);
}

/** The hint ladder. Each rung gives strictly more support than the last. */
function escalate(state: SessionState, ctx: PolicyContext, vars0: Record<string, string>, rule: string, reason: string, obs?: Observation, opts: { lead?: string; conf?: number } = {}): Decision {
  const { current, next } = ctx;
  const tm = teachingOf(state);
  const conf = opts.conf ?? 0;
  const vars = { ...vars0, lead: opts.lead ?? "" };
  const cap = state.noReveal ? 2 : 3;
  const k = (state.explainVariant ?? 0) + 1;
  if (state.noReveal && state.hintLevel >= cap) {
    const text = pick(tryVariants(ctx), k);
    return d({
      action: "HINT",
      rule: `${rule}_L2`,
      reason: `${reason} The student asked not to be told the answer, so the ladder stops at naming the move; this is the same move explained a new way.`,
      hintLevel: Math.max(2, state.hintLevel),
      goal: `Name the move again in different words, and ask for their line: ${text}`,
      facts: [`Next operation: ${next.operation}`],
      template: "micro",
      templateVars: { ...vars, micro: text },
      stage: "TRY",
      strategy: "named_move",
    });
  }
  // NOTICE → THINK → TRY: after pointing at the part (NOTICE, rung 1), the next help is a guiding question at the same rung.
  const afterNotice = state.lastStage === "NOTICE" && state.hintLevel === 1;
  const target = afterNotice ? 1 : Math.min(cap, state.hintLevel + 1);
  const dg = obs?.diagnosis ?? state.lastDiagnosis;
  const focus = dg && dg.id !== "UNCLASSIFIED" ? fillTemplate(MISCONCEPTIONS[dg.id].focus, current) : "";
  if (target <= 1) {
    const check = obs?.check?.text;
    return d({
      // A second "I don't know": the first explanation didn't land, so this is the idea again, differently.
      action: conf >= 2 ? "RETEACH" : "HINT",
      rule: `${rule}_L1`,
      reason: `${reason} Rung 1: conceptual nudge${check ? " plus a computed check of their own work" : ""}.`,
      hintLevel: 1,
      goal: `Give a conceptual nudge${focus ? ` (${focus})` : ""}${check ? ` and show that ${check}` : ""}. Ask what that tells them. Don't name the operation to do.`,
      facts: [focus, check ?? ""].filter(Boolean),
      template: check ? "hint1_check" : focus ? "hint1" : "micro",
      templateVars: { ...vars, focus, micro: pick(thinkVariants(ctx), k - 1) },
      stage: "THINK",
      strategy: "analogy",
      assistive: true,
    });
  }
  if (target === 2 && conf >= 3 && !tm.strategies.includes("visual") && balanceDrawable(current)) {
    return d({
      action: "VISUALIZE",
      rule: `${rule}_L2`,
      reason: `${reason} Rung 2, as a picture: still stuck after ${conf - 1} explanations in words, so switch to the balance on the whiteboard. The picture names the move (take the same off both sides); the student works out what's left.`,
      hintLevel: 2,
      goal: `Describe the balance for ${ctx.currentRaw}, say taking the same amount off both sides keeps it level, and ask what's left on each side. Don't state the result.`,
      facts: [`Balance: ${current.A} bags of x and ${current.B} blocks on the left, ${current.C} blocks on the right.`, `Next operation: ${next.operation}`],
      template: current.B.isZero() ? "visual_share" : "visual_balance",
      templateVars: { ...vars, ...balanceVars(current) },
      stage: "TRY",
      strategy: "visual",
      visual: "balance",
      assistive: true,
    });
  }
  if (target === 2) {
    return d({
      action: "HINT",
      rule: `${rule}_L2`,
      reason: `${reason} Rung 2: name the next operation; the student carries it out.`,
      hintLevel: 2,
      goal: `Tell them the next move is to ${next.operation}, and ask what the equation becomes. Don't state the result.`,
      facts: [`Next operation: ${next.operation}`],
      template: "hint2",
      templateVars: vars,
      stage: "TRY",
      strategy: "named_move",
    });
  }
  return d({
    action: "EXPLAIN",
    rule: `${rule}_L3`,
    reason: `${reason} Rung 3 (bottom-out): show the next step only; the student still does the rest.`,
    hintLevel: 3,
    goal: `Show the next step worked out: ${next.operation} gives ${next.resultRaw} (${next.arithmetic}). ${ctx.isFinalStep ? "Then ask them to check it by substituting." : "Then ask them for the step after."}`,
    facts: [`${next.operation} → ${next.resultRaw}`, next.arithmetic],
    revealAllowed: ctx.isFinalStep,
    nextStepAllowed: true,
    allowedEquations: [next.resultRaw],
    template: opts.lead && conf >= 4 ? (ctx.isFinalStep ? "explain_part_final" : "explain_part") : ctx.isFinalStep ? "explain_final" : "explain_step",
    templateVars: vars,
    strategy: "worked_part",
  });
}

function balanceVars(n: Normal): Record<string, string> {
  return { balA: n.A.toString(), balB: n.B.toString(), balC: n.C.toString(), balBags: n.A.eq(1) ? "one bag" : `${n.A} bags` };
}

function workedSteps(n: Normal): string {
  const parts: string[] = [];
  let cur = n;
  for (let i = 0; i < 3; i++) {
    const s = nextStepFrom(cur);
    parts.push(`${i === 0 ? "First" : "Then"}, ${s.operation}: ${s.resultRaw}.`);
    if (s.resultRaw.startsWith("x =")) break;
    cur = normalize(s.resultEq);
  }
  return parts.join(" ");
}

function workedEquations(n: Normal): string[] {
  const out: string[] = [];
  let cur = n;
  for (let i = 0; i < 3; i++) {
    const s = nextStepFrom(cur);
    out.push(s.resultRaw);
    if (s.resultRaw.startsWith("x =")) break;
    cur = normalize(s.resultEq);
  }
  return out;
}

/** Deterministic answers to conceptual questions — about the idea, never the result of the student's next step. */
export function conceptAnswer(topic: NonNullable<Observation["topic"]>, ctx: PolicyContext): { text: string; equations: string[] } {
  const { current: n } = ctx;
  const bAbs = absF(n.B);
  const plus = !isNeg(n.B);
  switch (topic) {
    case "why_inverse_constant":
      if (n.B.isZero()) return { text: `Right now nothing is added to or taken from x — it's only multiplied by ${n.A}. So the thing to undo is the multiplication. What undoes multiplying?`, equations: [] };
      return {
        text: `Because x has ${bAbs} ${plus ? "added to it" : "taken away from it"}. To get x on its own we undo that, and the opposite of ${plus ? "adding" : "taking away"} ${bAbs} is ${plus ? "taking away" : "adding"} ${bAbs}. We do it to both sides so they stay equal. Want to try it?`,
        equations: [],
      };
    case "why_divide":
      if (n.A.eq(1)) return { text: `Good thinking — but here x isn't multiplied by anything, so there's nothing to divide. What's still attached to x?`, equations: [] };
      return { text: `${n.A}x means ${n.A} times x. The opposite of multiplying by ${n.A} is dividing by ${n.A} — and we divide both sides so they stay equal. Want to try it?`, equations: [] };
    case "order": {
      if (n.B.isZero()) return { text: `Here there's only one thing left to undo — x is multiplied by ${n.A}. So yes, dividing is the move now. What do you get?`, equations: [] };
      if (n.A.eq(1)) return { text: `x isn't multiplied by anything here, so there's nothing to divide — just undo the ${plus ? "+" : "−"} ${bAbs}. What do you get?`, equations: [] };
      const divFirst = `x ${plus ? "+" : "-"} ${bAbs.div(n.A)} = ${n.C.div(n.A)}`;
      return {
        text: `Yes, you can! Dividing every part by ${n.A} is allowed: ${divFirst}. It's correct, just messier with fractions, so most people undo the ${plus ? "+" : "−"} ${bAbs} first. Which would you like to do?`,
        equations: [divFirst],
      };
    }
    case "negatives":
      return { text: `Negative numbers are numbers below zero, like −3. On a number line they sit to the left of 0. If you take away more than you have, you get a negative: 2 − 5 = −3. They follow the same rules in equations. Want to keep going?`, equations: [] };
    case "balance":
      return { text: `The = sign means both sides have the same value — like a balanced scale. If you change one side, change the other side in the same way and it stays balanced. What would you like to do to both sides?`, equations: [] };
    case "what_is_x":
      return { text: `x is a number we don't know yet. Our job is to find the number that makes ${ctx.currentRaw} true. What could you do first?`, equations: [] };
    case "check":
      return { text: `Put your answer in place of x in ${ctx.problem.text} and work out the left side. If it comes to ${ctx.problem.c}, your answer is right. Want to try?`, equations: [] };
  }
}

/** Plug a value into the ORIGINAL equation — deterministic, can't hallucinate. */
export function substitutionCheck(problem: Problem, value?: string): { text: string; lhs: string } | null {
  if (!value) return null;
  const eq = parseEquation(problem.text)!;
  const [n, dd] = value.split("/").map(Number);
  const v = new Fraction(n, dd ?? 1);
  const lhs = evaluate(eq.lhs, v);
  const shown = v.isInteger() && v.valueOf() >= 0 ? v.toString() : `(${v})`;
  const a = problem.a;
  const bAbs = Math.abs(problem.b);
  const expr = problem.form === "b+ax=c" ? `${bAbs} + ${a} × ${shown}` : problem.form === "ax-b=c" ? `${a} × ${shown} − ${bAbs}` : `${a} × ${shown} + ${bAbs}`;
  return { text: `${expr} = ${lhs}${lhs.eq(problem.c) ? "" : `, not ${problem.c}`}`, lhs: lhs.toString() };
}

/**
 * The check shown for a wrong STEP: test the student's own line against the line before,
 * in their numbers — "if 3x were 25, the left side would be 25 + 5 = 30, not 20" —
 * rather than substituting an implied fractional x they never wrote.
 */
export function stepCheck(studentEq: Equation, from: Normal): string | null {
  const s = normalize(studentEq);
  if (from.B.isZero() || !s.A.eq(from.A) || !s.B.isZero()) return null;
  const k = s.C;
  const left = k.add(from.B);
  return `if ${ax(from.A)} were ${k}, the left side would be ${k} ${isNeg(from.B) ? "−" : "+"} ${absF(from.B)} = ${left}, not ${from.C}`;
}
