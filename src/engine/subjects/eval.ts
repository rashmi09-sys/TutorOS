/**
 * Scripted-student scenarios for the geometry and physics lessons. The student is scripted; the tutor is the
 * real stepSubject() the lesson UI calls. Assertions check properties (verdicts, no early answer, one
 * question, the hint ladder), not exact wording.
 */
import type { TeachingModel } from "../llm/teacher";
import type { AssertionCategory, AssertionResult } from "../eval/scenarios";
import { computeMetrics, type ScenarioResult, type SuiteResult } from "../eval/runner";
import type { StudentEvent, TurnTrace } from "../types";
import { createSubjectSession, stepSubject } from "./kernel";
import { SUBJECTS } from "./index";
import type { SubjectLessonId, SubjectProblem, SubjectState } from "./types";
import { GENERIC_PRAISE, HUMOUR, languageProblems } from "../eval/language";

type Input = StudentEvent | ((s: SubjectState) => StudentEvent);
interface Turn {
  trace: TurnTrace;
  problem: SubjectProblem;
}
export interface SubjectScenario {
  id: string;
  lesson: SubjectLessonId;
  seed: number;
  title: string;
  why: string;
  inputs: Input[];
  check: (turns: Turn[], final: SubjectState) => AssertionResult[];
}

const t = (text: string, via: "keyboard" | "voice" = "keyboard"): StudentEvent => ({ type: "text", text, via });
const start: StudentEvent = { type: "start" };
const cur = (s: SubjectState) => s.problems[s.current];
/** Answer the current problem correctly (as a student who knows it would say it). */
const answer = (s: SubjectState): StudentEvent => {
  const p = cur(s);
  if (p.answer.outcome === "same_speed") return t("it keeps moving at the same speed");
  if (p.answer.outcome === "starts_moving") return t(`it starts moving to the ${p.answer.direction}`);
  if (p.answer.unit === "N") return t(`${p.answer.value} N to the ${p.answer.direction}`);
  return t(`${p.answer.value}`);
};

const at = (turns: Turn[], n: number) => turns.find((x) => x.trace.turn === n);
const rule = (turns: Turn[], n: number, prefixes: string[], category: AssertionCategory = "appropriateness"): AssertionResult => {
  const x = at(turns, n);
  return { name: `turn ${n}: ${prefixes.join(" or ")}`, category, passed: !!x && prefixes.some((p) => x.trace.decision.rule.startsWith(p)), detail: x ? `got ${x.trace.decision.rule}: "${x.trace.utterance}"` : "turn missing" };
};
const verdict = (turns: Turn[], n: number, v: string, mis?: string): AssertionResult => {
  const x = at(turns, n)?.trace.subjectCheck;
  return { name: `turn ${n}: verifier says ${v}${mis ? ` (${mis})` : ""}`, category: mis ? "diagnosis" : "math", passed: x?.verdict === v && (!mis || x.misconception?.id === mis), detail: x ? `${x.verdict} ${x.misconception?.id ?? ""} — ${x.detail}` : "no check" };
};
const noLeak = (turns: Turn[]): AssertionResult => {
  for (const { trace, problem } of turns) {
    if (!trace.decision.revealAllowed && SUBJECTS[trace.lesson as SubjectLessonId].leaks(trace.utterance, problem)) return { name: "no premature answer leak", category: "leak", passed: false, detail: `Turn ${trace.turn} (${trace.decision.rule}) stated the answer: "${trace.utterance}"` };
  }
  return { name: "no premature answer leak", category: "leak", passed: true, detail: "No turn stated the answer before it was earned." };
};
const oneQuestion = (turns: Turn[], n: number): AssertionResult => {
  const x = at(turns, n);
  const q = x ? (x.trace.utterance.match(/\?/g) ?? []).length : 0;
  return { name: `turn ${n} asks one question`, category: "appropriateness", passed: q === 1, detail: x ? `${q}: "${x.trace.utterance}"` : "turn missing" };
};
const stage = (turns: Turn[], n: number, st: string): AssertionResult => {
  const x = at(turns, n);
  return { name: `turn ${n} is a ${st} move`, category: "appropriateness", passed: x?.trace.decision.stage === st, detail: x ? `${x.trace.decision.rule} ${x.trace.decision.stage ?? "—"}` : "turn missing" };
};
const distinct = (turns: Turn[]): AssertionResult => {
  for (let i = 1; i < turns.length; i++) if (turns[i].trace.utterance === turns[i - 1].trace.utterance && !turns[i].trace.decision.rule.startsWith("S_REPEAT")) return { name: "never repeats the same reply", category: "recovery", passed: false, detail: `turns ${turns[i - 1].trace.turn} and ${turns[i].trace.turn}` };
  return { name: "never repeats the same reply", category: "recovery", passed: true, detail: "All replies differ." };
};
const noAttempt = (s: SubjectState): AssertionResult => ({ name: "not counted as an attempt", category: "robustness", passed: s.attempts === 0, detail: `attempts ${s.attempts}` });
const says = (turns: Turn[], n: number, re: RegExp, name: string, category: AssertionCategory = "appropriateness"): AssertionResult => {
  const x = at(turns, n);
  return { name, category, passed: !!x && re.test(x.trace.utterance), detail: x ? `"${x.trace.utterance}"` : "turn missing" };
};

