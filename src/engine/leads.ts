/**
 * Opening lines for help turns, shared by all three lessons. Chosen from the teaching memory — how many
 * times in a row the student has been stuck on this problem, and how often they've asked for the answer —
 * so a student who is still stuck hears that the tutor noticed and is changing approach.
 */
export function confusionLead(conf: number, visual: boolean): string {
  if (conf <= 1) return "";
  if (conf === 2) return "Hmm, that didn't land. Let me try it another way.";
  if (conf === 3) return visual ? "Words aren't helping — let's try a picture." : "Let's try a bigger clue.";
  return "Let's do one tiny part together: I'll take the first step, you take the next.";
}

export function answerLead(timesAskedBefore: number): string {
  return ["I could just tell you — but finding it is the fun part.", "I know, you'd like the answer. Here's a bigger clue instead.", "Nearly there — one more push first."][Math.min(timesAskedBefore, 2)];
}
