/**
 * Physics lesson: forces and balance (one dimension, horizontal).
 *
 * Verifier, in two deliberately separate parts:
 *  - Numerical: net force along a line = (sum of forces to the right) − (sum to the left), computed exactly;
 *    the size and the direction are checked separately, and the force needed to balance is the difference.
 *  - Conceptual, explicitly bounded: for "what happens to the motion?" questions the student's words are
 *    matched against a closed list of outcomes (stays still · keeps the same speed · speeds up · slows down ·
 *    starts moving, and which way). Anything outside that list is not judged: the tutor says what it can
 *    check and asks again. This is not general physics reasoning.
 */
import type { RespondContext, SubjectModule } from "./kernel";
import { numbersIn, pickVariant, randInt, rng } from "./text";
import type { Direction, SubjectCheck, SubjectMove, SubjectProblem, SubjectReading } from "./types";

type Kind = "net-force" | "balance-missing" | "balanced-moving" | "unbalanced-rest";

const n = (p: SubjectProblem, k: string) => Number(p.data[k]);

export const OUTCOMES = ["stays_still", "same_speed", "speeds_up", "slows_down", "starts_moving"] as const;
const OUTCOME_WORDS: Record<(typeof OUTCOMES)[number], string> = {
  stays_still: "stays still",
  same_speed: "keeps moving at the same speed",
  speeds_up: "speeds up",
  slows_down: "slows down",
  starts_moving: "starts moving",
};

function make(kind: Kind, id: string, role: "guided" | "check", v: Record<string, number>): SubjectProblem {
  switch (kind) {
    case "net-force": {
      const net = v.right - v.left;
      const dir: Direction = net > 0 ? "right" : "left";
      return { id, role, kind, prompt: `Two people push a box along the floor. One pushes right with ${v.right} N, the other pushes left with ${v.left} N. What is the net force on the box — how big, and which way?`, data: { right: v.right, left: v.left }, answer: { value: Math.abs(net), unit: "N", direction: dir }, answerText: `${Math.abs(net)} N to the ${dir}` };
    }
    case "balance-missing": {
      const need = v.left - v.right;
      return { id, role, kind, prompt: `A crate has ${v.left} N pushing it left and ${v.right} N pushing it right. How much more force must push right to balance the forces?`, data: { right: v.right, left: v.left, missing: "right" }, answer: { value: need, unit: "N", direction: "right" }, answerText: `${need} N more to the right` };
    }
    case "balanced-moving":
      return { id, role, kind, prompt: `A trolley is already rolling at 2 m/s. Now ${v.f} N pushes it forward and ${v.f} N pushes back on it. What happens to its speed?`, data: { right: v.f, left: v.f, moving: 2 }, answer: { outcome: "same_speed", direction: "none" }, answerText: "it keeps moving at the same speed (2 m/s)" };
    case "unbalanced-rest":
      return { id, role, kind, prompt: `A box is resting on smooth ice. ${v.right} N pushes it right and ${v.left} N pushes it left. Does it stay still, or start to move — and if it moves, which way?`, data: { right: v.right, left: v.left }, answer: { outcome: "starts_moving", direction: v.right > v.left ? "right" : "left" }, answerText: `it starts moving to the ${v.right > v.left ? "right" : "left"}` };
  }
}

export function makePhysicsProblems(seed: number): SubjectProblem[] {
  const r = rng(seed * 104729 + 3);
  const guided = make("net-force", "f0", "guided", { right: 12, left: 8 });
  let check1: SubjectProblem;
  if (r() < 0.5) {
    let a: number, b: number;
    do {
      a = randInt(r, 4, 24);
      b = randInt(r, 3, 24);
    } while (a === b || Math.abs(a - b) < 2 || Math.abs(a - b) === a || Math.abs(a - b) === b || a + b === Math.abs(a - b) || (a === 12 && b === 8));
    check1 = make("net-force", "f1", "check", { right: a, left: b });
  } else {
    let left: number, right: number;
    do {
      left = randInt(r, 10, 25);
      right = randInt(r, 3, left - 3);
    } while (left - right === right || left - right === left);
    check1 = make("balance-missing", "f1", "check", { left, right });
  }
  let check2: SubjectProblem;
  if (r() < 0.5) check2 = make("balanced-moving", "f2", "check", { f: randInt(r, 5, 30) });
  else {
    let a: number, b: number;
    do {
      a = randInt(r, 4, 25);
      b = randInt(r, 3, 25);
    } while (a === b);
    check2 = make("unbalanced-rest", "f2", "check", { right: a, left: b });
  }
  return [guided, check1, check2];
}

