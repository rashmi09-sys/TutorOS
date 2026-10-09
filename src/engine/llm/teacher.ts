import { z } from "zod";
import { MISCONCEPTIONS, classifyExplanationHeuristic, type Diagnosis, type MisconceptionId, type Normal } from "../misconceptions";
import { renderTemplate } from "../language/templates";
import type { Decision, GuardResult, LlmCall } from "../types";
import type { LlmProvider } from "./provider";
import type { HelpRequest } from "../intent";
import { numbersIn, type OpKind, type StudentMeaning } from "../understand";
import { normalizeText, numbersIn as subjectNumbersIn } from "../subjects/text";

const subjectNumbers = (text: string) => subjectNumbersIn(normalizeText(text));

/**
 * The teaching layer seam used by the engine.
 *
 *  decide():   pick ONE of the policy's permitted candidate decisions and word it.
 *  classify(): interpret a free-text explanation into a misconception id.
 *
 * Two implementations:
 *  - DeterministicTeacher: always the policy's default candidate + templates. No model, no tokens.
 *  - LlmTeacher: a model proposes {candidate, wording}; we validate the schema, check the
 *    candidate exists, guard the wording, retry once with the rejection reasons, then fall
 *    back to the deterministic default. The model never sees or produces validation results.
 */
export interface TeachingContext {
  problemText: string;
  currentLine: string;
  observation: Record<string, unknown>;
  learner: Record<string, unknown>;
  recent: { role: "tutor" | "student"; text: string }[];
}

export interface DecideRequest {
  candidates: Decision[];
  context: TeachingContext;
  /** Guard for a given decision's wording (built by the engine with that decision's permissions). */
  guard: (d: Decision, text: string) => GuardResult;
  variant: number;
}

export interface DecideResult {
  chosen: Decision;
  utterance: string;
  source: "policy-default" | "llm-choice" | "fallback-default";
  rationale?: string;
  calls: LlmCall[];
  errors: string[];
}

export interface ClassifyRequest {
  explanation: string;
  problemText: string;
  current: Normal;
  lastStudentMath?: string;
}

export interface ClassifyResult {
  diagnosis: Diagnosis | null;
  calls: LlmCall[];
  source: "llm" | "heuristic";
  errors: string[];
}

export interface InterpretRequest {
  text: string;
  problemText: string;
  currentLine: string;
  lastTutor?: string;
  /** The current equation in normal form (A·x + B = C). Used to check any number the model reports. */
  current?: Normal;
  /** What the tutor's last question was waiting for (engine dialog state). */
  awaiting?: string;
}

export interface InterpretResult {
  /** A teaching request from a fixed list, or null ("unclear" / "off topic" / failure → deterministic handling). */
  request: HelpRequest | null;
  /**
   * A move on the equation described in words, as the model read it. Never a judgement: the engine
   * verifies it exactly (understand.checkOperation) before anything is said about it.
   */
  meaning?: StudentMeaning | null;
  calls: LlmCall[];
  errors: string[];
}

/** Requests a model may map unmatched student text to. No maths: answers and steps are only ever read by the parser. */
export const INTERPRETABLE: HelpRequest[] = ["stuck", "hint", "next", "confused", "rephrase", "example", "slower", "no_answer", "why", "ack"];

export interface TeachingModel {
  readonly mode: "deterministic" | "llm";
  readonly name: string;
  decide(req: DecideRequest): Promise<DecideResult>;
  classify(req: ClassifyRequest): Promise<ClassifyResult>;
  /** Optional: interpret text the deterministic phrase rules couldn't place. Deterministic mode has none. */
  interpret?(req: InterpretRequest): Promise<InterpretResult>;
  /** Optional: read unplaced text in a geometry / physics lesson into a closed, structured label set. */
  interpretSubject?(req: SubjectInterpretRequest): Promise<SubjectInterpretResult>;
}

export interface SubjectInterpretRequest {
  lesson: "geometry" | "physics";
  text: string;
  question: string;
  lastTutor?: string;
  /** Closed vocabularies the lesson's verifier understands. */
  concepts: string[];
  outcomes: string[];
  topics: string[];
}

export interface SubjectInterpretResult {
  reading: { kind: "answer" | "concept_claim" | "help" | "why" | "concept_question"; value?: number; direction?: "left" | "right" | "none"; outcome?: string; concept?: string; topic?: string; confidence: number } | null;
  calls: LlmCall[];
  errors: string[];
}

