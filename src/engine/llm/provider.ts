import type { LlmCall } from "../types";

/**
 * Provider seam. The teaching engine never imports a vendor SDK — it talks to
 * an LlmProvider that turns (system, user, JSON schema) into validated JSON plus
 * an honest LlmCall record. Swapping vendors means adding one class here.
 */
export interface JsonRequest<T> {
  purpose: LlmCall["purpose"];
  system: string;
  user: string;
  schemaName: string;
  /** Strict JSON Schema (additionalProperties: false) sent to the provider. */
  jsonSchema: Record<string, unknown>;
  /** Our own validation of whatever came back — never trust the provider's schema enforcement alone. */
  validate: (raw: unknown) => { ok: true; data: T } | { ok: false; error: string };
  maxTokens: number;
  attempt: number;
}

export interface JsonResponse<T> {
  data: T | null;
  call: LlmCall;
}

export interface LlmProvider {
  readonly provider: string;
  readonly model: string;
  generateJson<T>(req: JsonRequest<T>): Promise<JsonResponse<T>>;
}

export interface ProviderOptions {
  model: string;
  timeoutMs: number;
  /** Retries for transient transport failures (timeouts, 429, 5xx). Validation failures are handled by the teacher, not here. */
  transportRetries: number;
  priceInPerMTok: number | null;
  priceOutPerMTok: number | null;
}

export function costUsd(o: ProviderOptions, inTok: number, outTok: number): number | null {
  if (o.priceInPerMTok == null || o.priceOutPerMTok == null) return null; // we never guess prices
  return (inTok * o.priceInPerMTok + outTok * o.priceOutPerMTok) / 1e6;
}

export class TransientError extends Error {}

/** Run fn with an AbortSignal that fires after timeoutMs; retry transient failures with backoff. */
export async function withTimeoutAndRetry<T>(fn: (signal: AbortSignal) => Promise<T>, o: ProviderOptions): Promise<{ value: T; retries: number }> {
  let lastErr: unknown;
  for (let i = 0; i <= o.transportRetries; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error(`timeout after ${o.timeoutMs} ms`)), o.timeoutMs);
    try {
      const value = await fn(ac.signal);
      return { value, retries: i };
    } catch (e) {
      lastErr = ac.signal.aborted ? new TransientError(`timeout after ${o.timeoutMs} ms`) : e;
      if (!(lastErr instanceof TransientError) || i === o.transportRetries) break;
      await new Promise((r) => setTimeout(r, 300 * 2 ** i));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export function isTransientStatus(status?: number) {
  return status === 408 || status === 409 || status === 429 || (status != null && status >= 500);
}

export function errMsg(e: unknown) {
  return (e instanceof Error ? e.message : String(e)).slice(0, 240);
}

export function round1(n: number) {
  return Math.round(n * 10) / 10;
}
