import { Fraction } from "./fraction";
import { NUMBER_WORDS, isSolvedForm, normalizeMath, parseAnswer, parseEquation, parseExpression, type Equation } from "./algebra";
import { interpretDeterministic, type MeaningContext, type StudentMeaning } from "./understand";
import type { Normal } from "./misconceptions";
import { readAffect, type AffectKind } from "./affect";

/**
 * Deterministic first-pass understanding of a student utterance.
 *
 * Maths is extracted clause by clause and parsed exactly. Questions, confusion,
 * disputes and malformed maths are recognised explicitly so the tutor responds
 * to what the student actually said. Only genuinely free-text reasoning is ever
 * sent to an LLM classifier.
 */
export type IntentKind =
  | "ANSWER" // "x = 5", "5", "is it 5?"
  | "STEP" // "3x = 15"
  | "HELP_REQUEST" // "just tell me", "I don't know"
  | "CONFUSED" // "I'm confused", "I don't get it"
  | "CONCEPT_QUESTION" // "why do we subtract 5?", "can we divide first?"
  | "ARITHMETIC_QUESTION" // "what is 20 minus 5?"
  | "DISPUTE" // "I think your answer is wrong"
  | "MALFORMED_MATH" // "3x + = 20"
  | "REPEAT_REQUEST" // "what?", "say that again"
  | "REPHRASE_REQUEST" // "explain it another way", "can you explain that again?"
  | "EXAMPLE_REQUEST" // "can you show me a small example?"
  | "SLOWER_REQUEST" // "can we go slower?"
  | "NO_ANSWER_PREFERENCE" // "don't tell me the answer"
  | "WHY_QUESTION" // a bare "why?" — about the tutor's last move
  | "ACKNOWLEDGE" // "ok", "got it"
  | "OPERATION" // a move described in words: "take five away", "I'll do BODMAS multiplication", "can we divide by 3?"
  | "EXPLANATION" // "I added 3 and 5"
  | "AMBIGUOUS" // short, not maths, not a known request: ask one clarifying question
  | "OFF_TOPIC"
  | "AFFECT" // "I hate algebra", "this is boring", "lol" — how they feel, not a maths move or a request
  | "THINKING" // "let me think", "give me a sec" — an explicit signal to wait
  | "EMPTY";

/** What kind of help the student asked for, in their own words (deterministic phrase rules below). */
export type HelpRequest = "stuck" | "answer" | "hint" | "next" | "more_help" | "confused" | "rephrase" | "example" | "slower" | "no_answer" | "why" | "ack" | "thinking";

export interface PhraseRule {
  id: string;
  kind: IntentKind;
  request: HelpRequest;
  re: RegExp;
  /** Phrases this rule must recognise — also the unit-test fixture and the documented list. */
  examples: string[];
}

/**
 * Everyday phrases → teaching requests. Explicit, ordered, testable rules: the first match wins.
 * This is phrase matching, not open-ended understanding — anything it doesn't cover falls through to
 * AMBIGUOUS (one clarifying question) or OFF_TOPIC, and, only when an LLM is configured, to the model's
 * enum-constrained interpretation.
 */
