import { NextResponse } from "next/server";
import { z } from "zod";
import { runSuite, type SuiteResult } from "@/engine/eval/runner";
import { runSubjectSuite } from "@/engine/subjects/eval";
import { DeterministicTeacher, LlmTeacher } from "@/engine/llm/teacher";
import { providerFromEnv } from "@/engine/llm/factory";
import { clientKey, rateLimit } from "@/lib/server/rate-limit";
import { logEvent } from "@/lib/server/log";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({ suites: z.array(z.enum(["A", "B", "C", "G", "P"])).min(1).max(5).default(["A", "B", "C", "G", "P"]) });

/**
 * Runs the scenario suite live against the same engine the student UI uses.
 *   A = baseline answer-giver (negative control), B = tutor-v1 deterministic, C = tutor-v1 + LLM.
 * C costs money, so in production it requires the x-eval-token header to match EVAL_TOKEN.
 */
export async function POST(req: Request) {
  const requestId = `req_${crypto.randomUUID().slice(0, 8)}`;
  const rl = rateLimit(`eval:${clientKey(req)}`, 6, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many eval runs — try again shortly.", requestId }, { status: 429, headers: { "retry-after": String(rl.retryAfterS) } });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", requestId }, { status: 400 });

  const det = new DeterministicTeacher();
  const out: Record<string, SuiteResult | { notRun: string }> = {};
  for (const s of parsed.data.suites) {
    if (s === "A") out.A = await runSuite(det, "baseline-answer-giver", { label: "A · baseline answer-giver (negative control)" });
    if (s === "B") out.B = await runSuite(det, "tutor-v1", { label: "B · tutor-v1, deterministic" });
    if (s === "G") out.G = await runSubjectSuite("geometry", det);
    if (s === "P") out.P = await runSubjectSuite("physics", det);
    if (s === "C") {
      const p = providerFromEnv();
      const token = process.env.EVAL_TOKEN;
      const allowed = process.env.NODE_ENV !== "production" || (!!token && req.headers.get("x-eval-token") === token);
      if (!p) out.C = { notRun: "No LLM provider configured on the server (set ANTHROPIC_API_KEY or OPENAI_API_KEY). Not simulated." };
      else if (!allowed) out.C = { notRun: "LLM evals cost money; in production they require the x-eval-token header matching EVAL_TOKEN." };
      else out.C = await runSuite(new LlmTeacher(p), "tutor-v1", { label: `C · tutor-v1 + ${p.provider}:${p.model}` });
    }
  }
  logEvent({ level: "info", route: "eval", requestId, suites: parsed.data.suites.join(",") });
  return NextResponse.json({ requestId, ranAt: new Date().toISOString(), ...out }, { headers: { "x-request-id": requestId, "cache-control": "no-store" } });
}
