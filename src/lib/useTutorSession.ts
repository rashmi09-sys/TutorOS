"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionState, StudentEvent, TurnTrace } from "@/engine/types";
import type { LessonId } from "@/engine/subjects/types";
import { clearSession, loadSession, saveSession } from "./storage";

export type TeacherInfo = { mode: "deterministic" | "llm"; name: string };

function eventId() {
  const c = globalThis.crypto;
  return c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Client session controller.
 *
 * The server is stateless; the browser holds the session state plus the HMAC
 * signature the server issued for it (so it can't be edited), and resumes it
 * after a reload. Every event carries an id: a network retry re-sends the same
 * event against the same base state (safe), and a late response for a state
 * we've already moved past is discarded.
 */
export function useTutorSession<S extends { turn: number; sessionId: string } = SessionState>(lesson: LessonId = "algebra") {
  const [state, setState] = useState<S | null>(null);
  const [traces, setTraces] = useState<TurnTrace[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReset, setNeedsReset] = useState(false);
  const [teacher, setTeacher] = useState<TeacherInfo | null>(null);
  const [resumed, setResumed] = useState(false);
  const [lastUtterance, setLastUtterance] = useState<{ text: string; id: string } | null>(null);
  const [pendingStudent, setPendingStudent] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const stateRef = useRef<S | null>(null);
  const sigRef = useRef<string | null>(null);
  const tracesRef = useRef<TurnTrace[]>([]);
  const inflight = useRef(false);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => setTeacher({ mode: h.teacher.mode, name: h.teacher.mode === "llm" ? `${h.teacher.provider}:${h.teacher.model}` : "deterministic" }))
      .catch(() => setTeacher({ mode: "deterministic", name: "deterministic" }));
    const stored = loadSession(lesson);
    if (stored?.state && stored.stateSig) {
      stateRef.current = stored.state as unknown as S;
      sigRef.current = stored.stateSig;
      tracesRef.current = stored.traces ?? [];
      setState(stored.state as unknown as S);
      setTraces(stored.traces ?? []);
      setResumed(stored.state.turn > 0);
    }
  }, [lesson]);

  const post = async (body: unknown, signal: AbortSignal) => {
    const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal };
    try {
      return await fetch("/api/turn", init);
    } catch (e) {
      if (signal.aborted) throw e;
      setRecovering(true); // visible "retrying once" state
      await new Promise((r) => setTimeout(r, 600));
      try {
        return await fetch("/api/turn", init); // same event id + same base state: idempotent
      } finally {
        setRecovering(false);
      }
    }
  };

  const send = useCallback(async (ev: StudentEvent) => {
    if (inflight.current) return false;
    inflight.current = true;
    setBusy(true);
    setError(null);
    const event = { ...ev, id: eventId() } as StudentEvent;
    const baseTurn = stateRef.current?.turn ?? -1;
    if (event.type === "text") setPendingStudent(event.text);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await post({ lesson, state: stateRef.current, stateSig: sigRef.current, event }, ac.signal);
      const data = await res.json();
      if (res.status === 409) {
        setNeedsReset(true);
        throw new Error(data.detail ?? "This lesson can't be resumed.");
      }
      if (res.status === 429) throw new Error("You're going a bit fast — wait a moment and try again.");
      if (!res.ok) throw new Error(`${data.error ?? "Something went wrong"} (ref ${data.requestId ?? "?"})`);
      if (data.duplicate || (stateRef.current?.turn ?? -1) !== baseTurn) return true; // already applied / stale
      stateRef.current = data.state;
      sigRef.current = data.stateSig;
      tracesRef.current = [...tracesRef.current, data.trace];
      setState(data.state);
      setTraces(tracesRef.current);
      setTeacher(data.teacher);
      setResumed(false);
      setLastUtterance({ text: data.utterance, id: data.trace.turnId });
      saveSession({ state: data.state, stateSig: data.stateSig, traces: tracesRef.current, teacher: data.teacher, updatedAt: new Date().toISOString() }, lesson);
      return true;
    } catch (e) {
      if (ac.signal.aborted) return false; // cancelled by the student: state unchanged (the server is stateless)
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      abortRef.current = null;
      setPendingStudent(null);
      inflight.current = false;
      setBusy(false);
    }
  }, [lesson]);

  /** Cancel an in-flight turn. Safe: nothing is applied until a response arrives. */
  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const restart = useCallback(async () => {
    clearSession(lesson);
    stateRef.current = null;
    sigRef.current = null;
    tracesRef.current = [];
    setState(null);
    setTraces([]);
    setLastUtterance(null);
    setNeedsReset(false);
    setResumed(false);
    await send({ type: "start" });
  }, [send, lesson]);

  return { state, traces, busy, error, needsReset, teacher, resumed, recovering, lastUtterance, pendingStudent, send, restart, cancel };
}