function templateCall(purpose: LlmCall["purpose"], guard?: GuardResult, attempt = 1, model = "templates-v2"): LlmCall {
  return { kind: purpose === "classify" ? "heuristic" : "template", purpose, provider: "local", model, latencyMs: 0, inputTokens: 0, outputTokens: 0, costUsd: null, attempt, ok: guard ? guard.ok : true, guard };
}

export class DeterministicTeacher implements TeachingModel {
  readonly mode = "deterministic" as const;
  readonly name = "deterministic (rule table + templates)";

  async decide(req: DecideRequest): Promise<DecideResult> {
    const chosen = req.candidates[0];
    const utterance = renderTemplate(chosen.template, chosen.templateVars, req.variant);
    const g = req.guard(chosen, utterance);
    return { chosen, utterance, source: "policy-default", calls: [templateCall("decide", g)], errors: g.ok ? [] : [`Template failed guard: ${g.violations.map((v) => v.detail).join("; ")}`] };
  }

  async classify(req: ClassifyRequest): Promise<ClassifyResult> {
    return { diagnosis: classifyExplanationHeuristic(req.explanation, req.current), calls: [templateCall("classify", undefined, 1, "heuristic-v2")], source: "heuristic", errors: [] };
  }
}

const SYSTEM_DECIDE = `You are the teaching voice of a maths tutor for a 12-year-old working on two-step linear equations.

A deterministic policy engine has already validated the student's maths and listed the PERMITTED moves for this turn ("candidates"). You must:
1. Choose exactly ONE candidate by id — the one that best fits THIS student right now (their words, frustration, history). The first candidate is the policy's default; choose another only with a concrete reason.
2. Write what the tutor says, accomplishing that candidate's GOAL using only its FACTS.

Hard rules (a checker enforces them and will reject violations):
- Never state the value of x unless the candidate says MAY_REVEAL_ANSWER: yes.
- Never state the result of the next step unless the candidate says MAY_SHOW_NEXT_STEP: yes.
- Never write any equation or calculation that is not in the facts, the problem, or the student's own words. Do not do arithmetic yourself.
- Never claim a step is right or wrong unless the observation says so — you do not judge correctness.
- At most 2 short sentences, max 40 words. Warm and direct; no baby talk, no emojis, no sarcasm.
- Plain-text maths like "3x + 5 = 20". No LaTeX.
- Stay on this lesson. Do not answer unrelated questions.`;

const SYSTEM_CLASSIFY = `You diagnose why a Grade 7 student made an error solving a two-step linear equation, from their own explanation.
Choose exactly one misconception id. If the explanation does not clearly support one, choose UNCLASSIFIED with low confidence. Never guess beyond the evidence; quote or paraphrase the student's words as evidence.
Ids:
${Object.values(MISCONCEPTIONS)
  .map((m) => `- ${m.id}: ${m.label}`)
  .join("\n")}`;

const SYSTEM_INTERPRET = `A 12-year-old is solving a linear equation with a maths tutor. Their message did not match the tutor's word lists.
Your only job is to say what the student MEANT, as structured data. You never judge whether it is right, and you never work anything out.

kind:
- "operation": they propose or ask about doing something to the equation ("let's take the five off", "times both sides?", "BODMAS so multiply first").
- "choose_part": they point at which part to deal with first, without saying what to do ("the number on its own", "the bit with x").
- "help_request": they ask the tutor for something; set request to one of: ${INTERPRETABLE.join(", ")}.
- "unclear": you can't tell, or it could mean several things.
- "off_topic": not about this lesson.

For "operation": operation = add | subtract | multiply | divide (what THEY want to do, even if it is wrong); number = the number they said, as digits, or null if they did not say one (never fill it in yourself);
sides = both | left | right | unspecified (as they said it); framing = undo ("undo/get rid of"), move ("move it to the other side"), evaluate ("do the multiplication", BODMAS), or plain.
mentions_order_of_operations = true if they appeal to BODMAS/PEMDAS or "multiplication comes first".
is_question = they are asking rather than proposing; is_correction = they are correcting or restating something they said before ("no, I meant…", "I said…").
part = constant | coefficient | null.
confidence: 0–1. Use below 0.6 if you are guessing.
If the message contains an equation (with "="), choose "unclear" — equations are checked by a separate parser.`;

