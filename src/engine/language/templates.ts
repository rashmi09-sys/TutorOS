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
    "Hi! Here's our equation: {problem}. x is hiding a number, and we're going to find it. What would you do first?",
    "Let's solve {problem} together. Where would you start?",
  ],
  wait: ["Take your time — thinking is part of it. If you'd like a hint, just say so.", "No rush. Say \"hint\" whenever you want one."],
  wait_thinking: ["Take your time. Write your line whenever you're ready, and I'll check it.", "Sure — no rush. I'll check your line when you send it."],
  affect: ["{lead} {back}"],
  redirect: ["Let's park that for later. Back to {current}: what could we do next?", "Let's stay with {current} for now. What's your next move?"],
  redirect_question: [
    "Good question for another day — I'm an AI maths tutor, so equations are really my only party trick. Back to {current}: what's your next move?",
    "I'll have to skip that one — I only do this lesson. Right now x is still hiding in {current}. What would you do?",
    "Let's save that for later. {current} first: what's your next move?",
  ],
  repeat: ["Sure — here it is again: {last}"],
  valid_step: [
    "Exactly — you {did}, so it's still balanced: {step}. What would you do next?",
    "That works: {step}. Same move on both sides, so the equation still holds. What's the next move?",
  ],
  valid_step_plain: [
    "That works: {step}. It's still balanced. What would you do next?",
    "Yes — {step} is still true, and x is closer to being on its own. What's the next move?",
  ],
  no_progress: ["{step} is still true — but x isn't any more on its own yet. What could you undo?"],
  guided_solved: [
    "There it is — balanced all the way down to x. Now try it yourself, a new problem: {nextProblem}",
  ],
  transfer_solved: ["Correct — and that one was all you. {followup}"],
  transfer_solved_assisted: ["You got there. We did some of that together, so here's another to try solo. {followup}"],
  lesson_end: ["{lead} {followup}"],
  help_choice: ["I hear you — it looks like a lot at first. Let's make it smaller: {opsQuestion}"],
  choice_dont_know: ["No worries — let's make it simpler. {opsQuestion}", "That's fine. Let's make it smaller: {opsQuestion}"],
  choice_plain: ["{lead} Let's make it smaller: {opsQuestion}"],
  confused_choice: ["That's okay — this is the tricky part. Let's take one small piece: {opsQuestion}"],
  visual_balance: [
    "{lead} On the board, {balBags} of x and {balB} blocks balance {balC} blocks. Take {balB} blocks off both sides and it stays level — in symbols, subtract {balB} from both sides. What's left on each side?",
  ],
  visual_share: [
    "{lead} On the board, {balBags} of x balance {balC} blocks. Share both sides into {balA} equal groups — in symbols, divide both sides by {balA}. How many blocks match one bag?",
  ],
  visual_same_line: [
    "{step} again — fair enough, my last explanation didn't convince you. Try the balance on the board: {balBags} of x and {balB} blocks against {balC} blocks. Take {balB} off both sides. Does your line match what's left?",
  ],
  reveal: ["Okay, let's walk through it together. {worked} Next, you'll try a similar one by yourself."],
  probe_unknown: ["Hmm, {value} — interesting. Can you walk me through how you got it?", "Tell me how you got {value}. I want to understand your thinking."],
  probe_narrow: ["Thanks for explaining! What was the very first thing you did to {current}?"],
  probe_targeted: ["Let's look closer. {probe}"],
  slip: ["That's close — can you double-check your arithmetic?"],
  address_misconception: ["Thanks for explaining — that really helps. {focus} Want to try again?"],
  recurring: ["This looks like the same mix-up as earlier: {focus} What would you change?"],
  insist_check: ["I like that you're confident — let's test it: {check}. What does that tell us?"],
  insist_focus: ["I can see why that feels right. Let's check one idea: {focus} Does your step do that to both sides?"],
  repeat_check: ["That's the same line as before, so let's test it properly: {check}. What does that tell us?"],
  explain_part: ["{lead} If we {nextOp}, we get {nextResult}. Your turn: what would you do next?"],
  explain_part_final: ["{lead} If we {nextOp}, we get {nextResult}. Your turn: put it back into {problem} and check it works."],
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
  complete: ["This lesson is finished. Start a new one whenever you're ready."],
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
  if (key === "valid_step" && !vars.did) k = "valid_step_plain";
  const options = T[k];
  if (!options) throw new Error(`Unknown template "${key}"`);
  let tpl = options[variant % options.length];
  // An opening line chosen by the policy (how many times they've been stuck, a feeling, an answer request).
  if (vars.lead && !tpl.includes("{lead}")) tpl = `{lead} ${tpl}`;
  return tpl
    .replace(/\{(\w+)\}/g, (_m, v) => vars[v] ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,?!])/g, "$1")
    .replace(/\.\./g, ".")
    .replace(/([.!?] )([a-z])/g, (_m, p, c) => p + c.toUpperCase())
    .trim();
}

export const TEMPLATE_KEYS = Object.keys(T);
