import { createHash } from "node:crypto";

/**
 * Structured, privacy-conscious server logs: ids, rules, timings, counts.
 * Never student text, never utterances, never raw session ids (hashed).
 * The full trace goes back to the client that owns the session, not to logs.
 */
export function hashId(id: string) {
  return createHash("sha256").update(id).digest("hex").slice(0, 10);
}

export function logEvent(fields: Record<string, string | number | boolean | null | undefined>) {
  if (process.env.NODE_ENV === "test") return;
  console.log(JSON.stringify({ ts: new Date().toISOString(), svc: "tutoros", ...fields }));
}
