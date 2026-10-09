/**
 * The shared tutoring kernel for the geometry and physics lessons.
 *
 *   text → read (shared request phrases + the subject's own reader; an optional model reading for text
 *   neither places) → verify (the subject's own deterministic verifier) → teaching move (shared hint ladder
 *   and requests; the subject's wording) → leak guard → state update → trace
 *
 * What is shared: conversation, requests ("I'm stuck", "why?", "explain it another way", "say that again",
 * "don't tell me"), the NOTICE → THINK → TRY ladder, reveal-only-after-effort, progress records,
 * idempotency, model-call budget and the trace format the Engineer View reads.
 * What is NOT shared: deciding whether an answer is right. Each subject has its own verifier, and there is
 * no general reasoning engine — text a subject can't check is answered with a clarifying question.
 */
import { DANGLING, FRUSTRATED, REPEAT, matchPhrase } from "../intent";
import { DeterministicTeacher, type TeachingModel } from "../llm/teacher";
import type { Decision, LlmCall, Message, Phase, StudentEvent, TurnTrace } from "../types";
import { arithmeticClaims, normalizeText, numbersIn } from "./text";
import type { ProblemRecord, SubjectCheck, SubjectLessonId, SubjectMove, SubjectProblem, SubjectReading, SubjectState } from "./types";

export interface SubjectModule {
  id: SubjectLessonId;
  title: string;
  objective: string;
  /** Three problems: one solved together, two checks on your own. Deterministic from the seed. */
  makeProblems(seed: number): SubjectProblem[];
  /** Subject-specific reading of answers, concept statements and concept questions. Null = not placed. */
  read(t: string, p: SubjectProblem): Partial<SubjectReading> | null;
  /** The authoritative check. */
  verify(r: SubjectReading, p: SubjectProblem): SubjectCheck;
  /** The move for an answer or concept statement, given the verdict. */
  respond(p: SubjectProblem, r: SubjectReading, c: SubjectCheck, cx: RespondContext): SubjectMove;
  /** Hint ladder: 1 NOTICE, 2 THINK, 3 TRY. `variant` gives a different explanation at the same level. */
  hint(p: SubjectProblem, level: 1 | 2 | 3, variant: number): string;
  /** Worked solution (only after real effort). */
  reveal(p: SubjectProblem): string;
  /** Explain an idea (a "why?" with no topic explains the current problem's key idea). Never states the answer. */
  explain(p: SubjectProblem, topic?: string): string;
  /** A small worked example with different numbers. */
  example(p: SubjectProblem): string;
  /** Does this text state the answer to p? (The leak guard.) */
  leaks(text: string, p: SubjectProblem): boolean;
  /** What a configured model may map unplaced text to. */
  vocabulary: { concepts: string[]; outcomes: string[]; topics: string[] };
  /** Said after a correct answer to move on. */
  nextIntro(next: SubjectProblem, index: number): string;
  /** What the tutor can check for this problem, for the "I can only check…" reply. */
  checkable(p: SubjectProblem): string;
}

export interface RespondContext {
  state: SubjectState;
  /** The student gave the same answer as last time. */
  repeat: boolean;
  /** Text to append when the problem is solved (the next question, or the end of the lesson). */
  next: string;
}

export interface SubjectStepDeps {
  teacher: TeachingModel;
  requestId?: string;
  maxModelCalls?: number;
  now?: () => Date;
}

export interface SubjectStepResult {
  state: SubjectState;
  utterance: string;
  trace: TurnTrace;
  duplicate?: boolean;
}