const OP_KINDS = ["add", "subtract", "multiply", "divide"] as const;
const INTERPRET_KINDS = ["operation", "choose_part", "help_request", "unclear", "off_topic"] as const;
const nullable = (t: object) => ({ anyOf: [t, { type: "null" }] });
export const InterpretSchema = z
  .object({
    kind: z.enum(INTERPRET_KINDS),
    request: z.enum(INTERPRETABLE as [HelpRequest, ...HelpRequest[]]).nullable(),
    operation: z.enum(OP_KINDS).nullable(),
    number: z
      .string()
      .regex(/^\d{1,4}(\.\d{1,3})?$/)
      .nullable(),
    sides: z.enum(["both", "left", "right", "unspecified"]),
    framing: z.enum(["undo", "move", "evaluate", "plain"]),
    part: z.enum(["constant", "coefficient"]).nullable(),
    mentions_order_of_operations: z.boolean(),
    is_question: z.boolean(),
    is_correction: z.boolean(),
    confidence: z.number().min(0).max(1),
  })
  .strict();
const INTERPRET_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "request", "operation", "number", "sides", "framing", "part", "mentions_order_of_operations", "is_question", "is_correction", "confidence"],
  properties: {
    kind: { type: "string", enum: INTERPRET_KINDS },
    request: nullable({ type: "string", enum: INTERPRETABLE }),
    operation: nullable({ type: "string", enum: OP_KINDS }),
    number: nullable({ type: "string", description: "Digits only, exactly as the student said it. null if they did not say a number." }),
    sides: { type: "string", enum: ["both", "left", "right", "unspecified"] },
    framing: { type: "string", enum: ["undo", "move", "evaluate", "plain"] },
    part: nullable({ type: "string", enum: ["constant", "coefficient"] }),
    mentions_order_of_operations: { type: "boolean" },
    is_question: { type: "boolean" },
    is_correction: { type: "boolean" },
    confidence: { type: "number" },
  },
};

/** Below this, an interpretation is treated as unclear: the tutor asks instead of acting on a guess. */
export const INTERPRET_MIN_CONFIDENCE = 0.6;

export class LlmTeacher implements TeachingModel {
  readonly mode = "llm" as const;
  readonly name: string;
  private fallback = new DeterministicTeacher();

  constructor(private provider: LlmProvider) {
    this.name = `${provider.provider}:${provider.model}`;
  }

  async decide(req: DecideRequest): Promise<DecideResult> {
    const ids = req.candidates.map((c) => c.id);
    const Schema = z
      .object({
        candidate_id: z.enum(ids as [string, ...string[]]),
        utterance: z.string().min(1).max(400),
        rationale: z.string().max(400),
      })
      .strict();
    const jsonSchema = {
      type: "object",
      additionalProperties: false,
      required: ["candidate_id", "utterance", "rationale"],
      properties: {
        candidate_id: { type: "string", enum: ids },
        utterance: { type: "string" },
        rationale: { type: "string", description: "One sentence: why this candidate for this student now." },
      },
    };
    const calls: LlmCall[] = [];
    const errors: string[] = [];
    let repair = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await this.provider.generateJson({
        purpose: "decide",
        system: SYSTEM_DECIDE,
        user: decidePrompt(req) + (repair ? `\n\nYOUR PREVIOUS ANSWER WAS REJECTED: ${repair}\nFix exactly that.` : ""),
        schemaName: "teaching_move",
        jsonSchema,
        validate: (raw) => {
          const p = Schema.safeParse(raw);
          return p.success ? { ok: true, data: p.data } : { ok: false, error: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
        },
        maxTokens: 300,
        attempt,
      });
      calls.push(res.call);
      if (!res.data) {
        repair = res.call.error ?? "invalid output";
        errors.push(`Model attempt ${attempt} failed: ${repair}`);
        // A transport failure (timeout, 5xx after retries) isn't fixed by asking again — fall back now.
        if (!/^schema:/.test(repair)) break;
        continue;
      }
      const chosen = req.candidates.find((c) => c.id === res.data!.candidate_id)!;
      res.call.proposal = { candidateId: chosen.id, rationale: res.data.rationale };
      const g = req.guard(chosen, res.data.utterance);
      res.call.guard = g;
      if (g.ok) {
        res.call.verdict = "accepted";
        return { chosen, utterance: res.data.utterance.trim(), source: chosen.id === req.candidates[0].id ? "policy-default" : "llm-choice", rationale: res.data.rationale, calls, errors };
      }
      res.call.verdict = "rejected";
      res.call.rejectionReasons = g.violations.map((v) => `${v.type}: ${v.detail}`);
      repair = res.call.rejectionReasons.join("; ");
      errors.push(`Guard rejected model attempt ${attempt}: ${repair}`);
    }
    const fb = await this.fallback.decide(req);
    return { ...fb, source: "fallback-default", calls: [...calls, ...fb.calls], errors: [...errors, ...fb.errors] };
  }

