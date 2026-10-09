/**
 * Natural student language and progressive micro-teaching.
 * Deterministic phrase rules, NOTICE → THINK → TRY, alternative explanations, small examples,
 * and the (optional) LLM interpretation boundary — tested with a fake provider, no network.
 */
import { describe, expect, it } from "vitest";
import { classifyIntent, PHRASE_RULES } from "@/engine/intent";
import { createSession, step } from "@/engine/engine";
import { DeterministicTeacher, LlmTeacher } from "@/engine/llm/teacher";
import { maxModelCallsFromEnv } from "@/engine/llm/factory";
import { buildContext } from "@/engine/policy";
import { noticeVariants, smallExample, thinkVariants, tryVariants } from "@/engine/language/explanations";
import { guardUtterance } from "@/engine/guard";
import { generateTransferProblem, GUIDED_PROBLEM, problemAnswer } from "@/engine/problems";
import { statesAnswer, falseArithmetic } from "@/engine/eval/scenarios";
import type { JsonRequest, JsonResponse, LlmProvider } from "@/engine/llm/provider";
import type { LlmCall, SessionState } from "@/engine/types";

const teacher = new DeterministicTeacher();

async function session(prefix: string[] = []) {
  let s = createSession({ sessionId: "lang", seed: 7 });
  s = (await step(s, { type: "start" }, { teacher })).state;
  for (const p of prefix) s = (await step(s, { type: "text", text: p, via: "keyboard" }, { teacher })).state;
  return s;
}
async function say(s: SessionState, text: string, t = teacher as DeterministicTeacher | LlmTeacher) {
  return step(s, { type: "text", text, via: "keyboard" }, { teacher: t });
}

describe("phrase rules: everyday student language", () => {
  const expected: Record<string, string> = {
    "I'm stuck.": "HELP_REQUEST",
    "I'm confused.": "CONFUSED",
    "I don't get it.": "CONFUSED",
    "Can you explain that again?": "REPHRASE_REQUEST",
    "Explain it another way.": "REPHRASE_REQUEST",
    "Explain differently": "REPHRASE_REQUEST",
    "Why?": "WHY_QUESTION",
    "Why did you subtract five?": "CONCEPT_QUESTION",
    "Can you show me a small example?": "EXAMPLE_REQUEST",
    "Give me a hint.": "HELP_REQUEST",
    "Small hint": "HELP_REQUEST",
    "Don't tell me the answer.": "NO_ANSWER_PREFERENCE",
    "I think that's wrong.": "DISPUTE",
    "I need more help.": "HELP_REQUEST",
    "Can we go slower?": "SLOWER_REQUEST",
    "What do I do next?": "HELP_REQUEST",
    "Say that again": "REPEAT_REQUEST",
    "okay": "ACKNOWLEDGE",
    "hmm": "AMBIGUOUS",
    "the left one": "AMBIGUOUS",
    "What's the capital of France?": "OFF_TOPIC",
  };
  for (const [text, kind] of Object.entries(expected)) {
    it(`"${text}" → ${kind}`, () => expect(classifyIntent(text).kind).toBe(kind));
  }

  it("every documented example of every rule is recognised by that rule", () => {
    for (const r of PHRASE_RULES) for (const ex of r.examples) expect(classifyIntent(ex).phraseRule, `${r.id}: "${ex}"`).toBe(r.id);
  });

  it("maths is never re-interpreted as a request: an equation is still read as maths", () => {
    expect(classifyIntent("3x = 15").kind).toBe("STEP");
    expect(classifyIntent("x = 5").kind).toBe("ANSWER");
    expect(classifyIntent("three x equals fifteen").kind).toBe("STEP");
  });

  it("'I'm stuck on 3x = 15' is a request for help, not an attempted step", () => {
    const i = classifyIntent("I'm stuck on 3x = 15");
    expect(i.kind).toBe("HELP_REQUEST");
    expect(i.mathSegment).toBe("3x = 15");
  });

  it("'explain it in 2 steps' isn't read as the answer 2", () => {
    expect(classifyIntent("explain it differently in 2 steps").kind).toBe("REPHRASE_REQUEST");
  });
});

