/**
 * The LLM teaching layer, tested with fake providers (no network, no credentials).
 * These verify the CONTROL logic — validation, permissions, retries, fallback —
 * not the quality of any real model's teaching. That needs a live eval (policy C).
 */
import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { createSession, step } from "@/engine/engine";
import { LlmTeacher } from "@/engine/llm/teacher";
import { AnthropicProvider } from "@/engine/llm/anthropic";
import { OpenAICompatibleProvider } from "@/engine/llm/openai";
import { withTimeoutAndRetry, TransientError, type JsonRequest, type JsonResponse, type LlmProvider, type ProviderOptions } from "@/engine/llm/provider";
import type { LlmCall } from "@/engine/types";

type Script = (req: JsonRequest<unknown>, n: number) => unknown | Error;

class FakeProvider implements LlmProvider {
  readonly provider = "fake";
  readonly model = "fake-1";
  calls = 0;
  prompts: string[] = [];
  constructor(private script: Script) {}
  async generateJson<T>(req: JsonRequest<T>): Promise<JsonResponse<T>> {
    this.calls++;
    this.prompts.push(req.user);
    const out = this.script(req as JsonRequest<unknown>, this.calls);
    const base: LlmCall = { kind: "model", purpose: req.purpose, provider: "fake", model: "fake-1", latencyMs: 1, inputTokens: 100, outputTokens: 20, costUsd: null, attempt: req.attempt, ok: false };
    if (out instanceof Error) return { data: null, call: { ...base, error: out.message } };
    const v = req.validate(out);
    return { data: v.ok ? v.data : null, call: { ...base, ok: v.ok, error: v.ok ? undefined : `schema: ${v.error}` } };
  }
}

async function afterStart() {
  let s = createSession({ sessionId: "llm", seed: 7 });
  s = (await step(s, { type: "start" }, { teacher: new LlmTeacher(new FakeProvider(() => ({ candidate_id: "R0_PRESENT_PROBLEM", utterance: "Let's solve 3x + 5 = 20. Where would you start?", rationale: "start" }))) })).state;
  return s;
}

