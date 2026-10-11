import type { Cue, Message, SessionState } from "@/engine/types";
import type { SubjectState } from "@/engine/subjects/types";
import type { AlgebraView, SubjectView } from "@/engine/view-types";

/**
 * Server-only: turn a full lesson state into the redacted view the browser may see.
 * Whitelist, not blacklist — a field added to the state later stays on the server unless it is added here.
 */

const NOT_ANSWERS = /(CONCEPT|WHICH_NUMBER|BOUNDED_CHECK|SIZE_TOO|CLARIFY)/;

/** The client-facing cue for a policy rule. Rule names never leave the server. */
export function cueOf(rule: string | undefined): Cue | undefined {
  if (!rule) return undefined;
  // Algebra policy
  if (rule === "R1_GUIDED_SOLVED") return "solved_guided";
  if (rule.startsWith("R1_") || rule === "R0_PRESENT_PROBLEM") return "fresh";
  if (rule.startsWith("R16")) return "summary";
  if (rule === "R25_SMALL_EXAMPLE") return "small_example";
  if (rule.startsWith("R23") || rule.startsWith("R27")) return "your_move";
  if (rule.startsWith("R18")) return "idea";
  if (rule === "R9_REVEAL_AFTER_EFFORT") return "worked_solution";
  // Geometry and physics
  if (rule === "S0_PRESENT") return "fresh";
  if (/^(G|P)_/.test(rule) && !NOT_ANSWERS.test(rule)) {
    if (/_CORRECT$/.test(rule)) return "ans_done";
    if (/(_SUB_RIGHT|_SUB_SOLVED)$/.test(rule)) return "ans_ok";
    if (/(RIGHT_FLAWED|NO_DIRECTION|WRONG_DIRECTION)/.test(rule)) return "ans_part";
    return "ans_bad";
  }
  return undefined;
}

export function messageView(m: Message): Message {
  const out: Message = { role: m.role, text: m.text, turn: m.turn };
  if (m.action) out.action = m.action;
  if (m.via) out.via = m.via;
  if (m.anchor) out.anchor = m.anchor;
  if (m.focus) out.focus = m.focus;
  if (m.hintLevel != null) out.hintLevel = m.hintLevel;
  if (m.stage) out.stage = m.stage;
  if (m.visual) out.visual = m.visual;
  if (m.awaiting) out.awaiting = m.awaiting;
  if (m.figure) out.figure = m.figure;
  const cue = m.role === "tutor" ? cueOf(m.rule) : undefined;
  if (cue) out.cue = cue;
  return out;
}

export function algebraView(s: SessionState): AlgebraView {
  const reached = (i: number) => i < s.current || s.phase === "COMPLETE";
  return {
    version: s.version,
    sessionId: s.sessionId,
    turn: s.turn,
    phase: s.phase,
    current: s.current,
    lastValidRaw: s.lastValidRaw,
    attempts: s.attempts,
    lastTutorText: s.lastTutorText,
    mastery: s.mastery,
    board: s.board,
    misconceptionCounts: s.misconceptionCounts,
    misconceptionHistory: s.misconceptionHistory,
    pace: s.pace,
    problems: s.problems.map((p, i) => {
      const { answer, ...rest } = p;
      return reached(i) ? { ...rest, answer } : rest;
    }),
    transcript: s.transcript.map(messageView),
    interventions: s.interventions.map((r) => ({ problemId: r.problemId, turn: r.turn, action: r.action, assistive: r.assistive, misconception: r.misconception, outcome: r.outcome })),
    teaching: s.teaching ? { confusion: s.teaching.confusion, strategies: s.teaching.strategies } : undefined,
  };
}

export function subjectView(s: SubjectState): SubjectView {
  const reached = (i: number) => i < s.current || s.phase === "COMPLETE" || !!s.records[i]?.solved;
  return {
    version: s.version,
    lesson: s.lesson,
    sessionId: s.sessionId,
    turn: s.turn,
    phase: s.phase,
    current: s.current,
    attempts: s.attempts,
    lastTutorText: s.lastTutorText,
    records: s.records,
    pace: s.pace,
    problems: s.problems.map((p, i) => {
      const { answer, answerText, ...rest } = p;
      if (reached(i)) return { ...rest, answer, answerText };
      // The missing angle is not needed to draw the triangle (only to label it once solved): drop it too.
      if (rest.data.unknown === "C") {
        const { C: _missing, ...data } = rest.data;
        return { ...rest, data };
      }
      return rest;
    }),
    transcript: s.transcript.map(messageView),
  };
}
