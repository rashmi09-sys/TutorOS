import { createHash } from "node:crypto";

/**
 * Cloud voice: Google Cloud Text-to-Speech (Chirp 3 HD) through the official client library,
 * `@google-cloud/text-to-speech`, on the server only.
 *
 * Turned on explicitly with GOOGLE_TTS_ENABLED=true (a paid API — never on by accident).
 * Authentication — no API keys and no service-account key files:
 *  - "adc" (default): Application Default Credentials. Locally that's `gcloud auth application-default login`.
 *    On Vercel ADC finds nothing, so production uses:
 *  - "vercel-oidc": Workload Identity Federation. Vercel's short-lived OIDC token for this deployment is
 *    exchanged by Google STS for a short-lived token impersonating a service account that only has the
 *    Text-to-Speech permission. Chosen automatically when the GCP_* federation variables are all set.
 * Credentials and tokens never leave this module: the browser only ever talks to /api/tts.
 *
 * Cost controls (in-memory, per server instance — a guard rail, not a distributed quota):
 * max characters per request, a daily character budget, a per-client rate limit (in the route),
 * a timeout, and an LRU cache so Replay of the same turn never pays twice.
 */

export const DEFAULT_TTS_VOICE = "en-US-Chirp3-HD-Sulafat";
export const TTS_RATE_LIMIT_PER_MINUTE = 30;
const CACHE_ENTRIES = 100;

export type TtsAuthMode = "adc" | "vercel-oidc";

export interface TtsConfig {
  enabled: boolean;
  auth: TtsAuthMode;
  projectId: string | null;
  /** Workload Identity Federation (only for auth = "vercel-oidc"). Not secrets, but never sent to the client. */
  wif: { projectNumber: string; poolId: string; providerId: string; serviceAccountEmail: string; oidcAudience: string | null } | null;
  voice: string;
  languageCode: string;
  speakingRate: number;
  maxCharsPerRequest: number;
  maxCharsPerDay: number;
  timeoutMs: number;
  rateLimitPerMinute: number;
}

const clampRate = (r: number) => Math.min(2, Math.max(0.25, r));
const posInt = (v: string | undefined, d: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : d;
};
const str = (v: string | undefined) => v?.trim() || null;

/** "en-US-Chirp3-HD-Sulafat" → "en-US". */
export function languageCodeOf(voice: string): string {
  const [a, b] = voice.split("-");
  return a && b ? `${a}-${b}` : "en-US";
}

export function ttsConfig(env: Record<string, string | undefined> = process.env): TtsConfig {
  const voice = str(env.GOOGLE_TTS_VOICE) ?? DEFAULT_TTS_VOICE;
  const rawRate = Number(env.GOOGLE_TTS_SPEAKING_RATE);
  const projectNumber = str(env.GCP_PROJECT_NUMBER);
  const poolId = str(env.GCP_WORKLOAD_IDENTITY_POOL_ID);
  const providerId = str(env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID);
  const serviceAccountEmail = str(env.GCP_SERVICE_ACCOUNT_EMAIL);
  const wif = projectNumber && poolId && providerId && serviceAccountEmail ? { projectNumber, poolId, providerId, serviceAccountEmail, oidcAudience: str(env.GCP_OIDC_AUDIENCE) } : null;
  return {
    enabled: env.GOOGLE_TTS_ENABLED?.trim().toLowerCase() === "true",
    auth: wif ? "vercel-oidc" : "adc",
    projectId: str(env.GOOGLE_CLOUD_PROJECT) ?? str(env.GCP_PROJECT_ID),
    wif,
    voice,
    languageCode: languageCodeOf(voice),
    speakingRate: clampRate(env.GOOGLE_TTS_SPEAKING_RATE && Number.isFinite(rawRate) ? rawRate : 1),
    maxCharsPerRequest: posInt(env.TTS_MAX_CHARS_PER_REQUEST, 1000),
    maxCharsPerDay: posInt(env.TTS_MAX_CHARS_PER_DAY, 100_000),
    timeoutMs: posInt(env.TTS_TIMEOUT_MS, 8000),
    rateLimitPerMinute: posInt(env.TTS_RATE_LIMIT_PER_MINUTE, TTS_RATE_LIMIT_PER_MINUTE),
  };
}

