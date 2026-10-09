import type { Mastery, MasteryObservation } from "./types";

/**
 * Mastery estimate for ONE skill: "solve a two-step linear equation".
 *
 * Assumptions (documented, not validated against student data):
 *  1. Bayesian Knowledge Tracing with conventional priors (below) — not fitted.
 *  2. Only FIRST attempts WITHOUT help are evidence:
 *       - "pre-check": the guided problem's first attempt, before any teaching;
 *       - "transfer": a fresh problem's first attempt.
 *     Asking for help (or saying "I'm confused") before attempting a transfer
 *     item is recorded as an unsuccessful independent attempt.
 *  3. Finishing a problem after hints, a reveal, or with invalid stated reasoning
 *     is "assisted": a learning opportunity (BKT transit), never evidence.
 *  4. "Mastered" requires BOTH P(known) ≥ 0.9 AND two consecutive independent
 *     transfer successes on problems with different surface forms.
 *  5. Fewer than two independent transfer observations = "insufficient evidence",
 *     whatever P(known) says.
 *
 * This is an instrument for estimating understanding inside one session — not a
 * validated assessment and not evidence of learning gains.
 */
export const BKT = { pInit: 0.3, pTransit: 0.15, pSlip: 0.1, pGuess: 0.2 };
export const MASTERY_THRESHOLD = 0.9;
export const REQUIRED_CONSECUTIVE = 2;
export const MIN_TRANSFER_EVIDENCE = 2;
export const MAX_TRANSFER_ITEMS = 4;

export function initialMastery(): Mastery {
  return { pKnown: BKT.pInit, status: "not_started", observations: [], consecutiveUnassisted: 0 };
}

export function independentTransferCount(m: Mastery) {
  return m.observations.filter((o) => o.kind === "transfer").length;
}

export function observe(m: Mastery, problemId: string, correct: boolean, isTransfer: boolean, note?: string): Mastery {
  const p = m.pKnown;
  const posterior = correct
    ? (p * (1 - BKT.pSlip)) / (p * (1 - BKT.pSlip) + (1 - p) * BKT.pGuess)
    : (p * BKT.pSlip) / (p * BKT.pSlip + (1 - p) * (1 - BKT.pGuess));
  const pKnown = posterior + (1 - posterior) * BKT.pTransit;
  const consecutiveUnassisted = isTransfer ? (correct ? m.consecutiveUnassisted + 1 : 0) : m.consecutiveUnassisted;
  const obs: MasteryObservation = { problemId, correct, assisted: false, kind: isTransfer ? "transfer" : "pre-check", note };
  const next = { pKnown, observations: [...m.observations, obs], consecutiveUnassisted, status: m.status };
  return { ...next, status: statusFor(next) };
}

/** A problem completed with help: a learning opportunity, not evidence. */
export function assistedCompletion(m: Mastery, problemId: string, note = "finished with help"): Mastery {
  const pKnown = m.pKnown + (1 - m.pKnown) * BKT.pTransit;
  const next = { pKnown, observations: [...m.observations, { problemId, correct: true, assisted: true, kind: "assisted" as const, note }], consecutiveUnassisted: 0, status: m.status };
  return { ...next, status: statusFor(next) };
}

function statusFor(m: Omit<Mastery, "status"> & { status: Mastery["status"] }): Mastery["status"] {
  if (m.pKnown >= MASTERY_THRESHOLD && m.consecutiveUnassisted >= REQUIRED_CONSECUTIVE) return "mastered";
  if (independentTransferCount(m as Mastery) < MIN_TRANSFER_EVIDENCE) return "insufficient_evidence";
  return "developing";
}

export function finalStatus(m: Mastery): Mastery["status"] {
  if (m.status === "mastered") return "mastered";
  if (independentTransferCount(m) < MIN_TRANSFER_EVIDENCE) return "insufficient_evidence";
  return m.pKnown < 0.5 ? "needs_practice" : "developing";
}
