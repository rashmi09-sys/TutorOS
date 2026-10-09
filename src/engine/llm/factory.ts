import { AnthropicProvider } from "./anthropic";
import { OpenAICompatibleProvider } from "./openai";
import type { LlmProvider, ProviderOptions } from "./provider";
import { DeterministicTeacher, LlmTeacher, type TeachingModel } from "./teacher";

/**
 * Server-only. Reads provider configuration from the environment; secrets never reach the browser.
 *
 *   LLM_PROVIDER      anthropic | openai   (default: whichever key is present; anthropic first)
 *   LLM_MODEL         model id             (default: claude-haiku-5-5 / gpt-4.1-mini)
 *   ANTHROPIC_API_KEY / OPENAI_API_KEY
 *   OPENAI_BASE_URL   any OpenAI-compatible endpoint
 *   LLM_TIMEOUT_MS    per-call timeout (default 8000)
 *   LLM_MAX_CALLS_PER_SESSION  model calls one lesson may make before it continues deterministically (default 150)
 *   PRICE_INPUT_PER_MTOK / PRICE_OUTPUT_PER_MTOK   USD per million tokens; unset = cost shown as unknown
 */
export interface ProviderInfo {
  configured: boolean;
  provider: string | null;
  model: string | null;
  pricingConfigured: boolean;
}

function num(v?: string) {
  return v && !Number.isNaN(Number(v)) ? Number(v) : null;
}

export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): LlmProvider | null {
  const want = (env.LLM_PROVIDER ?? "").toLowerCase();
  const opts = (defaultModel: string): ProviderOptions => ({
    model: env.LLM_MODEL || env.ANTHROPIC_MODEL || defaultModel,
    timeoutMs: num(env.LLM_TIMEOUT_MS) ?? 8000,
    transportRetries: 1,
    priceInPerMTok: num(env.PRICE_INPUT_PER_MTOK),
    priceOutPerMTok: num(env.PRICE_OUTPUT_PER_MTOK),
  });
  if ((want === "anthropic" || !want) && env.ANTHROPIC_API_KEY) return new AnthropicProvider(env.ANTHROPIC_API_KEY, opts("claude-haiku-5-5"));
  if ((want === "openai" || !want) && env.OPENAI_API_KEY) return new OpenAICompatibleProvider(env.OPENAI_API_KEY, { ...opts("gpt-4.1-mini"), model: env.LLM_MODEL || "gpt-4.1-mini" }, env.OPENAI_BASE_URL);
  return null;
}

export function providerInfo(env: NodeJS.ProcessEnv = process.env): ProviderInfo {
  const p = providerFromEnv(env);
  return { configured: !!p, provider: p?.provider ?? null, model: p?.model ?? null, pricingConfigured: num(env.PRICE_INPUT_PER_MTOK) != null && num(env.PRICE_OUTPUT_PER_MTOK) != null };
}

/** "llm" when a provider is configured (or requested and available), else deterministic. Never pretends. */
export function teacherFromEnv(prefer?: "deterministic" | "llm"): TeachingModel {
  if (prefer === "deterministic") return new DeterministicTeacher();
  const p = providerFromEnv();
  return p ? new LlmTeacher(p) : new DeterministicTeacher();
}

/** Per-session model-call budget (cost control). Invalid or missing → 150; 0 means no model calls at all. */
export function maxModelCallsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const n = num(env.LLM_MAX_CALLS_PER_SESSION);
  return n != null && n >= 0 ? Math.floor(n) : 150;
}