  interpret(req: InterpretRequest): Promise<InterpretResult> {
    return interpretWith(this.provider, req);
  }

  interpretSubject(req: SubjectInterpretRequest): Promise<SubjectInterpretResult> {
    return interpretSubjectWith(this.provider, req);
  }

  async classify(req: ClassifyRequest): Promise<ClassifyResult> {
    const ids = Object.keys(MISCONCEPTIONS) as MisconceptionId[];
    const Schema = z.object({ misconception: z.enum(ids as [MisconceptionId, ...MisconceptionId[]]), confidence: z.number().min(0).max(1), evidence: z.string().min(1).max(300) }).strict();
    const res = await this.provider.generateJson({
      purpose: "classify",
      system: SYSTEM_CLASSIFY,
      user: `Equation being worked on: ${req.current.A}x + (${req.current.B}) = ${req.current.C} (original problem: ${req.problemText}).\nStudent's last maths: ${req.lastStudentMath ?? "n/a"}\nStudent's explanation: """${req.explanation.slice(0, 500)}"""`,
      schemaName: "diagnosis",
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        required: ["misconception", "confidence", "evidence"],
        properties: { misconception: { type: "string", enum: ids }, confidence: { type: "number" }, evidence: { type: "string" } },
      },
      validate: (raw) => {
        const p = Schema.safeParse(raw);
        return p.success ? { ok: true, data: p.data } : { ok: false, error: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
      },
      maxTokens: 200,
      attempt: 1,
    });
    if (!res.data) {
      const fb = await this.fallback.classify(req);
      return { ...fb, calls: [res.call, ...fb.calls], errors: [`LLM classification failed (${res.call.error ?? "invalid"}); used heuristic.`] };
    }
    const id = res.data.misconception;
    return {
      diagnosis: { id, category: MISCONCEPTIONS[id].category, confidence: res.data.confidence, evidence: `From the student's words: ${res.data.evidence}`, alsoMatches: [], basis: "explanation" },
      calls: [res.call],
      source: "llm",
      errors: [],
    };
  }
}

