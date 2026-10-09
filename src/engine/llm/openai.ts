import type { LlmCall } from "../types";
import { costUsd, errMsg, isTransientStatus, round1, TransientError, withTimeoutAndRetry, type JsonRequest, type JsonResponse, type LlmProvider, type ProviderOptions } from "./provider";

/**
 * Any OpenAI-compatible Chat Completions endpoint (OpenAI and the many vendors
 * that mirror its API), using strict json_schema response format. Plain fetch —
 * no SDK dependency.
 */
export class OpenAICompatibleProvider implements LlmProvider {
  readonly provider: string;
  readonly model: string;

  constructor(private apiKey: string, private o: ProviderOptions, private baseUrl = "https://api.openai.com/v1", providerName = "openai-compatible") {
    this.model = o.model;
    this.provider = providerName;
  }

  async generateJson<T>(req: JsonRequest<T>): Promise<JsonResponse<T>> {
    const t0 = performance.now();
    const base: LlmCall = { kind: "model", purpose: req.purpose, provider: this.provider, model: this.model, latencyMs: 0, inputTokens: 0, outputTokens: 0, costUsd: null, attempt: req.attempt, ok: false };
    try {
      const { value: body, retries } = await withTimeoutAndRetry(async (signal) => {
        let res: Response;
        try {
          res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
            method: "POST",
            signal,
            headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
            body: JSON.stringify({
              model: this.model,
              max_tokens: req.maxTokens,
              messages: [
                { role: "system", content: req.system },
                { role: "user", content: req.user },
              ],
              response_format: { type: "json_schema", json_schema: { name: req.schemaName, schema: req.jsonSchema, strict: true } },
            }),
          });
        } catch (e) {
          if (signal.aborted) throw e;
          throw new TransientError(errMsg(e)); // network
        }
        if (!res.ok) {
          const text = (await res.text()).slice(0, 200);
          if (isTransientStatus(res.status)) throw new TransientError(`HTTP ${res.status}: ${text}`);
          throw new Error(`HTTP ${res.status}: ${text}`);
        }
        return (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      }, this.o);
      const content = body.choices?.[0]?.message?.content ?? "";
      let raw: unknown = null;
      try {
        raw = JSON.parse(content);
      } catch {
        raw = null;
      }
      const v = req.validate(raw);
      const inTok = body.usage?.prompt_tokens ?? 0;
      const outTok = body.usage?.completion_tokens ?? 0;
      const call: LlmCall = {
        ...base,
        latencyMs: round1(performance.now() - t0),
        inputTokens: inTok,
        outputTokens: outTok,
        costUsd: body.usage ? costUsd(this.o, inTok, outTok) : null,
        ok: v.ok,
        error: v.ok ? (retries ? `ok after ${retries} transport retr${retries === 1 ? "y" : "ies"}` : undefined) : `schema: ${v.error}`,
      };
      return { data: v.ok ? v.data : null, call };
    } catch (e) {
      return { data: null, call: { ...base, latencyMs: round1(performance.now() - t0), error: errMsg(e) } };
    }
  }
}
