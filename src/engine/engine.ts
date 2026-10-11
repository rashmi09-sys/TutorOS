import { complexity, equivalent, parseEquation, rawToLatex, solve } from "./algebra";
import { classifyIntent, intentEquation, intentValue, type HelpRequest, type Intent } from "./intent";
import { DeterministicTeacher, type TeachingModel } from "./llm/teacher";
import { guardUtterance, type GuardSpec } from "./guard";
import { MAX_TRANSFER_ITEMS, assistedCompletion, finalStatus, initialMastery, observe } from "./mastery";
import { MISCONCEPTIONS, diagnoseStep, diagnoseValue, type Diagnosis } from "./misconceptions";
import { buildContext, candidates as policyCandidates, stepCheck, substitutionCheck, type PolicyContext } from "./policy";
import { FIRST_TRANSFER, GUIDED_PROBLEM, generateTransferProblem, problemAnswer, type Problem } from "./problems";
import { renderTemplate } from "./language/templates";
import { checkClaims, type ClaimCheck } from "./reasoning";
import { observeOperation } from "./observe";
import { whyTopic } from "./why";
import { checkOperation, interpretDeterministic, sameProposal, type Awaiting, type OperationCheck, type StudentMeaning } from "./understand";
export { whyTopic };
import type { BoardEntry, Decision, LlmCall, Observation, SessionState, StudentEvent, TurnTrace } from "./types";

/**
 * The orchestrator — a reducer:   (state, event) -> (state', utterance, trace)
 *
 *  1. Perceive: deterministic intent parsing + exact maths validation + diagnosis.
 *  2. Permit:   the policy lists the decisions allowed for this observation.
 *  3. Choose:   the teaching model picks one candidate and words it (LLM or deterministic);
 *               every utterance is guarded; failures fall back to the rule-table default.
 *  4. Update:   learner state, mastery evidence, phase transitions, whiteboard.
 *
 * The state is a plain JSON value, so every turn is reproducible and replayable,
 * and the eval suite runs exactly this function.
 */
export type PolicyVariant = "tutor-v1" | "baseline-answer-giver";

export interface StepDeps {
  teacher: TeachingModel;
  /** "baseline-answer-giver" is a deliberately naive chatbot policy used as a negative control in evals. */
  policy?: PolicyVariant;
  requestId?: string;
  now?: () => Date;
  /** Per-session cap on model calls (LLM_MAX_CALLS_PER_SESSION). Past it, turns fall back to the deterministic teacher. */
  maxModelCalls?: number;
}

export interface StepResult {
  state: SessionState;
  utterance: string;
  trace: TurnTrace;
  /** True when this event id was already applied to this state — nothing changed. */
  duplicate?: boolean;
}

export const MAX_TURNS = 300;

export function createSession(opts: { sessionId: string; seed?: number; now?: Date }): SessionState {
  const p = GUIDED_PROBLEM;
  return {
    version: 1,
    sessionId: opts.sessionId,
    createdAt: (opts.now ?? new Date()).toISOString(),
    seed: opts.seed ?? 42,
    turn: 0,
    phase: "GUIDED",
    problems: [p],
    current: 0,
    lastValidRaw: p.text,
    attempts: 0,
    hintLevel: 0,
    hintsGiven: 0,
    helpRequests: 0,
    silences: 0,
    revealed: false,
    lastTutorText: "",
    misconceptionCounts: {},
    misconceptionHistory: [],
    interventions: [],
    mastery: initialMastery(),
    board: [{ id: `${p.id}-given`, problemId: p.id, kind: "problem", latex: p.latex, status: "given", raw: p.text, turn: 0 }],
    transcript: [],
    teaching: { objective: objectiveFor(p), confusion: 0, strategies: [], hintHistory: [], answerRequests: 0, affect: 0, offTopic: 0 },
  };
}

/** One line on what a problem is for (teaching memory; shown in the Engineer View). */
export function objectiveFor(p: Problem): string {
  const stage = p.role === "guided" ? "Guided practice" : p.id === "t1" ? "Independent practice" : "Transfer";
  return `${stage}: solve ${p.text} by undoing the constant, then the multiplication, doing the same to both sides.`;
}

/** Strategies, confusion, hint history: what the tutor remembers about how teaching has gone (read by the policy next turn). */
function updateTeaching(state: SessionState, obs: Observation, decision: Decision, problemIdBefore: string) {
  const tm = (state.teaching ??= { objective: objectiveFor(state.problems[state.current]), confusion: 0, strategies: [], hintHistory: [], answerRequests: 0, affect: 0, offTopic: 0 });
  if (obs.kind === "help" || obs.kind === "confused") tm.confusion += 1;
  if (["valid_step", "correct_answer", "correct_flawed"].includes(obs.kind) || (obs.kind === "operation" && obs.opCheck?.verdict === "correct_next")) tm.confusion = 0;
  if (obs.kind === "valid_step" || obs.kind === "correct_answer") tm.lastSuccess = obs.studentRaw;
  if (obs.request === "answer") tm.answerRequests += 1;
  if (obs.affect) tm.affect += 1;
  if (obs.kind === "off_topic") tm.offTopic += 1;
  if (decision.strategy && tm.strategies.at(-1) !== decision.strategy) tm.strategies.push(decision.strategy);
  if (decision.assistive) {
    tm.hintHistory.push({ turn: state.turn, problemId: problemIdBefore, rule: decision.rule, strategy: decision.strategy });
    if (tm.hintHistory.length > 40) tm.hintHistory.shift();
  }
  const now = state.problems[state.current];
  if (now.id !== problemIdBefore) Object.assign(tm, { objective: objectiveFor(now), confusion: 0, strategies: [], answerRequests: 0, lastSuccess: undefined });
}

const deterministic = new DeterministicTeacher();

