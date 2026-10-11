/**
 * Deterministic checks of how the tutor talks, used by the scenario suites (no model judge — these are
 * rules, documented here and in docs/EVALUATION.md, with their limits):
 *  - age-appropriate: no insults or put-downs, no swearing, no claim to be a human, no sentence over 35
 *    words, no reply over 90 words;
 *  - not generic: none of the stock praise lines ("Great job!", "You've got this!", "Nice move");
 *  - no humour when the student is worried or frustrated;
 *  - no repetition: no reply identical to an earlier one on the same problem (unless asked to repeat).
 * They catch the failure modes we've seen; they can't judge tone the way a teacher reviewing transcripts can.
 */
export const PUT_DOWNS = /\b(stupid|dumb|idiot|lazy|silly mistake|careless|obviously|clearly you|you should know|that'?s easy|shut up|damn|hell|crap|sucks)\b/i;
export const CLAIMS_HUMAN = /\bi'?m (a )?(human|real person|real teacher|person too)\b|\bi am (a )?(human|real person)\b/i;
export const GENERIC_PRAISE = /\b(great job|good job|you'?ve got this|nice move|awesome|amazing|well done!|fantastic|superstar)\b/i;
export const HUMOUR = /\b(ha\.|alphabet|film|party trick|speed run|having fun|pizza|predictable)\b/i;

export function languageProblems(text: string): string[] {
  const out: string[] = [];
  if (PUT_DOWNS.test(text)) out.push(`put-down or unsuitable word: “${text.match(PUT_DOWNS)![0]}”`);
  if (CLAIMS_HUMAN.test(text)) out.push("claims to be human");
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words > 90) out.push(`${words} words`);
  for (const s of text.split(/(?<=[.?!])\s+/)) if (s.split(/\s+/).length > 35) out.push(`long sentence (${s.split(/\s+/).length} words)`);
  return out;
}