async function interpretWith(provider: LlmProvider, req: InterpretRequest): Promise<InterpretResult> {
  // Equations are only ever read by the exact parser.
  if (/=/.test(req.text)) return { request: null, calls: [], errors: [] };
  const res = await provider.generateJson({
    purpose: "interpret",
    system: SYSTEM_INTERPRET,
    user: `Equation now: ${req.currentLine} (problem ${req.problemText}).\nTutor just said: ${req.lastTutor ?? "(nothing yet)"}\nThe tutor is waiting for: ${req.awaiting ?? "anything"}\nStudent: """${req.text.slice(0, 300)}"""`,
    schemaName: "student_meaning",
    jsonSchema: INTERPRET_JSON_SCHEMA,
    validate: (raw) => {
      const p = InterpretSchema.safeParse(raw);
      return p.success ? { ok: true, data: p.data } : { ok: false, error: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    },
    maxTokens: 160,
    attempt: 1,
  });
  if (!res.data) return { request: null, meaning: null, calls: [res.call], errors: [`LLM interpretation failed (${res.call.error ?? "invalid"}); handled deterministically.`] };
  const r = res.data;
  const reject = (why: string): InterpretResult => {
    res.call.verdict = "rejected";
    res.call.rejectionReasons = [why];
    return { request: null, meaning: null, calls: [res.call], errors: [] };
  };
  res.call.proposal = { candidateId: `interpret:${r.kind}${r.operation ? `:${r.operation}${r.number ? ` ${r.number}` : ""}` : r.request ? `:${r.request}` : ""}`, rationale: `confidence ${r.confidence}` };
  // Low-confidence readings are treated as unclear: the tutor asks rather than guesses.
  if (r.confidence < INTERPRET_MIN_CONFIDENCE) return reject(`confidence ${r.confidence} < ${INTERPRET_MIN_CONFIDENCE}`);
  if (r.kind === "unclear" || r.kind === "off_topic") return reject(`model said ${r.kind}`);
  if (r.kind === "help_request") {
    if (!r.request) return reject("help_request without a request label");
    res.call.verdict = "accepted";
    return { request: r.request, meaning: null, calls: [res.call], errors: [] };
  }
  if (!req.current) return reject("no current equation to read a move against");
  if (r.kind === "choose_part") {
    if (!r.part) return reject("choose_part without a part");
    res.call.verdict = "accepted";
    return { request: null, meaning: { act: "choose_part", operation: null, part: r.part, mentionsOrderOfOperations: r.mentions_order_of_operations, isQuestion: r.is_question, isCorrection: r.is_correction, confidence: r.confidence, evidence: [`model: points at the ${r.part}`], source: "llm" }, calls: [res.call], errors: [] };
  }
  // kind === "operation"
  if (!r.operation) return reject("operation without an operation");
  // The model may only report a number the student actually said. It may not supply one: the
  // deterministic layer infers an operand from the equation only where that is unambiguous.
  let operand: string | null = null;
  let operandSource: "stated" | "inferred" | null = null;
  if (r.number) {
    const said = numbersIn(req.text);
    if (!said.includes(Number(r.number))) return reject(`number ${r.number} is not in the student's words`);
    operand = String(Number(r.number));
    operandSource = "stated";
  } else {
    const n = req.current;
    const bAbs = n.B.valueOf() < 0 ? n.B.neg() : n.B;
    if ((r.operation === "subtract" || r.operation === "add") && !n.B.isZero() && r.framing !== "evaluate") {
      operand = bAbs.toString();
      operandSource = "inferred";
    } else if (r.operation === "divide" && !n.A.eq(1)) {
      operand = n.A.toString();
      operandSource = "inferred";
    }
  }
  res.call.verdict = "accepted";
  const kind: OpKind = r.operation;
  return {
    request: null,
    meaning: {
      act: r.is_question ? "ask_operation" : "propose_operation",
      operation: { kind, operand, operandSource, sides: r.sides, framing: r.framing },
      part: r.part,
      mentionsOrderOfOperations: r.mentions_order_of_operations,
      isQuestion: r.is_question,
      isCorrection: r.is_correction,
      confidence: r.confidence,
      evidence: [`model: ${kind}${operand ? ` ${operand}` : ""} (${r.framing}, ${r.sides})`],
      source: "llm",
    },
    calls: [res.call],
    errors: [],
  };
}

const SUBJECT_KINDS = ["answer", "concept_claim", "help", "why", "concept_question", "off_topic", "unclear"] as const;

/**
 * Geometry / physics: map a student's message to a closed set of labels. The model never judges whether an
 * answer is right — the lesson's deterministic verifier does — and any number it reports must appear in the
 * student's own words.
 */
async function interpretSubjectWith(provider: LlmProvider, req: SubjectInterpretRequest): Promise<SubjectInterpretResult> {
  const enumOrNull = (xs: string[]) => (xs.length ? z.enum(xs as [string, ...string[]]).nullable() : z.null());
  const Schema = z
    .object({
      kind: z.enum(SUBJECT_KINDS),
      number: z
        .string()
        .regex(/^\d{1,4}(\.\d{1,3})?$/)
        .nullable(),
      direction: z.enum(["left", "right", "none"]).nullable(),
      outcome: enumOrNull(req.outcomes),
      concept: enumOrNull(req.concepts),
      topic: enumOrNull(req.topics),
      confidence: z.number().min(0).max(1),
    })
    .strict();
  const ns = (xs: string[]) => (xs.length ? { anyOf: [{ type: "string", enum: xs }, { type: "null" }] } : { type: "null" });
  const res = await provider.generateJson({
    purpose: "interpret",
    system: `A 12-year-old is in a ${req.lesson} lesson with a tutor. Their message didn't match the tutor's word lists. Say what they MEANT, as structured data — never whether it is right.
kind: "answer" (they give an answer: a number, a direction, or an outcome), "concept_claim" (a general statement), "help", "why", "concept_question" (asks about an idea), "off_topic", or "unclear".
number: digits exactly as they said it, or null. Never fill in a number they didn't say. direction: left | right | none | null.
outcome (only these): ${req.outcomes.join(", ") || "none"}. concept (only these): ${req.concepts.join(", ") || "none"}. topic (only these): ${req.topics.join(", ") || "none"}.
confidence 0–1; below 0.6 if guessing.`,
    user: `Question: ${req.question}\nTutor just said: ${req.lastTutor ?? "(nothing)"}\nStudent: """${req.text.slice(0, 300)}"""`,
    schemaName: "subject_reading",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "number", "direction", "outcome", "concept", "topic", "confidence"],
      properties: {
        kind: { type: "string", enum: SUBJECT_KINDS },
        number: { anyOf: [{ type: "string" }, { type: "null" }] },
        direction: { anyOf: [{ type: "string", enum: ["left", "right", "none"] }, { type: "null" }] },
        outcome: ns(req.outcomes),
        concept: ns(req.concepts),
        topic: ns(req.topics),
        confidence: { type: "number" },
      },
    },
    validate: (raw) => {
      const p = Schema.safeParse(raw);
      return p.success ? { ok: true, data: p.data } : { ok: false, error: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    },
    maxTokens: 120,
    attempt: 1,
  });
  if (!res.data) return { reading: null, calls: [res.call], errors: [`LLM interpretation failed (${res.call.error ?? "invalid"}); handled deterministically.`] };
  const r = res.data;
  const reject = (why: string): SubjectInterpretResult => {
    res.call.verdict = "rejected";
    res.call.rejectionReasons = [why];
    return { reading: null, calls: [res.call], errors: [] };
  };
  res.call.proposal = { candidateId: `interpret:${r.kind}${r.number ? ` ${r.number}` : ""}${r.direction ? ` ${r.direction}` : ""}${r.outcome ? ` ${r.outcome}` : ""}`, rationale: `confidence ${r.confidence}` };
  if (r.confidence < INTERPRET_MIN_CONFIDENCE) return reject(`confidence ${r.confidence} < ${INTERPRET_MIN_CONFIDENCE}`);
  if (r.kind === "off_topic" || r.kind === "unclear") return reject(`model said ${r.kind}`);
  let value: number | undefined;
  if (r.number) {
    const said = subjectNumbers(req.text);
    if (!said.includes(Number(r.number))) return reject(`number ${r.number} is not in the student's words`);
    value = Number(r.number);
  }
  if (r.kind === "answer" && value == null && !r.outcome && !r.direction) return reject("answer with nothing to check");
  res.call.verdict = "accepted";
  return { reading: { kind: r.kind, value, direction: r.direction ?? undefined, outcome: r.outcome ?? undefined, concept: r.concept ?? undefined, topic: r.topic ?? undefined, confidence: r.confidence }, calls: [res.call], errors: [] };
}

