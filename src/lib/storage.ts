import type { LessonId } from "@/engine/subjects/types";
import type { AlgebraView, SubjectView } from "@/engine/view-types";

/**
 * What the browser keeps between visits: the redacted view (to draw the page) and the sealed state (opaque,
 * encrypted by the server, bound to the lesson and the signed-in user). Nothing in here is trusted: the server
 * only ever continues from the sealed state, and editing either one gets the lesson refused, not changed.
 *
 * v3 keys: older saves (which held the full state and traces) are removed on first load.
 */
export const SESSION_KEY = "tutoros.session.v3";
export const EVAL_HISTORY_KEY = "tutoros.evalHistory.v2";
const LEGACY_KEYS = ["tutoros.session.v1", "tutoros.session.v2", "tutoros.session.geometry.v1", "tutoros.session.physics.v1"];
/** Each lesson keeps its own session, so moving between lessons never loses progress. */
export const sessionKey = (lesson: LessonId = "algebra") => (lesson === "algebra" ? SESSION_KEY : `tutoros.session.${lesson}.v2`);

export interface StoredSession<V = AlgebraView | SubjectView> {
  view: V | null;
  sealed: string | null;
  teacher: { mode: "deterministic" | "llm"; name: string } | null;
  updatedAt: string;
}

function dropLegacy() {
  try {
    for (const k of LEGACY_KEYS) localStorage.removeItem(k);
  } catch {}
}

export function loadSession(lesson: LessonId = "algebra"): StoredSession | null {
  dropLegacy();
  try {
    const raw = localStorage.getItem(sessionKey(lesson));
    const s = raw ? (JSON.parse(raw) as StoredSession) : null;
    return s && typeof s.sealed === "string" && s.view ? s : null;
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
  } catch {}
  dropLegacy();
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