/** What /api/health may show: the mode and the limits. Never credentials, tokens or account identifiers. */
export function ttsPublicInfo(cfg: TtsConfig = ttsConfig()) {
  return {
    provider: cfg.enabled ? ("google-chirp3-hd" as const) : ("browser" as const),
    voice: cfg.enabled ? cfg.voice : null,
    auth: cfg.enabled ? cfg.auth : null,
    limits: {
      maxCharsPerRequest: cfg.maxCharsPerRequest,
      maxCharsPerDay: cfg.maxCharsPerDay,
      charsUsedToday: budget.day === today() ? budget.used : 0,
      requestsPerMinutePerClient: cfg.rateLimitPerMinute,
      timeoutMs: cfg.timeoutMs,
      scope: "in-memory, per instance",
    },
  };
}

/** Speaking rate actually sent: the configured rate times the client's relative pace (1 = normal), clamped. */
export function effectiveRate(cfg: TtsConfig, pace?: number): number {
  const r = clampRate(cfg.speakingRate * (pace && Number.isFinite(pace) ? pace : 1));
  return Math.round(r * 100) / 100;
}

/* ---------------- Daily budget (global, per instance) ---------------- */

const today = () => new Date().toISOString().slice(0, 10);
const budget = { day: today(), used: 0 };

/** Reserve `chars` from today's budget. False (and nothing reserved) if it would exceed it. */
export function reserveBudget(chars: number, cfg: TtsConfig): boolean {
  const d = today();
  if (budget.day !== d) {
    budget.day = d;
    budget.used = 0;
  }
  if (budget.used + chars > cfg.maxCharsPerDay) return false;
  budget.used += chars;
  return true;
}

/** Give back a reservation for a request that produced no audio. */
export function refundBudget(chars: number) {
  budget.used = Math.max(0, budget.used - chars);
}

/* ---------------- LRU cache (voice + rate + text hash) ---------------- */

const cache = new Map<string, Uint8Array>();

export function cacheKey(voice: string, rate: number, text: string) {
  return createHash("sha256").update(`${voice}\u0000${rate}\u0000${text}`).digest("hex");
}

export function cacheGet(key: string): Uint8Array | null {
  const v = cache.get(key);
  if (!v) return null;
  cache.delete(key); // refresh recency
  cache.set(key, v);
  return v;
}