describe("micro-teaching: NOTICE → THINK → TRY, one stage at a time", () => {
  it("repeated requests for help move one stage per turn and never repeat the same words", async () => {
    let s = await session();
    const stages: (string | undefined)[] = [];
    const said: string[] = [];
    for (const text of ["I'm stuck", "I still need more help", "I need more help"]) {
      const r = await say(s, text);
      s = r.state;
      stages.push(r.trace.decision.stage);
      said.push(r.utterance);
    }
    expect(stages).toEqual(["NOTICE", "THINK", "TRY"]);
    expect(new Set(said).size).toBe(3);
    for (const u of said) expect(statesAnswer(u, "5")).toBe(false);
    for (const u of said) expect(u).not.toMatch(/3x = 15/);
  });

  it("'explain it differently' keeps the same amount of help but changes the explanation each time", async () => {
    let s = await session(["I'm stuck", "I need more help"]); // at THINK, rung 1
    const out: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await say(s, "Explain it another way");
      s = r.state;
      expect(r.trace.decision.rule).toMatch(/^R24_REPHRASE_/);
      expect(r.trace.decision.hintLevel).toBe(1);
      out.push(r.utterance);
    }
    expect(out[0]).not.toBe(out[1]);
    expect(out[1]).not.toBe(out[2]);
  });

  it("a bare 'Why?' is answered about the tutor's last move", async () => {
    const s = await session(["I'm stuck", "I need more help", "I need more help"]); // TRY: "take 5 away from the left side"
    const r = await say(s, "Why?");
    expect(r.trace.decision.rule).toBe("R18_CONCEPT_WHY_INVERSE_CONSTANT");
    expect(r.utterance).not.toMatch(/\b15\b/);
  });

  it("a bare 'Why?' with nothing to refer to asks one clarifying question", async () => {
    const r = await say(await session(), "Why?");
    expect(r.trace.decision.rule).toBe("R22_CLARIFY_WHY");
    expect(r.utterance.match(/\?/g)?.length).toBe(1);
  });

  it("ambiguous input gets one short clarifying question and is not counted as an attempt", async () => {
    const s = await session();
    const r = await say(s, "hmm");
    expect(r.trace.decision.rule).toBe("R22_CLARIFY");
    expect(r.state.attempts).toBe(0);
    expect(r.utterance.split(/\s+/).length).toBeLessThan(30);
  });

  it("'Don't tell me the answer' is honoured: no worked solution even after many attempts", async () => {
    let s = await session(["Don't tell me the answer"]);
    expect(s.noReveal).toBe(true);
    for (const x of ["x = 12", "x = 45", "x = 1", "x = 15", "x = 2", "please just tell me", "I'm stuck", "I'm stuck"]) {
      const r = await say(s, x);
      s = r.state;
      expect(r.trace.decision.rule).not.toBe("R9_REVEAL_AFTER_EFFORT");
      expect(r.trace.decision.revealAllowed && r.trace.decision.action === "EXPLAIN").toBe(false);
      expect(statesAnswer(r.utterance, "5")).toBe(false);
      expect(r.utterance).not.toMatch(/3x = 15/);
    }
  });

  it("'Can we go slower?' points at one part and sets a slower read-aloud pace", async () => {
    const r = await say(await session(), "Can we go slower?");
    expect(r.trace.decision.rule).toBe("R26_SLOWER_ONE_IDEA");
    expect(r.trace.decision.stage).toBe("NOTICE");
    expect(r.state.pace).toBe("slow");
  });

  it("help-like requests before trying a fresh problem count against independent mastery", async () => {
    let s = await session(["3x = 15", "x = 5"]); // now on a transfer problem
    s = (await say(s, "Can you show me a small example?")).state;
    expect(s.mastery.observations.some((o) => o.kind === "transfer" && !o.correct)).toBe(true);
  });

  it("an incorrect transformation is still rejected after a help exchange", async () => {
    const s = await session(["I'm stuck", "Explain it another way"]);
    const r = await say(s, "3x = 25");
    expect(r.trace.validation?.equivalentToProblem).toBe(false);
    expect(r.state.lastValidRaw).toBe("3x + 5 = 20");
  });
});

