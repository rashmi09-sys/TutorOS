/**
 * Geometry lesson: angles in a triangle.
 *
 * Verifier: the angle-sum rule, computed exactly — the missing angle is 180° minus the known angles (with the
 * isosceles rule that the two base angles are equal). A wrong value is matched against a short list of
 * recognisable mistakes (added the given angles, used 360°, subtracted only one angle, forgot to halve,
 * assumed all angles equal, an arithmetic slip in a calculation the student wrote). Anything else is
 * "a value we can't explain" and the tutor asks how they got it.
 */
import type { RespondContext, SubjectModule } from "./kernel";
import { numbersIn, pickVariant, randInt, rng } from "./text";
import type { SubjectCheck, SubjectMove, SubjectProblem, SubjectReading } from "./types";

type Kind = "two-angles" | "right" | "isosceles-base" | "isosceles-apex";

const n = (p: SubjectProblem, k: string) => Number(p.data[k]);

function make(kind: Kind, id: string, role: "guided" | "check", v: Record<string, number>): SubjectProblem {
  switch (kind) {
    case "two-angles": {
      const c = 180 - v.a - v.b;
      return { id, role, kind, prompt: `A triangle has angles of ${v.a}° and ${v.b}°. What is the size of the third angle?`, data: { A: v.a, B: v.b, C: c, a: v.a, b: v.b, unknown: "C" }, answer: { value: c, unit: "°" }, answerText: `${c}°` };
    }
    case "right": {
      const c = 90 - v.a;
      return { id, role, kind, prompt: `This triangle has a right angle (90°) and an angle of ${v.a}°. What is the size of the third angle?`, data: { A: 90, B: v.a, C: c, a: v.a, unknown: "C", right: "A" }, answer: { value: c, unit: "°" }, answerText: `${c}°` };
    }
    case "isosceles-base": {
      const base = (180 - v.p) / 2;
      return { id, role, kind, prompt: `This isosceles triangle has a top angle of ${v.p}°. Its two base angles are equal. How big is each base angle?`, data: { A: base, B: base, C: v.p, p: v.p, unknown: "AB", equal: "AB" }, answer: { value: base, unit: "°" }, answerText: `${base}° each` };
    }
    case "isosceles-apex": {
      const top = 180 - 2 * v.b;
      return { id, role, kind, prompt: `This isosceles triangle has two equal base angles of ${v.b}°. How big is the top angle?`, data: { A: v.b, B: v.b, C: top, b: v.b, unknown: "C", equal: "AB" }, answer: { value: top, unit: "°" }, answerText: `${top}°` };
    }
  }
}

/** Givens never equal the answer, so the leak guard can simply look for the answer's number. */
export function makeGeometryProblems(seed: number): SubjectProblem[] {
  const r = rng(seed * 7919 + 17);
  const guided = make("two-angles", "g0", "guided", { a: 65, b: 40 });
  let check1: SubjectProblem;
  if (r() < 0.5) {
    let a: number;
    do a = randInt(r, 22, 68);
    while (a === 45);
    check1 = make("right", "g1", "check", { a });
  } else {
    let a: number, b: number, c: number;
    do {
      a = randInt(r, 30, 80);
      b = randInt(r, 25, 75);
      c = 180 - a - b;
    } while (c < 25 || c > 110 || c === a || c === b || a === b || a + b === 90 || (a === 65 && b === 40));
    check1 = make("two-angles", "g1", "check", { a, b });
  }
  let check2: SubjectProblem;
  if (r() < 0.5) {
    let p: number;
    do p = 2 * randInt(r, 15, 50);
    while (p === 60);
    check2 = make("isosceles-base", "g2", "check", { p });
  } else {
    let b: number;
    do b = randInt(r, 40, 75);
    while (b === 60 || b === 45);
    check2 = make("isosceles-apex", "g2", "check", { b });
  }
  return [guided, check1, check2];
}

const givens = (p: SubjectProblem): number[] => {
  switch (p.kind as Kind) {
    case "two-angles":
      return [n(p, "a"), n(p, "b")];
    case "right":
      return [90, n(p, "a")];
    case "isosceles-base":
      return [n(p, "p")];
    case "isosceles-apex":
      return [n(p, "b")];
  }
};

