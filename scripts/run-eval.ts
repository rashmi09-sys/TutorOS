/**
 * CLI eval runner.
 *
 *   npm run eval                      # compare A (baseline), B (deterministic tutor-v1), C (LLM tutor-v1, if configured)
 *   npm run eval -- --only B          # one policy (A, B, C, or G / P for the geometry / physics lessons)
 *
 * Writes eval-results.json. Exit code 1 if policy B fails any scenario (CI gate).
 * Policy C is reported as "not run" when no provider credentials are configured — never simulated.
 */
import { existsSync, writeFileSync } from "node:fs";
import { runSuite, type SuiteResult } from "../src/engine/eval/runner";
import { DeterministicTeacher } from "../src/engine/llm/teacher";
import { providerFromEnv, providerInfo } from "../src/engine/llm/factory";
import { LlmTeacher } from "../src/engine/llm/teacher";
import { runSubjectSuite } from "../src/engine/subjects/eval";

// Same configuration as `next dev` / `next start`: read .env.local if present (variables already set in the shell win).
if (existsSync(".env.local") && typeof process.loadEnvFile === "function") process.loadEnvFile(".env.local");

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const only = arg("only");

function row(label: string, r: SuiteResult | null, note?: string) {
  if (!r) return `| ${label} | ${note} | | | | | | | | | | | |`;
  const m = r.metrics;
  const c = m.byCategory;
  const pct = (x: { passed: number; total: number }) => (x.total ? `${x.passed}/${x.total}` : "–");
  return `| ${label} | ${m.scenarios.passed}/${m.scenarios.total} | ${m.assertions.passed}/${m.assertions.total} | ${m.scenariosWithLeak} | ${m.falseMathStatements} | ${pct(c.diagnosis)} | ${pct(c.appropriateness)} | ${pct(c.recovery)} | ${pct(c.mastery)} | ${pct(c.context)} | ${pct(c.language)} | ${pct(c.repetition)} | ${m.latencyMs.p50}/${m.latencyMs.p95} ms · ${m.modelCalls} model calls · ${m.costUsd == null ? (m.modelCalls ? "cost unknown (no prices set)" : "no model cost") : `$${m.costUsd.toFixed(4)}`} |`;
}

(async () => {
  const det = new DeterministicTeacher();
  const out: Record<string, SuiteResult | null> = {};
  if (!only || only === "A") out.A = await runSuite(det, "baseline-answer-giver", { label: "A · baseline answer-giver" });
  if (!only || only === "B") out.B = await runSuite(det, "tutor-v1", { label: "B · tutor-v1 deterministic" });
  const p = providerFromEnv();
  if (!only || only === "C") out.C = p ? await runSuite(new LlmTeacher(p), "tutor-v1", { label: `C · tutor-v1 + ${p.provider}:${p.model}` }) : null;
  // Geometry (G) and physics (P): subject verifiers + shared kernel, deterministic.
  if (!only || only === "G") out.G = await runSubjectSuite("geometry", det);
  if (!only || only === "P") out.P = await runSubjectSuite("physics", det);

  console.log(`\nTutorOS eval — ${new Date().toISOString()}\n`);
  console.log("| Policy | Scenarios | Assertions | Scenarios with answer leak | False maths stated | Diagnosis | Appropriateness | Recovery | Mastery | Context | Language | Repetition | Latency · cost |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  if ("A" in out) console.log(row("A · baseline answer-giver", out.A));
  if ("B" in out) console.log(row("B · tutor-v1 deterministic", out.B));
  if ("C" in out) console.log(row(`C · tutor-v1 + LLM`, out.C, out.C ? undefined : `not run — no provider configured (${JSON.stringify(providerInfo())})`));
  if ("G" in out) console.log(row("G · geometry lesson, deterministic", out.G));
  if ("P" in out) console.log(row("P · physics lesson, deterministic", out.P));

  for (const [k, r] of Object.entries(out)) {
    if (!r) continue;
    const fails = r.results.filter((x) => !x.passed);
    if (fails.length) {
      console.log(`\n${k} failures:`);
      for (const f of fails) for (const a of f.assertions.filter((a) => !a.passed)) console.log(`  ✗ ${f.id} · ${a.name}: ${a.detail.slice(0, 160)}`);
    }
  }
  const strip = (r: SuiteResult | null) => (r ? { ...r, results: r.results.map(({ traces: _traces, ...x }) => x) } : null);
  writeFileSync("eval-results.json", JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, strip(v)])), null, 2));
  if ([out.B, out.G, out.P].some((r) => r && r.passed !== r.total)) process.exit(1);
})();