describe("every explanation variant is safe on every kind of problem", () => {
  const problems = [GUIDED_PROBLEM, ...Array.from({ length: 40 }, (_, i) => generateTransferProblem(i * 7919 + 3, i % 4, []))];
  it("NOTICE / THINK / TRY / example: no answer, no next-step result, no false arithmetic, guard passes", async () => {
    let checked = 0;
    for (const p of problems) {
      for (const stepDone of [false, true]) {
        let s = createSession({ sessionId: "v", seed: 1 });
        s = { ...s, problems: [p], lastValidRaw: p.text };
        if (stepDone) {
          const ctx0 = buildContext(s);
          s = { ...s, lastValidRaw: ctx0.next.resultRaw };
        }
        const ctx = buildContext(s);
        const answer = problemAnswer(p);
        const texts = [...noticeVariants(ctx), ...thinkVariants(ctx), ...tryVariants(ctx)];
        const ex = [0, 1, 2, 3].map((v) => smallExample(ctx, v));
        for (const t of [...texts, ...ex.map((e) => e.text)]) {
          const allowed = ex.find((e) => e.text === t)?.equations ?? [];
          const g = guardUtterance(t, { answer, problemText: p.text, nextStepRaw: ctx.next.resultRaw, revealAllowed: false, nextStepAllowed: false, groundedEquations: [p.text, ctx.currentRaw, ...allowed] });
          expect(g.ok, `${p.text} | ${ctx.currentRaw} | ${t} | ${JSON.stringify(g.violations)}`).toBe(true);
          expect(statesAnswer(t, answer.toString()), t).toBe(false);
          expect(falseArithmetic(t), t).toEqual([]);
          expect(t.split(/\s+/).length, t).toBeLessThanOrEqual(45);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});

/* ---------------- LLM interpretation (optional, enum-constrained) ---------------- */

class FakeProvider implements LlmProvider {
  readonly provider = "fake";
  readonly model = "fake-1";
  purposes: string[] = [];
  constructor(private interpret: () => unknown) {}
  async generateJson<T>(req: JsonRequest<T>): Promise<JsonResponse<T>> {
    this.purposes.push(req.purpose);
    const base: LlmCall = { kind: "model", purpose: req.purpose, provider: "fake", model: "fake-1", latencyMs: 1, inputTokens: 50, outputTokens: 5, costUsd: null, attempt: req.attempt, ok: false };
    if (req.purpose !== "interpret") return { data: null, call: { ...base, error: "transport: offline" } }; // decide → deterministic fallback
    const v = req.validate(this.interpret());
    return { data: v.ok ? v.data : null, call: { ...base, ok: v.ok, error: v.ok ? undefined : `schema: ${v.error}` } };
  }
}

const reading = (o: Partial<Record<string, unknown>>) => ({
  kind: "unclear",
  request: null,
  operation: null,
  number: null,
  sides: "unspecified",
  framing: "plain",
  part: null,
  mentions_order_of_operations: false,
  is_question: false,
  is_correction: false,
  confidence: 0.9,
  ...o,
});

describe("LLM interpretation of unmatched text", () => {
  it("maps unmatched text to a permitted request; the policy still decides; the trace says it was the model", async () => {
    const p = new FakeProvider(() => reading({ kind: "help_request", request: "confused" }));
    const r = await say(await session(), "my brain hurts", new LlmTeacher(p));
    expect(p.purposes[0]).toBe("interpret");
    expect((r.trace.intent as { recognisedBy?: string }).recognisedBy).toBe("llm");
    expect(r.trace.decision.rule.startsWith("R8b")).toBe(true);
    expect(r.trace.llmCalls.some((c) => c.purpose === "interpret" && c.kind === "model")).toBe(true);
  });

  it("an invented label fails schema validation → handled deterministically", async () => {
    const p = new FakeProvider(() => reading({ kind: "help_request", request: "give_answer" }));
    const r = await say(await session(), "my brain hurts", new LlmTeacher(p));
    expect((r.trace.intent as { recognisedBy?: string }).recognisedBy).not.toBe("llm");
    expect(r.trace.errors.join(" ")).toMatch(/interpretation failed/);
  });

  it("a verdict field the model invents (e.g. 'correct: true') fails the strict schema", async () => {
    const p = new FakeProvider(() => ({ ...reading({ kind: "operation", operation: "multiply" }), correct: true }));
    const r = await say(await session(), "my brain hurts", new LlmTeacher(p));
    expect(r.trace.errors.join(" ")).toMatch(/interpretation failed/);
    expect(r.trace.decision.rule).toBe("R22_CLARIFY");
  });

  it("low confidence or 'unclear' → the tutor asks instead of guessing", async () => {
    const p = new FakeProvider(() => reading({ kind: "help_request", request: "hint", confidence: 0.3 }));
    const r = await say(await session(), "this bit", new LlmTeacher(p));
    expect(r.trace.decision.rule).toBe("R22_CLARIFY");
  });

  it("equations are never sent for interpretation", async () => {
    const p = new FakeProvider(() => reading({ kind: "help_request", request: "stuck" }));
    await say(await session(), "3x + = 20", new LlmTeacher(p));
    expect(p.purposes).not.toContain("interpret");
  });

  it("a move the model reads is verified exactly: correct move → TRY, and the board does not change", async () => {
    const p = new FakeProvider(() => reading({ kind: "operation", operation: "subtract", number: "5", sides: "both" }));
    const s0 = await session();
    const r = await say(s0, "yeet 5 outta there", new LlmTeacher(p));
    expect((r.trace.intent as { kind?: string } | undefined)?.kind).toBe("OPERATION");
    expect((r.trace.intent as { recognisedBy?: string }).recognisedBy).toBe("llm");
    expect(r.trace.meaning?.source).toBe("llm");
    expect(r.trace.opCheck?.verdict).toBe("correct_next");
    expect(r.trace.decision.rule).toBe("R30_OP_RIGHT_MOVE");
    expect(r.state.board.length).toBe(s0.board.length); // nothing written for them
    expect(r.state.phase).toBe("GUIDED");
  });

  it("the model can't make a wrong move right: it reports 'add 5', the engine computes 3x + 10 = 25", async () => {
    const p = new FakeProvider(() => reading({ kind: "operation", operation: "add", number: "5", sides: "both", confidence: 0.99 }));
    const r = await say(await session(), "chuck another 5 on", new LlmTeacher(p));
    expect(r.trace.opCheck?.verdict).toBe("wrong_inverse");
    expect(r.trace.opCheck?.result).toBe("3x + 10 = 25");
    expect(r.trace.decision.rule).toBe("R33_OP_WRONG_INVERSE");
  });

  it("a number the student never said is rejected (the model may not supply operands)", async () => {
    const p = new FakeProvider(() => reading({ kind: "operation", operation: "subtract", number: "5" }));
    const r = await say(await session(), "my brain hurts", new LlmTeacher(p));
    expect((r.trace.intent as { kind?: string } | undefined)?.kind).not.toBe("OPERATION");
    expect(r.trace.llmCalls.find((c) => c.purpose === "interpret")?.rejectionReasons?.[0]).toMatch(/not in the student's words/);
    expect(r.trace.decision.rule).toBe("R22_CLARIFY");
  });

  it("BODMAS read by the model → the same evaluation-order teaching move as the lexicon", async () => {
    const p = new FakeProvider(() => reading({ kind: "operation", operation: "multiply", framing: "evaluate", mentions_order_of_operations: true }));
    const r = await say(await session(), "bodmos innit", new LlmTeacher(p));
    expect(r.trace.opCheck?.verdict).toBe("evaluation_order");
    expect(r.trace.decision.rule).toBe("R31_OP_EVALUATION_ORDER");
  });

  it("timeout / transport failure → deterministic handling, error recorded, lesson continues", async () => {
    class Down extends FakeProvider {
      async generateJson<T>(req: JsonRequest<T>): Promise<JsonResponse<T>> {
        return { data: null, call: { kind: "model", purpose: req.purpose, provider: "fake", model: "fake-1", latencyMs: 8000, inputTokens: 0, outputTokens: 0, costUsd: null, attempt: 1, ok: false, error: "transport: timeout after 8000ms" } };
      }
    }
    const r = await say(await session(), "my brain hurts", new LlmTeacher(new Down(() => null)));
    expect(r.trace.errors.join(" ")).toMatch(/timeout/);
    expect(r.trace.decision.rule).toBe("R22_CLARIFY");
    expect(r.utterance.length).toBeGreaterThan(0);
  });

  it("per-session model-call budget: past it, the turn runs deterministically with no model calls", async () => {
    const p = new FakeProvider(() => reading({ kind: "help_request", request: "confused" }));
    const s = { ...(await session()), modelCalls: 5 };
    const r = await step(s, { type: "text", text: "my brain hurts", via: "keyboard" }, { teacher: new LlmTeacher(p), maxModelCalls: 5 });
    expect(p.purposes).toEqual([]);
    expect(r.trace.llmCalls.every((c) => c.kind !== "model")).toBe(true);
    expect(r.trace.errors.join(" ")).toMatch(/budget/);
  });

  it("the per-session budget comes from LLM_MAX_CALLS_PER_SESSION (default 150; invalid → default)", () => {
    expect(maxModelCallsFromEnv({} as NodeJS.ProcessEnv)).toBe(150);
    expect(maxModelCallsFromEnv({ LLM_MAX_CALLS_PER_SESSION: "20" } as unknown as NodeJS.ProcessEnv)).toBe(20);
    expect(maxModelCallsFromEnv({ LLM_MAX_CALLS_PER_SESSION: "lots" } as unknown as NodeJS.ProcessEnv)).toBe(150);
  });

  it("deterministic mode has no interpreter (no model calls)", async () => {
    const r = await say(await session(), "my brain hurts");
    expect(r.trace.llmCalls.every((c) => c.kind !== "model")).toBe(true);
  });
});
