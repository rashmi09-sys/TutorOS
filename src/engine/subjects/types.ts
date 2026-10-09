import type { Message, Phase, TeachingAction, TeachingStage } from "../types";
import type { ArithmeticClaim } from "./text";

export type LessonId = "algebra" | "geometry" | "physics";
export type SubjectLessonId = "geometry" | "physics";

/** One question in a subject lesson. Everything the verifier needs is in `data` and `answer`. */
export interface SubjectProblem {
  id: string;
  /** guided = solved together with hints; check = a fresh one to try alone. */
  role: "guided" | "check";
  /** Question type, which selects the verifier branch (e.g. "two-angles", "net-force", "balanced-moving"). */
  kind: string;
  /** What the tutor asks. */
  prompt: string;
  /** Numbers for the diagram and the verifier. */
  data: Record<string, number | string>;
  /** The expected answer. Never shown to the client before it is reached (the verifier holds it). */
  answer: { value?: number; unit?: "°" | "N"; direction?: Direction; outcome?: string };
  /** The answer in words, for the worked solution after real effort. */
  answerText: string;
}

export type Direction = "left" | "right" | "none";

export interface ProblemRecord {
  problemId: string;
  solved: boolean;
  /** Solved with no hints, no reveal, and on a check problem: independent evidence. */
  alone: boolean;
  hints: number;
  attempts: number;
  revealed: boolean;
}

/**
 * What the student's message was read as. Deterministic rules first ("rules"); a configured model may
 * propose a reading for text the rules can't place ("llm") — the verifier still decides correctness.
 */
export interface SubjectReading {
  kind:
    | "answer" // a value / direction / outcome to check
    | "concept_claim" // a general statement ("angles add up to 180") with no answer in it
    | "help"
    | "confused"
    | "why"
    | "concept_question"
    | "rephrase"
    | "example"
    | "slower"
    | "no_answer"
    | "repeat"
    | "ack"
    | "incomplete"
    | "off_topic"
    | "unclear";
  value?: number;
  direction?: Direction;
  /** A conceptual outcome label from a closed list (physics: "same_speed", "slows", …). */
  outcome?: string;
  /** Concept ids recognised in the words (e.g. "sum_180", "sum_360", "balanced"). */
  concepts: string[];
  /** Topic of a concept question ("why_180", "isosceles", "net_force", …). */
  topic?: string;
  claims: ArithmeticClaim[];
  evidence: string[];
  source: "rules" | "llm";
  confidence: number;
  question: boolean;
  frustrated: boolean;
}

export interface SubjectCheck {
  /** Which subject-specific verifier ran. */
  verifier: string;
  verdict: "correct" | "partial" | "incorrect" | "not_checkable";
  /** One plain sentence for the Engineer View: what was compared with what. */
  detail: string;
  /** A hypothesis about the mistake (never shown to the student as a label). */
  misconception?: { id: string; label: string };
  /** Arithmetic the student stated, re-checked. */
  claims: ArithmeticClaim[];
}

/** The tutor's move for a subject turn (shape-compatible with the algebra Decision for the trace). */
export interface SubjectMove {
  rule: string;
  action: TeachingAction;
  stage?: TeachingStage;
  reason: string;
  text: string;
  hintLevel: number;
  /** The answer may be stated (after a correct answer, or a worked solution after real effort). */
  revealAllowed: boolean;
  assistive: boolean;
  /** Advance to the next problem after this turn. */
  advance?: boolean;
  /** This turn solved the current problem. */
  solved?: boolean;
  /** This turn revealed the worked solution. */
  revealed?: boolean;
  /** This turn counts as a wrong attempt. */
  attempt?: boolean;
  /** This turn is help (counts against "solved alone"). */
  help?: boolean;
}

export interface SubjectState {
  version: 1;
  lesson: SubjectLessonId;
  sessionId: string;
  createdAt: string;
  seed: number;
  turn: number;
  phase: Phase;
  problems: SubjectProblem[];
  current: number;
  attempts: number;
  hintLevel: number;
  helpRequests: number;
  explainVariant: number;
  lastStage?: TeachingStage;
  lastTutorText: string;
  lastQuestion: string;
  /** The student's last reading on this problem, to notice repeats. */
  lastAnswer?: { value?: number; direction?: Direction; outcome?: string; turn: number };
  repeats: number;
  noReveal?: boolean;
  pace?: "normal" | "slow";
  records: ProblemRecord[];
  transcript: Message[];
  modelCalls?: number;
  lastEventId?: string;
}
