import type { ConceptTopic } from "./intent";
import type { SessionState } from "./types";

/**
 * A bare "why?" is about the tutor's previous move. Resolve it from what the tutor last said;
 * if that isn't clear, return undefined and the policy asks one clarifying question.
 */
export function whyTopic(state: Pick<SessionState, "lastTutorText">): ConceptTopic | undefined {
  const last = (state.lastTutorText ?? "").toLowerCase();
  if (/divid|split both|equal parts|equal groups/.test(last)) return "why_divide";
  if (/subtract|take \d+ away|taking away|add \d+ to|undo|take (it|that) off|comes off first|blocks off both/.test(last)) return "why_inverse_constant";
  if (/check|putting it back|substitut/.test(last)) return "check";
  if (/both sides|balanc|level|still true/.test(last)) return "balance";
  return undefined;
}

