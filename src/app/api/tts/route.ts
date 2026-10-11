import { NextResponse } from "next/server";
import { z } from "zod";
import { clientKey, rateLimit } from "@/lib/server/rate-limit";
import { logEvent } from "@/lib/server/log";
import { currentUser, unauthorized } from "@/lib/auth/server";
import { cacheGet, cacheKey, cachePut, effectiveRate, refundBudget, reserveBudget, synthesize, ttsConfig } from "@/lib/server/tts";

/**
 * POST /api/tts  { text, rate? } → audio/mpeg
 *
 * The tutor's voice: Google Cloud Text-to-Speech, Chirp 3 HD (default en-US-Chirp3-HD-Sulafat), through the
 * official client library with Application Default Credentials (local) or Workload Identity Federation
 * (Vercel). Off unless GOOGLE_TTS_ENABLED=true: 503 and no network call.
 * Every refusal carries `fallback: "browser"` so the client speaks with speechSynthesis instead.
 * `rate` is a relative pace (1 = normal, 0.87 ≈ "slow") applied to GOOGLE_TTS_SPEAKING_RATE.
 * Never logs the text, credentials or error messages (only a status category and code).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const MAX_BODY_BYTES = 16 * 1024;
const Body = z.object({ text: z.string(), rate: z.number().min(0.25).max(2).optional() }).strict();

function json(body: unknown, status: number, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store", ...extra } });
}

function audio(bytes: Uint8Array, cached: boolean) {
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: { "content-type": "audio/mpeg", "content-length": String(bytes.byteLength), "cache-control": "no-store", "x-tts-cache": cached ? "hit" : "miss" },
  });
}

export async function POST(req: Request) {
  // Billable: only a signed-in session may use it (the middleware checks too; this is defence in depth).
  if (!(await currentUser(req))) return unauthorized();
  const cfg = ttsConfig();
  if (!cfg.enabled) return json({ enabled: false, fallback: "browser" }, 503);

  const rl = rateLimit(`tts:${clientKey(req)}`, cfg.rateLimitPerMinute, 60_000);
  if (!rl.ok) return json({ error: "rate_limited", fallback: "browser" }, 429, { "retry-after": String(rl.retryAfterS) });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json({ error: "too_large", fallback: "browser" }, 413);

  let body: z.infer<typeof Body>;
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return json({ error: "bad_request", fallback: "browser" }, 400);
    body = parsed.data;
  } catch {
    return json({ error: "bad_request", fallback: "browser" }, 400);
  }
  const text = body.text.trim();
  if (!text) return json({ error: "bad_request", fallback: "browser" }, 400);
  if (text.length > cfg.maxCharsPerRequest) return json({ error: "text_too_long", maxChars: cfg.maxCharsPerRequest, fallback: "browser" }, 413);

  const rate = effectiveRate(cfg, body.rate);
  const key = cacheKey(cfg.voice, rate, text);
  const hit = cacheGet(key);
  if (hit) {
    logEvent({ evt: "tts", result: "cache_hit", chars: text.length });
    return audio(hit, true);
  }

  if (!reserveBudget(text.length, cfg)) {
    logEvent({ evt: "tts", result: "daily_budget_exhausted", chars: text.length });
    return json({ error: "daily_budget_exhausted", fallback: "browser" }, 429);
  }

  const t0 = Date.now();
  const r = await synthesize(text, rate, cfg);
  if (!r.ok) {
    refundBudget(text.length);
    logEvent({ evt: "tts", result: r.kind, upstreamCode: r.code ?? null, chars: text.length, ms: Date.now() - t0 });
    if (r.kind === "timeout") return json({ error: "upstream_timeout", fallback: "browser" }, 504);
    if (r.kind === "quota") return json({ error: "upstream_quota", fallback: "browser" }, 429, { "retry-after": "60" });
    if (r.kind === "auth") return json({ error: "upstream_auth", fallback: "browser" }, 502);
    return json({ error: "upstream_error", fallback: "browser" }, 502);
  }
  cachePut(key, r.audio);
  logEvent({ evt: "tts", result: "ok", chars: text.length, bytes: r.audio.byteLength, ms: Date.now() - t0 });
  return audio(r.audio, false);
}