describe("LlmTeacher", () => {
  it("may choose a non-default permitted move; the trace records the choice and rationale", async () => {
    const p = new FakeProvider(() => ({ candidate_id: "R5c_CHECK_FIRST_ERROR", utterance: "Let's test it: if 3x were 25, the left side would be 25 + 5 = 30, not 20. What does that tell you?", rationale: "Evidence works better than a question here." }));
    const r = await step(await afterStart(), { type: "text", text: "3x = 25", via: "keyboard" }, { teacher: new LlmTeacher(p) });
    expect(r.trace.decision.id).toBe("R5c_CHECK_FIRST_ERROR");
    expect(r.trace.decisionSource).toBe("llm-choice");
    expect(r.trace.rationale).toMatch(/Evidence/);
    expect(r.trace.llmCalls.filter((c) => c.kind === "model")).toHaveLength(1);
  });

  it("the model sees the validated observation; it is never asked to judge correctness", async () => {
    const p = new FakeProvider(() => ({ candidate_id: "R5_TARGETED_PROBE", utterance: "What undoes + 5?", rationale: "x" }));
    await step(await afterStart(), { type: "text", text: "3x = 25", via: "keyboard" }, { teacher: new LlmTeacher(p) });
    expect(p.prompts[0]).toContain('"equivalentToProblem":false');
    expect(p.prompts[0]).toContain("SIGN_ERROR_INVERSE_OP");
  });

  it("an invented candidate id fails schema validation → retry → deterministic fallback", async () => {
    const p = new FakeProvider(() => ({ candidate_id: "GIVE_ANSWER", utterance: "x = 5", rationale: "fast" }));
    const r = await step(await afterStart(), { type: "text", text: "x = 8", via: "keyboard" }, { teacher: new LlmTeacher(p) });
    expect(p.calls).toBe(2);
    expect(r.trace.decisionSource).toBe("fallback-default");
    expect(r.trace.decision.id).toBe("R6_PROBE_UNKNOWN");
    expect(r.utterance).not.toMatch(/x = 5/);
  });

  it("an answer-leaking utterance is rejected by the guard, retried with the reason, then falls back", async () => {
    const p = new FakeProvider(() => ({ candidate_id: "R6_PROBE_UNKNOWN", utterance: "Close! Actually x = 5.", rationale: "be nice" }));
    const r = await step(await afterStart(), { type: "text", text: "x = 8", via: "keyboard" }, { teacher: new LlmTeacher(p) });
    expect(p.calls).toBe(2);
    expect(p.prompts[1]).toMatch(/REJECTED: ANSWER_LEAK/);
    expect(r.trace.fallbackUsed).toBe(true);
    expect(r.trace.llmCalls.filter((c) => c.verdict === "rejected")).toHaveLength(2);
    expect(r.utterance).not.toMatch(/x = 5/);
  });

  it("false arithmetic from the model is rejected (the model can't invent maths)", async () => {
    const p = new FakeProvider((_r, n) => (n === 1 ? { candidate_id: "R6_PROBE_UNKNOWN", utterance: "Hmm, 3 × 8 + 5 = 28. How did you get 8?", rationale: "x" } : { candidate_id: "R6_PROBE_UNKNOWN", utterance: "How did you get 8?", rationale: "x" }));
    const r = await step(await afterStart(), { type: "text", text: "x = 8", via: "keyboard" }, { teacher: new LlmTeacher(p) });
    expect(r.trace.llmCalls[0].rejectionReasons?.[0]).toMatch(/FALSE_ARITHMETIC/);
    expect(r.utterance).toBe("How did you get 8?");
    expect(r.trace.decisionSource).toBe("policy-default");
  });

  it("a transport failure falls back immediately (no pointless second call)", async () => {
    const p = new FakeProvider(() => new Error("timeout after 8000 ms"));
    const r = await step(await afterStart(), { type: "text", text: "x = 8", via: "keyboard" }, { teacher: new LlmTeacher(p) });
    expect(p.calls).toBe(1);
    expect(r.trace.fallbackUsed).toBe(true);
    expect(r.utterance.length).toBeGreaterThan(0);
  });

  it("the model cannot unlock a reveal: no permitted candidate allows it, so stating x is rejected", async () => {
    const p = new FakeProvider(() => ({ candidate_id: "R8_HELP_BEFORE_TRYING", utterance: "Fine — it's x = 5. Which would you undo first?", rationale: "they asked" }));
    const r = await step(await afterStart(), { type: "text", text: "just tell me the answer", via: "keyboard" }, { teacher: new LlmTeacher(p) });
    expect(r.trace.candidates.every((c) => c.id !== "R9_REVEAL_AFTER_EFFORT")).toBe(true);
    expect(r.utterance).not.toMatch(/x = 5/);
  });

  it("classification: schema-valid model output is used; invalid output falls back to the heuristic", async () => {
    const good = new FakeProvider((req) => (req.purpose === "classify" ? { misconception: "COMBINED_UNLIKE_TERMS", confidence: 0.8, evidence: "added 3 and 5" } : { candidate_id: "R12_EXPLANATION_DIAGNOSED", utterance: "3x and 5 can't be added. Try again?", rationale: "x" }));
    const r1 = await step(await afterStart(), { type: "text", text: "I put the 3 and 5 together", via: "keyboard" }, { teacher: new LlmTeacher(good) });
    expect(r1.trace.diagnosisSource).toBe("llm");
    const bad = new FakeProvider((req) => (req.purpose === "classify" ? { misconception: "MADE_UP", confidence: 2 } : { candidate_id: "R12_EXPLANATION_DIAGNOSED", utterance: "Try again?", rationale: "x" }));
    const r2 = await step(await afterStart(), { type: "text", text: "I added 3 and 5", via: "keyboard" }, { teacher: new LlmTeacher(bad) });
    expect(r2.trace.diagnosisSource).toBe("heuristic");
    expect(r2.trace.diagnosis?.id).toBe("COMBINED_UNLIKE_TERMS");
  });
});

const opts = (o: Partial<ProviderOptions> = {}): ProviderOptions => ({ model: "m", timeoutMs: 200, transportRetries: 1, priceInPerMTok: null, priceOutPerMTok: null, ...o });

describe("provider transport", () => {
  it("retries a transient failure once, then succeeds", async () => {
    let n = 0;
    const r = await withTimeoutAndRetry(async () => {
      if (++n === 1) throw new TransientError("HTTP 503");
      return "ok";
    }, opts());
    expect(r).toEqual({ value: "ok", retries: 1 });
  });
  it("times out a hung call via AbortSignal", async () => {
    await expect(withTimeoutAndRetry((signal) => new Promise((_res, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")))), opts({ transportRetries: 0, timeoutMs: 50 }))).rejects.toThrow(/timeout/);
  });
  it("does not retry a non-transient error", async () => {
    let n = 0;
    await expect(withTimeoutAndRetry(async () => { n++; throw new Error("HTTP 400"); }, opts())).rejects.toThrow("HTTP 400");
    expect(n).toBe(1);
  });
});

/** Real HTTP round-trips against a local fake server: exercises the SDK / fetch code paths without network or keys. */
function fakeServer(handler: (body: any, url: string) /* eslint-disable-line @typescript-eslint/no-explicit-any */ => { status: number; json: unknown }) {
  return new Promise<{ url: string; close: () => void; hits: () => number }>((resolve) => {
    let hits = 0;
    const srv = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        hits++;
        const out = handler(data ? JSON.parse(data) : null, req.url ?? "");
        res.writeHead(out.status, { "content-type": "application/json" });
        res.end(JSON.stringify(out.json));
      });
    });
    srv.listen(0, () => {
      const port = (srv.address() as { port: number }).port;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => srv.close(), hits: () => hits });
    });
  });
}