export function createSubjectSession(mod: SubjectModule, o: { sessionId: string; seed: number; now?: Date }): SubjectState {
  const problems = mod.makeProblems(o.seed);
  return {
    version: 1,
    lesson: mod.id,
    sessionId: o.sessionId,
    createdAt: (o.now ?? new Date()).toISOString(),
    seed: o.seed,
    turn: 0,
    phase: "GUIDED",
    problems,
    current: 0,
    attempts: 0,
    hintLevel: 0,
    helpRequests: 0,
    explainVariant: 0,
    lastTutorText: "",
    lastQuestion: "",
    repeats: 0,
    records: problems.map((p) => ({ problemId: p.id, solved: false, alone: false, hints: 0, attempts: 0, revealed: false })),
    transcript: [],
  };
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** The last question in a tutor message (for repeats and "go ahead"). */
function lastQuestionOf(text: string) {
  const qs = text.match(/[^.?!]*\?/g);
  return qs ? qs[qs.length - 1].trim() : "";
}

/** Read a message: shared request phrases, then the subject's own reader, then fallbacks. */
export function readMessage(mod: SubjectModule, raw: string, p: SubjectProblem): SubjectReading {
  const t = normalizeText(raw.trim()).replace(/[.!]+$/, "");
  const base: SubjectReading = { kind: "unclear", concepts: [], claims: arithmeticClaims(t), evidence: [], source: "rules", confidence: 0.6, question: /\?\s*$/.test(t) || /^(why|how|what|can|could|should|is|are|does|do)\b/.test(t), frustrated: FRUSTRATED.test(t) };
  if (!t) return { ...base, kind: "unclear", evidence: ["(empty)"] };
  const phrase = matchPhrase(t);
  // Requests about the explanation itself come first: "explain it another way" is not "say it again".
  if (phrase && (phrase.id === "P_NO_ANSWER" || phrase.id === "P_REPHRASE")) return { ...base, kind: phrase.id === "P_NO_ANSWER" ? "no_answer" : "rephrase", evidence: [phrase.id], confidence: 0.9 };
  if (REPEAT.test(t)) return { ...base, kind: "repeat", evidence: ["P_REPEAT"], confidence: 0.9 };
  const own = mod.read(t, p);
  if (own?.kind) return { ...base, ...own, concepts: own.concepts ?? [], claims: own.claims ?? base.claims, evidence: own.evidence ?? [], confidence: own.confidence ?? 0.85 };
  if (phrase) {
    const kind: SubjectReading["kind"] =
      phrase.kind === "CONFUSED" ? "confused" : phrase.kind === "WHY_QUESTION" ? "why" : phrase.kind === "EXAMPLE_REQUEST" ? "example" : phrase.kind === "SLOWER_REQUEST" ? "slower" : phrase.kind === "ACKNOWLEDGE" ? "ack" : "help";
    return { ...base, kind, evidence: [phrase.id], confidence: 0.9 };
  }
  const words = t.split(/\s+/).length;
  if (words <= 6 && DANGLING.test(t)) return { ...base, kind: "incomplete", evidence: ["stops mid-sentence", raw.trim().replace(/[.…\s-]+$/, "")] };
  if (base.frustrated) return { ...base, kind: "help", evidence: ["frustrated"] };
  return { ...base, kind: words <= 4 && !base.question ? "unclear" : "off_topic", evidence: ["no rule matched"], confidence: 0.4 };
}

/** One turn of a geometry or physics lesson. Pure: (state, event) → (state', utterance, trace). */
export async function stepSubject(mod: SubjectModule, prev: SubjectState, event: StudentEvent, deps: SubjectStepDeps): Promise<SubjectStepResult> {
  const t0 = performance.now();
  const now = deps.now?.() ?? new Date();
  if (event.id && prev.lastEventId === event.id) {
    return { state: prev, utterance: prev.lastTutorText, duplicate: true, trace: emptyTrace(prev, event, deps, now) };
  }
  const state = clone(prev);
  state.turn += 1;
  if (event.id) state.lastEventId = event.id;
  const phaseBefore = state.phase;
  const before = snapshot(state);
  const llmCalls: LlmCall[] = [];
  const errors: string[] = [];
  const overBudget = deps.teacher.mode === "llm" && deps.maxModelCalls != null && (state.modelCalls ?? 0) >= deps.maxModelCalls;
  const teacher: TeachingModel = overBudget ? new DeterministicTeacher() : deps.teacher;
  if (overBudget) errors.push(`Model-call budget for this session (${deps.maxModelCalls}) reached; this turn ran deterministically.`);

  const p = state.problems[Math.min(state.current, state.problems.length - 1)];
  const rec = state.records[Math.min(state.current, state.records.length - 1)];
  let reading: SubjectReading | undefined;
  let check: SubjectCheck | undefined;
  let move: SubjectMove;
  const context = { awaiting: state.phase === "COMPLETE" ? "nothing" : "answer", lastQuestion: state.lastQuestion, repeat: false, correction: false, repair: false };

  if (event.type === "start") {
    move = state.turn === 1 || state.transcript.length === 0 ? startMove(mod, p) : { rule: "S_REPEAT", action: "RECAP", reason: "Start pressed again: restate the question.", text: `Here's where we are: ${state.lastQuestion || p.prompt}`, hintLevel: state.hintLevel, revealAllowed: false, assistive: false };
  } else if (event.type === "silence") {
    move = { rule: "S_WAIT", action: "WAIT", reason: "Silence is thinking time; offer, don't push.", text: `Take your time. If you'd like a hint, just say so. ${state.lastQuestion}`.trim(), hintLevel: state.hintLevel, revealAllowed: false, assistive: false };
  } else {
    state.transcript.push({ role: "student", text: event.text, turn: state.turn, via: event.via });
    reading = readMessage(mod, event.text, p);
    // Text the rules can't place may go to a configured model, which can only choose from closed labels.
    if ((reading.kind === "unclear" || reading.kind === "off_topic") && !reading.frustrated && teacher.interpretSubject && state.phase !== "COMPLETE") {
      const r = await teacher.interpretSubject({ lesson: mod.id, text: event.text, question: state.lastQuestion || p.prompt, lastTutor: state.lastTutorText, ...mod.vocabulary });
      llmCalls.push(...r.calls);
      errors.push(...r.errors);
      if (r.reading) {
        reading = {
          ...reading,
          kind: r.reading.kind,
          value: r.reading.value,
          direction: r.reading.direction,
          outcome: r.reading.outcome,
          concepts: r.reading.concept ? [r.reading.concept] : [],
          topic: r.reading.topic,
          source: "llm",
          confidence: r.reading.confidence,
          evidence: ["model reading (closed labels)"],
        };
      }
    }
    // "4" … "to the right": a direction on its own finishes the size the student gave in their last message.
    if (reading.kind === "answer" && reading.value == null && reading.direction && !reading.outcome && state.lastAnswer?.value != null && state.lastAnswer.turn === state.turn - 1) {
      reading = { ...reading, value: state.lastAnswer.value, evidence: [...reading.evidence, `size ${state.lastAnswer.value} from the previous message`] };
    }
    if (state.phase === "COMPLETE") {
      move = { rule: "S_COMPLETE", action: "RECAP", reason: "Lesson finished; nothing new after closure.", text: "This lesson is finished. You can start it again or pick another lesson from the home page.", hintLevel: 0, revealAllowed: true, assistive: false };
    } else {
      const repeat = reading.kind === "answer" && !!state.lastAnswer && state.lastAnswer.value === reading.value && state.lastAnswer.direction === reading.direction && state.lastAnswer.outcome === reading.outcome;
      context.repeat = repeat;
      if (reading.kind === "answer" || reading.kind === "concept_claim") {
        check = mod.verify(reading, p);
        const next = state.current + 1 < state.problems.length ? mod.nextIntro(state.problems[state.current + 1], state.current + 1) : finalText(state, rec);
        move = mod.respond(p, reading, check, { state, repeat, next });
        // A wrong answer given again after the tutor already responded: move one rung up instead of repeating.
        // A third wrong answer that no modelled mistake explains: stop asking how, and move up the ladder.
        if (move.attempt && !repeat && state.attempts >= 2 && check.misconception?.id === "UNEXPLAINED") move = { ...ladder(mod, state, p, "S_REPEATED_ERROR", "A third unexplained wrong answer: asking how again won't help — give the next hint.", false), attempt: true };
        if (move.attempt && repeat && state.repeats >= 1) move = ladder(mod, state, p, "S_REPEATED_ANSWER", `The same answer (${describeAnswer(reading)}) a third time: the explanation isn't landing — move up the hint ladder.`, true);
        if (reading.kind === "answer") {
          state.lastAnswer = { value: reading.value, direction: reading.direction, outcome: reading.outcome, turn: state.turn };
          state.repeats = repeat ? state.repeats + 1 : 0;
        }
      } else {
        move = requestMove(mod, state, p, reading);
      }
    }
  }

  // Leak guard: the answer is never stated before it is earned.
  const guardViolations: string[] = [];
  if (!move.revealAllowed && mod.leaks(move.text, p)) {
    guardViolations.push(`ANSWER_LEAK: "${move.text.slice(0, 80)}…"`);
    errors.push("Guard replaced a reply that stated the answer early.");
    move = { ...move, rule: `${move.rule}_GUARDED`, text: mod.hint(p, 1, state.explainVariant), stage: "NOTICE", reason: `${move.reason} (Guard: the reply would have stated the answer; replaced with a NOTICE hint.)` };
  }

  // ---------- Update ----------
  if (move.help) {
    rec.hints += 1;
    state.helpRequests += 1;
  }
  if (move.attempt) {
    state.attempts += 1;
    rec.attempts += 1;
  }
  state.hintLevel = Math.max(state.hintLevel, move.hintLevel);
  if (move.stage) state.lastStage = move.stage;
  if (move.revealed) rec.revealed = true;
  if (move.solved) {
    rec.solved = true;
    rec.alone = p.role === "check" && rec.hints === 0 && !rec.revealed;
  }
  if (move.advance) {
    state.current += 1;
    state.attempts = 0;
    state.hintLevel = 0;
    state.helpRequests = 0;
    state.explainVariant = 0;
    state.lastStage = undefined;
    state.lastAnswer = undefined;
    state.repeats = 0;
    state.phase = state.current >= state.problems.length ? "COMPLETE" : "TRANSFER";
  }
  state.lastTutorText = move.text;
  const q = lastQuestionOf(move.text);
  if (q && !["S_INCOMPLETE", "S_CLARIFY", "S_REDIRECT", "S_REPEAT", "G_WHICH_NUMBER", "P_WHICH_NUMBER"].includes(move.rule)) state.lastQuestion = q;
  state.modelCalls = (state.modelCalls ?? 0) + llmCalls.filter((c) => c.kind === "model").length;
  const msg: Message = { role: "tutor", text: move.text, action: move.action, turn: state.turn, rule: move.rule, hintLevel: move.hintLevel, stage: move.stage };
  state.transcript.push(msg);

  const decision: Decision = {
    id: move.rule,
    action: move.action,
    rule: move.rule,
    reason: move.reason,
    hintLevel: move.hintLevel,
    goal: "Deterministic subject template (no model wording in geometry and physics).",
    facts: check ? [check.detail] : [],
    revealAllowed: move.revealAllowed,
    nextStepAllowed: move.revealAllowed,
    allowedEquations: [],
    assistive: move.assistive,
    stage: move.stage,
    template: "op",
    templateVars: { opText: move.text },
  };
  const templateCall: LlmCall = { kind: "template", purpose: "decide", provider: "local", model: `${mod.id}-templates-v1`, latencyMs: 0, inputTokens: 0, outputTokens: 0, costUsd: null, attempt: 1, ok: guardViolations.length === 0, guard: { ok: guardViolations.length === 0, violations: guardViolations.map((d) => ({ type: "ANSWER_LEAK" as const, detail: d })) } };
  const trace: TurnTrace = {
    turnId: `${state.sessionId}-t${state.turn}`,
    requestId: deps.requestId ?? "local",
    sessionId: state.sessionId,
    turn: state.turn,
    startedAt: now.toISOString(),
    event,
    lesson: mod.id,
    intent: reading ? { ...reading, kind: reading.kind.toUpperCase(), recognisedBy: reading.source === "llm" ? "llm" : /^P_[A-Z_]+$/.test(reading.evidence[0] ?? "") ? "phrase rule" : "subject rules", phraseRule: /^P_[A-Z_]+$/.test(reading.evidence[0] ?? "") ? reading.evidence[0] : undefined } : undefined,
    context,
    subjectCheck: check,
    candidates: [{ id: decision.id, action: decision.action, hintLevel: decision.hintLevel }],
    decision,
    decisionSource: "policy-default",
    phaseBefore,
    phaseAfter: state.phase,
    stateDelta: delta(before, snapshot(state)),
    llmCalls: [...llmCalls, templateCall],
    fallbackUsed: guardViolations.length > 0,
    utterance: move.text,
    totalLatencyMs: Math.round(performance.now() - t0),
    errors,
  };
  return { state, utterance: move.text, trace };
}

function startMove(mod: SubjectModule, p: SubjectProblem): SubjectMove {
  return { rule: "S0_PRESENT", action: "ASK", reason: "New lesson: present the first problem and ask for the student's answer, without telling them the method.", text: `Let's work on ${mod.title.toLowerCase()}. ${p.prompt}`, hintLevel: 0, revealAllowed: false, assistive: false };
}

function finalText(state: SubjectState, rec: ProblemRecord) {
  const checks = state.records.filter((r, i) => state.problems[i].role === "check");
  const alone = checks.filter((r) => (r === rec ? rec.hints === 0 && !rec.revealed : r.alone)).length;
  return `That's the end of this lesson — you solved ${alone} of ${checks.length} checks without hints.`;
}

function describeAnswer(r: SubjectReading) {
  return [r.value != null ? String(r.value) : "", r.direction ?? "", r.outcome ?? ""].filter(Boolean).join(" ") || "the same";
}

/** The shared hint ladder: NOTICE → THINK → TRY, a worked solution only after real effort. */
function ladder(mod: SubjectModule, state: SubjectState, p: SubjectProblem, rule: string, reason: string, help: boolean): SubjectMove {
  const effort = state.attempts >= 2 || state.helpRequests >= 3;
  if (state.hintLevel >= 3 && effort && !state.noReveal) {
    const nextP = state.problems[state.current + 1];
    const tail = nextP ? ` ${mod.nextIntro(nextP, state.current + 1)}` : ` ${finalText(state, state.records[state.current])}`;
    return { rule: `${rule}_REVEAL`, action: "EXPLAIN", reason: `${reason} After real effort (${state.attempts} attempts, ${state.helpRequests} help requests), show the worked solution, then move on to a fresh problem.`, text: `${mod.reveal(p)}${tail}`, hintLevel: 4, revealAllowed: true, assistive: true, advance: true, revealed: true, solved: true, help };
  }
  const level = Math.min(3, state.hintLevel + 1) as 1 | 2 | 3;
  const atCap = state.hintLevel >= 3;
  if (atCap) state.explainVariant += 1;
  const stage = level === 1 ? "NOTICE" : level === 2 ? "THINK" : "TRY";
  return { rule: `${rule}_L${level}`, action: "HINT", stage, reason: atCap ? `${reason} Already at the top of the ladder${state.noReveal ? " and the student asked not to be shown the answer" : " without enough effort for a worked solution"}: the same step, explained a new way.` : `${reason} Move one rung: ${stage}.`, text: mod.hint(p, level, state.explainVariant), hintLevel: level, revealAllowed: false, assistive: true, help };
}

/** The question part of a problem prompt ("What is the size of the third angle?"). */
export function problemQuestion(p: SubjectProblem) {
  return p.prompt.match(/[^.?!]*\?$/)?.[0]?.trim() ?? p.prompt;
}

function requestMove(mod: SubjectModule, state: SubjectState, p: SubjectProblem, r: SubjectReading): SubjectMove {
  const q = problemQuestion(p);
  const lvl = state.hintLevel;
  switch (r.kind) {
    case "help":
      return ladder(mod, state, p, "S_HELP", "The student asked for help.", true);
    case "confused":
      return ladder(mod, state, p, "S_CONFUSED", "The student is confused: a smaller step.", true);
    case "rephrase": {
      state.explainVariant += 1;
      const level = Math.max(1, Math.min(3, lvl)) as 1 | 2 | 3;
      return { rule: "S_REPHRASE", action: "HINT", stage: level === 1 ? "NOTICE" : level === 2 ? "THINK" : "TRY", reason: "Asked for another explanation: same amount of help, different words.", text: mod.hint(p, level, state.explainVariant), hintLevel: level, revealAllowed: false, assistive: true, help: lvl === 0 };
    }
    case "example":
      return { rule: "S_EXAMPLE", action: "EXPLAIN", stage: "THINK", reason: "A worked example with different numbers teaches the idea without doing this problem.", text: `${mod.example(p)} Now yours: ${q}`, hintLevel: Math.max(1, lvl), revealAllowed: false, assistive: true, help: true };
    case "slower":
      state.pace = "slow";
      return { rule: "S_SLOWER", action: "HINT", stage: "NOTICE", reason: "Slower: point at one thing only.", text: mod.hint(p, 1, state.explainVariant), hintLevel: Math.max(1, lvl), revealAllowed: false, assistive: true, help: lvl === 0 };
    case "no_answer":
      state.noReveal = true;
      return { rule: "S_NO_REVEAL", action: "ASK", reason: "The student asked not to be told the answer: hints stop before the worked solution.", text: `Deal — I won't tell you the answer. I'll give hints if you ask. ${q}`, hintLevel: lvl, revealAllowed: false, assistive: false };
    case "repeat":
      return { rule: "S_REPEAT", action: "RECAP", reason: "Asked to hear it again: restate, don't advance.", text: `Sure — here it is again: ${state.lastTutorText || p.prompt}`, hintLevel: lvl, revealAllowed: false, assistive: false };
    case "ack":
      return { rule: "S_ACK", action: "ASK", stage: "TRY", reason: "Acknowledged: hand the thinking back.", text: `Go ahead — ${q.charAt(0).toLowerCase()}${q.slice(1)}`, hintLevel: lvl, revealAllowed: false, assistive: false };
    case "why":
    case "concept_question":
      return { rule: r.kind === "why" ? "S_WHY" : `S_CONCEPT_${(r.topic ?? "general").toUpperCase()}`, action: "EXPLAIN", reason: "A question about the idea deserves a direct answer about the idea — never the answer to this problem.", text: `${mod.explain(p, r.topic)} ${q}`, hintLevel: lvl, revealAllowed: false, assistive: true };
    case "incomplete":
      return { rule: "S_INCOMPLETE", action: "ASK", reason: "The message stops mid-sentence; ask them to finish rather than guess.", text: `I caught “${(r.evidence[1] ?? "").trim() || "the start of that"}…” and then it stopped. What were you going to say?`, hintLevel: lvl, revealAllowed: false, assistive: false };
    case "off_topic":
      return { rule: "S_REDIRECT", action: "ASK", reason: "Not about the lesson (or not something the rules can read). Say what can be checked and return to the question.", text: `That's outside what I can check here. ${cap(mod.checkable(p))}. ${q}`, hintLevel: lvl, revealAllowed: false, assistive: false };
    case "unclear":
    default:
      return { rule: "S_CLARIFY", action: "ASK", reason: "Unclear: ask rather than guess. States what the tutor can check.", text: `I'm not sure what you mean. ${cap(mod.checkable(p))}. If you'd like a hint, just ask. ${q}`, hintLevel: lvl, revealAllowed: false, assistive: false };
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function snapshot(s: SubjectState) {
  return { problem: s.current, phase: s.phase, attempts: s.attempts, hintLevel: s.hintLevel, helpRequests: s.helpRequests, solved: s.records.filter((r) => r.solved).length, alone: s.records.filter((r) => r.alone).length, noReveal: !!s.noReveal } as Record<string, unknown>;
}

function delta(a: Record<string, unknown>, b: Record<string, unknown>) {
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(b)) if (a[k] !== b[k]) out[k] = [a[k], b[k]];
  return out;
}

function emptyTrace(state: SubjectState, event: StudentEvent, deps: SubjectStepDeps, now: Date): TurnTrace {
  return {
    turnId: `${state.sessionId}-t${state.turn}-dup`,
    requestId: deps.requestId ?? "local",
    sessionId: state.sessionId,
    turn: state.turn,
    startedAt: now.toISOString(),
    event,
    lesson: state.lesson,
    candidates: [],
    decision: { id: "DUPLICATE", action: "RECAP", rule: "DUPLICATE", reason: "Event already applied.", hintLevel: state.hintLevel, goal: "", facts: [], revealAllowed: false, nextStepAllowed: false, allowedEquations: [], assistive: false, template: "op", templateVars: { opText: state.lastTutorText } },
    decisionSource: "policy-default",
    phaseBefore: state.phase as Phase,
    phaseAfter: state.phase as Phase,
    stateDelta: {},
    llmCalls: [],
    fallbackUsed: false,
    utterance: state.lastTutorText,
    totalLatencyMs: 0,
    errors: [],
  };
}

export { numbersIn };