export async function step(prev: SessionState, event: StudentEvent, deps: StepDeps): Promise<StepResult> {
  const t0 = performance.now();
  const now = deps.now ?? (() => new Date());
  const requestId = deps.requestId ?? `req_${Math.random().toString(36).slice(2, 10)}`;

  // Idempotency: the client sent the post-state of an event it already applied (e.g. a retried request).
  if (event.id && prev.lastEventId === event.id) {
    return { state: prev, utterance: prev.lastTutorText, trace: duplicateTrace(prev, event, requestId, now), duplicate: true };
  }

  const state: SessionState = structuredClone(prev);
  state.turn += 1;
  state.lastEventId = event.id;
  state.misconceptionHistory ??= [];
  const turnId = `${state.sessionId}-t${state.turn}`;
  const errors: string[] = [];
  const llmCalls: LlmCall[] = [];
  const notes: string[] = [];
  const phaseBefore = state.phase;
  const snapshot = summarize(prev);

  const ctx = buildContext(state);
  const problem = ctx.problem;
  let intent: Intent | undefined;
  let meaning: StudentMeaning | undefined;
  let opCheck: OperationCheck | undefined;
  let diagnosis: Diagnosis | undefined;
  let diagnosisSource: TurnTrace["diagnosisSource"];
  let validation: TurnTrace["validation"] = { parsed: null, correctValue: problem.answer };
  const grounded: string[] = [problem.text, state.lastValidRaw];
  const studentEntry: { id?: string } = {};
  let obs: Observation;

  // Cost control: once a session has used its model-call budget, the rest of it runs deterministically.
  const overBudget = deps.teacher.mode === "llm" && deps.maxModelCalls != null && (state.modelCalls ?? 0) >= deps.maxModelCalls;
  const teacher: TeachingModel = overBudget ? new DeterministicTeacher() : deps.teacher;
  if (overBudget) errors.push(`Model-call budget for this session (${deps.maxModelCalls}) reached; this turn ran deterministically.`);

  // ---------- 1. Perceive ----------
  if (event.type === "start") {
    obs = { kind: state.phase === "COMPLETE" ? "after_complete" : "start", insistent: false, frustrated: false };
  } else if (event.type === "silence") {
    obs = { kind: state.phase === "COMPLETE" ? "after_complete" : "silence", insistent: false, frustrated: false };
  } else {
    state.transcript.push({ role: "student", text: event.text, turn: state.turn, via: event.via });
    // Read in context: the current equation and what the tutor's last message asked for.
    intent = classifyIntent(event.text, ctx.current, { awaiting: state.dialog?.awaiting });
    // A fragment that finishes the student's previous sentence ("subtract 5 from" … "both sides"): read the
    // two together. Only when the joined reading says something the first part didn't.
    let continuation = false;
    const lastP = state.dialog?.lastProposal;
    const prevStudent = state.transcript.filter((r) => r.role === "student").at(-2);
    if (intent.kind === "AMBIGUOUS" && lastP?.text && prevStudent?.turn === lastP.turn) {
      const joined = interpretDeterministic(`${lastP.text} ${event.text}`, ctx.current);
      const before = interpretDeterministic(lastP.text, ctx.current);
      if (joined?.operation && JSON.stringify(joined.operation) !== JSON.stringify(before?.operation)) {
        intent = { ...intent, kind: "OPERATION", meaning: { ...joined, evidence: [...joined.evidence, `continues “${lastP.text}”`] }, recognisedBy: "operation lexicon", phraseRule: "OP_continuation" };
        continuation = true;
      }
    }
    // Only text the word lists couldn't place goes to a configured model. The model returns a structured
    // reading (zod-validated); a move it reports is then verified exactly below, like any other move.
    if ((intent.kind === "AMBIGUOUS" || (intent.kind === "OFF_TOPIC" && !intent.frustrated)) && teacher.interpret && state.phase !== "COMPLETE") {
      const r = await teacher.interpret({ text: event.text, problemText: problem.text, currentLine: ctx.currentRaw, lastTutor: state.lastTutorText, current: ctx.current, awaiting: state.dialog?.awaiting });
      llmCalls.push(...r.calls);
      errors.push(...r.errors);
      if (r.meaning) intent = { ...intent, kind: "OPERATION", meaning: r.meaning, question: r.meaning.isQuestion, recognisedBy: "llm", phraseRule: `LLM(${intent.kind}→${r.meaning.operation?.kind ?? r.meaning.act})` };
      else if (r.request) intent = { ...intent, ...intentForRequest(r.request), recognisedBy: "llm", phraseRule: `LLM(${intent.kind}→${r.request})` };
    }
    const base = { insistent: intent.insistent, frustrated: intent.frustrated, question: intent.question, interruptedTutor: !!event.interruptedTutor, request: intent.request, affect: intent.affect };
    if (state.phase === "COMPLETE" || state.turn > MAX_TURNS) obs = { kind: "after_complete", ...base };
    else
      switch (intent.kind) {
        case "REPEAT_REQUEST":
          obs = { kind: "repeat", ...base };
          break;
        case "HELP_REQUEST":
          obs = { kind: "help", ...base };
          break;
        case "CONFUSED":
          obs = { kind: "confused", ...base };
          break;
        case "CONCEPT_QUESTION":
          obs = { kind: "concept", topic: intent.topic, ...base };
          break;
        case "ARITHMETIC_QUESTION":
          obs = { kind: "arithmetic_question", studentRaw: intent.mathSegment, ...base };
          break;
        case "DISPUTE":
          obs = { kind: "dispute", ...base };
          break;
        case "MALFORMED_MATH":
          obs = { kind: "malformed", studentRaw: intent.mathSegment, ...base };
          break;
        case "EMPTY":
          obs = { kind: "empty", ...base };
          break;
        case "OFF_TOPIC":
          // "This is stupid, I hate this" isn't off-topic: it's a student struggling. Treat it as a request for help.
          obs = intent.frustrated ? { kind: "help", ...base } : { kind: "off_topic", ...base };
          break;
        case "AFFECT":
          // Worry and frustration are a student struggling: help, with the feeling acknowledged first.
          // Dislike, boredom and laughter get an acknowledgement and the question back (ENCOURAGE).
          obs = intent.affect === "worried" || intent.affect === "frustrated" ? { kind: "help", ...base } : { kind: "affect", ...base };
          break;
        case "THINKING":
          obs = { kind: "thinking", ...base };
          break;
        case "REPHRASE_REQUEST":
          obs = { kind: "rephrase", ...base };
          break;
        case "EXAMPLE_REQUEST":
          obs = { kind: "example", ...base };
          break;
        case "SLOWER_REQUEST":
          obs = { kind: "slower", ...base };
          break;
        case "NO_ANSWER_PREFERENCE":
          obs = { kind: "no_answer", ...base };
          break;
        case "WHY_QUESTION":
          obs = { kind: "why", topic: whyTopic(state), ...base };
          break;
        case "ACKNOWLEDGE":
          obs = { kind: "ack", ...base };
          break;
        case "AMBIGUOUS":
          obs = { kind: "ambiguous", studentRaw: event.text.trim().slice(0, 60), incomplete: intent.incomplete, ...base };
          break;
        case "OPERATION": {
          const m = intent.meaning!;
          meaning = m;
          // The maths engine — not the interpreter — decides what the proposed move does.
          opCheck = m.operation ? checkOperation(m.operation, ctx.current) : undefined;
          const last = state.dialog?.lastProposal;
          const recent = !!last && state.turn - last.turn <= 4;
          const restated = /\bi (said|told you|already said)\b|\blike i said\b|\bi just said\b/i.test(event.text);
          const repeat = recent && sameProposal(last, m) && !continuation;
          const misread = ["R13_REDIRECT", "R22_CLARIFY", "R12_EXPLANATION_UNCLEAR"].includes(state.dialog?.lastRule ?? "");
          const correction = m.isCorrection && !(repeat && sameProposal(last, m));
          obs = { kind: "operation", meaning: m, opCheck, repeat: !!repeat, correction, repair: misread && (restated || m.isCorrection || !!repeat), continuation, studentRaw: event.text.trim().slice(0, 80), ...base };
          diagnosis = operationDiagnosis(m, opCheck, event.text);
          if (diagnosis) diagnosisSource = m.source === "llm" ? "llm" : "deterministic";
          break;
        }
        case "EXPLANATION": {
          const cls = await teacher.classify({ explanation: event.text, problemText: problem.text, current: ctx.current, lastStudentMath: lastStudentMath(state) });
          llmCalls.push(...cls.calls);
          errors.push(...cls.errors);
          diagnosis = cls.diagnosis ?? undefined;
          diagnosisSource = cls.source === "llm" ? "llm" : "heuristic";
          obs = { kind: "explanation", diagnosis, ...base };
          break;
        }
        default:
          obs = perceiveMath(
            state,
            intent,
            ctx,
            base,
            grounded,
            (v) => (validation = v),
            (dg) => {
              diagnosis = dg;
              diagnosisSource = "deterministic";
            },
            studentEntry,
          );
      }
  }

  // ---------- 2. Permit: the decisions the policy allows ----------
  let cands = policyCandidates(state, obs, ctx);
  if (deps.policy === "baseline-answer-giver" && !["start", "correct_answer", "correct_flawed", "after_complete", "valid_step"].includes(obs.kind)) {
    cands = [baselineDecision(cands[0], ctx)];
  }

  // ---------- 3+4. Choose + update ----------
  const recent = state.transcript.slice(-6).map((m) => ({ role: m.role, text: m.text }));
  const guard = (d: Decision, text: string) => guardUtterance(stripNextProblem(text, d), specFor(d, ctx, grounded, state));
  const context = {
    problemText: problem.text,
    currentLine: ctx.currentRaw,
    observation: observationSummary(obs, intent, validation),
    learner: learnerSummary(state),
    recent,
  };

  let decision: Decision;
  let utterance: string;
  let source: TurnTrace["decisionSource"];
  let rationale: string | undefined;

  if (obs.kind === "correct_answer" || obs.kind === "correct_flawed") {
    // Single permitted decision; the transition (next problem) must exist before wording it.
    decision = cands[0];
    updateCounters(state, obs, decision, diagnosis);
    const t = transition(state, obs);
    decision = { ...decision, ...(t.decision ?? {}), templateVars: { ...decision.templateVars, ...t.vars } };
    cands = [decision]; // the lesson-end decision replaces the solved-problem one
    const r = await teacher.decide({ candidates: cands, context, guard, variant: state.turn });
    ({ chosen: decision, utterance, source, rationale } = r);
    llmCalls.push(...r.calls);
    errors.push(...r.errors);
  } else {
    const r = await teacher.decide({ candidates: cands, context, guard, variant: state.turn });
    ({ chosen: decision, utterance, source, rationale } = r);
    llmCalls.push(...r.calls);
    errors.push(...r.errors);
    // Never say the same thing twice on one problem (unless asked to repeat): try another wording of the same
    // move, then the next permitted move. Deterministic, and every alternative passes the same guard.
    if (decision.rule !== "R11_REPEAT") {
      const said = new Set(state.transcript.filter((m) => m.role === "tutor" && state.turn - m.turn <= 12).map((m) => m.text));
      if (said.has(utterance)) {
        const alts: [Decision, string][] = [];
        for (let v = 1; v <= 3; v++) alts.push([decision, renderTemplate(decision.template, decision.templateVars, state.turn + v)]);
        for (const c of cands.filter((c) => c !== decision)) alts.push([c, renderTemplate(c.template, c.templateVars, state.turn)]);
        const fresh = alts.find(([c, text]) => !said.has(text) && guard(c, text).ok);
        if (fresh) {
          notes.push(`Avoided repeating an earlier reply (${decision.rule}); used ${fresh[0] === decision ? "another wording of the same move" : `the next permitted move, ${fresh[0].rule}`}.`);
          [decision, utterance] = fresh;
        } else notes.push(`Repeated an earlier reply (${decision.rule}): no alternative wording or permitted move was available.`);
      }
    }
    updateCounters(state, obs, decision, diagnosis);
  }
  applyBoardOps(state, decision, obs, ctx);
  updateTeaching(state, obs, decision, problem.id);
  if (decision.action === "EXPLAIN" && decision.nextStepAllowed && decision.template !== "concept") {
    state.lastShown = { prevRaw: ctx.currentRaw, operation: ctx.next.operation, resultRaw: ctx.next.resultRaw, arithmetic: ctx.next.arithmetic };
  }

  const contextBefore = {
    awaiting: state.dialog?.awaiting ?? "open",
    lastQuestion: state.dialog?.lastQuestion ?? "",
    lastProposal: state.dialog?.lastProposal,
    repeat: obs.kind === "operation" && !!obs.repeat,
    correction: obs.kind === "operation" && !!obs.correction,
    repair: obs.kind === "operation" && !!obs.repair,
    continuation: obs.kind === "operation" && !!obs.continuation,
  };
  state.dialog = {
    awaiting: awaitingFor(utterance),
    lastQuestion: lastQuestionIn(utterance),
    lastRule: decision.rule,
    lastProposal:
      obs.kind === "operation" && meaning
        ? { kind: meaning.operation?.kind ?? null, part: meaning.part, verdict: opCheck?.verdict ?? null, turn: state.turn, text: event.type === "text" ? (obs.continuation && state.dialog?.lastProposal ? `${state.dialog.lastProposal.text} ${event.text}` : event.text).slice(0, 120) : "" }
        : state.dialog?.lastProposal,
    repeats: obs.kind === "operation" && obs.repeat ? (state.dialog?.repeats ?? 0) + 1 : 0,
  };
  state.modelCalls = (state.modelCalls ?? 0) + llmCalls.filter((c) => c.kind === "model").length;
  state.lastTutorText = utterance;
  state.lastTutorGrounded = Array.from(new Set([...grounded, ...decision.allowedEquations, ...(decision.nextStepAllowed ? [ctx.next.resultRaw] : [])]));
  state.revealedLast = decision.revealAllowed;
  state.transcript.push({ role: "tutor", text: utterance, action: decision.action, turn: state.turn, anchor: anchorFor(state, decision, ctx, studentEntry.id), focus: decision.focus ?? [], rule: decision.rule, hintLevel: decision.hintLevel, stage: decision.stage, ...(decision.visual ? { visual: decision.visual } : {}), ...(decision.visual === "balance" ? { figure: { a: Number(decision.templateVars.balA), b: Number(decision.templateVars.balB), c: Number(decision.templateVars.balC) } } : {}) });

  const trace: TurnTrace = {
    turnId,
    requestId,
    sessionId: state.sessionId,
    turn: state.turn,
    startedAt: now().toISOString(),
    event,
    intent,
    validation,
    diagnosis,
    diagnosisSource,
    meaning,
    context: contextBefore,
    opCheck,
    candidates: cands.map((c) => ({ id: c.id, action: c.action, hintLevel: c.hintLevel })),
    decision,
    decisionSource: source,
    rationale,
    phaseBefore,
    phaseAfter: state.phase,
    stateDelta: diff(snapshot, summarize(state)),
    llmCalls,
    fallbackUsed: source === "fallback-default",
    utterance,
    totalLatencyMs: Math.round(performance.now() - t0),
    errors,
    ...(notes.length ? { notes } : {}),
    teaching: state.teaching ? { confusion: state.teaching.confusion, strategies: [...state.teaching.strategies], answerRequests: state.teaching.answerRequests, lastSuccess: state.teaching.lastSuccess, objective: state.teaching.objective } : undefined,
  };
  return { state, utterance, trace };
}

