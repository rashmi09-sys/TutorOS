import type { Problem } from "./problems";
import type { Diagnosis, MisconceptionId } from "./misconceptions";
import type { ConceptTopic } from "./intent";
import type { ObservedOperation } from "./observe";
import type { Awaiting, OperationCheck, OpKind, StudentMeaning } from "./understand";
import type { LessonId, SubjectCheck } from "./subjects/types";

/**
 * Short-term conversational memory for the active lesson. Lives in the signed session state, so it
 * survives reloads and can't be edited by the client.
 */
export interface DialogState {
  /** What the tutor's last message asked for. */
  awaiting: Awaiting;
  /** The tutor's last question, verbatim (for repeats, "go back" and the console). */
  lastQuestion: string;
  /** The rule behind the tutor's last message (to know whether it was a generic clarification). */
  lastRule: string;
  /** The student's latest proposal in words, with what the maths check said about it. */
  lastProposal?: { kind: OpKind | null; part: "constant" | "coefficient" | null; verdict: string | null; turn: number; text: string };
  /** How many times in a row the student has re-stated the same proposal. */
  repeats: number;
}

/** Which part of the anchored line a tutor turn is about (drives highlighting in the UI). */
export type FocusRole = "x-term" | "constant" | "other-side" | "equals";

export type TeachingAction = "ASK" | "HINT" | "EXPLAIN" | "WAIT" | "VERIFY" | "RECAP";

export type Phase = "GUIDED" | "TRANSFER" | "COMPLETE";

/** `id` is a client-generated event id used for idempotency (duplicate submissions are not applied twice). */
export type StudentEvent =
  | { type: "start"; id?: string }
  | { type: "text"; text: string; via: "keyboard" | "voice"; interruptedTutor?: boolean; id?: string; voice?: VoiceInputMeta; source?: "typed" | "help-option" }
  | { type: "silence"; ms: number; id?: string };

/** How a spoken line was captured (client-side voice state machine) — shown in the console, never used for teaching. */
export interface VoiceInputMeta {
  segments: number;
  interimUpdates: number;
  duplicateEventsIgnored: number;
  autoResumes: number;
  durationMs: number;
  endedBy: "done" | "pause" | "after-interruption";
}

/** Progressive micro-teaching: point at the important part → one guiding question or analogy → invite one move. */
export type TeachingStage = "NOTICE" | "THINK" | "TRY";

export interface BoardEntry {
  id: string;
  problemId: string;
  kind: "problem" | "step" | "answer" | "check" | "hint";
  latex: string;
  status: "given" | "valid" | "invalid" | "info" | "final";
  note?: string;
  /** The line as the student (or problem) wrote it — for term-level rendering. */
  raw?: string;
  turn?: number;
  /** What the student did relative to the previous accepted line (observation, not diagnosis). */
  observed?: ObservedOperation;
}

export interface Message {
  role: "tutor" | "student";
  text: string;
  action?: TeachingAction;
  turn: number;
  via?: "keyboard" | "voice";
  /** Board entry this tutor turn is about. */
  anchor?: string;
  focus?: FocusRole[];
  rule?: string;
  hintLevel?: number;
  stage?: TeachingStage;
}

/**
 * One piece of evidence about the skill.
 *  - "pre-check": first attempt at the guided problem, before any teaching.
 *  - "transfer": first attempt at a fresh problem.
 *  - "assisted": a problem finished after help, a reveal, or with invalid reasoning — NOT evidence of independent skill.
 */
export interface MasteryObservation {
  problemId: string;
  correct: boolean;
  assisted: boolean;
  kind?: "pre-check" | "transfer" | "assisted";
  note?: string;
}

export interface Mastery {
  pKnown: number;
  status: "not_started" | "insufficient_evidence" | "developing" | "mastered" | "needs_practice";
  observations: MasteryObservation[];
  consecutiveUnassisted: number;
}

export interface InterventionRecord {
  problemId: string;
  turn: number;
  action: TeachingAction;
  rule: string;
  misconception?: MisconceptionId;
  outcome?: "progress" | "no_progress";
}

export interface ShownStep {
  prevRaw: string;
  operation: string;
  resultRaw: string;
  arithmetic: string;
}

export interface SessionState {
  version: 1;
  sessionId: string;
  createdAt: string;
  seed: number;
  turn: number;
  phase: Phase;
  problems: Problem[];
  current: number;
  /** The latest line of the student's work that is equivalent to the problem. */
  lastValidRaw: string;
  attempts: number; // wrong attempts on current problem
  hintLevel: number; // 0..3 on current problem
  hintsGiven: number; // assistive turns on current problem
  helpRequests: number;
  silences: number;
  revealed: boolean;
  lastTutorText: string;
  /** Equations the last tutor utterance was allowed to state (so a "repeat" stays within bounds). */
  lastTutorGrounded?: string[];
  revealedLast?: boolean;
  /** The last step the tutor worked out for the student (used to answer disputes with a computed re-check). */
  lastShown?: ShownStep;
  lastDiagnosis?: Diagnosis;
  persistentClaim?: string; // a wrong value the student is insisting on
  misconceptionCounts: Partial<Record<MisconceptionId, number>>;
  /** Every diagnosed misconception with where it happened — "recurring" = seen on more than one problem. */
  misconceptionHistory?: { id: MisconceptionId; problemId: string; turn: number }[];
  interventions: InterventionRecord[];
  mastery: Mastery;
  board: BoardEntry[];
  transcript: Message[];
  /** Stage of the last teaching move on this problem, and how many alternative explanations have been used. */
  lastStage?: TeachingStage;
  explainVariant?: number;
  /** The student asked not to be told the answer: no full worked solution, hint ladder capped at "name the move". */
  noReveal?: boolean;
  /** Conversational memory (see DialogState). */
  dialog?: DialogState;
  /** Model calls made in this session (cost control: capped per session). */
  modelCalls?: number;
  /** Read-aloud pace the student asked for ("can we go slower?"). */
  pace?: "normal" | "slow";
  /** Last applied client event id (idempotency). */
  lastEventId?: string;
}

