import type { SessionState, TurnTrace } from "./types";

/**
 * Persistence seam. The demo keeps state in the browser (zero infra, works on
 * Vercel). A production deployment would implement this against Postgres
 * (e.g. Supabase): `sessions(id, state jsonb, updated_at)` and
 * `turn_traces(session_id, turn, trace jsonb)` — server-side, so clients can't
 * tamper with mastery state.
 */
export interface SessionStore {
  load(sessionId: string): Promise<SessionState | null>;
  save(state: SessionState, trace: TurnTrace): Promise<void>;
}

/** Reference implementation (tests, single-process dev). */
export class MemorySessionStore implements SessionStore {
  private states = new Map<string, SessionState>();
  readonly traces: TurnTrace[] = [];
  async load(id: string) {
    return this.states.get(id) ?? null;
  }
  async save(state: SessionState, trace: TurnTrace) {
    this.states.set(state.sessionId, state);
    this.traces.push(trace);
  }
}
