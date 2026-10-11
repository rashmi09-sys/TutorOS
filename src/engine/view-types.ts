import type { InterventionRecord, Message, SessionState, Strategy } from "./types";
import type { Problem } from "./problems";
import type { SubjectProblem, SubjectState } from "./subjects/types";

/**
 * What the browser receives: a redacted view of the lesson state, enough to draw the page and nothing more.
 * Types only (erased at build time). The full state stays sealed on the server side (see sealed-state.ts).
 *
 * Removed: answers to problems not reached yet, the generator seed, rule names, the dialogue and diagnosis
 * internals, the teaching memory beyond what the board shows, model-call counters and event ids.
 */
export type ProblemView = Omit<Problem, "answer"> & { answer?: string };
export type InterventionView = Pick<InterventionRecord, "problemId" | "turn" | "action" | "assistive" | "misconception" | "outcome">;

export type AlgebraView = Pick<
  SessionState,
  "version" | "sessionId" | "turn" | "phase" | "current" | "lastValidRaw" | "attempts" | "lastTutorText" | "mastery" | "board" | "misconceptionCounts" | "misconceptionHistory" | "pace"
> & {
  problems: ProblemView[];
  transcript: Message[];
  interventions: InterventionView[];
  teaching?: { confusion: number; strategies: Strategy[] };
};

export type SubjectProblemView = Omit<SubjectProblem, "answer" | "answerText"> & { answer?: SubjectProblem["answer"]; answerText?: string };

export type SubjectView = Pick<SubjectState, "version" | "lesson" | "sessionId" | "turn" | "phase" | "current" | "attempts" | "lastTutorText" | "records" | "pace"> & {
  problems: SubjectProblemView[];
  transcript: Message[];
};
