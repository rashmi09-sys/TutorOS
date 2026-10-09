import type { SessionState, TurnTrace } from "@/engine/types";
import type { LessonId, SubjectState } from "@/engine/subjects/types";

/** v2: state is signed by the server; v1 (unsigned) sessions are ignored rather than trusted. */
export const SESSION_KEY = "tutoros.session.v2";
export const EVAL_HISTORY_KEY = "tutoros.evalHistory.v2";
/** Each lesson keeps its own session, so moving between lessons never loses progress. */
export const sessionKey = (lesson: LessonId = "algebra") => (lesson === "algebra" ? SESSION_KEY : `tutoros.session.${lesson}.v1`);

export interface StoredSession<S = SessionState | SubjectState> {
  state: S | null;
  stateSig: string | null;
  traces: TurnTrace[];
  teacher: { mode: "deterministic" | "llm"; name: string } | null;
  updatedAt: string;
}

export function loadSession(lesson: LessonId = "algebra"): StoredSession | null {
  try {
    const raw = localStorage.getItem(sessionKey(lesson));
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: StoredSession, lesson: LessonId = "algebra") {
  try {
    localStorage.setItem(sessionKey(lesson), JSON.stringify(s));
  } catch {
    /* storage full or blocked — the lesson still works in memory */
  }
}

export function clearSession(lesson: LessonId = "algebra") {
  try {
    localStorage.removeItem(sessionKey(lesson));
    if (lesson === "algebra") localStorage.removeItem("tutoros.session.v1");
  } catch {}
}

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}
