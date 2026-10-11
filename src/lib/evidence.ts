import type { AlgebraView as SessionState, SubjectView as SubjectState } from "@/engine/view-types";

/** guided practice → independent practice (same idea, new numbers) → transfer (a new twist). */
export type Stage = "guided" | "independent" | "transfer";
const stageAt = (i: number): Stage => (i === 0 ? "guided" : i === 1 ? "independent" : "transfer");
import { MISCONCEPTION_LABELS } from "@/engine/misconception-labels";

/**
 * What was observed on each algebra problem in this session — only things the session actually recorded:
 * the lines the student wrote, the lines that weren't equivalent, the help the tutor gave, and whether the
 * first attempt at an independent problem was right. These are observable indicators, not a measure of
 * long-term learning.
 */
export interface ProblemEvidence {
  problemId: string;
  text: string;
  role: "guided" | "transfer";
  stage: Stage;
  /** Accepted lines in the order written (steps and the final answer). */
  steps: string[];
  /** Lines that were not equivalent to the problem. */
  wrongLines: number;
  /** Tutor turns that were help: hints, explanations, worked steps. */
  hints: number;
  /** First attempt at an independent problem (null for the guided problem or if not reached). */
  firstTry: "right" | "not right" | "asked for help first" | null;
  solved: boolean;
  /** Solved with no help, no worked solution, first attempt right: independent evidence. */
  independent: boolean;
  /** Possible mistakes the tutor noticed (hypotheses, never shown as labels during the lesson). */
  noticed: string[];
  /** A noticed mistake that also happened on an earlier problem. */
  repeatedMistake: boolean;
}

export function problemEvidence(state: SessionState): ProblemEvidence[] {
  const seenBefore = new Set<string>();
  return state.problems.map((p, i) => {
    const board = state.board.filter((b) => b.problemId === p.id);
    const steps = board.filter((b) => b.status === "valid" || b.status === "final").map((b) => b.raw ?? b.latex);
    const wrongLines = board.filter((b) => b.status === "invalid").length;
    const hints = state.interventions.filter((i) => i.problemId === p.id && (i.assistive || i.action === "HINT" || i.action === "EXPLAIN")).length;
    const obs = state.mastery.observations.filter((o) => o.problemId === p.id);
    const first = obs.find((o) => o.kind === "transfer");
    const solved = board.some((b) => b.status === "final");
    const independent = p.role === "transfer" && solved && obs.some((o) => o.kind === "transfer" && o.correct && !o.assisted);
    const ids = Array.from(new Set((state.misconceptionHistory ?? []).filter((m) => m.problemId === p.id).map((m) => m.id)));
    const noticed = ids.map((id) => MISCONCEPTION_LABELS[id]);
    const repeatedMistake = ids.some((id) => seenBefore.has(id));
    ids.forEach((id) => seenBefore.add(id));
    return { problemId: p.id, text: p.text, role: p.role, stage: stageAt(i), repeatedMistake, steps, wrongLines, hints, firstTry: p.role !== "transfer" || !first ? null : first.correct ? "right" : first.note?.startsWith("asked for help") ? "asked for help first" : "not right", solved, independent, noticed };
  });
}

/** What the child reads at the end: guided vs unaided performance, kept separate, and no claim beyond today. */
export function learningMessage(rows: { stage: Stage; independent: boolean; solved: boolean }[]): { heading: string; text: string } {
  const ind = rows.find((r) => r.stage === "independent");
  const tr = rows.find((r) => r.stage === "transfer");
  const later = "One lesson isn't proof it'll stick — a quick check in a few days would tell us.";
  if (ind?.independent && tr?.independent) return { heading: "Got it.", text: `You solved the new problem without help, and the one with a twist too. That suggests you've understood the main idea. ${later}` };
  if (ind?.independent) return { heading: "Nearly there.", text: "You solved the one with new numbers on your own. The twist needed help — that's the part to practise next." };
  if (tr?.independent) return { heading: "Nearly there.", text: "You did the twist on your own, but the one with new numbers needed help. Worth one more go on your own." };
  if (ind || tr) return { heading: "Not yet.", text: "The problems on your own needed help this time — which is fine. It tells us exactly what to practise next." };
  return { heading: "Not finished.", text: "We didn't get to the problems on your own yet." };
}

export interface QuestionEvidence {
  problemId: string;
  prompt: string;
  stage: Stage;
  /** Wrong answers before the right one. */
  tries: number;
  hints: number;
  solved: boolean;
  /** Shown the worked solution. */
  workedThrough: boolean;
  /** Solved on a check question without hints and without being shown the working. */
  independent: boolean;
  firstTry: "right" | "not right" | null;
}

/** The same record for the geometry and physics lessons, from the session's own problem records. */
export function subjectEvidence(state: SubjectState): QuestionEvidence[] {
  return state.problems.map((p, i) => {
    const r = state.records[i];
    return {
      problemId: p.id,
      prompt: p.prompt,
      stage: p.stage ?? stageAt(i),
      tries: r.attempts,
      hints: r.hints,
      solved: r.solved,
      workedThrough: r.revealed,
      independent: r.alone,
      firstTry: i === 0 || !r.solved ? null : r.alone && r.attempts === 0 ? "right" : "not right",
    };
  });
}
