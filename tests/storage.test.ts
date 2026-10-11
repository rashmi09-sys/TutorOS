/** Per-lesson progress in the browser: each lesson has its own key, and clearing one leaves the others. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearSession, loadSession, saveSession, sessionKey, type StoredSession } from "@/lib/storage";

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

const g = globalThis as unknown as { localStorage?: unknown };
const stored = (turn: number): StoredSession => ({ view: { version: 1, sessionId: `s${turn}`, turn } as never, sealed: "s1.opaque", teacher: null, updatedAt: "2026-10-09T00:00:00Z" });

describe("lesson progress storage", () => {
  beforeEach(() => {
    g.localStorage = new MemoryStorage();
  });
  afterEach(() => {
    delete g.localStorage;
  });

  it("uses a separate key per lesson, and removes old saves that held the full state and traces", () => {
    expect(sessionKey("algebra")).toBe("tutoros.session.v3");
    expect(sessionKey()).toBe("tutoros.session.v3");
    const ls = g.localStorage as MemoryStorage;
    ls.setItem("tutoros.session.v2", JSON.stringify({ state: { answer: "5" }, traces: [{ decision: {} }] }));
    ls.setItem("tutoros.session.physics.v1", "{}");
    expect(loadSession("algebra")).toBeNull();
    expect(ls.getItem("tutoros.session.v2")).toBeNull();
    expect(ls.getItem("tutoros.session.physics.v1")).toBeNull();
    expect(new Set([sessionKey("algebra"), sessionKey("physics"), sessionKey("geometry")]).size).toBe(3);
  });

  it("saves and resumes each lesson independently; clearing one leaves the others", () => {
    saveSession(stored(3), "algebra");
    saveSession(stored(5), "physics");
    saveSession(stored(7), "geometry");
    expect((loadSession("physics")?.view as { turn: number }).turn).toBe(5);
    clearSession("physics");
    expect(loadSession("physics")).toBeNull();
    expect((loadSession("algebra")?.view as { turn: number }).turn).toBe(3);
    expect((loadSession("geometry")?.view as { turn: number }).turn).toBe(7);
  });

  it("never throws when storage is blocked or corrupt — the lesson just starts fresh", () => {
    g.localStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(loadSession("geometry")).toBeNull();
    expect(() => saveSession(stored(1), "geometry")).not.toThrow();
    expect(() => clearSession("geometry")).not.toThrow();
    g.localStorage = new MemoryStorage();
    (g.localStorage as MemoryStorage).setItem(sessionKey("physics"), "{not json");
    expect(loadSession("physics")).toBeNull();
  });

  it("ignores a save without a sealed state", () => {
    (g.localStorage as MemoryStorage).setItem(sessionKey("algebra"), JSON.stringify({ view: { turn: 3 }, sealed: null }));
    expect(loadSession("algebra")).toBeNull();
  });
});