export const PHRASE_RULES: PhraseRule[] = [
  {
    id: "P_NO_ANSWER",
    kind: "NO_ANSWER_PREFERENCE",
    request: "no_answer",
    re: /(don'?t|do not|dont|never) (just )?(tell|give|show) me (the )?(answer|solution)|let me (try|do it|work it out|figure it out|solve it)( myself| on my own| alone)?|i want to (try|do it|figure it out|solve it)( myself| on my own| alone)|no spoilers/,
    examples: ["Don't tell me the answer", "Please don't give me the answer", "Let me try it myself", "No spoilers!"],
  },
  {
    id: "P_REPHRASE",
    kind: "REPHRASE_REQUEST",
    request: "rephrase",
    re: /(explain|say|put|show) (it |that |this )?(in )?(another|a different|some other|other) way|explain (it |that |this )?(differently|again|more simply|simpler|slowly)|say (it |that |this )?(differently|more simply|simpler)|(a |in a )?different way|(can|could|would) you explain (it|that|this)( one more time| again)|i still don'?t (get|understand)( it| that| this)?|in (simpler|easier|other) words|explain differently/,
    examples: ["Can you explain that again?", "Explain it another way", "Explain differently", "Say it more simply", "I still don't get it", "In other words?"],
  },
  {
    id: "P_EXAMPLE",
    kind: "EXAMPLE_REQUEST",
    request: "example",
    re: /\bexample\b|show me (one|how)( first)?\b|(an?|one) (easier|simpler|smaller|similar) (one|problem|equation|question)|show me a similar/,
    examples: ["Can you show me a small example?", "Give me an example", "Show me an easier one first", "Show me how"],
  },
  {
    id: "P_SLOWER",
    kind: "SLOWER_REQUEST",
    request: "slower",
    re: /slow(er| down)|too fast|step by step|one (step|thing|bit) at a time|smaller steps?|more slowly/,
    examples: ["Can we go slower?", "Slow down please", "That's too fast", "One step at a time"],
  },
  {
    id: "P_NEXT",
    kind: "HELP_REQUEST",
    request: "next",
    re: /what (do|should|can|would) i do (next|now)|what('s| is) (the )?next( step| move)?|what now|now what|what do i do\b|what should i do\b|where do i go from here/,
    examples: ["What do I do next?", "What's the next step?", "Now what?", "What should I do?"],
  },
  {
    id: "P_HINT",
    kind: "HELP_REQUEST",
    request: "hint",
    re: /\bhint\b|\bclue\b|\bnudge\b/,
    examples: ["Give me a hint", "Small hint", "Can I have a clue?", "Just a nudge"],
  },
  {
    id: "P_THINKING",
    kind: "THINKING",
    request: "thinking",
    re: /^(?!.*\b(why|how come)\b)(ok(ay)?,? |hmm+,? |wait,? |um+,? )?(let me think|give me a (sec|second|minute|moment)|one (sec|second|moment|minute)|hold on|hang on|i'?m (still )?(thinking|working (on )?it)|let me (work|figure) (it|this) out( first)?|thinking)\b/,
    examples: ["Let me think", "Give me a sec", "Hold on, I'm working on it", "I'm still thinking"],
  },
  {
    id: "P_ANSWER",
    kind: "HELP_REQUEST",
    request: "answer",
    re: /just (tell|give|show) me|(tell|give|show) me (the )?(answer|solution)|what('s| is) the answer|what'?s x\b|whats x\b|what does x (equal|=|come to|work out)|what is x (equal|=)|(tell|give|show) me (what )?x\b|x (equals|is|=) what/,
    examples: ["Just tell me the answer", "What's x?", "Give me the answer", "What does x equal?"],
  },
  {
    id: "P_STUCK",
    kind: "HELP_REQUEST",
    request: "stuck",
    re: /i'?m stuck|\bstuck\b|\b(i|still) (really |still )?don'?t know|^don'?t know|\bidk\b|no idea|i give up|can'?t do (it|this)|(tell|give|show) me how|how do (i|we) (start|begin|do (this|it|that))|where (do|should|can) (i|we) start|what('s| is) the first (step|thing)/,
    examples: ["I'm stuck", "I don't know", "I give up", "How do I start?", "Still don't know"],
  },
  {
    id: "P_MORE_HELP",
    kind: "HELP_REQUEST",
    request: "more_help",
    re: /(need|want) (more|some|a bit of|a little|extra) help|more help|help me|\bhelp\b/,
    examples: ["I need more help", "Help me", "Help please"],
  },
  {
    id: "P_CONFUSED",
    kind: "CONFUSED",
    request: "confused",
    re: /confus|don'?t (understand|get it|get this|get what|get that)|i'?m lost|(makes|make) no sense|doesn'?t make (any )?sense|what am i supposed to|i don'?t get/,
    examples: ["I'm confused", "I don't get it", "I don't understand", "This makes no sense", "I'm lost"],
  },
  {
    id: "P_WHY",
    kind: "WHY_QUESTION",
    request: "why",
    re: /^((but|and|ok(ay)?|so|um+|wait|hmm+|hold on|sorry)[,.!]? )*(why|how come)( though| is that| that| not)?\s*[?!.]*$|why (did|do) (you|we) do that|why does (that|this|it) work|why (is|was) that (right|true)/,
    examples: ["Why?", "But why?", "How come?", "Why did you do that?", "Why does that work?"],
  },
  {
    id: "P_ACK",
    kind: "ACKNOWLEDGE",
    request: "ack",
    re: /^(ok(ay)?|k|yes|yeah|yep|yup|sure|got it|i see|oh|oh i see|ah|alright|all right|right|cool|thanks|thank you|ready|let'?s go|i'?ll try|i will try|okay i'?ll try)[.! ]*$/,
    examples: ["Okay", "Got it", "Yes", "I'll try"],
  },
];

export function matchPhrase(t: string): PhraseRule | null {
  return PHRASE_RULES.find((r) => r.re.test(t)) ?? null;
}

export type ConceptTopic = "why_inverse_constant" | "why_divide" | "order" | "negatives" | "balance" | "what_is_x" | "check";

export interface Intent {
  kind: IntentKind;
  value?: string; // answer value as fraction string
  equation?: { raw: string };
  topic?: ConceptTopic;
  tentative?: boolean; // "is it 5?"
  /** Other maths the student stated alongside the answer/step (their reasoning), checked deterministically. */
  claims: string[];
  insistent: boolean;
  frustrated: boolean;
  question: boolean;
  mathSegment?: string;
  /** Help the student asked for in everyday words, and which phrase rule recognised it. */
  request?: HelpRequest;
  phraseRule?: string;
  /** How this intent was recognised. "llm" only when a configured model interpreted the text. */
  recognisedBy?: "maths parser" | "phrase rule" | "concept rule" | "operation lexicon" | "fallback" | "llm";
  /** Structured meaning of a move described in words (OPERATION intents). */
  meaning?: StudentMeaning;
  /** The message stops mid-sentence ("I think we…") — probably cut off. */
  incomplete?: boolean;
  /** How the student said they feel, if they did (see affect.ts). Travels with any intent. */
  affect?: AffectKind;
}

export const REPEAT = /^(what\??|huh\??|sorry\??|pardon\??|eh\??)$|repeat|say (that|it) again|didn'?t (hear|catch)|one more time|^(can we |let'?s |please )?go back\b|previous question|what was the question|ask (me )?(that|the question) again/;
const INSIST = /i'?m sure|i am sure|definitely|i'?m right|i am right|it'?s right|that'?s right|must be|no,? it'?s|trust me|i know it'?s|pretty sure/;
export const FRUSTRATED = /just tell|ugh|boring|hate|annoy|give up|so hard|too hard|whatever/;
const DISPUTE = /(your|the|that) (answer|step|hint|working|math|maths|sum) (is|was|looks|seems) (wrong|incorrect|not right|off)|you('re| are) wrong|you made a mistake|you got it wrong|that'?s (wrong|not right|incorrect)(?! answer)|i think you('re| are) (wrong|mistaken)|i think your .* (is|was) wrong|you'?re lying/;
const QUESTION_START = /^(why|how|what|when|where|which|who|can|could|should|would|is|are|do|does|did|will|whats|what's)\b/;
const REASONING = /\b(because|i did|i added|i subtract|i took|i multipl|i divid|first i|then i|so i|i moved|i used|i put|i made|i just)\b/;
const EXPLAIN_MARKERS = /\b(because|i did|i added|i subtract|i took|i multipl|i divid|first i|then i|so i|i moved|i used|i put|i made|i just|i think|i thought|i got)\b/;

const TOPICS: Array<[ConceptTopic, RegExp]> = [
  ["negatives", /negative|minus numbers|below zero|less than zero/],
  ["order", /(divide|division|dividing) first|can (we|i|you) (divide|split)|(subtract|take away|minus|subtracting) first|which (one )?(first|do (i|we) do first|comes first)|what order|does (the )?order matter|in what order/],
  ["why_inverse_constant", /why (do|did|would|should|must) (we|you|i) (subtract|take away|minus|add|plus|remove|get rid)|why (subtract|take away|minus|add|remove)|why (is|does) it (subtract|minus)/],
  ["why_divide", /why (do|did|would|should|must) (we|you|i) (divide|share|split)|why divide/],
  ["check", /how (do|can|would|will) (i|we|you) (check|know|test|be sure)|is there a way to check|how to check/],
  ["what_is_x", /what (is|does) x (mean|stand for|even mean)\b|^what is x\s*\??$|what('s| is) a variable|why (is there|do we have|is there an) (an )?x|what is the letter/],
  ["balance", /both sides|equal(s)? sign|what does (the )?= mean|why (do|does) .* same .* side|balance/],
];

function isQuestion(t: string) {
  return /\?\s*$/.test(t) || QUESTION_START.test(t);
}

interface Claim {
  raw: string;
  eq: Equation | null;
  hasX: boolean;
}

/** Split an utterance into clauses and pull out every maths fragment. */
export function extractClaims(text: string): Claim[] {
  let s = normalizeMath(text);
  s = s.replace(/\b(it'?s|it is|that'?s)\b/g, " ").replace(/\b(is|equals?|makes|gives)\b/g, "=");
  const clauses = s.split(/\b(?:because|since|so|and|then|but|after|cause|coz|cuz|which)\b|[,;:!?\n]|\.(?!\d)/);
  const out: Claim[] = [];
  for (const clause of clauses) {
    const cleaned = clause.replace(/[a-z']{2,}/g, " | ");
    for (const seg0 of cleaned.match(/[0-9x=+\-*/(). ]+/g) ?? []) {
      const seg = seg0.trim().replace(/^[=+*/. ]+|[=+\-*/ ]+$/g, "").trim();
      if (!/[0-9]/.test(seg) && !/\bx\b|\dx/.test(seg)) continue;
      if (!/[0-9x]/.test(seg)) continue;
      out.push({ raw: seg, eq: seg.includes("=") ? parseEquation(seg) : null, hasX: /x/.test(seg) });
    }
  }
  return out;
}

/** Back-compat helper used by older callers: the single most answer-like maths segment. */
export function extractMath(text: string): string | null {
  const c = extractClaims(text);
  if (!c.length) return null;
  return (c.find((x) => x.eq && x.hasX) ?? c.find((x) => x.eq) ?? c[0]).raw;
}

/** Does this look like an attempt at writing maths (so a parse failure is "malformed", not "off-topic")? */
function looksLikeMath(t: string) {
  const symbols = (t.match(/[0-9x=+\-*/()]/g) ?? []).length;
  const letters = (t.replace(/\bx\b/g, "").match(/[a-z]/g) ?? []).length;
  return t.includes("=") || (symbols >= 3 && letters <= 3);
}

const phrase = (r: PhraseRule) => ({ kind: r.kind, request: r.request, phraseRule: r.id, recognisedBy: "phrase rule" as const });

export function classifyIntent(text: string, current?: Normal, cx: MeaningContext = {}): Intent {
  const i = classifyIntentInner(text, current, cx);
  const affect = readAffect(text);
  if (!affect) return i;
  // A feeling on its own ("I hate algebra", "lol") is its own kind of message; with maths, a move or a request in it,
  // the maths/request is handled and the feeling is acknowledged alongside.
  if (["AMBIGUOUS", "OFF_TOPIC", "EXPLANATION", "ACKNOWLEDGE"].includes(i.kind)) return { ...i, kind: "AFFECT", affect, recognisedBy: "phrase rule", phraseRule: `AFFECT_${affect}` };
  return { ...i, affect };
}

function classifyIntentInner(text: string, current?: Normal, cx: MeaningContext = {}): Intent {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[’‘]/g, "'");
  const base = { insistent: INSIST.test(t), frustrated: FRUSTRATED.test(t), question: isQuestion(t), claims: [] as string[] };
  if (!t) return { kind: "EMPTY", ...base, recognisedBy: "fallback" };
  // Requests about the explanation itself come first: "explain that again" is not "say that again".
  const early = TOPICS.some(([, re]) => re.test(t)) ? null : PHRASE_RULES.find((r) => ["P_NO_ANSWER", "P_REPHRASE"].includes(r.id) && r.re.test(t));
  if (early) return { ...base, ...phrase(early) };
  if (REPEAT.test(t)) return { kind: "REPEAT_REQUEST", ...base, recognisedBy: "phrase rule", phraseRule: "P_REPEAT" };
  if (DISPUTE.test(t)) return { kind: "DISPUTE", ...base, recognisedBy: "phrase rule", phraseRule: "P_DISPUTE" };

  // "is it 5?" / "x = 5?" — a tentative answer, still validated exactly.
  const tentative = t.match(/^(?:so |um+ |maybe )?(?:is it|is x|could it be|would it be|is the answer|x is|x =|x equals)\s*(-?[\d./]+|[a-z]+)\s*\??$/);
  if (tentative) {
    const v = parseAnswer(tentative[1]);
    if (v) return { kind: "ANSWER", value: v.toString(), tentative: true, ...base, mathSegment: `x = ${v}`, recognisedBy: "maths parser" };
  }

  const understandish = /don'?t (understand|get)|confus|explain|what does|what is|why|how|can (we|i)/.test(t);
  if (base.question || understandish) {
    for (const [topic, re] of TOPICS) if (re.test(t)) return { kind: "CONCEPT_QUESTION", topic, ...base, recognisedBy: "concept rule", phraseRule: `TOPIC_${topic}` };
  }

  // "the left one", "which one" — "one" as a pronoun is not the number 1.
  const tm = t.replace(/\b(the|this|that|which|left|right|other|each|every|any|some|first|last|next|a|an)\s+one\b/g, "$1 thing");
  const claims = extractClaims(tm);
  const xEqs = claims.filter((c) => c.eq && c.hasX);
  const solved = xEqs.filter((c) => isSolvedForm(c.eq!));
  const pick = solved.length ? solved[solved.length - 1] : xEqs.length ? xEqs[xEqs.length - 1] : null;
  const said = matchPhrase(t);
  if (pick) {
    const rest = claims.filter((c) => c !== pick).map((c) => c.raw);
    const v = isSolvedForm(pick.eq!);
    if (v) return { kind: "ANSWER", value: v.toString(), equation: { raw: pick.raw }, ...base, tentative: base.question, claims: rest, mathSegment: pick.raw, recognisedBy: "maths parser" };
    // "I'm stuck on 3x = 15" mentions a line; it isn't offering it as the next step.
    if (said && (said.kind === "HELP_REQUEST" || said.kind === "CONFUSED")) return { ...base, ...phrase(said), mathSegment: pick.raw };
    return { kind: "STEP", equation: { raw: pick.raw }, ...base, claims: rest, mathSegment: pick.raw, recognisedBy: "maths parser" };
  }

  // A move described in words ("take five away", "I'll do BODMAS multiplication", "no, I meant subtract").
  // Read against the current equation BEFORE the bare-number rule: "take five away" is not the answer 5.
  const meaning = current ? interpretDeterministic(text, current, cx) : null;
  if (meaning && (meaning.operation || !said)) return { kind: "OPERATION", ...base, meaning, question: meaning.isQuestion, recognisedBy: "operation lexicon", phraseRule: `OP_${meaning.act}` };

  // Everyday requests, before bare numbers ("explain it in 2 steps" isn't the answer 2).
  if (said) return { ...base, ...phrase(said) };

  // Cut off mid-sentence ("I think we", "so you"): ask them to finish rather than read it as reasoning.
  if (!t.includes("=") && t.split(/\s+/).length <= 6 && DANGLING.test(t)) return { kind: "AMBIGUOUS", ...base, incomplete: true, recognisedBy: "fallback" };

  // Pure arithmetic asked as a question: the student is asking us to compute — hand it back.
  const arith = claims.find((c) => !c.hasX && !c.eq && /[+\-*/]/.test(c.raw) && parseExpression(c.raw));
  if (arith && (base.question || /^(what|whats|what's|how much)/.test(t))) return { kind: "ARITHMETIC_QUESTION", ...base, mathSegment: arith.raw, recognisedBy: "maths parser" };

  // A bare number is an answer only if the utterance is short and not reasoning.
  if (claims.length && !REASONING.test(t) && !/\b(added|subtract|took|times|divid|multipl)/.test(t)) {
    const nums = claims.filter((c) => !c.hasX && !c.eq);
    const ans = nums.length === 1 ? parseAnswer(nums[0].raw) : null;
    const words = t.split(/\s+/).length;
    // Only answer-shaped words around the number ("I think it's 5", "the answer is 5?"). "Get the 3 away
    // from x" has one number too, but it describes something to do — that is not an answer of 3.
    const around = ans ? t.replace(nums[0].raw.toLowerCase(), " ").replace(/[^a-z' ]/g, " ").replace(/\b[a-z]+\b/g, (w) => (w in NUMBER_WORDS ? " " : w)) : "";
    const answerShaped = ANSWER_FILLER.test(around.trim());
    if (ans && answerShaped && (words <= 6 || /answer|x is|i think|got/.test(t))) {
      return { kind: "ANSWER", value: ans.toString(), ...base, tentative: base.question, claims: [], mathSegment: nums[0].raw, recognisedBy: "maths parser" };
    }
    if (ans && !answerShaped && words <= 8) return { kind: "AMBIGUOUS", ...base, recognisedBy: "fallback" };
  }

  if (looksLikeMath(tm) && !claims.some((c) => c.eq)) return { kind: "MALFORMED_MATH", ...base, mathSegment: text.trim(), recognisedBy: "maths parser" };
  if (EXPLAIN_MARKERS.test(t) || (claims.length && !base.question)) return { kind: "EXPLANATION", ...base, claims: claims.map((c) => c.raw), recognisedBy: "fallback" };
  // Short and unclear ("hmm", "the left one", "no"): ask, don't guess. Real questions about other things are off-topic.
  const words = t.split(/\s+/).filter(Boolean).length;
  if (!base.question && words <= 4) return { kind: "AMBIGUOUS", ...base, recognisedBy: "fallback" };
  return { kind: "OFF_TOPIC", ...base, recognisedBy: "fallback" };
}

export const DANGLING = /\b(we|i|you|the|a|an|to|and|so|then|from|by|of|with|should|would|could|will|can|need|have|minus|plus|times|because|but|if|is)\s*(\.\.\.|…|-|—)?\s*$/;
const ANSWER_FILLER = /^(?:(?:i|i'?m|think|thought|it'?s|its|it|is|was|the|answer|final|my|x|maybe|perhaps|um+|uh+|er+|erm|so|then|got|get|ok|okay|sure|probably|definitely|pretty|equals|equal|to|be|would|could|should|must|guess|well|hmm+|that|yes|yeah|no|oh|right|correct|now|a|just|minus|negative)\b\s*)*$/;

export function intentEquation(i: Intent): Equation | null {
  return i.equation ? parseEquation(i.equation.raw) : null;
}

export function intentValue(i: Intent): Fraction | null {
  if (!i.value) return null;
  const [n, d] = i.value.split("/").map(Number);
  return new Fraction(n, d ?? 1);
}
