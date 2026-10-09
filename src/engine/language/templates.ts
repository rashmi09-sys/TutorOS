/**
 * Deterministic wording for each policy decision. These are NOT a scripted
 * conversation — the policy chooses which decision fires from the student's
 * actual input and state; a template only words that decision with
 * deterministically computed values. Every output passes the same guard as LLM
 * output (tests/guard.test.ts), and templates are the fallback when an LLM
 * response is rejected.
 */
const T: Record<string, string[]> = {
  present: [
    "Hi! Here's our equation: {problem}. What would you do first to start getting x on its own?",
    "Let's solve {problem} together. Where would you start?",
  ],
  wait: ["Take your time — thinking is part of it. If you'd like a hint, just say so.", "No rush. Say \"hint\" whenever you want one."],
  redirect: ["Let's park that for later! Back to {current}: what could we do next?", "Let's stay with {current} for now. What's your next move?"],
  redirect_question: ["Fun question — but I can only help with this lesson right now. Back to {current}: what's your next move?"],
  repeat: ["Sure — here it is again: {last}"],
  valid_step: [
    "Yes! {step} — still perfectly balanced. Nice move. What would you do next?",
    "That works: {step}. You kept both sides equal. What's the next move?",
  ],
  no_progress: ["{step} is still true — but x isn't any more on its own yet. What could you undo?"],
  guided_solved: [
    "That's it — you solved it! One solved problem isn't proof yet, so here's a fresh one to try completely on your own: {nextProblem}",
  ],
  transfer_solved: ["Correct — and you did that one entirely on your own. {followup}"],
  transfer_solved_assisted: ["You got there! Since we worked it out together, let's see you do one solo. {followup}"],
  lesson_end: ["{lead} {followup}"],
  help_choice: ["I hear you — it looks like a lot at first. Let's make it smaller: {opsQuestion}"],
  confused_choice: ["That's okay — this is the tricky part. Let's take one small piece: {opsQuestion}"],
  reveal: ["Okay, let's walk through it together. {worked} Next, you'll try a similar one by yourself."],
  probe_unknown: ["Hmm, {value} — interesting. Can you walk me through how you got it?", "Tell me how you got {value}. I want to understand your thinking."],
  probe_narrow: ["Thanks for explaining! What was the very first thing you did to {current}?"],
  probe_targeted: ["Let's look closer. {probe}"],
  slip: ["That's close — can you double-check your arithmetic?"],
  address_misconception: ["Thanks for explaining — that really helps. {focus} Want to try again?"],
  recurring: ["This looks like the same mix-up as earlier: {focus} What would you change?"],
  insist_check: ["I like that you're confident — let's test it: {check}. What does that tell us?"],
  insist_focus: ["I can see why that feels right. Let's check one idea: {focus} Does your step do that to both sides?"],
  verify_check: ["Let's test it: {check}. What does that tell you?"],
  contrast_check: ["Let's test that: {check}. Compare it with the step we just looked at — what's different?"],
  hint1: ["Here's a nudge: {focus} What does that suggest you try?"],
  hint1_plain: ["Here's a nudge: look at what's happening to x on the left side. Which part could you undo first?"],
  hint1_check: ["Let's test it: {check}. So something went off. {focus} Where do you think it was?"],
  hint2: ["Here's a bigger hint: {nextOp}. What does the equation become?"],
  explain_step: ["Let me show you this step: if we {nextOp}, we get {nextResult}. What would you do next?"],
  explain_final: ["Let me show you this step: if we {nextOp}, we get {nextResult}. Can you check it by putting it back into {problem}?"],
  malformed: ["I couldn't read “{raw}” as maths. Could you write it with one equals sign — like x = (a number), or your next line of working?"],
  arithmetic_back: ["That's one you can work out — what do you get? I'll check it."],
  dispute_none: ["Good that you're checking! I haven't given an answer yet — every line on the board is checked exactly. Which part looks wrong to you?"],
  dispute_shown: ["Let's re-check what I showed: from {prev}, if we {op} we get {result}, because {arith}. Which part looks wrong to you?"],
  concept: ["{concept}"],
  correct_flawed: ["x = {value} is right — it checks out: {check}. But {flaw}, so that reasoning wouldn't work on other problems. {followup}"],
  complete: ["You've finished this lesson — great work! Start a new lesson whenever you're ready."],
  micro: ["{micro}"],
  op: ["{opText}"],
  incomplete: ["I caught “{raw}…” and then it stopped. What were you going to say?", "It sounds like you stopped partway: “{raw}…”. How does the rest of it go?"],
  slower: ["Sure — one small piece at a time. {micro}", "Of course, let's slow down. {micro}"],
  clarify: [
    "I'm not sure what you mean by “{raw}”. Would a small hint help, or should I explain the last part another way?",
    "Hmm, “{raw}” — do you want a small hint, or the last part explained differently?",
  ],
  clarify_why: ["Good question — do you mean why we do the same thing to both sides, or {part}?"],
  ack_try: ["Great — go ahead and write your next line.", "Go for it — write your next line, and I'll check it."],
  no_reveal_ack: ["Deal — I won't tell you the answer. I'll only point you in the right direction. What's your next line?"],
};

export function renderTemplate(key: string, vars: Record<string, string>, variant: number): string {
  let k = key;
  if (key === "hint1" && !vars.focus) k = "hint1_plain";
  const options = T[k];
  if (!options) throw new Error(`Unknown template "${key}"`);
  const tpl = options[variant % options.length];
  return tpl
    .replace(/\{(\w+)\}/g, (_m, v) => vars[v] ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,?!])/g, "$1")
    .replace(/\.\./g, ".")
    .trim();
}

export const TEMPLATE_KEYS = Object.keys(T);