/** The first seed whose transfer problem (the third question) is of this kind — so scenarios don't depend on generator internals. */
function seedFor(lesson: SubjectLessonId, kind: string): number {
  for (let seed = 1; seed < 500; seed++) if (SUBJECTS[lesson].makeProblems(seed)[2].kind === kind) return seed;
  throw new Error(`no seed gives a ${kind} transfer problem`);
}
const strategiesDiffer = (turns: Turn[], from: number, to: number): AssertionResult => {
  const used = turns.filter((x) => x.trace.turn >= from && x.trace.turn <= to).map((x) => x.trace.decision.strategy ?? x.trace.decision.rule);
  return { name: `turns ${from}–${to}: a different approach each time`, category: "recovery", passed: new Set(used).size === used.length, detail: used.join(" → ") };
};

const language = (turns: Turn[]): AssertionResult => {
  const bad = turns.flatMap((x) => [...languageProblems(x.trace.utterance), ...(GENERIC_PRAISE.test(x.trace.utterance) ? ["stock praise"] : [])].map((p) => `turn ${x.trace.turn}: ${p}`));
  return { name: "age-appropriate, specific language", category: "language", passed: bad.length === 0, detail: bad.join("; ") || "All replies pass the language rules." };
};
const noRepeatAtAll = (turns: Turn[]): AssertionResult => {
  const seen = new Map<string, number>();
  for (const x of turns) {
    if (x.trace.decision.rule.startsWith("S_REPEAT")) continue;
    const k = `${x.problem.id}|${x.trace.utterance}`;
    if (seen.has(k)) return { name: "never says the same thing twice on one question", category: "repetition", passed: false, detail: `turns ${seen.get(k)} and ${x.trace.turn}` };
    seen.set(k, x.trace.turn);
  }
  return { name: "never says the same thing twice on one question", category: "repetition", passed: true, detail: "All different." };
};
const action = (turns: Turn[], n: number, a: string): AssertionResult => {
  const x = at(turns, n);
  return { name: `turn ${n}: ${a}`, category: "appropriateness", passed: x?.trace.decision.action === a, detail: x ? `${x.trace.decision.action} ${x.trace.decision.rule}: "${x.trace.utterance}"` : "turn missing" };
};

