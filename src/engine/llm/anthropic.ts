import Anthropic from "@anthropic-ai/sdk";
import type { LlmCall } from "../types";
import { costUsd, errMsg, isTransientStatus, round1, TransientError, withTimeoutAndRetry, type JsonRequest, type JsonResponse, type LlmProvider, type ProviderOptions } from "./provider";

/** Anthropic Messages API. Structured output = a forced tool call whose input_schema is the JSON schema. */
export class AnthropicProvider implements LlmProvider {
  readonly provider = "anthropic";
  readonly model: string;
  private client: Anthropic;

  constructor(apiKey: string, private o: ProviderOptions, baseURL?: string) {
    this.model = o.model;
    this.client = new Anthropic({ apiKey, baseURL, maxRetries: 0 }); // retries are ours, so they're visible in traces
  }

  async generateJson<T>(req: JsonRequest<T>): Promise<JsonResponse<T>> {
    const t0 = performance.now();
    const base: LlmCall = { kind: "model", purpose: req.purpose, provider: this.provider, model: this.model, latencyMs: 0, inputTokens: 0, outputTokens: 0, costUsd: null, attempt: req.attempt, ok: false };
    try {
      const { value: res, retries } = await withTimeoutAndRetry(async (signal) => {
        try {
          return await this.client.messages.create(
            {
              model: this.model,
              max_tokens: req.maxTokens,
              system: req.system,
              tools: [{ name: req.schemaName, description: "Return the structured result.", input_schema: req.jsonSchema as Anthropic.Tool.InputSchema }],
              tool_choice: { type: "tool", name: req.schemaName },
              messages: [{ role: "user", content: req.user }],
            },
            { signal },
          );
        } catch (e) {
          if (e instanceof Anthropic.APIError && isTransientStatus(e.status)) throw new TransientError(`HTTP ${e.status}: ${e.message}`);
          if (e instanceof Anthropic.APIConnectionError) throw new TransientError(e.message);
          throw e;
        }
      }, this.o);
      const block = res.content.find((b) => b.type === "tool_use");
      const raw = block && "input" in block ? block.input : null;
      const v = req.validate(raw);
      const call: LlmCall = {
        ...base,
        latencyMs: round1(performance.now() - t0),
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        costUsd: costUsd(this.o, res.usage.input_tokens, res.usage.output_tokens),
        ok: v.ok,
        error: v.ok ? (retries ? `ok after ${retries} transport retr${retries === 1 ? "y" : "ies"}` : undefined) : `schema: ${v.error}`,
      };
      return { data: v.ok ? v.data : null, call };
    } catch (e) {
      return { data: null, call: { ...base, latencyMs: round1(performance.now() - t0), error: errMsg(e) } };
    }
  }
}
