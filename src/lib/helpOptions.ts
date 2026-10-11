import { whyTopic } from "@/engine/why";
import type { AlgebraView as SessionState } from "@/engine/view-types";

export interface HelpOption {
  label: string;
  /** Exactly what is sent — the same words a student could type or say, through the same intent rules. */
  text: string;
}

const STUCK: HelpOption = { label: "I'm stuck", text: "I'm stuck" };
const DIFFERENT: HelpOption = { label: "Explain differently", text: "Explain it another way" };
const HINT: HelpOption = { label: "Small hint", text: "Small hint" };
const WHY: HelpOption = { label: "Why?", text: "Why?" };

/**
 * The two or three most relevant help actions for this moment, chosen from what the tutor just did.
 * They are real requests: the text goes through the same phrase rules and policy as typed or spoken words.
 */
export function helpOptions(state: SessionState | null): HelpOption[] {
  if (!state || state.phase === "COMPLETE") return [];
  const last = [...state.transcript].reverse().find((m) => m.role === "tutor");
  if (!last) return [HINT, STUCK];
  if (last.action === "WAIT") return []; // they said they're thinking: don't put buttons in their way
  const canWhy = !!whyTopic(state);
  const cue = last.cue;
  if (cue === "fresh" || cue === "solved_guided") return [HINT, STUCK]; // a fresh problem: nothing explained yet
  if (last.stage === "NOTICE") return [HINT, DIFFERENT];
  if (last.stage === "THINK") return [DIFFERENT, HINT, ...(canWhy ? [WHY] : [])];
  if (last.stage === "TRY" || (last.action === "EXPLAIN" && cue !== "idea")) return [...(canWhy ? [WHY] : []), DIFFERENT, STUCK].slice(0, 3);
  if (cue === "idea") return [DIFFERENT, HINT];
  if (last.action === "VERIFY") return [...(canWhy ? [WHY] : []), HINT, STUCK].slice(0, 3);
  return [HINT, STUCK];
}