export const SUBJECT_SCENARIOS: SubjectScenario[] = [
  /* ---------------- Geometry ---------------- */
  { id: "g-correct", lesson: "geometry", seed: 1, title: "Gives the missing angle straight away", why: "A correct answer is confirmed with the computed reason, then a fresh problem follows.", inputs: [start, t("75")], check: (x, s) => [verdict(x, 2, "correct"), rule(x, 2, ["G_CORRECT"]), { name: "moves on to a check", category: "mastery", passed: s.current === 1 && s.phase === "TRANSFER", detail: `current ${s.current}, ${s.phase}` }] },
  { id: "g-added-given", lesson: "geometry", seed: 1, title: "Adds the two given angles (105°)", why: "The most common first step mistake: keep the useful part, ask for the remainder of 180° — without giving it.", inputs: [start, t("105")], check: (x) => [verdict(x, 2, "incorrect", "ADDED_GIVEN"), oneQuestion(x, 2), noLeak(x)] },
  { id: "g-sum-360", lesson: "geometry", seed: 1, title: "Uses 360° (255°)", why: "Confuses the triangle sum with a full turn.", inputs: [start, t("360 - 105 = 255")], check: (x) => [verdict(x, 2, "incorrect", "SUM_360"), says(x, 2, /180°/, "states the correct angle sum"), noLeak(x)] },
  { id: "g-arith-slip", lesson: "geometry", seed: 1, title: "Right method, wrong subtraction (180 − 65 − 40 = 74)", why: "The calculation is re-checked exactly; the tutor points at the line instead of re-teaching the method.", inputs: [start, t("180 - 65 - 40 = 74")], check: (x) => [verdict(x, 2, "incorrect", "ARITHMETIC_SLIP"), says(x, 2, /method is right/i, "says the method is right"), noLeak(x)] },
  { id: "g-ladder", lesson: "geometry", seed: 1, title: "\"I'm stuck\" four times", why: "Each time, a different way in: a smaller question (NOTICE), an analogy, the picture, then the first part worked (TRY) — never the answer.", inputs: [start, t("I'm stuck"), t("I'm stuck"), t("I'm stuck"), t("I'm stuck")], check: (x) => [stage(x, 2, "NOTICE"), stage(x, 3, "THINK"), rule(x, 4, ["S_HELP_VISUAL"]), stage(x, 5, "TRY"), strategiesDiffer(x, 2, 5), noLeak(x), distinct(x)] },
  { id: "g-reveal-after-effort", lesson: "geometry", seed: 1, title: "Worked solution only after real effort", why: "Endless hints frustrate; a worked solution comes after attempts and every other approach, and the next problem is still required.", inputs: [start, t("20"), t("30"), t("I'm stuck"), t("I'm stuck"), t("I'm stuck"), t("I'm stuck"), t("I'm stuck")], check: (x, s) => [rule(x, 3, ["G_UNEXPLAINED"], "recovery"), strategiesDiffer(x, 4, 7), rule(x, 8, ["S_HELP_REVEAL"], "recovery"), noLeak(x), { name: "the revealed problem is not counted as solved alone", category: "mastery", passed: s.records[0].revealed && !s.records[0].alone, detail: JSON.stringify(s.records[0]) }] },
  { id: "g-no-reveal", lesson: "geometry", seed: 1, title: "\"Don't tell me the answer\", then lots of help", why: "The student's choice holds: hints stop before the worked solution.", inputs: [start, t("Don't tell me the answer"), t("I'm stuck"), t("I'm stuck"), t("I'm stuck"), t("12"), t("13"), t("I'm stuck"), t("I'm stuck")], check: (x, s) => [{ name: "never reveals", category: "leak", passed: !s.records[0].revealed && x.every((y) => !y.trace.decision.revealAllowed), detail: x.map((y) => y.trace.decision.rule).join(", ") }, noLeak(x)] },
  { id: "g-why-180", lesson: "geometry", seed: 1, title: "\"Why is it 180?\"", why: "A question about the idea gets a direct answer about the idea, then the problem back.", inputs: [start, t("Why is it 180?")], check: (x, s) => [rule(x, 2, ["S_CONCEPT_WHY_180"]), noLeak(x), noAttempt(s), oneQuestion(x, 2)] },
  { id: "g-concept-claim", lesson: "geometry", seed: 1, title: "\"The angles add up to 180\" (no answer yet)", why: "A true statement of the key idea is confirmed and turned into the next question; nothing is marked wrong.", inputs: [start, t("the angles add up to 180")], check: (x, s) => [verdict(x, 2, "correct"), rule(x, 2, ["G_CONCEPT_RIGHT"]), noAttempt(s), noLeak(x)] },
  { id: "g-spoken", lesson: "geometry", seed: 1, title: "Spoken: \"seventy five degrees\"", why: "Number words are read exactly.", inputs: [start, t("seventy five degrees", "voice")], check: (x) => [verdict(x, 2, "correct")] },
  { id: "g-unclear", lesson: "geometry", seed: 1, title: "Something the rules can't read", why: "Without a model, the tutor says what it can check and asks again — it doesn't guess.", inputs: [start, t("purple monkey dishwasher")], check: (x, s) => [rule(x, 2, ["S_CLARIFY", "S_REDIRECT"]), says(x, 2, /I can check/, "says what it can check"), noAttempt(s)] },
  { id: "g-right-forgot", lesson: "geometry", seed: seedFor("geometry", "right"), title: "Right-angled triangle: forgets the 90°", why: "Recognises a specific mistake on a different question type (the transfer problem).", inputs: [start, t("75"), answer, (s) => t(String(180 - Number(cur(s).data.a)))], check: (x) => [verdict(x, 4, "incorrect", "FORGOT_RIGHT_ANGLE"), noLeak(x)] },
  { id: "g-isosceles-halve", lesson: "geometry", seed: seedFor("geometry", "isosceles-base"), title: "Isosceles: forgets to halve", why: "Finds what the base angles share but not each one.", inputs: [start, t("75"), answer, (s) => t(String(180 - Number(cur(s).data.p)))], check: (x) => [verdict(x, 4, "incorrect", "FORGOT_HALVE"), noLeak(x)] },
  { id: "g-complete", lesson: "geometry", seed: 2, title: "Whole lesson, solved without hints", why: "Two checks solved without hints are recorded as such; the lesson ends.", inputs: [start, answer, answer, answer], check: (_x, s) => [{ name: "lesson complete, both checks without hints", category: "mastery", passed: s.phase === "COMPLETE" && s.records.filter((r) => r.alone).length === 2, detail: JSON.stringify(s.records) }] },
  /* ---------------- Physics ---------------- */
  { id: "p-correct", lesson: "physics", seed: 1, title: "Net force with direction", why: "Size and direction are both checked.", inputs: [start, t("4 N to the right")], check: (x) => [verdict(x, 2, "correct"), rule(x, 2, ["P_CORRECT"])] },
  { id: "p-no-direction", lesson: "physics", seed: 1, title: "\"4\" then \"to the right\"", why: "A right size without a direction is partly right; the follow-up direction completes it.", inputs: [start, t("4"), t("to the right")], check: (x) => [verdict(x, 2, "partial", "NO_DIRECTION"), verdict(x, 3, "correct"), noLeak(x)] },
  { id: "p-added", lesson: "physics", seed: 1, title: "Adds opposite forces (20 N)", why: "Opposite forces subtract; say why, don't give the result.", inputs: [start, t("20 N")], check: (x) => [verdict(x, 2, "incorrect", "ADDED_OPPOSING"), oneQuestion(x, 2), noLeak(x)] },
  { id: "p-called-balanced", lesson: "physics", seed: 1, title: "\"It's balanced\" when it isn't", why: "Only equal opposite forces cancel completely.", inputs: [start, t("they cancel out")], check: (x) => [verdict(x, 2, "incorrect", "CALLED_BALANCED"), noLeak(x)] },
  { id: "p-ladder", lesson: "physics", seed: 1, title: "\"I'm stuck\" three times", why: "A different way in each time — the tug-of-war question, the arrows to tap, then the first part worked — and no answer.", inputs: [start, t("I'm stuck"), t("I'm stuck"), t("I'm stuck")], check: (x) => [stage(x, 2, "NOTICE"), rule(x, 3, ["S_HELP_VISUAL"]), stage(x, 4, "TRY"), strategiesDiffer(x, 2, 4), noLeak(x), distinct(x)] },
  { id: "p-tug-of-war", lesson: "physics", seed: 1, title: "\"I don't know\" → tug-of-war → taps the stronger arrow → how much stronger", why: "Repeated confusion is answered with a smaller question and the picture; the student's tap answers the sub-question, and they finish the problem themselves.", inputs: [start, t("I don't know"), t("Still don't know"), t("the push to the right"), t("4")], check: (x, s) => [rule(x, 2, ["S_HELP_SIMPLIFY"]), rule(x, 3, ["S_HELP_VISUAL"]), rule(x, 4, ["P_SUB_RIGHT"]), says(x, 4, /stronger/, "confirms the stronger side specifically"), rule(x, 5, ["P_SUB_SOLVED"]), noLeak(x), { name: "solved with help: not counted as independent", category: "mastery", passed: s.records[0].solved && !s.records[0].alone, detail: JSON.stringify(s.records[0]) }] },
  { id: "p-motion-needs-force", lesson: "physics", seed: seedFor("physics", "balanced-moving"), title: "Balanced forces on a moving trolley: \"it slows down\"", why: "The classic misconception: name friction as the hidden force, and don't give the answer.", inputs: [start, answer, answer, t("it slows down")], check: (x) => [verdict(x, 4, "incorrect", "MOTION_NEEDS_FORCE"), says(x, 4, /friction/i, "names friction"), noLeak(x)] },
  { id: "p-bounded", lesson: "physics", seed: seedFor("physics", "balanced-moving"), title: "An answer outside the closed outcome list", why: "Conceptual checks are bounded: the tutor says what it can check instead of judging.", inputs: [start, answer, answer, t("it turns into a rocket")], check: (x, s) => [rule(x, 4, ["S_CLARIFY", "S_REDIRECT", "P_BOUNDED_CHECK"]), says(x, 4, /speeds up/, "lists the outcomes it can check"), noAttempt(s)] },
  { id: "p-unbalanced", lesson: "physics", seed: seedFor("physics", "unbalanced-rest"), title: "Box at rest, unbalanced: stays → moves → which way", why: "Each part is checked: whether it moves, then the direction.", inputs: [start, answer, answer, t("it doesn't move"), t("it moves"), (s) => t(String(cur(s).answer.direction))], check: (x) => [verdict(x, 4, "incorrect", "UNBALANCED_STAYS"), verdict(x, 5, "partial", "NO_DIRECTION"), verdict(x, 6, "correct"), noLeak(x)] },
  { id: "p-why", lesson: "physics", seed: 1, title: "\"Why?\"", why: "Explains the idea without the result.", inputs: [start, t("why?")], check: (x, s) => [rule(x, 2, ["S_WHY"]), noLeak(x), noAttempt(s)] },
  { id: "p-spoken", lesson: "physics", seed: 1, title: "Spoken: \"four newtons to the right\"", why: "Number words and units are read exactly.", inputs: [start, t("four newtons to the right", "voice")], check: (x) => [verdict(x, 2, "correct")] },
  { id: "p-complete", lesson: "physics", seed: 3, title: "Whole lesson, solved without hints", why: "The lesson ends with honest records.", inputs: [start, answer, answer, answer], check: (_x, s) => [{ name: "lesson complete, both checks without hints", category: "mastery", passed: s.phase === "COMPLETE" && s.records.filter((r) => r.alone).length === 2, detail: JSON.stringify(s.records) }] },
  /* ---------------- v6: teaching behaviour ---------------- */
  { id: "p-dont-know-four", lesson: "physics", seed: 1, title: "\"I don't know\" four times", why: "Tug-of-war question → tap the stronger arrow → the first part worked → (after real effort) the working — a different approach each time, never repeated.", inputs: [start, t("I don't know"), t("I don't know"), t("I don't know"), t("I don't know")], check: (x) => [action(x, 3, "VISUALIZE"), strategiesDiffer(x, 2, 5), noRepeatAtAll(x), noLeak(x), language(x)] },
  { id: "g-dont-know-four", lesson: "geometry", seed: 1, title: "\"I don't know\" four times", why: "Smaller question → pizza analogy → light up the known angles → first part worked.", inputs: [start, t("I don't know"), t("I don't know"), t("I don't know"), t("I don't know")], check: (x) => [action(x, 3, "RETEACH"), action(x, 4, "VISUALIZE"), strategiesDiffer(x, 2, 5), noRepeatAtAll(x), noLeak(x), language(x)] },
  { id: "g-sub-question", lesson: "geometry", seed: 1, title: "\"I don't know\" → \"105\" answers the tutor's smaller question", why: "105° is a mistake as a final answer, but it's the right answer to \"what do the two known angles add up to?\" — read in context.", inputs: [start, t("I don't know"), t("105"), t("75")], check: (x, s) => [rule(x, 3, ["G_SUB_RIGHT"]), { name: "105 isn't counted as a wrong attempt", category: "context", passed: s.records[0].attempts === 0, detail: JSON.stringify(s.records[0]) }, verdict(x, 4, "correct"), noLeak(x)] },
  { id: "g-feelings", lesson: "geometry", seed: 1, title: "\"I hate geometry\", then \"I'm scared I'll get it wrong\"", why: "A short acknowledgement (humour only about the subject), then the question back; worry gets reassurance and a smaller step, no jokes.", inputs: [start, t("I hate geometry"), t("I'm scared I'll get it wrong")], check: (x) => [action(x, 2, "ENCOURAGE"), oneQuestion(x, 2), { name: "turn 3: no jokes for a worried student", category: "language", passed: !HUMOUR.test(at(x, 3)?.trace.utterance ?? ""), detail: at(x, 3)?.trace.utterance ?? "" }, rule(x, 3, ["S_HELP"]), language(x), noLeak(x)] },
  { id: "p-answer-request", lesson: "physics", seed: 1, title: "\"Just tell me the answer\"", why: "Acknowledged honestly, then a smaller question — no answer yet.", inputs: [start, t("just tell me the answer")], check: (x) => [says(x, 2, /could just tell you/i, "acknowledges the request", "context"), oneQuestion(x, 2), noLeak(x)] },
  { id: "p-off-topic-honest", lesson: "physics", seed: 1, title: "\"What's your favourite food?\"", why: "Doesn't pretend to be a person; says it's an AI tutor for this lesson and asks the question again.", inputs: [start, t("what's your favourite food?")], check: (x, s) => [rule(x, 2, ["S_REDIRECT"]), says(x, 2, /AI tutor/, "says it's an AI tutor", "language"), noAttempt(s), language(x)] },
  { id: "p-thinking", lesson: "physics", seed: 1, title: "\"Give me a sec\"", why: "An explicit signal to wait: no new question, no help counted.", inputs: [start, t("give me a sec")], check: (x, s) => [action(x, 2, "WAIT"), { name: "doesn't push a question", category: "appropriateness", passed: !/\?/.test(at(x, 2)?.trace.utterance ?? "?"), detail: at(x, 2)?.trace.utterance ?? "" }, noAttempt(s)] },
];