function decidePrompt(req: DecideRequest): string {
  const c = req.context;
  const cands = req.candidates
    .map(
      (d, i) =>
        `- id: ${d.id}${i === 0 ? "  (policy default)" : ""}\n  action: ${d.action} (hint level ${d.hintLevel})\n  why: ${d.reason}\n  GOAL: ${d.goal}\n  FACTS: ${d.facts.length ? d.facts.join(" | ") : "none"}\n  MAY_REVEAL_ANSWER: ${d.revealAllowed ? "yes" : "NO"}\n  MAY_SHOW_NEXT_STEP: ${d.nextStepAllowed ? "yes" : "NO"}\n  example wording: "${renderTemplate(d.template, d.templateVars, 0)}"`,
    )
    .join("\n");
  return [
    `PROBLEM: ${c.problemText}`,
    `STUDENT'S CURRENT VALID LINE: ${c.currentLine}`,
    `VALIDATED OBSERVATION (from the maths checker — do not second-guess): ${JSON.stringify(c.observation)}`,
    `LEARNER STATE: ${JSON.stringify(c.learner)}`,
    `RECENT CONVERSATION:\n${c.recent.map((m) => `${m.role}: ${m.text}`).join("\n") || "(none)"}`,
    `CANDIDATES:\n${cands}`,
  ].join("\n\n");
}
