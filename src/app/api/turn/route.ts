import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, step } from "@/engine/engine";
import { maxModelCallsFromEnv, teacherFromEnv } from "@/engine/llm/factory";
import type { SessionState, TurnTrace } from "@/engine/types";
import { SUBJECTS, createSubjectSession, stepSubject, type SubjectState } from "@/engine/subjects";
import { signState, verifyState } from "@/lib/server/session-token";
import { clientKey, rateLimit } from "@/lib/server/rate-limit";
import { hashId, logEvent } from "@/lib/server/log";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 512 * 1024;
const EventId = z.string().regex(/^[A-Za-z0-9_-]{6,64}$/).optional();
const Event = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start"), id: EventId }),
  z.object({
    type: z.literal("text"),
    text: z.string().trim().min(1).max(500),
    via: z.enum(["keyboard", "voice"]),
    interruptedTutor: z.boolean().optional(),
    id: EventId,
    source: z.enum(["typed", "help-option", "board"]).optional(),
    // How a spoken line was captured — console diagnostics only, never used for teaching.
    voice: z
      .object({
        segments: z.number().int().min(0).max(1000),
        interimUpdates: z.number().int().min(0).max(100000),
        duplicateEventsIgnored: z.number().int().min(0).max(100000),
        autoResumes: z.number().int().min(0).max(10),
        durationMs: z.number().min(0).max(3_600_000),
        endedBy: z.enum(["done", "pause", "after-interruption"]),
      })
      .optional(),
  }),
  z.object({ type: z.literal("silence"), ms: z.number().int().min(0).max(600000), id: EventId }),
]);
const Body = z.object({
  state: z.object({ version: z.literal(1), sessionId: z.string().min(1).max(100), turn: z.number().int().min(0) }).passthrough().nullable(),
  stateSig: z.string().max(200).nullable().optional(),
  event: Event,
  mode: z.enum(["deterministic", "llm"]).optional(),
  /** Which lesson the state belongs to. Each lesson has its own verifier; states can't cross lessons. */
  lesson: z.enum(["algebra", "geometry", "physics"]).default("algebra"),
});

function json(body: unknown, status: number, requestId: string, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { "x-request-id": requestId, "cache-control": "no-store", ...extra } });
}

export async function POST(req: Request) {
  const requestId = `req_${crypto.randomUUID().slice(0, 8)}`;
  const t0 = Date.now();
  const rl = rateLimit(`turn:${clientKey(req)}`, 60, 60_000);
  if (!rl.ok) return json({ error: "Too many requests — slow down a little.", requestId }, 429, requestId, { "retry-after": String(rl.retryAfterS) });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json({ error: "Request too large", requestId }, 413, requestId);

  let body: z.infer<typeof Body>;
  let rawState: unknown = null;
  try {
    const raw = await req.json();
    body = Body.parse(raw);
    // Verify and use the state exactly as sent: re-serialising zod's output would reorder keys and break the HMAC.
    rawState = (raw as { state?: unknown }).state ?? null;
  } catch (e) {
    return json({ error: "Invalid request", detail: e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) : "malformed JSON", requestId }, 400, requestId);
  }
  if (rawState && !verifyState(rawState, body.stateSig)) {
    logEvent({ level: "warn", route: "turn", requestId, event: "state_signature_rejected" });
    return json({ error: "session_unverifiable", detail: "This saved lesson can't be verified (it was changed, or the server key rotated). Please start a new lesson.", requestId }, 409, requestId);
  }

  const stateLesson = rawState ? ((rawState as { lesson?: string }).lesson ?? "algebra") : body.lesson;
  if (stateLesson !== body.lesson) return json({ error: "Invalid request", detail: "The saved state belongs to a different lesson.", requestId }, 400, requestId);

  try {
    const teacher = teacherFromEnv(body.mode);
    const newId = `ses_${crypto.randomUUID().slice(0, 12)}`;
    const seed = Math.floor(Math.random() * 1e6);
    let r: { state: SessionState | SubjectState; utterance: string; trace: TurnTrace; duplicate?: boolean };
    if (body.lesson === "algebra") {
      const state: SessionState = (rawState as SessionState | null) ?? createSession({ sessionId: newId, seed });
      r = await step(state, body.event, { teacher, requestId, maxModelCalls: maxModelCallsFromEnv() });
    } else {
      const mod = SUBJECTS[body.lesson];
      const state: SubjectState = (rawState as SubjectState | null) ?? createSubjectSession(mod, { sessionId: newId, seed });
      r = await stepSubject(mod, state, body.event, { teacher, requestId, maxModelCalls: maxModelCallsFromEnv() });
    }
    const modelCalls = r.trace.llmCalls.filter((c) => c.kind === "model");
    logEvent({
      level: "info",
      route: "turn",
      lesson: body.lesson,
      requestId,
      traceId: hashId(r.trace.turnId),
      session: hashId(r.state.sessionId),
      turn: r.state.turn,
      event: body.event.type,
      rule: r.trace.decision.rule,
      decisionSource: r.trace.decisionSource,
      duplicate: !!r.duplicate,
      modelCalls: modelCalls.length,
      tokens: modelCalls.reduce((s, c) => s + c.inputTokens + c.outputTokens, 0),
      fallback: r.trace.fallbackUsed,
      engineMs: r.trace.totalLatencyMs,
      totalMs: Date.now() - t0,
    });
    return json({ ...r, stateSig: signState(r.state), teacher: { mode: teacher.mode, name: teacher.name }, requestId }, 200, requestId, { "x-trace-id": r.trace.turnId });
  } catch (e) {
    logEvent({ level: "error", route: "turn", requestId, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
    return json({ error: "Turn failed", requestId }, 500, requestId);
  }
}