export async function runSubjectScenario(sc: SubjectScenario, teacher: TeachingModel): Promise<ScenarioResult> {
  const mod = SUBJECTS[sc.lesson];
  let s = createSubjectSession(mod, { sessionId: `eval-${sc.id}`, seed: sc.seed });
  const turns: Turn[] = [];
  try {
    for (const input of sc.inputs) {
      const ev = typeof input === "function" ? input(s) : input;
      const problem = cur(s) ?? s.problems[s.problems.length - 1];
      const r = await stepSubject(mod, s, ev, { teacher, requestId: `eval-${sc.id}-${turns.length + 1}` });
      s = r.state;
      turns.push({ trace: r.trace, problem });
    }
    const assertions = sc.check(turns, s);
    return { id: sc.id, title: sc.title, why: sc.why, passed: assertions.every((a) => a.passed), assertions, traces: turns.map((x) => x.trace), turns: turns.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { id: sc.id, title: sc.title, why: sc.why, passed: false, assertions: [{ name: "scenario ran without exceptions", category: "robustness", passed: false, detail: msg }], traces: turns.map((x) => x.trace), turns: turns.length, error: msg };
  }
}

export async function runSubjectSuite(lesson: SubjectLessonId, teacher: TeachingModel): Promise<SuiteResult> {
  const t0 = performance.now();
  const startedAt = new Date().toISOString();
  const results: ScenarioResult[] = [];
  for (const sc of SUBJECT_SCENARIOS.filter((x) => x.lesson === lesson)) results.push(await runSubjectScenario(sc, teacher));
  const metrics = computeMetrics(results);
  return {
    runId: `run_${lesson}_${Date.now().toString(36)}`,
    startedAt,
    label: `${lesson} · ${teacher.mode}`,
    teacher: teacher.name,
    mode: teacher.mode,
    policy: "tutor-v1",
    durationMs: Math.round(performance.now() - t0),
    metrics,
    results,
    passed: metrics.scenarios.passed,
    total: metrics.scenarios.total,
    assertionsPassed: metrics.assertions.passed,
    assertionsTotal: metrics.assertions.total,
  };
}