const schemaReq = (attempt = 1): JsonRequest<{ a: string }> => ({
  purpose: "decide",
  system: "s",
  user: "u",
  schemaName: "teaching_move",
  jsonSchema: { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false },
  validate: (raw) => (raw && typeof (raw as { a?: unknown }).a === "string" ? { ok: true, data: raw as { a: string } } : { ok: false, error: "a missing" }),
  maxTokens: 50,
  attempt,
});

describe("AnthropicProvider (real SDK, local fake server)", () => {
  it("forces the tool, parses tool_use input, records real usage and computes cost only when priced", async () => {
    const srv = await fakeServer((body) => {
      expect(body.tool_choice).toEqual({ type: "tool", name: "teaching_move" });
      return { status: 200, json: { id: "msg_1", type: "message", role: "assistant", model: "m", stop_reason: "tool_use", stop_sequence: null, content: [{ type: "tool_use", id: "t1", name: "teaching_move", input: { a: "hi" } }], usage: { input_tokens: 321, output_tokens: 12 } } };
    });
    const p = new AnthropicProvider("sk-test", opts({ timeoutMs: 3000, priceInPerMTok: 1, priceOutPerMTok: 5 }), srv.url);
    const r = await p.generateJson(schemaReq());
    srv.close();
    expect(r.data).toEqual({ a: "hi" });
    expect(r.call).toMatchObject({ kind: "model", provider: "anthropic", inputTokens: 321, outputTokens: 12, ok: true });
    expect(r.call.costUsd).toBeCloseTo((321 * 1 + 12 * 5) / 1e6, 10);
  });
  it("retries a 529/503 once and reports it", async () => {
    let n = 0;
    const srv = await fakeServer(() => (++n === 1 ? { status: 503, json: { type: "error", error: { type: "overloaded_error", message: "busy" } } } : { status: 200, json: { id: "m", type: "message", role: "assistant", model: "m", stop_reason: "tool_use", stop_sequence: null, content: [{ type: "tool_use", id: "t", name: "teaching_move", input: { a: "x" } }], usage: { input_tokens: 1, output_tokens: 1 } } }));
    const r = await new AnthropicProvider("sk-test", opts({ timeoutMs: 3000 }), srv.url).generateJson(schemaReq());
    srv.close();
    expect(r.data).toEqual({ a: "x" });
    expect(r.call.error).toMatch(/1 transport retry/);
    expect(r.call.costUsd).toBeNull(); // no prices configured → unknown, never guessed
  });
  it("schema-invalid tool input is reported, not passed through", async () => {
    const srv = await fakeServer(() => ({ status: 200, json: { id: "m", type: "message", role: "assistant", model: "m", stop_reason: "tool_use", stop_sequence: null, content: [{ type: "tool_use", id: "t", name: "teaching_move", input: { b: 1 } }], usage: { input_tokens: 1, output_tokens: 1 } } }));
    const r = await new AnthropicProvider("sk-test", opts({ timeoutMs: 3000 }), srv.url).generateJson(schemaReq());
    srv.close();
    expect(r.data).toBeNull();
    expect(r.call.error).toMatch(/^schema:/);
  });
});

describe("OpenAICompatibleProvider (fetch, local fake server)", () => {
  it("sends strict json_schema and parses content + usage", async () => {
    const srv = await fakeServer((body, url) => {
      expect(url).toBe("/v1/chat/completions");
      expect(body.response_format.json_schema.strict).toBe(true);
      return { status: 200, json: { choices: [{ message: { content: JSON.stringify({ a: "ok" }) } }], usage: { prompt_tokens: 50, completion_tokens: 7 } } };
    });
    const r = await new OpenAICompatibleProvider("k", opts({ timeoutMs: 3000 }), `${srv.url}/v1`).generateJson(schemaReq());
    srv.close();
    expect(r.data).toEqual({ a: "ok" });
    expect(r.call).toMatchObject({ inputTokens: 50, outputTokens: 7, costUsd: null });
  });
  it("a 400 is not retried", async () => {
    const srv = await fakeServer(() => ({ status: 400, json: { error: "bad" } }));
    const r = await new OpenAICompatibleProvider("k", opts({ timeoutMs: 3000 }), `${srv.url}/v1`).generateJson(schemaReq());
    expect(srv.hits()).toBe(1);
    srv.close();
    expect(r.data).toBeNull();
    expect(r.call.error).toMatch(/HTTP 400/);
  });
});