export function cachePut(key: string, audio: Uint8Array) {
  cache.delete(key);
  cache.set(key, audio);
  while (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
}

/* ---------------- The Google client (official library) ---------------- */

/** The one method we use, so tests can pass a fake. Mirrors TextToSpeechClient.synthesizeSpeech. */
export interface SynthClient {
  synthesizeSpeech(
    request: { input: { text: string }; voice: { languageCode: string; name: string }; audioConfig: { audioEncoding: "MP3"; speakingRate: number } },
    options?: { timeout?: number; maxRetries?: number },
  ): Promise<[{ audioContent?: Uint8Array | string | null }, ...unknown[]]>;
}

let clientPromise: Promise<SynthClient> | null = null;
let clientKeyUsed = "";
let testClient: SynthClient | null = null;

/** Tests only: use this client instead of the real library (null = back to the real one). */
export function setTtsClientForTests(c: SynthClient | null) {
  testClient = c;
}

/** Tests only: forget the budget, the cache and the client. */
export function resetTtsState() {
  budget.day = today();
  budget.used = 0;
  cache.clear();
  clientPromise = null;
  clientKeyUsed = "";
}

/** Short-lived credentials on Vercel: the deployment's OIDC token → Google STS → service-account impersonation. */
async function vercelOidcAuthClient(w: NonNullable<TtsConfig["wif"]>) {
  const [{ ExternalAccountClient }, { getVercelOidcToken }] = await Promise.all([import("google-auth-library"), import("@vercel/oidc")]);
  const client = ExternalAccountClient.fromJSON({
    type: "external_account",
    audience: `//iam.googleapis.com/projects/${w.projectNumber}/locations/global/workloadIdentityPools/${w.poolId}/providers/${w.providerId}`,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${w.serviceAccountEmail}:generateAccessToken`,
    subject_token_supplier: { getSubjectToken: () => (w.oidcAudience ? getVercelOidcToken({ audience: w.oidcAudience }) : getVercelOidcToken()) },
  });
  if (!client) throw new Error("Workload Identity Federation configuration was rejected by google-auth-library");
  return client;
}

async function getClient(cfg: TtsConfig): Promise<SynthClient> {
  if (testClient) return testClient;
  const key = `${cfg.auth}|${cfg.projectId ?? ""}|${cfg.wif ? JSON.stringify(cfg.wif) : ""}`;
  if (!clientPromise || clientKeyUsed !== key) {
    clientKeyUsed = key;
    clientPromise = (async () => {
      const [{ TextToSpeechClient }, { GoogleAuth }] = await Promise.all([import("@google-cloud/text-to-speech"), import("google-auth-library")]);
      // Resolve credentials ourselves, inside our own error handling: if the library looks them up lazily
      // and finds none, that rejection can escape as an unhandled one and take the server process down.
      const authClient =
        cfg.auth === "vercel-oidc" && cfg.wif
          ? await vercelOidcAuthClient(cfg.wif)
          : await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"], ...(cfg.projectId ? { projectId: cfg.projectId } : {}) }).getClient();
      // `fallback: true` = the library's HTTP/1.1 REST transport: no long-lived gRPC channel, which suits
      // short serverless invocations and proxies. Same API, same request and response shapes.
      const client = new TextToSpeechClient({ fallback: true, authClient, ...(cfg.projectId ? { projectId: cfg.projectId } : {}) });
      await client.initialize();
      return client as unknown as SynthClient;
    })();
    // A failed construction (e.g. a bad WIF config) is retried on the next request, not cached forever.
    clientPromise.catch(() => {
      clientPromise = null;
    });
  }
  return clientPromise;
}

/* ---------------- Synthesis ---------------- */

export type SynthFailure = "timeout" | "quota" | "auth" | "upstream";
export type SynthResult = { ok: true; audio: Uint8Array } | { ok: false; kind: SynthFailure; code?: number | string };

/** gRPC status codes the client library reports (google-gax). */
const DEADLINE_EXCEEDED = 4, PERMISSION_DENIED = 7, RESOURCE_EXHAUSTED = 8, UNAUTHENTICATED = 16;

/** Map a client-library error to what the route reports. Never returns the error text (it can contain account details). */
export function classifyError(e: unknown): { kind: SynthFailure; code?: number | string } {
  const err = e as { code?: number | string; message?: string };
  const code = err?.code;
  const msg = String(err?.message ?? "");
  // Credential problems first: the library can wrap them in a retry/deadline error (code 4).
  if (/default credentials|could not load the default|invalid_grant|oidc|subject.token|sts\.googleapis|unauthenticated|permission[_ ]denied/i.test(msg)) return { kind: "auth", code };
  if (code === RESOURCE_EXHAUSTED || code === 429) return { kind: "quota", code };
  if (code === DEADLINE_EXCEEDED) return { kind: "timeout", code };
  if (code === UNAUTHENTICATED || code === PERMISSION_DENIED || code === 401 || code === 403 || /default credentials|could not load the default|invalid_grant|unauthenticated|permission|oidc|subject.token|sts\.googleapis/i.test(msg)) return { kind: "auth", code };
  return { kind: "upstream", code };
}

/** One MP3 for `text` in the configured Chirp 3 HD voice. No retries (the client falls back to the browser voice). */
export async function synthesize(text: string, rate: number, cfg: TtsConfig): Promise<SynthResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SynthResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, kind: "timeout" }), cfg.timeoutMs);
  });
  const work = (async (): Promise<SynthResult> => {
    try {
      const client = await getClient(cfg);
      const [res] = await client.synthesizeSpeech(
        { input: { text }, voice: { languageCode: cfg.languageCode, name: cfg.voice }, audioConfig: { audioEncoding: "MP3", speakingRate: rate } },
        { timeout: cfg.timeoutMs, maxRetries: 0 },
      );
      const raw = res?.audioContent;
      const audio = typeof raw === "string" ? new Uint8Array(Buffer.from(raw, "base64")) : raw ? new Uint8Array(raw) : new Uint8Array();
      return audio.length ? { ok: true, audio } : { ok: false, kind: "upstream" };
    } catch (e) {
      return { ok: false, ...classifyError(e) };
    }
  })();
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