/** Exact validation of an answer or a step, with diagnosis and the check shown to the student. */
function perceiveMath(
  state: SessionState,
  intent: Intent,
  ctx: PolicyContext,
  base: Pick<Observation, "insistent" | "frustrated" | "question" | "interruptedTutor">,
  grounded: string[],
  setValidation: (v: NonNullable<TurnTrace["validation"]>) => void,
  setDiagnosis: (d: Diagnosis) => void,
  studentEntry: { id?: string },
): Observation {
  const problem = ctx.problem;
  const value = intent.kind === "ANSWER" ? intentValue(intent) : null;
  const eq = intentEquation(intent);
  const raw = intent.mathSegment ?? "";
  const claims: ClaimCheck[] = checkClaims(intent.claims, problem);
  const pEq = parseEquation(problem.text)!;

  const before = parseEquation(state.lastValidRaw) ?? pEq;
  const lineRaw = eq ? eq.raw : `x = ${value}`;
  const lineEq = eq ?? parseEquation(lineRaw);
  const observed = lineEq ? observeOperation(before, lineEq) : undefined;
  if (value && value.eq(problemAnswer(problem))) {
    const bad = claims.filter((c) => !c.ok);
    setValidation({ parsed: raw, equivalentToProblem: true, impliedValue: value.toString(), correctValue: problem.answer, claims, observed });
    studentEntry.id = addBoard(state, { kind: "answer", latex: rawToLatex(lineRaw), raw: lineRaw, observed, status: "final", note: bad.length ? "right answer — reasoning to fix" : undefined });
    const sub = substitutionCheck(problem, value.toString());
    if (bad.length) return { kind: "correct_flawed", studentRaw: raw, studentValue: value.toString(), check: sub ? { text: sub.text, kind: "substitution" } : undefined, flaw: bad.map((b) => b.why).join("; "), ...base };
    return { kind: "correct_answer", studentRaw: raw, studentValue: value.toString(), ...base };
  }

  let obs: Observation;
  if (eq && !value) {
    if (equivalent(eq, pEq)) {
      const progress = complexity(eq) < complexity(before);
      setValidation({ parsed: raw, equivalentToProblem: true, impliedValue: problem.answer, correctValue: problem.answer, progress, claims, observed });
      studentEntry.id = addBoard(state, { kind: "step", latex: rawToLatex(raw), raw, observed, status: "valid", note: progress ? "balanced ✓" : "true, but no simpler" });
      if (progress) state.lastValidRaw = raw;
      return { kind: progress ? "valid_step" : "valid_no_progress", studentRaw: raw, observed, ...base };
    }
    const sol = solve(eq);
    const implied = sol.kind === "unique" ? sol.x : null;
    const dg = diagnoseStep(eq, ctx.current);
    setDiagnosis(dg);
    setValidation({ parsed: raw, equivalentToProblem: false, impliedValue: implied?.toString() ?? null, correctValue: problem.answer, progress: false, claims, observed });
    const sc = stepCheck(eq, ctx.current);
    const sub = !sc && implied ? substitutionCheck(problem, implied.toString()) : null;
    const subText = sub ? `if x = ${implied}, then ${sub.text}` : null;
    obs = {
      kind: "invalid",
      diagnosis: dg,
      studentRaw: raw,
      studentValue: implied?.toString(),
      check: sc ? { text: sc, kind: "step" } : subText ? { text: subText, kind: "substitution" } : undefined,
      observed,
      ...base,
    };
    studentEntry.id = addBoard(state, { kind: "step", latex: rawToLatex(raw), raw, observed, status: "invalid", note: `not equivalent to ${state.lastValidRaw}` });
    grounded.push(raw);
    if (implied && !sc) grounded.push(`x = ${implied}`);
  } else {
    const v = value!;
    const dg = diagnoseValue(v, ctx.current);
    setDiagnosis(dg);
    setValidation({ parsed: raw, equivalentToProblem: false, impliedValue: v.toString(), correctValue: problem.answer, claims, observed });
    const sub = substitutionCheck(problem, v.toString());
    obs = { kind: "invalid", diagnosis: dg, studentRaw: raw, studentValue: v.toString(), check: sub ? { text: `if x = ${v}, then ${sub.text}`, kind: "substitution" } : undefined, observed, ...base };
    studentEntry.id = addBoard(state, { kind: "answer", latex: rawToLatex(lineRaw), raw: lineRaw, observed, status: "invalid", note: `doesn't make ${problem.text} true` });
    grounded.push(raw, `x = ${v}`);
  }
  // Insisting = saying so, or repeating the same wrong claim.
  const claim = obs.studentValue;
  if (claim && state.persistentClaim === claim) {
    if (!obs.insistent) obs.repeatedClaim = true;
    obs.insistent = true;
  }
  state.persistentClaim = claim;
  return obs;
}

