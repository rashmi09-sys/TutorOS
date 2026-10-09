import { NextResponse } from "next/server";
import { maxModelCallsFromEnv, providerInfo } from "@/engine/llm/factory";
import { signingMode } from "@/lib/server/session-token";

export const dynamic = "force-dynamic";

export async function GET() {
  const p = providerInfo();
  const signing = signingMode();
  return NextResponse.json(
    {
      ok: true,
      status: signing === "configured" ? "ok" : "degraded",
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
      teacher: p.configured ? { mode: "llm", provider: p.provider, model: p.model } : { mode: "deterministic", provider: null, model: null },
      pricingConfigured: p.pricingConfigured,
      sessionSigning: signing === "configured" ? "configured" : "dev-default key — set SESSION_SECRET (≥32 chars) in production",
      rateLimiting: "in-memory, per instance",
      // Model limits (shown in the Engineer View). Only meaningful when a provider is configured.
      limits: { timeoutMs: Number(process.env.LLM_TIMEOUT_MS) || 8000, maxModelCallsPerSession: maxModelCallsFromEnv(), retries: 1 },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
