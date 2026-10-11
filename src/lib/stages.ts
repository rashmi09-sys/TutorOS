/**
 * The three stages every lesson follows, in the student's words:
 *  1. Learn Together — guided practice: hints, questions and pictures as needed.
 *  2. Try It Yourself — independent practice: the same idea, new numbers; help only if asked, and then it doesn't count as "on your own".
 *  3. Challenge Yourself — transfer: a different form or relationship, to see whether the idea carries over.
 * Finishing a stage is not treated as mastery; the evidence is how stages 2 and 3 went without help.
 */
const STAGES = [
  { label: "Learn Together", sub: "Let's work it out" },
  { label: "Try It Yourself", sub: "A new problem" },
  { label: "Challenge Yourself", sub: "A different twist" },
];

export function stageLabel(i: number) {
  return STAGES[i]?.label ?? "Extra challenge";
}
export function stageSub(i: number) {
  return STAGES[i]?.sub ?? "On your own";
}
export function stageDone(i: number) {
  return stageLabel(i);
}