const TOPICS: Array<[string, RegExp]> = [
  ["why_180", /why .*(180|add (up )?to|always|same total)|how (do|can|would) (we|you|i) know .*180|where does (the )?180 come from|why (do|does|is) .*180/],
  ["isosceles", /what('s| is| does)( an?)? isosceles|isosceles mean|what are base angles|which (ones|angles) are (the )?equal/],
  ["right_angle", /what('s| is)( a)? right angle|what does (the |that )?(little |small )?square mean|what('s| is) 90/],
  ["angle", /what('s| is) an angle\b|what are degrees|what('s| is) a degree/],
];

const SUM_PHRASE = /\b(add|adds|added|adding|add up to|sum|sums|total|totals|make|makes|come to|comes to|equal|equals)\b[^.,;?]{0,25}?(?<![\d.])(180|360)(?![\d.])°?|(?<![\d.])(180|360)(?![\d.])°? (in total|altogether|in a triangle|for a triangle)|=\s*(180|360)(?![\d.])°?/g;

function read(t: string, p: SubjectProblem): Partial<SubjectReading> | null {
  const question = /\?\s*$/.test(t) || /^(why|how|what|where|which|can|could|should|is|are|does|do)\b/.test(t);
  if (question) {
    const topic = TOPICS.find(([, re]) => re.test(t));
    if (topic) return { kind: "concept_question", topic: topic[0], evidence: [topic[0]], question: true };
  }
  const concepts: string[] = [];
  const evidence: string[] = [];
  const rest = t.replace(SUM_PHRASE, (m, _w, x1, x2, _w2, x3) => {
    concepts.push((x1 ?? x2 ?? x3) === "360" ? "sum_360" : "sum_180");
    evidence.push(m.trim());
    return " ";
  });
  const nums = numbersIn(rest);
  if (!nums.length) {
    if (concepts.length) return { kind: "concept_claim", concepts, evidence };
    return null;
  }
  // Which number is the answer? An explicit result ("= 75", "it's 75", "the answer is 75"), the result of the
  // last calculation they wrote, or the one number that isn't a given angle.
  const marker = Array.from(rest.matchAll(/(?:=|\bis\b|\bit'?s\b|\banswer\b|\bangle\b|\bbe\b|\bget\b|\bgot\b|\beach\b|\bmissing\b)\s*(?:is\s*|=\s*)?(\d+(?:\.\d+)?)/g)).map((m) => Number(m[1]));
  const g = givens(p);
  const fresh = nums.filter((x) => !g.includes(x) && x !== 180 && x !== 360);
  let value: number | undefined;
  const lastNum = nums[nums.length - 1];
  if (fresh.length && fresh[fresh.length - 1] === lastNum) value = lastNum; // "… so 75": the last word is the answer
  else if (marker.length) value = marker[marker.length - 1];
  else if (fresh.length === 1) value = fresh[0];
  else if (nums.length === 1) value = nums[0];
  evidence.push(value != null ? `answer ${value}` : "numbers without a clear answer");
  return { kind: "answer", value, concepts, evidence };
}

const MIS: Record<string, string> = {
  ADDED_GIVEN: "Added the known angles but didn't take the total from 180°",
  SUM_360: "Used 360° (a full turn / a quadrilateral) as the angle sum",
  SUBTRACTED_ONE: "Took only one known angle away from 180°",
  FORGOT_RIGHT_ANGLE: "Didn't count the right angle as one of the three angles",
  FORGOT_HALVE: "Found what the two equal base angles share but didn't halve it",
  ASSUMED_ALL_EQUAL: "Assumed all three angles of the isosceles triangle are equal to the given one",
  EQUILATERAL: "Used 60° (equilateral) for an isosceles triangle",
  ARITHMETIC_SLIP: "Right method, slip in the arithmetic",
  IMPOSSIBLE: "An angle a triangle can't have (0° or less, or 180° or more)",
  UNEXPLAINED: "A value no modelled mistake explains",
};

function verify(r: SubjectReading, p: SubjectProblem): SubjectCheck {
  const e = p.answer.value!;
  const base = { verifier: "triangle angle sum (180°)", claims: r.claims };
  if (r.kind === "concept_claim") {
    const bad = r.concepts.includes("sum_360");
    return { ...base, verdict: bad ? "incorrect" : "correct", detail: bad ? "Statement uses 360° as the triangle angle sum (it is 180°)." : "Statement: the angles of a triangle add up to 180° — true.", misconception: bad ? { id: "SUM_360", label: MIS.SUM_360 } : undefined };
  }
  const v = r.value;
  if (v == null) return { ...base, verdict: "not_checkable", detail: "Numbers given, but no single value reads as the answer." };
  const falseClaim = r.claims.find((c) => !c.ok);
  const sumLine = `${givens(p).join(" + ")}${p.kind === "isosceles-apex" ? ` + ${n(p, "b")}` : ""}`;
  if (v === e) {
    if (falseClaim) return { ...base, verdict: "partial", detail: `Answer ${v}° matches 180° rule (expected ${e}°), but a stated calculation is false: ${falseClaim.expr} = ${falseClaim.actual}, not ${falseClaim.stated}.`, misconception: { id: "ARITHMETIC_SLIP", label: "Right answer, but a written calculation is false" } };
    return { ...base, verdict: "correct", detail: `${v}° matches the angle-sum rule: ${p.kind === "isosceles-base" ? `(180 − ${n(p, "p")}) ÷ 2 = ${e}` : `180 − ${sumLine.replace(/ \+ /g, " − ")} = ${e}`}.` };
  }
  const mk = (id: string, how: string): SubjectCheck => ({ ...base, verdict: "incorrect", detail: `Gave ${v}°, expected ${e}°. ${how}`, misconception: { id, label: MIS[id] } });
  if (r.claims.some((c) => !c.ok && c.actual === e && c.stated === v)) return mk("ARITHMETIC_SLIP", "Their own calculation evaluates to the right answer; the result was mis-written.");
  switch (p.kind as Kind) {
    case "two-angles": {
      const a = n(p, "a"), b = n(p, "b");
      if (v === a + b) return mk("ADDED_GIVEN", `${v} = ${a} + ${b}.`);
      if (v === 360 - a - b) return mk("SUM_360", `${v} = 360 − ${a} − ${b}.`);
      if (v === 180 - a || v === 180 - b) return mk("SUBTRACTED_ONE", `${v} = 180 − ${v === 180 - a ? a : b}.`);
      break;
    }
    case "right": {
      const a = n(p, "a");
      if (v === 180 - a) return mk("FORGOT_RIGHT_ANGLE", `${v} = 180 − ${a}; the 90° wasn't used.`);
      if (v === 90 + a) return mk("ADDED_GIVEN", `${v} = 90 + ${a}.`);
      if (v === 360 - 90 - a) return mk("SUM_360", `${v} = 360 − 90 − ${a}.`);
      break;
    }
    case "isosceles-base": {
      const pp = n(p, "p");
      if (v === 180 - pp) return mk("FORGOT_HALVE", `${v} = 180 − ${pp}, not halved.`);
      if (v === pp) return mk("ASSUMED_ALL_EQUAL", `${v} is the top angle itself.`);
      if (v === 60) return mk("EQUILATERAL", "60° is the equilateral angle.");
      if (v === (360 - pp) / 2) return mk("SUM_360", `${v} = (360 − ${pp}) ÷ 2.`);
      break;
    }
    case "isosceles-apex": {
      const b = n(p, "b");
      if (v === 180 - b) return mk("SUBTRACTED_ONE", `${v} = 180 − ${b}; only one base angle subtracted.`);
      if (v === b) return mk("ASSUMED_ALL_EQUAL", `${v} is the base angle itself.`);
      if (v === 60) return mk("EQUILATERAL", "60° is the equilateral angle.");
      if (v === 360 - 2 * b) return mk("SUM_360", `${v} = 360 − 2 × ${b}.`);
      if (v === 2 * b) return mk("ADDED_GIVEN", `${v} = ${b} + ${b}.`);
      break;
    }
  }
  if (v <= 0 || v >= 180) return mk("IMPOSSIBLE", "Outside 0°–180°.");
  return mk("UNEXPLAINED", "No modelled mistake gives this value.");
}

/** What the student would get by adding the known angles (with "the three angles" shown in full). */
function knownSentence(p: SubjectProblem) {
  switch (p.kind as Kind) {
    case "two-angles":
      return `${n(p, "a")}° and ${n(p, "b")}°`;
    case "right":
      return `90° and ${n(p, "a")}°`;
    case "isosceles-base":
      return `the ${n(p, "p")}° top angle`;
    case "isosceles-apex":
      return `the two ${n(p, "b")}° base angles`;
  }
}

function respond(p: SubjectProblem, r: SubjectReading, c: SubjectCheck, cx: RespondContext): SubjectMove {
  const lvl = cx.state.hintLevel;
  const e = p.answer.value!;
  if (r.kind === "concept_claim") {
    if (c.verdict === "correct") return { rule: "G_CONCEPT_RIGHT", action: "ASK", stage: "THINK", reason: "A true statement of the key idea: confirm it and ask them to use it on this triangle.", text: `Yes — the three angles of every triangle add up to 180°. Using that, ${lowerQ(p.prompt)}`, hintLevel: lvl, revealAllowed: false, assistive: false };
    return { rule: "G_CONCEPT_360", action: "HINT", stage: "THINK", reason: "Uses 360°: correct the fact (360° is a full turn or a four-sided shape) and hand the problem back.", text: `Careful: 360° is a full turn — it's also what the four angles of a four-sided shape add up to. A triangle's three angles add up to 180°. Using 180°, ${lowerQ(p.prompt)}`, hintLevel: Math.max(lvl, 1), revealAllowed: false, assistive: true, help: false };
  }
  if (c.verdict === "not_checkable") return { rule: "G_WHICH_NUMBER", action: "ASK", reason: "Several numbers and none reads as the answer — ask which is their answer rather than guess.", text: "I can see some numbers there. Which one is your answer for the missing angle?", hintLevel: lvl, revealAllowed: false, assistive: false };
  if (c.verdict === "correct" || c.verdict === "partial") {
    const why =
      p.kind === "isosceles-base"
        ? `The base angles share 180° − ${n(p, "p")}° = ${180 - n(p, "p")}°, so each one is ${e}°.`
        : p.kind === "isosceles-apex"
          ? `180° − ${n(p, "b")}° − ${n(p, "b")}° = ${e}°.`
          : p.kind === "right"
            ? `180° − 90° − ${n(p, "a")}° = ${e}°.`
            : `180° − ${n(p, "a")}° − ${n(p, "b")}° = ${e}°.`;
    const slip = c.verdict === "partial" && r.claims.find((x) => !x.ok);
    const lead = slip ? `${e}° is right — but check one line you wrote: ${slip.expr} is ${slip.actual}, not ${slip.stated}.` : `Yes — ${e}°. ${why}`;
    return { rule: c.verdict === "partial" ? "G_RIGHT_FLAWED_WORKING" : "G_CORRECT", action: "VERIFY", reason: c.verdict === "partial" ? "Right value, but a written calculation is false: confirm the answer and point at the false line." : "Correct: confirm with the computed reason, then move on.", text: `${lead} ${cx.next}`, hintLevel: lvl, revealAllowed: true, assistive: false, solved: true, advance: true };
  }
  const v = r.value!;
  const again = cx.repeat ? `You've said ${v}° again. ` : "";
  const id = c.misconception?.id ?? "UNEXPLAINED";
  const mv = (text: string, reason: string, stage: SubjectMove["stage"] = "THINK"): SubjectMove => ({ rule: `G_${id}`, action: id === "UNEXPLAINED" || id === "IMPOSSIBLE" ? "VERIFY" : "HINT", stage, reason, text: again + text, hintLevel: Math.max(lvl, 1), revealAllowed: false, assistive: true, attempt: true });
  const total = (() => {
    switch (p.kind as Kind) {
      case "two-angles":
        return n(p, "a") + n(p, "b") + v;
      case "right":
        return 90 + n(p, "a") + v;
      case "isosceles-base":
        return n(p, "p") + 2 * v;
      case "isosceles-apex":
        return 2 * n(p, "b") + v;
    }
  })();
  switch (id) {
    case "ADDED_GIVEN":
      return mv(`${v}° is what ${knownSentence(p)} add up to — a useful step. But that's the part of 180° already used. How much of the 180° is left for the missing angle?`, "Added the known angles: their working is a correct first step; ask for the remainder of 180°.");
    case "SUM_360":
      return mv(`It looks like you used 360°. That's a full turn, and what the angles of a four-sided shape add to. The three angles of a triangle add up to 180°. What do you get using 180°?`, "Used 360°: give the correct angle sum and hand it back.");
    case "SUBTRACTED_ONE":
      return mv(`You took one angle away from 180°, which leaves ${v}° for the other two angles together. One of them is already known. What's left for the last one?`, "Subtracted only one known angle: their value is what the remaining two angles share.");
    case "FORGOT_RIGHT_ANGLE":
      return mv(`The right angle counts too: it's one of the three angles, and it's 90°. So 180° has to cover 90°, ${n(p, "a")}° and the missing angle. What's left for the missing one?`, "Forgot the right angle: point at the 90° as one of the three.");
    case "FORGOT_HALVE":
      return mv(`${v}° is what the two base angles share between them. They're equal, so how big is each one?`, "Found the shared total but didn't halve it.");
    case "ASSUMED_ALL_EQUAL":
      return mv(`In an isosceles triangle only the two base angles are equal — the top angle can be different. ${p.kind === "isosceles-base" ? `With a top angle of ${n(p, "p")}°, how much is left for the two base angles together?` : `With base angles of ${n(p, "b")}° each, how much of the 180° is left for the top?`}`, "Assumed all three angles equal: say which two are equal.");
    case "EQUILATERAL":
      return mv(`60° would be right if all three angles were equal — that's an equilateral triangle. Here only the two base angles are equal. ${p.kind === "isosceles-base" ? `After the ${n(p, "p")}° top angle, how much do the base angles share?` : `After the two ${n(p, "b")}° base angles, how much is left for the top?`}`, "Used the equilateral 60°.");
    case "ARITHMETIC_SLIP": {
      const s = r.claims.find((x) => !x.ok && x.actual === e);
      return mv(`Your method is right. Check the arithmetic in ${s ? s.expr : "your last step"} once more — what does it come to?`, "Right method, slip in the arithmetic: point at the line, let them recompute.", "TRY");
    }
    case "IMPOSSIBLE":
      return mv(`An angle inside a triangle has to be more than 0° and less than 180°, because all three share 180° between them. What could the missing angle be?`, "Impossible angle: state the range and ask again.", "NOTICE");
    default:
      return mv(`Let's check it: with ${v}°, the three angles would add up to ${total}°, but they have to make exactly 180°. How did you get ${v}°?`, "Value no modelled mistake explains: show the computed check and ask how they got it (don't guess).", "NOTICE");
  }
}

const lowerQ = (s: string) => {
  const q = s.match(/[^.?!]*\?$/)?.[0]?.trim() ?? s;
  return q.charAt(0).toLowerCase() + q.slice(1);
};

function hint(p: SubjectProblem, level: 1 | 2 | 3, variant: number): string {
  const k = p.kind as Kind;
  const known = knownSentence(p);
  if (level === 1) {
    const extra = k === "right" ? " The little square marks a right angle, which is 90°." : k.startsWith("isosceles") ? " The marks on the base angles show they're equal." : "";
    return pickVariant(
      [
        `Look at the triangle: we know ${known}, and one angle is missing.${extra} What do the three angles of any triangle always add up to?`,
        `Start with what never changes: every triangle's angles add up to the same total.${extra} What is that total?`,
      ],
      variant,
    );
  }
  if (level === 2) {
    if (k === "isosceles-base") return pickVariant([`The top angle uses ${n(p, "p")}° of the 180°. The two base angles share what's left, equally. How much do they share?`, `Think of 180° as a cake: the top angle takes ${n(p, "p")}°, and the two equal base angles split the rest. How much is the rest?`], variant);
    if (k === "isosceles-apex") return pickVariant([`The two base angles are both ${n(p, "b")}°. Together they use part of the 180°. How much is left for the top?`, `Think of 180° as a cake: each base angle takes ${n(p, "b")}°. What's left for the top angle?`], variant);
    return pickVariant([`All three angles share 180°. The ones we know, ${known}, use up part of it. How much is left for the missing angle?`, `Think of 180° as a cake shared by three angles. ${cap(known)} have taken their slices. How much is left?`], variant);
  }
  if (k === "isosceles-base") return pickVariant([`Work out 180° − ${n(p, "p")}°, then split it into two equal parts. What is each part?`, `Take ${n(p, "p")}° away from 180°, then halve what's left. What do you get?`], variant);
  if (k === "isosceles-apex") return pickVariant([`Work out 180° − ${n(p, "b")}° − ${n(p, "b")}°. What do you get?`, `Add the two base angles, then take that from 180°. What's left?`], variant);
  if (k === "right") return pickVariant([`Work out 180° − 90° − ${n(p, "a")}°. What do you get?`, `Take the right angle and the ${n(p, "a")}° away from 180°. What's left?`], variant);
  return pickVariant([`Work out 180° − ${n(p, "a")}° − ${n(p, "b")}°. What do you get?`, `Add ${n(p, "a")}° and ${n(p, "b")}°, then take that total away from 180°. What's left?`], variant);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function reveal(p: SubjectProblem): string {
  const e = p.answer.value!;
  switch (p.kind as Kind) {
    case "two-angles":
      return `Here's the working: ${n(p, "a")}° + ${n(p, "b")}° = ${n(p, "a") + n(p, "b")}°, and 180° − ${n(p, "a") + n(p, "b")}° = ${e}°. So the missing angle is ${e}°.`;
    case "right":
      return `Here's the working: 90° + ${n(p, "a")}° = ${90 + n(p, "a")}°, and 180° − ${90 + n(p, "a")}° = ${e}°. So the missing angle is ${e}°.`;
    case "isosceles-base":
      return `Here's the working: 180° − ${n(p, "p")}° = ${180 - n(p, "p")}°, shared equally by the two base angles: ${180 - n(p, "p")}° ÷ 2 = ${e}°. So each base angle is ${e}°.`;
    case "isosceles-apex":
      return `Here's the working: ${n(p, "b")}° + ${n(p, "b")}° = ${2 * n(p, "b")}°, and 180° − ${2 * n(p, "b")}° = ${e}°. So the top angle is ${e}°.`;
  }
}

function explain(p: SubjectProblem, topic?: string): string {
  switch (topic) {
    case "isosceles":
      return "Isosceles means two sides are the same length. The two angles at the ends of the third side — the base angles — are equal too.";
    case "right_angle":
      return "A right angle is a square corner, exactly 90°. Diagrams mark it with a small square instead of a curve.";
    case "angle":
      return "An angle measures how much two lines turn away from each other at a corner. We measure it in degrees: a full turn is 360°, a straight line is 180°.";
    case "why_180":
    default: {
      const iso = (p.kind as Kind).startsWith("isosceles") && topic !== "why_180" ? " And in an isosceles triangle the two base angles are equal." : "";
      return `Tear the three corners off any paper triangle and put them side by side: they always make a straight line, and a straight line is 180°. You can see it here too — drag the top corner and watch the total stay at 180°.${iso}`;
    }
  }
}

function example(p: SubjectProblem): string {
  const e = p.answer.value!;
  const avoid = new Set([e, ...givens(p)]);
  if ((p.kind as Kind).startsWith("isosceles")) {
    const opts: [number, number][] = [[100, 40], [20, 80], [140, 20], [80, 50]];
    const [top, base] = opts.find(([t, b]) => !avoid.has(t) && !avoid.has(b) && !avoid.has(180 - t)) ?? opts[0];
    return `For example, an isosceles triangle with a top angle of ${top}°: the base angles share 180° − ${top}° = ${180 - top}°, so each is ${base}°.`;
  }
  const opts: [number, number][] = [[90, 50], [100, 30], [70, 70], [60, 35], [110, 25]];
  const [a, b] = opts.find(([x, y]) => ![x, y, 180 - x - y, x + y].some((z) => avoid.has(z))) ?? opts[0];
  return `For example, if two angles are ${a}° and ${b}°, the third is 180° − ${a}° − ${b}° = ${180 - a - b}°.`;
}

function leaks(text: string, p: SubjectProblem): boolean {
  const e = p.answer.value!;
  return new RegExp(`(?<![\\d.])${e}(?![\\d.])`).test(text);
}

export const geometry: SubjectModule = {
  id: "geometry",
  title: "Angles in a triangle",
  objective: "Find a missing angle using the fact that a triangle's angles add up to 180°, including right-angled and isosceles triangles.",
  makeProblems: makeGeometryProblems,
  read,
  verify,
  respond,
  hint,
  reveal,
  explain,
  example,
  leaks,
  vocabulary: { concepts: ["sum_180", "sum_360"], outcomes: [], topics: ["why_180", "isosceles", "right_angle", "angle"] },
  nextIntro: (next) => `Now one to try on your own. ${next.prompt}`,
  checkable: () => "I can check an angle in degrees, and statements like “the angles add up to 180”",
};