function specFor(d: Decision, ctx: PolicyContext, grounded: string[], state: SessionState): GuardSpec {
  return {
    answer: problemAnswer(ctx.problem),
    problemText: ctx.problem.text,
    nextStepRaw: ctx.next.resultRaw,
    revealAllowed: d.revealAllowed,
    nextStepAllowed: d.nextStepAllowed,
    groundedEquations: [
      ...grounded,
      ...d.allowedEquations,
      ...state.board.filter((b) => b.problemId === ctx.problem.id && b.status === "valid").map((b) => b.latex),
    ],
  };
}

function baselineDecision(base: Decision, ctx: PolicyContext): Decision {
  return {
    ...base,
    id: "BASELINE_ANSWER_GIVER",
    action: "EXPLAIN",
    rule: "BASELINE_ANSWER_GIVER",
    reason: "Naive baseline: behaves like a generic helpful chatbot and explains the full solution whenever the student is wrong, stuck or asks anything.",
    goal: "Explain the full solution.",
    hintLevel: 3,
    revealAllowed: true,
    nextStepAllowed: true,
    assistive: true,
    template: "reveal",
    templateVars: { ...base.templateVars, worked: worked(ctx), lead: "" },
    strategy: "worked",
    visual: undefined,
  };
}

function worked(ctx: PolicyContext) {
  const s1 = ctx.next;
  if (s1.resultRaw.startsWith("x =")) return `First, ${s1.operation}: ${s1.resultRaw}.`;
  const after = parseEquation(s1.resultRaw)!;
  const a = after.lhs.a.isZero() ? after.rhs.a : after.lhs.a;
  const c = after.lhs.a.isZero() ? after.lhs.b : after.rhs.b;
  return `First, ${s1.operation}: ${s1.resultRaw}. Then, divide both sides by ${a}: x = ${c.div(a)}.`;
}