export interface Observation {
  kind:
    | "start"
    | "correct_answer"
    | "correct_flawed"
    | "valid_step"
    | "valid_no_progress"
    | "invalid"
    | "help"
    | "confused"
    | "concept"
    | "arithmetic_question"
    | "dispute"
    | "malformed"
    | "repeat"
    | "explanation"
    | "silence"
    | "off_topic"
    | "empty"
    | "after_complete"
    | "rephrase"
    | "example"
    | "slower"
    | "no_answer"
    | "why"
    | "ack"
    | "ambiguous"
    | "operation";
  /** A move described in words, and the deterministic verdict on it. */
  meaning?: StudentMeaning;
  opCheck?: OperationCheck;
  /** The student re-stated their previous proposal ("I said multiplication"). */
  repeat?: boolean;
  /** The student is correcting themselves or us ("no, I meant subtract"). */
  correction?: boolean;
  /** Our previous reply didn't engage with what they said (a generic clarification/redirect): repair first. */
  repair?: boolean;
  /** This message finished the student's previous sentence ("subtract 5 from" … "both sides"). */
  continuation?: boolean;
  /** The message stopped mid-sentence ("I think we…"). */
  incomplete?: boolean;
  /** The help the student asked for in everyday words (phrase rule), when there was one. */
  request?: string;
  diagnosis?: Diagnosis;
  insistent: boolean;
  frustrated: boolean;
  question?: boolean;
  topic?: ConceptTopic;
  studentRaw?: string;
  studentValue?: string;
  interruptedTutor?: boolean;
  /** A deterministic check shown to the student (substitution, or their step against the line before). */
  check?: { text: string; kind: "substitution" | "step" };
  /** Why the stated reasoning is invalid, when the answer is right but the reasoning isn't. */
  flaw?: string;
  observed?: ObservedOperation;
}

export interface Decision {
  /** Unique id within a candidate set (= rule). */
  id: string;
  action: TeachingAction;
  rule: string;
  reason: string;
  hintLevel: number;
  /** What the utterance must accomplish, in plain words for the language layer. */
  goal: string;
  /** Facts the utterance may use (all deterministically computed). */
  facts: string[];
  revealAllowed: boolean;
  nextStepAllowed: boolean;
  /** Extra equations this decision may state (e.g. the divide-first example). */
  allowedEquations: string[];
  /** Does this turn count as help for mastery purposes? */
  assistive: boolean;
  /** Presentation: which line the turn is about (the student's new line, or the current accepted line) and which terms. */
  anchor?: "student" | "current";
  focus?: FocusRole[];
  /** Micro-teaching stage this move belongs to, when it is a teaching move. */
  stage?: TeachingStage;
  /** Template key used by deterministic mode and as the fallback. */
  template: string;
  templateVars: Record<string, string>;
}

export interface LlmCall {
  /** model = a real provider call; template / heuristic = deterministic code, never billed. */
  kind: "model" | "template" | "heuristic";
  purpose: "decide" | "classify" | "interpret";
  provider: string;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  /** null when unknown (no prices configured) or not applicable. */
  costUsd: number | null;
  attempt: number;
  ok: boolean;
  error?: string;
  guard?: GuardResult;
  /** What the model proposed (decide calls). */
  proposal?: { candidateId: string; rationale?: string };
  verdict?: "accepted" | "rejected";
  rejectionReasons?: string[];
}

export interface GuardViolation {
  type: "ANSWER_LEAK" | "STEP_LEAK" | "FALSE_ARITHMETIC" | "UNGROUNDED_EQUATION" | "TOO_LONG" | "SCHEMA" | "INVALID_CANDIDATE";
  detail: string;
}

export interface GuardResult {
  ok: boolean;
  violations: GuardViolation[];
}

export interface TurnTrace {
  turnId: string; // = trace id
  requestId: string;
  sessionId: string;
  turn: number;
  startedAt: string;
  event: StudentEvent;
  intent?: unknown;
  validation?: {
    parsed: string | null;
    equivalentToProblem?: boolean;
    impliedValue?: string | null;
    correctValue: string;
    progress?: boolean;
    claims?: { raw: string; ok: boolean; why?: string }[];
    observed?: ObservedOperation;
  };
  diagnosis?: Diagnosis;
  diagnosisSource?: "deterministic" | "llm" | "heuristic";
  /** Structured meaning of the student's words, the conversational context it was read in, and the maths check of any proposed move. */
  meaning?: StudentMeaning;
  context?: { awaiting: string; lastQuestion: string; lastProposal?: DialogState["lastProposal"]; repeat: boolean; correction: boolean; repair: boolean; continuation?: boolean };
  opCheck?: OperationCheck;
  /** Which lesson this turn belongs to (absent = algebra, for traces recorded before lessons existed). */
  lesson?: LessonId;
  /** Geometry / physics: what the subject's own deterministic verifier concluded. */
  subjectCheck?: SubjectCheck;
  /** All decisions the policy permitted this turn (default first). */
  candidates: { id: string; action: TeachingAction; hintLevel: number }[];
  decision: Decision;
  decisionSource: "policy-default" | "llm-choice" | "fallback-default";
  rationale?: string;
  phaseBefore: Phase;
  phaseAfter: Phase;
  stateDelta: Record<string, [unknown, unknown]>;
  llmCalls: LlmCall[];
  fallbackUsed: boolean;
  utterance: string;
  totalLatencyMs: number;
  errors: string[];
}
