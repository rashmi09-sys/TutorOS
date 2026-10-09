// Audit harness: each input is sent as the FIRST student turn on a fresh session (plus optional prefix).
import { createSession, step } from "../src/engine/engine";
import { DeterministicTeacher } from "../src/engine/llm/teacher";
const teacher = new DeterministicTeacher();
const prefix = (process.env.PREFIX ?? "").split("|").filter(Boolean);
(async () => {
  for (const text of process.argv.slice(2)) {
    let s = createSession({ sessionId: "audit", seed: 7 });
    s = (await step(s, { type: "start" }, { teacher })).state;
    for (const p of prefix) s = (await step(s, { type: "text", text: p, via: "keyboard" }, { teacher })).state;
    const r = await step(s, { type: "text", text, via: "keyboard" }, { teacher });
    const i = r.trace.intent as { kind?: string; value?: string } | undefined;
    console.log(`\n> ${text}\n  intent=${i?.kind}${i?.value ? `(${i.value})` : ""} diag=${r.trace.diagnosis?.id ?? "-"} rule=${r.trace.decision.rule} candidates=[${r.trace.candidates.map((c) => c.id).join(", ")}]`);
    if (r.trace.diagnosis) console.log(`  evidence: ${r.trace.diagnosis.evidence}`);
    console.log(`  tutor: ${r.utterance}`);
    const last = r.state.board[r.state.board.length - 1];
    console.log(`  board: ${last.latex} [${last.status}] ${last.note ?? ""}`);
  }
})();