/** The next problem's own equation is not about the current problem — exclude it from current-problem guard checks. */
function stripNextProblem(text: string, decision: Decision): string {
  const np = decision.templateVars.nextProblem;
  return np ? text.split(np).join(" [next problem] ") : text;
}

const HELP_LIKE: Observation["kind"][] = ["help", "confused", "rephrase", "example", "slower"];

/** Moves described in words that are mathematically wrong count as attempts, like a wrong line would. */
const WRONG_MOVES = ["wrong_inverse", "one_side", "evaluation_order"];

/** What the tutor's question asks the student for — read from the words actually said (template or model). */
export function awaitingFor(utterance: string): Awaiting {
  const q = lastQuestionIn(utterance).toLowerCase();
  if (/which (one )?(would|do|should|could) you (undo|deal with|do) first|which comes off first|which part|which one first/.test(q)) return "choose_part";
  if (/what (operation )?(would |could )?undoes?|what would undo|what could you undo|what operation|what undoes|what has to happen|what do you need to do/.test(q)) return "operation";
  if (/what does (the equation|it) become|new line|line do you get|what do you get|your next line|next line|do next|next move|what would you do|where would you start/.test(q)) return "line";
  if (/how you got|walk me through|first thing you did|how did you/.test(q)) return "reasoning";
  if (/what does that tell|compare|which part looks wrong|what's different/.test(q)) return "reflection";
  return "open";
}

export function lastQuestionIn(utterance: string): string {
  const qs = utterance.match(/[^.?!]*\?/g);
  return (qs ? qs[qs.length - 1] : utterance).trim();
}

/** A misconception hypothesis from a move described in words (basis: the student's own words). */
function operationDiagnosis(m: StudentMeaning, c: OperationCheck | undefined, said: string): Diagnosis | undefined {
  if (!c) return undefined;
  const words = `"${said.trim().slice(0, 60)}"`;
  const common = { alsoMatches: [], basis: "explanation" as const };
  if (c.verdict === "evaluation_order")
    return { id: "EVALUATION_ORDER_CONFUSION", category: "conceptual", confidence: m.mentionsOrderOfOperations ? 0.7 : 0.5, evidence: `Proposed multiplying first ${words}${m.mentionsOrderOfOperations ? ", citing the order of operations" : ""}. Consistent with using the evaluation order (BODMAS) to solve.`, alternatives: ["noticed the 3 × x and wanted to deal with it — a reasonable instinct, just not first"], ...common };
  if (c.verdict === "wrong_inverse")
    return { id: m.operation?.kind === "multiply" ? "MULTIPLIED_INSTEAD_OF_DIVIDING" : "SIGN_ERROR_INVERSE_OP", category: "conceptual", confidence: 0.6, evidence: `Proposed ${m.operation?.kind} ${m.operation?.operand ?? ""} ${words}: ${c.explanation}`, alternatives: ["a slip of the tongue (said add, meant subtract)"], ...common };
  if (c.verdict === "one_side")
    return { id: "ONE_SIDE_ONLY", category: "conceptual", confidence: 0.6, evidence: `Proposed the move on the ${m.operation?.sides} side only ${words}.`, alternatives: ["meant both sides but only mentioned one"], ...common };
  return undefined;
}

/** Map a request (from a phrase rule or a model's enum answer) to the intent the engine routes on. */
function intentForRequest(r: HelpRequest): Pick<Intent, "kind" | "request"> {
  const kind: Record<HelpRequest, Intent["kind"]> = {
    stuck: "HELP_REQUEST",
    answer: "HELP_REQUEST",
    thinking: "THINKING",
    hint: "HELP_REQUEST",
    next: "HELP_REQUEST",
    more_help: "HELP_REQUEST",
    confused: "CONFUSED",
    rephrase: "REPHRASE_REQUEST",
    example: "EXAMPLE_REQUEST",
    slower: "SLOWER_REQUEST",
    no_answer: "NO_ANSWER_PREFERENCE",
    why: "WHY_QUESTION",
    ack: "ACKNOWLEDGE",
  };
  return { kind: kind[r], request: r };
}

function updateCounters(state: SessionState, obs: Observation, decision: Decision, diagnosis?: Diagnosis) {
  const problem = state.problems[state.current];
  const isTransfer = problem.role === "transfer";
  const firstAttempt = state.attempts === 0 && state.hintsGiven === 0 && state.helpRequests === 0;
  if (obs.kind === "invalid" || (obs.kind === "operation" && obs.opCheck && WRONG_MOVES.includes(obs.opCheck.verdict))) {
    if (firstAttempt) state.mastery = observe(state.mastery, problem.id, false, isTransfer, obs.kind === "operation" ? `first move incorrect (${obs.opCheck!.verdict}, in words)` : "first attempt incorrect");
    state.attempts += 1;
  }
  // Asking for help before attempting a fresh problem is evidence the skill isn't independent yet.
  // Rephrasing, examples and "slower" are help too (conservative: they never inflate mastery).
  const helpLike = HELP_LIKE.includes(obs.kind);
  if (helpLike && firstAttempt && isTransfer) {
    state.mastery = observe(state.mastery, problem.id, false, true, `asked for help before attempting (${obs.kind})`);
  }
  if (obs.kind === "silence" || obs.kind === "empty") state.silences += 1;
  else if (obs.kind !== "start") state.silences = 0;
  if (helpLike) state.helpRequests += 1;
  if (obs.kind === "no_answer") state.noReveal = true;
  if (obs.kind === "slower") state.pace = "slow";
  if (decision.stage) state.lastStage = decision.stage;
  if (decision.template === "micro" || decision.template === "slower") state.explainVariant = (state.explainVariant ?? 0) + 1;
  if (decision.assistive) state.hintsGiven += 1;
  state.hintLevel = Math.max(state.hintLevel, decision.hintLevel);
  if (decision.action === "EXPLAIN" && decision.revealAllowed) state.revealed = true;
  if (diagnosis && diagnosis.id !== "UNCLASSIFIED" && diagnosis.id !== "ARITHMETIC_SLIP") {
    state.misconceptionCounts[diagnosis.id] = (state.misconceptionCounts[diagnosis.id] ?? 0) + 1;
    state.misconceptionHistory!.push({ id: diagnosis.id, problemId: problem.id, turn: state.turn });
  }
  if (diagnosis && diagnosis.id !== "UNCLASSIFIED") state.lastDiagnosis = diagnosis;
  // Close the loop on the previous intervention: did it lead to progress?
  const prevIv = [...state.interventions].reverse().find((i) => i.problemId === problem.id && !i.outcome);
  if (prevIv && ["valid_step", "correct_answer", "correct_flawed", "invalid"].includes(obs.kind)) {
    prevIv.outcome = obs.kind === "invalid" ? "no_progress" : "progress";
  }
  if (["ASK", "HINT", "EXPLAIN", "VISUALIZE", "RETEACH", "ENCOURAGE", "CLARIFY", "VERIFY", "WAIT"].includes(decision.action) && obs.kind !== "correct_answer" && obs.kind !== "correct_flawed") {
    state.interventions.push({ problemId: problem.id, turn: state.turn, action: decision.action, rule: decision.rule, misconception: diagnosis?.id, assistive: !!decision.assistive || undefined });
  }
}

/** Moving between problems and ending the lesson. Only called on a correct answer. */
function transition(state: SessionState, obs: Observation): { vars: Record<string, string>; decision?: Partial<Decision> } {
  const problem = state.problems[state.current];
  const flawed = obs.kind === "correct_flawed";
  const unassisted = state.attempts === 0 && state.hintsGiven === 0 && state.helpRequests === 0 && !state.revealed && !flawed;
  state.mastery = unassisted
    ? observe(state.mastery, problem.id, true, problem.role === "transfer", "first attempt correct, no help")
    : assistedCompletion(state.mastery, problem.id, flawed ? "correct answer, invalid stated reasoning" : "finished after help");

  const transfersDone = state.problems.filter((p) => p.role === "transfer").length;
  const finished = state.mastery.status === "mastered" || (problem.role === "transfer" && transfersDone >= MAX_TRANSFER_ITEMS);
  if (finished) {
    state.phase = "COMPLETE";
    state.mastery = { ...state.mastery, status: finalStatus(state.mastery) };
    const mastered = state.mastery.status === "mastered";
    return {
      decision: {
        action: "ASSESS",
        rule: mastered ? "R16_MASTERY_CONFIRMED" : "R16_LESSON_END_NOT_MASTERED",
        id: mastered ? "R16_MASTERY_CONFIRMED" : "R16_LESSON_END_NOT_MASTERED",
        reason: mastered
          ? `Mastery criterion met: P(known) = ${state.mastery.pKnown.toFixed(2)} ≥ 0.9 and ${state.mastery.consecutiveUnassisted} consecutive independent transfer solves.`
          : `Reached ${MAX_TRANSFER_ITEMS} transfer items without two consecutive independent solves; status "${state.mastery.status}". End positively and flag for practice.`,
        goal: "Acknowledge the answer, recap the two moves (undo the constant, then the multiplication), and close the lesson.",
        template: flawed ? "correct_flawed" : "lesson_end",
      },
      vars: {
        lead: unassisted ? "Correct — and that one was all you, no hints." : "You got there.",
        followup: mastered
          ? "That's two new problems in a row without help, including the one with a twist — so the two moves seem to make sense to you. Lesson complete!"
          : "You stuck with it today — we'll practise this a bit more next time. Lesson complete!",
      },
    };
  }

  // The first independent check is always 4x + 3 = 19: same shape as the guided problem, new numbers — a
  // fair first test of whether the two moves transfer. Later checks change the surface form.
  const next = transfersDone === 0 ? FIRST_TRANSFER : generateTransferProblem(state.seed, transfersDone, state.problems);
  state.problems.push(next);
  state.current = state.problems.length - 1;
  state.phase = "TRANSFER";
  state.lastValidRaw = next.text;
  state.attempts = 0;
  state.hintLevel = 0;
  state.hintsGiven = 0;
  state.helpRequests = 0;
  state.silences = 0;
  state.revealed = false;
  state.persistentClaim = undefined;
  state.lastShown = undefined;
  state.lastStage = undefined;
  state.explainVariant = 0;
  state.board.push({ id: `${next.id}-given`, problemId: next.id, kind: "problem", latex: next.latex, status: "given", raw: next.text, turn: state.turn });
  // The third problem is the transfer: say what's different about it, so the twist is visible.
  const twist = next.form === "ax-b=c" ? "this time something is taken away" : next.form === "b+ax=c" ? "this time the number comes first" : "new numbers again";
  return { vars: { nextProblem: next.text, followup: transfersDone >= 1 ? `Ready for a challenge? A different twist — ${twist}: ${next.text}` : `Try this one yourself: ${next.text}` } };
}

/** Whiteboard entries come only from validated, deterministic data — never from model text. */
function applyBoardOps(state: SessionState, d: Decision, obs: Observation, ctx: PolicyContext) {
  const pid = ctx.problem.id;
  if (obs.check && ["hint1_check", "insist_check", "contrast_check", "verify_check", "correct_flawed"].includes(d.template)) {
    addBoard(state, { kind: "check", latex: checkLatex(obs.check.text), status: "info", note: obs.check.kind === "step" ? "testing your line" : "check by substitution" }, pid);
  }
  if (d.action === "EXPLAIN" && d.nextStepAllowed && d.template !== "concept") {
    addBoard(state, { kind: "hint", latex: rawToLatex(ctx.next.resultRaw), status: "info", note: `tutor showed: ${ctx.next.operation}` }, pid);
  }
}

/** Which board line a tutor turn sits beside (presentation only). */
function anchorFor(state: SessionState, d: Decision, ctx: PolicyContext, studentEntryId?: string): string | undefined {
  const now = state.problems[state.current];
  if (now.id !== ctx.problem.id) return state.board.find((b) => b.problemId === now.id && b.kind === "problem")?.id; // moved to a fresh problem
  if (state.phase === "COMPLETE" && studentEntryId) return studentEntryId;
  if (d.anchor === "student" && studentEntryId) return studentEntryId;
  return [...state.board].reverse().find((b) => b.problemId === ctx.problem.id && (b.status === "valid" || b.status === "given"))?.id;
}

function checkLatex(check: string) {
  return check
    .replace(/^if (\S+) were (\S+), the left side would be /, "$1 = $2 \\;\\Rightarrow\\; ")
    .replace(/^if x = (\S+), then /, "x = $1 \\;\\Rightarrow\\; ")
    .replace(/×/g, "\\times")
    .replace(/−/g, "-")
    .replace(/, not (-?[\d/]+)/, " \\neq $1")
    .replace(/(\d+)\/(\d+)/g, "\\tfrac{$1}{$2}");
}

function addBoard(state: SessionState, e: Omit<BoardEntry, "id" | "problemId">, problemId?: string): string {
  const pid = problemId ?? state.problems[state.current].id;
  const last = [...state.board].reverse().find((b) => b.problemId === pid);
  if (last && last.latex === e.latex && last.status === e.status) return last.id; // student repeated themselves
  const id = `${pid}-${state.board.length}`;
  state.board.push({ turn: state.turn, ...e, id, problemId: pid });
  return id;
}

function lastStudentMath(state: SessionState): string | undefined {
  for (let i = state.transcript.length - 2; i >= 0; i--) {
    const m = state.transcript[i];
    if (m.role === "student" && /\d/.test(m.text)) return m.text;
  }
  return undefined;
}

function observationSummary(obs: Observation, _intent: Intent | undefined, validation: TurnTrace["validation"]) {
  return {
    kind: obs.kind,
    studentMaths: obs.studentRaw,
    correct: obs.kind === "correct_answer" || obs.kind === "valid_step" || obs.kind === "valid_no_progress",
    equivalentToProblem: validation?.equivalentToProblem,
    misconception: obs.diagnosis ? { id: obs.diagnosis.id, label: MISCONCEPTIONS[obs.diagnosis.id].label, evidence: obs.diagnosis.evidence } : undefined,
    computedCheck: obs.check?.text,
    reasoningFlaw: obs.flaw,
    topic: obs.topic,
    insistent: obs.insistent || undefined,
    frustrated: obs.frustrated || undefined,
    interruptedTutor: obs.interruptedTutor || undefined,
    // A move described in words, and the exact verdict on it. The model words the reply; it does not re-judge this.
    studentProposal: obs.meaning?.operation ? { operation: obs.meaning.operation.kind, number: obs.meaning.operation.operand, sides: obs.meaning.operation.sides, appealsToBODMAS: obs.meaning.mentionsOrderOfOperations || undefined } : obs.meaning?.part ? { pointsAt: obs.meaning.part } : undefined,
    verifiedVerdict: obs.opCheck ? { verdict: obs.opCheck.verdict, explanation: obs.opCheck.explanation } : undefined,
    repeatedSameProposal: obs.repeat || undefined,
    correctingThemselves: obs.correction || undefined,
    tutorMisreadThemLastTurn: obs.repair || undefined,
  };
}

function learnerSummary(s: SessionState) {
  const recurring = Array.from(new Set((s.misconceptionHistory ?? []).map((m) => m.id))).filter((id) => new Set((s.misconceptionHistory ?? []).filter((m) => m.id === id).map((m) => m.problemId)).size > 1);
  return {
    phase: s.phase,
    problemRole: s.problems[s.current].role,
    wrongAttemptsOnThisProblem: s.attempts,
    hintLevel: s.hintLevel,
    helpRequests: s.helpRequests,
    silences: s.silences,
    recurringMisconceptions: recurring,
    timesStuckOnThisProblem: s.teaching?.confusion ?? 0,
    approachesAlreadyTried: s.teaching?.strategies ?? [],
    askedForTheAnswer: s.teaching?.answerRequests ?? 0,
    masteryEstimate: Math.round(s.mastery.pKnown * 100) / 100,
  };
}

function summarize(s: SessionState) {
  return {
    phase: s.phase,
    problem: s.problems[s.current]?.text,
    attempts: s.attempts,
    hintLevel: s.hintLevel,
    helpRequests: s.helpRequests,
    silences: s.silences,
    pKnown: Math.round(s.mastery.pKnown * 1000) / 1000,
    mastery: s.mastery.status,
    lastValid: s.lastValidRaw,
  };
}

function diff(a: Record<string, unknown>, b: Record<string, unknown>) {
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(b)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out[k] = [a[k], b[k]];
  return out;
}

function duplicateTrace(prev: SessionState, event: StudentEvent, requestId: string, now: () => Date): TurnTrace {
  return {
    turnId: `${prev.sessionId}-t${prev.turn}-dup`,
    requestId,
    sessionId: prev.sessionId,
    turn: prev.turn,
    startedAt: now().toISOString(),
    event,
    candidates: [],
    decision: {
      id: "DUPLICATE_EVENT",
      action: "RECAP",
      rule: "DUPLICATE_EVENT",
      reason: "This event id was already applied; returning the existing state unchanged.",
      hintLevel: prev.hintLevel,
      goal: "",
      facts: [],
      revealAllowed: false,
      nextStepAllowed: false,
      allowedEquations: [],
      assistive: false,
      template: "repeat",
      templateVars: {},
    },
    decisionSource: "policy-default",
    phaseBefore: prev.phase,
    phaseAfter: prev.phase,
    stateDelta: {},
    llmCalls: [],
    fallbackUsed: false,
    utterance: prev.lastTutorText,
    totalLatencyMs: 0,
    errors: [],
  };
}

export { MISCONCEPTIONS, deterministic as defaultTeacher };