const TOPICS: Array<[string, RegExp]> = [
  ["net_force", /what('s| is)( the| a)? (net|resultant|overall) force|what does net (force )?mean/],
  ["newton", /what('s| is)( a)? newton|what does n (stand for|mean)|what('s| is) n\b/],
  ["balanced", /what (does|do) (balanced|unbalanced) mean|what('s| is| are) (balanced|unbalanced)( forces?)?/],
  ["keeps_moving", /why (does|would|do) (it|the \w+) (keep|still) (moving|going|rolling)|how can it (keep )?mov\w* (if|when|with)|why doesn'?t it (stop|slow)|why (does|would) it not (stop|slow)/],
  ["friction", /friction|why do(es)? (things|it) (stop|slow down) (in real life|normally|on the floor)/],
];

const DIRS: Array<[Direction, RegExp]> = [
  ["right", /\b(right|rightwards?|to the right|forwards?)\b/],
  ["left", /\b(left|leftwards?|to the left|backwards?|back)\b/],
];

const OUTCOME_RES: Array<[(typeof OUTCOMES)[number], RegExp]> = [
  ["same_speed", /(same|constant|steady|unchanged|doesn'?t change|does not change|won'?t change|stays the same|stay the same|keeps? (going|moving|rolling)( at| with)?|carr(y|ies) on|continues?|still (at )?2)/],
  ["speeds_up", /(speeds? up|faster|accelerat|gets quicker|gains speed|increases?)/],
  ["slows_down", /(slows?( down)?|slower|decelerat|loses speed|decreases?|comes? to a stop|\bstops?\b|stop moving|will stop)/],
  ["stays_still", /(stays? (still|put|at rest|where it is)|doesn'?t move|does not move|won'?t move|not move|stationary|remains? (still|at rest)|nothing happens)/],
  ["starts_moving", /(starts?( to)? (move|moving|slide|sliding)|moves?|slides?|will go|goes|it moves)/],
];

const CONCEPTS: Array<[string, RegExp]> = [
  ["balanced", /\b(balanced|cancel( each other)?( out)?|equal and opposite)\b/],
  ["unbalanced", /\bunbalanced|not balanced\b/],
  ["zero_net", /\b(net force (is )?(0|zero|nothing)|no (net|overall|resultant) force|zero net)\b/],
  ["motion_needs_force", /(needs? a force to keep|force (is )?needed to keep|has to keep pushing|nothing pushing it so it stops|no force so it stops)/],
];

function read(t: string, p: SubjectProblem): Partial<SubjectReading> | null {
  const question = /\?\s*$/.test(t) || /^(why|how|what|where|which|can|could|should|is|are|does|do)\b/.test(t);
  if (question) {
    const topic = TOPICS.find(([, re]) => re.test(t));
    if (topic) return { kind: "concept_question", topic: topic[0], evidence: [topic[0]], question: true };
  }
  const evidence: string[] = [];
  const dirHits = DIRS.filter(([, re]) => re.test(t)).map(([d]) => d);
  // "pushes left" inside a restatement of the problem isn't the student's direction; use the last direction word.
  let direction: Direction | undefined;
  if (dirHits.length) {
    const last = DIRS.map(([d, re]) => ({ d, i: Math.max(...Array.from(t.matchAll(new RegExp(re.source, "g"))).map((m) => m.index ?? -1)) })).sort((a, b) => b.i - a.i)[0];
    direction = last.i >= 0 ? last.d : undefined;
    evidence.push(`direction ${direction}`);
  }
  const concepts = CONCEPTS.filter(([, re]) => re.test(t)).map(([c]) => c);
  const kind = p.kind as Kind;
  if (kind === "balanced-moving" || kind === "unbalanced-rest") {
    // Closed outcome list, most specific first ("keeps moving" before "moves").
    const hit = OUTCOME_RES.find(([, re]) => re.test(t));
    if (hit) {
      evidence.push(`outcome “${t.match(hit[1])![0]}” → ${hit[0]}`);
      return { kind: "answer", outcome: hit[0], direction: hit[0] === "starts_moving" || hit[0] === "speeds_up" ? direction : undefined, concepts, evidence };
    }
    if (direction && /\b(right|left)\b/.test(t) && kind === "unbalanced-rest") return { kind: "answer", outcome: "starts_moving", direction, concepts, evidence: [...evidence, "direction only → moves that way"] };
    if (concepts.length) return { kind: "concept_claim", concepts, evidence: [...evidence, ...concepts] };
    const nums = numbersIn(t);
    if (nums.length) return { kind: "answer", value: nums[nums.length - 1], direction, concepts, evidence: [...evidence, `number ${nums[nums.length - 1]} (this question asks about motion)`] };
    return null;
  }
  // Numerical questions.
  const stripped = t.replace(/\b\d+(?:\.\d+)?\s*(m\/s|metres per second|meters per second)\b/g, " ");
  const nums = numbersIn(stripped);
  if (/\b(balanced|zero|nothing|no net force|0 n)\b/.test(t) && !nums.filter((x) => x !== 0).length) return { kind: "answer", value: 0, direction: "none", concepts, evidence: [...evidence, "zero / balanced"] };
  if (!nums.length) {
    if (concepts.length) return { kind: "concept_claim", concepts, evidence: concepts };
    if (direction) return { kind: "answer", direction, concepts, evidence };
    return null;
  }
  const marker = Array.from(stripped.matchAll(/(?:=|\bis\b|\bit'?s\b|\banswer\b|\bnet\b|\bforce of\b|\bneeds?\b|\bmore\b|\bget\b|\bgot\b)\s*(?:is\s*|=\s*|force\s*)?(\d+(?:\.\d+)?)/g)).map((m) => Number(m[1]));
  const givens = [n(p, "right"), n(p, "left")];
  const fresh = nums.filter((x) => !givens.includes(x));
  const value = marker.length ? marker[marker.length - 1] : fresh.length ? fresh[fresh.length - 1] : nums[nums.length - 1];
  evidence.push(`size ${value}`);
  return { kind: "answer", value, direction, concepts, evidence };
}

const MIS: Record<string, string> = {
  ADDED_OPPOSING: "Added forces that point in opposite directions",
  WRONG_DIRECTION: "Net force points the way of the smaller force",
  NO_DIRECTION: "Gave the size of the net force but not its direction",
  CALLED_BALANCED: "Called unequal opposite forces balanced",
  ONE_FORCE: "Gave one of the forces instead of combining them",
  MOTION_NEEDS_FORCE: "Thinks a moving object needs a net force to keep moving",
  BALANCED_SPEEDS_UP: "Thinks balanced forces change the speed",
  MOVING_STOPS_STILL: "Thinks balanced forces make a moving object stop",
  UNBALANCED_STAYS: "Thinks unbalanced forces leave an object at rest",
  UNEXPLAINED: "A value or outcome no modelled mistake explains",
};

function verify(r: SubjectReading, p: SubjectProblem): SubjectCheck {
  const base = { verifier: p.kind === "balanced-moving" || p.kind === "unbalanced-rest" ? "motion outcome (closed list)" : "net force on a line", claims: r.claims };
  const R = n(p, "right"), L = n(p, "left");
  const mk = (verdict: SubjectCheck["verdict"], id: string | undefined, detail: string): SubjectCheck => ({ ...base, verdict, detail, misconception: id ? { id, label: MIS[id] } : undefined });
  if (r.kind === "concept_claim") {
    const balanced = R === L;
    if (r.concepts.includes("motion_needs_force")) return mk("incorrect", "MOTION_NEEDS_FORCE", "Statement: a moving object needs a force to keep moving.");
    if (r.concepts.includes("balanced") || r.concepts.includes("zero_net")) return balanced ? mk("correct", undefined, `Forces ${R} N and ${L} N are equal and opposite: balanced, net force 0 — statement true.`) : mk("incorrect", "CALLED_BALANCED", `Called ${R} N right and ${L} N left balanced; net is ${Math.abs(R - L)} N.`);
    if (r.concepts.includes("unbalanced")) return balanced ? mk("incorrect", undefined, "Called equal opposite forces unbalanced.") : mk("correct", undefined, "Forces are unequal: unbalanced — statement true.");
    return mk("not_checkable", undefined, "No checkable claim.");
  }
  switch (p.kind as Kind) {
    case "net-force": {
      const size = Math.abs(R - L);
      const dir = R > L ? "right" : "left";
      const v = r.value;
      if (v == null) return mk("not_checkable", undefined, `Direction ${r.direction ?? "—"} without a size; expected ${size} N ${dir}.`);
      if (v === size && r.direction === dir) return mk("correct", undefined, `${R} − ${L} = ${size} N, towards the bigger force (${dir}). Student: ${v} N ${r.direction}.`);
      if (v === size && !r.direction) return mk("partial", "NO_DIRECTION", `Size ${v} N is right; no direction given (expected ${dir}).`);
      if (v === size && r.direction && r.direction !== dir) return mk("partial", "WRONG_DIRECTION", `Size ${v} N is right; direction ${r.direction} should be ${dir}.`);
      if (v === R + L) return mk("incorrect", "ADDED_OPPOSING", `${v} = ${R} + ${L}; opposite forces subtract.`);
      if (v === 0) return mk("incorrect", "CALLED_BALANCED", `Net 0 given; ${R} ≠ ${L}, so the net is ${size} N.`);
      if (v === R || v === L) return mk("incorrect", "ONE_FORCE", `${v} N is one of the forces.`);
      return mk("incorrect", "UNEXPLAINED", `Gave ${v} N; expected ${size} N ${dir}.`);
    }
    case "balance-missing": {
      const need = L - R;
      const v = r.value;
      if (v == null) return mk("not_checkable", undefined, `No size given; expected ${need} N.`);
      if (v === need && r.direction === "left") return mk("partial", "WRONG_DIRECTION", `${need} N is the right size, but it must push right (against the bigger ${L} N).`);
      if (v === need) return mk("correct", undefined, `${L} − ${R} = ${need} N more to the right balances it. Student: ${v} N.`);
      if (v === L + R) return mk("incorrect", "ADDED_OPPOSING", `${v} = ${L} + ${R}.`);
      if (v === L) return mk("incorrect", "ONE_FORCE", `${v} N would make the right side ${R + v} N.`);
      return mk("incorrect", "UNEXPLAINED", `Gave ${v} N; right side would total ${R + v} N against ${L} N.`);
    }
    case "balanced-moving": {
      if (!r.outcome) return mk("not_checkable", undefined, `No outcome from the closed list (${OUTCOMES.join(", ")}).`);
      if (r.outcome === "same_speed") return mk("correct", undefined, `Balanced (${R} N each way) → net force 0 → motion unchanged at 2 m/s. Student: ${OUTCOME_WORDS.same_speed}.`);
      if (r.outcome === "slows_down") return mk("incorrect", "MOTION_NEEDS_FORCE", "Said it slows down / stops: motion would only change with a net force.");
      if (r.outcome === "speeds_up") return mk("incorrect", "BALANCED_SPEEDS_UP", "Said it speeds up: needs an unbalanced force.");
      if (r.outcome === "stays_still") return mk("incorrect", "MOVING_STOPS_STILL", "Said it stays still: it is already moving, and balanced forces don't stop it.");
      return mk("incorrect", "UNEXPLAINED", `Outcome ${r.outcome}.`);
    }
    case "unbalanced-rest": {
      const dir = R > L ? "right" : "left";
      if (!r.outcome) return mk("not_checkable", undefined, `No outcome from the closed list (${OUTCOMES.join(", ")}).`);
      if ((r.outcome === "starts_moving" || r.outcome === "speeds_up") && r.direction === dir) return mk("correct", undefined, `Net ${Math.abs(R - L)} N ${dir} → it starts moving ${dir}. Student: moves ${r.direction}.`);
      if (r.outcome === "starts_moving" || r.outcome === "speeds_up") return r.direction ? mk("partial", "WRONG_DIRECTION", `Moves, but ${r.direction}; the bigger force is ${dir}.`) : mk("partial", "NO_DIRECTION", "Said it moves, no direction.");
      if (r.outcome === "stays_still") return mk("incorrect", "UNBALANCED_STAYS", `Said it stays still; ${R} N vs ${L} N is unbalanced.`);
      return mk("incorrect", "UNEXPLAINED", `Outcome ${r.outcome} for an object at rest.`);
    }
  }
}

const lowerQ = (s: string) => {
  const q = s.match(/[^.?!]*\?$/)?.[0]?.trim() ?? s;
  return q.charAt(0).toLowerCase() + q.slice(1);
};

function respond(p: SubjectProblem, r: SubjectReading, c: SubjectCheck, cx: RespondContext): SubjectMove {
  const lvl = cx.state.hintLevel;
  const R = n(p, "right"), L = n(p, "left");
  const kind = p.kind as Kind;
  const ask = (rule: string, text: string, reason: string): SubjectMove => ({ rule, action: "ASK", reason, text, hintLevel: lvl, revealAllowed: false, assistive: false });
  if (r.kind === "concept_claim") {
    if (c.verdict === "correct") return { ...ask("P_CONCEPT_RIGHT", `That's right. ${R === L ? "Equal forces in opposite directions cancel, so the net force is zero." : "The forces aren't equal, so they don't cancel completely."} So: ${lowerQ(p.prompt)}`, "A true statement about the forces: confirm and ask them to use it."), stage: "THINK" };
    if (c.misconception?.id === "MOTION_NEEDS_FORCE") return { rule: "P_MOTION_NEEDS_FORCE", action: "HINT", stage: "THINK", reason: "Common misconception (motion needs a force). Name where the idea comes from (friction) and the rule: forces change motion, they aren't needed to keep it.", text: `That's how it feels in everyday life — but there, friction is quietly pushing back. Forces change motion; they aren't needed to keep it. ${cap(lowerQ(p.prompt))}`, hintLevel: Math.max(lvl, 1), revealAllowed: false, assistive: true };
    if (c.verdict === "incorrect") return { rule: "P_CONCEPT_CHECK", action: "VERIFY", stage: "NOTICE", reason: "The statement doesn't match these forces: compare them.", text: `Look at the sizes: ${R} N one way and ${L} N the other. ${R === L ? "They're equal" : "They're not equal"}. With that in mind, ${lowerQ(p.prompt)}`, hintLevel: Math.max(lvl, 1), revealAllowed: false, assistive: true };
    return ask("P_CLARIFY", `${physics.checkable(p)}. ${p.prompt}`, "No checkable claim: say what can be checked.");
  }
  if (c.verdict === "not_checkable") {
    if (kind === "balanced-moving" || kind === "unbalanced-rest") return ask("P_BOUNDED_CHECK", `I can only check a few kinds of answers here: whether it stays still, keeps the same speed, speeds up, slows down or starts moving — and which way. Which of those happens?`, "The answer isn't in the closed outcome list. Don't judge it; say what can be checked and ask again.");
    if (r.direction && r.value == null) return ask("P_SIZE_TOO", `Which way is part of it. How big is the net force, in newtons?`, "Direction without size: ask for the size.");
    return ask("P_WHICH_NUMBER", "Which number is your answer, in newtons?", "No single value reads as the answer.");
  }
  if (c.verdict === "correct") {
    const why = kind === "net-force" ? `${R} N − ${L} N = ${Math.abs(R - L)} N, and the bigger push is to the ${R > L ? "right" : "left"}.` : kind === "balance-missing" ? `${R} N + ${L - R} N = ${L} N, matching the ${L} N on the other side, so the forces cancel.` : kind === "balanced-moving" ? "Balanced forces mean zero net force, and zero net force leaves the motion unchanged: it keeps rolling at 2 m/s." : `The net force is ${Math.abs(R - L)} N to the ${R > L ? "right" : "left"}, so it starts to move that way.`;
    return { rule: "P_CORRECT", action: "VERIFY", reason: "Correct: confirm with the computed reason, then move on.", text: `Yes. ${why} ${cx.next}`, hintLevel: lvl, revealAllowed: true, assistive: false, solved: true, advance: true };
  }
  const again = cx.repeat ? "That's the same answer as before. " : "";
  const id = c.misconception?.id ?? "UNEXPLAINED";
  // Restating the size the student already gave isn't a leak, so direction-only feedback may say it.
  const ownSize = id === "NO_DIRECTION" || id === "WRONG_DIRECTION";
  const mv = (text: string, reason: string, stage: SubjectMove["stage"] = "THINK", attempt = true): SubjectMove => ({ rule: `P_${id}`, action: "HINT", stage, reason, text: again + text, hintLevel: Math.max(lvl, 1), revealAllowed: ownSize, assistive: true, attempt });
  const v = r.value;
  switch (id) {
    case "NO_DIRECTION":
      return mv(kind === "unbalanced-rest" ? "Yes, it starts to move. Which way does it go?" : `${v} N is the right size. Which way does the box get pushed overall?`, "Size right, direction missing: ask for the direction only.", "TRY", false);
    case "WRONG_DIRECTION":
      return mv(kind === "unbalanced-rest" ? `It does start moving — but check the direction. Which push is bigger, ${R} N to the right or ${L} N to the left?` : kind === "balance-missing" ? `${v} N is the right size. But it has to push against the ${L} N — which way is that?` : `${v} N is the right size. Now check the direction: which push is bigger, ${R} N right or ${L} N left?`, "Size right, direction wrong: point at which force is bigger.", "TRY");
    case "ADDED_OPPOSING":
      return mv(`${v} N would be right if both pushes went the same way. These push in opposite directions, so they partly cancel. What's left after they cancel?`, "Added opposite forces: they subtract.");
    case "CALLED_BALANCED":
      return mv(`Forces only cancel completely when they're equal. ${R} N and ${L} N aren't equal. Which is bigger, and by how much?`, "Called unequal forces balanced.");
    case "ONE_FORCE":
      return mv(`${v} N is one of the forces on its own. The net force combines both of them. What do you get when you combine ${R} N right with ${L} N left?`, "Gave one force: the net combines both.");
    case "MOTION_NEEDS_FORCE":
      return mv(`On a real floor that's what usually happens — because friction is an extra force pulling back. Here the only forces are ${R} N forward and ${L} N back, and they cancel. If nothing changes the trolley's motion, what happens to its speed?`, "Common misconception: motion needs a force. Name friction as the hidden force; ask again.");
    case "BALANCED_SPEEDS_UP":
      return mv(`Speeding up needs an unbalanced force. Here ${R} N forward and ${L} N back cancel each other out. So what happens to the speed?`, "Balanced forces don't speed things up.");
    case "MOVING_STOPS_STILL":
      return mv(`It's already rolling at 2 m/s. Balanced forces don't stop a moving object — they just don't change its motion. So what happens to its speed?`, "Balanced forces don't stop motion.");
    case "UNBALANCED_STAYS":
      return mv(`It would stay still if the forces were balanced. But ${R} N and ${L} N aren't equal, so there's a net force. What does a net force do to a box at rest?`, "Unbalanced forces start motion.");
    default:
      return mv(kind === "balance-missing" ? `Let's check: with ${v} N more, the right side would total ${R + (v ?? 0)} N against ${L} N on the left. How did you get ${v} N?` : `Let's check it against the arrows: ${R} N right and ${L} N left. How did you get that?`, "Not a modelled mistake: show the comparison and ask how they got it.", "NOTICE");
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function hint(p: SubjectProblem, level: 1 | 2 | 3, variant: number): string {
  const R = n(p, "right"), L = n(p, "left");
  const kind = p.kind as Kind;
  if (kind === "balanced-moving") {
    if (level === 1) return pickVariant([`Look at the two forces: ${R} N forward and ${L} N back. Are they balanced or unbalanced?`, `Compare the arrows: same size, opposite directions. What does that make the net force?`], variant);
    if (level === 2) return pickVariant([`Balanced forces cancel, so the net force is zero. A zero net force doesn't start, stop, speed up or slow down anything. What does that mean for a trolley that's already rolling?`, `Think of a puck sliding on ice with nothing pushing it overall. Does it need a push to keep going?`], variant);
    return pickVariant([`With zero net force, the trolley's motion doesn't change. Does its speed go up, go down, or stay as it is?`, `Nothing is changing its motion. Pick one: faster, slower, or neither?`], variant);
  }
  if (kind === "unbalanced-rest") {
    if (level === 1) return pickVariant([`Look at the two forces: ${R} N right and ${L} N left. Are they equal?`, `Compare the arrows. Is one longer than the other?`], variant);
    if (level === 2) return pickVariant([`Unequal opposite forces don't fully cancel — there's a net force left over. What does a net force do to something at rest?`, `Think of a tug of war on ice: when one side pulls harder, what happens?`], variant);
    return pickVariant([`The bigger force wins. Which force is bigger, and so which way does the box go?`, `Find the bigger push. That's the way the net force points — and the way it moves. Which way is that?`], variant);
  }
  if (kind === "balance-missing") {
    if (level === 1) return pickVariant([`Look at the arrows: ${L} N to the left and only ${R} N to the right. Which side needs more push to match?`, `Balanced means both sides push equally hard. Is the right side as strong as the left yet?`], variant);
    if (level === 2) return pickVariant([`The right side has to reach ${L} N to match the left. It already has ${R} N. How much is it short?`, `Think of filling a gap: the left is at ${L} N, the right is at ${R} N. How big is the gap?`], variant);
    return pickVariant([`Work out ${L} N − ${R} N. That's how much more the right side needs. What do you get?`, `Take ${R} away from ${L}. What's left?`], variant);
  }
  if (level === 1) return pickVariant([`Look at the arrows: ${R} N pushes right and ${L} N pushes left. They point in opposite directions. What happens to forces that push against each other?`, `Two pushes, opposite ways. Do they add together, or work against each other?`], variant);
  if (level === 2) return pickVariant([`Opposite forces partly cancel. Picture a tug of war: the stronger side wins by the difference. Which side is stronger, and by how much?`, `Imagine the ${L} N cancelling ${L} N of the ${R} N. How much push is left over, and which way?`], variant);
  return pickVariant([`Take the smaller force from the bigger one, and say which way the bigger one points. What's the net force?`, `Work out ${Math.max(R, L)} N − ${Math.min(R, L)} N, then add the direction of the bigger push. What do you get?`], variant);
}

function reveal(p: SubjectProblem): string {
  const R = n(p, "right"), L = n(p, "left");
  switch (p.kind as Kind) {
    case "net-force":
      return `Here's the working: ${Math.max(R, L)} N − ${Math.min(R, L)} N = ${Math.abs(R - L)} N, and the bigger push is to the ${R > L ? "right" : "left"}. So the net force is ${Math.abs(R - L)} N to the ${R > L ? "right" : "left"}.`;
    case "balance-missing":
      return `Here's the working: the right side needs to match ${L} N, and it has ${R} N. ${L} N − ${R} N = ${L - R} N, so ${L - R} N more must push right.`;
    case "balanced-moving":
      return "Here's the idea: the forces are balanced, so the net force is zero, and zero net force doesn't change motion. The trolley keeps rolling at 2 m/s. (On a real floor, friction would be an extra force that slows it.)";
    case "unbalanced-rest":
      return `Here's the idea: ${R} N and ${L} N aren't equal, so there's a net force of ${Math.abs(R - L)} N to the ${R > L ? "right" : "left"}. A net force starts a resting object moving, so the box starts moving ${R > L ? "right" : "left"}.`;
  }
}

function explain(p: SubjectProblem, topic?: string): string {
  switch (topic) {
    case "net_force":
      return "The net force is what's left when you combine all the forces: forces the same way add, forces in opposite directions subtract. It points the way of the bigger push.";
    case "newton":
      return "N stands for newtons, the unit of force. Roughly, 1 newton is the push you need to hold up a small apple.";
    case "balanced":
      return "Balanced forces are equal in size and opposite in direction, so they cancel: the net force is zero. Unbalanced forces don't cancel, so there's a net force.";
    case "friction":
      return "Friction is a force between surfaces that pushes against sliding. It's why a ball rolling on grass slows down: friction is an unbalanced force pulling back.";
    case "keeps_moving":
    default:
      if (topic === "keeps_moving") return "Forces change motion — they speed things up, slow them down or turn them. With no net force there's nothing to change it, so a moving object carries on as it was. That's Newton's first law.";
      if (p.kind === "balanced-moving") return "Forces are what change motion: a net force speeds something up, slows it down or turns it. When the forces are balanced, the net force is zero.";
      return "When forces push in opposite directions, they work against each other, so the net force is the difference between them, pointing the way of the bigger one. A net force changes how something moves; zero net force changes nothing.";
  }
}

function example(p: SubjectProblem): string {
  const kind = p.kind as Kind;
  if (kind === "balanced-moving") return "For example, a hockey puck sliding on smooth ice has almost no net force on it — and it glides on at nearly the same speed.";
  if (kind === "unbalanced-rest") return "For example, in a tug of war, if one team pulls with 300 N and the other with 200 N, the rope starts moving towards the 300 N team.";
  const avoid = new Set([n(p, "right"), n(p, "left"), p.answer.value]);
  const opts: [number, number][] = [[30, 20], [50, 35], [9, 2], [40, 15]];
  const [a, b] = opts.find(([x, y]) => ![x, y, x - y, x + y].some((z) => avoid.has(z))) ?? opts[0];
  if (kind === "balance-missing") return `For example, if ${a} N pushes left and ${b} N pushes right, the right side needs ${a - b} N more to balance.`;
  return `For example, if ${a} N pushes right and ${b} N pushes left, the net force is ${a} N − ${b} N = ${a - b} N to the right.`;
}

function leaks(text: string, p: SubjectProblem): boolean {
  const kind = p.kind as Kind;
  if (kind === "net-force" || kind === "balance-missing") return new RegExp(`(?<![\\d.])${p.answer.value}\\s*(n\\b|newtons?)`, "i").test(text);
  if (kind === "balanced-moving") return /(keeps? (rolling|moving|going) at( the same| a steady)? (speed|2 m\/s)|speed stays the same|its speed doesn'?t change)/i.test(text);
  return new RegExp(`(starts?|begins?) (to )?mov\\w* (to the )?${p.answer.direction}`, "i").test(text);
}

export const physics: SubjectModule = {
  id: "physics",
  title: "Forces and balance",
  objective: "Combine forces along a line into a net force, and use balanced vs unbalanced forces to say what happens to an object's motion.",
  makeProblems: makePhysicsProblems,
  read,
  verify,
  respond,
  hint,
  reveal,
  explain,
  example,
  leaks,
  vocabulary: { concepts: ["balanced", "unbalanced", "zero_net", "motion_needs_force"], outcomes: [...OUTCOMES], topics: TOPICS.map(([t]) => t) },
  nextIntro: (next) => `Now one to try on your own. ${next.prompt}`,
  checkable: (p) =>
    p.kind === "balanced-moving" || p.kind === "unbalanced-rest"
      ? "For this question I can check whether it stays still, keeps the same speed, speeds up, slows down or starts moving, and which way"
      : "For this question I can check a force in newtons, and which way it points",
};
