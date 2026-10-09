import { createSession, step, type PolicyVariant } from "../engine";
import type { TeachingModel } from "../llm/teacher";
import type { TurnTrace } from "../types";
import { SCENARIOS, falseArithmetic, type AssertionCategory, type AssertionResult, type Scenario } from "./scenarios";

export interface ScenarioResult {
  id: string;
  title: string;
  why: string;
  passed: boolean;
  assertions: AssertionResult[];
  traces: TurnTrace[];
  turns: number;
  error?: string;
}

export interface SuiteMetrics {
  scenarios: { passed: number; total: number };
  assertions: { passed: number; total: number };
  byCategory: Record<AssertionCategory, { passed: number; total: number }>;
  /** Scenarios where the tutor stated the answer before policy-sanctioned effort. */
  scenariosWithLeak: number;
  /** Arithmetic statements in delivered tutor turns that are false (independent re-check). */
  falseMathStatements: number;
  turns: number;
  latencyMs: { p50: number; p95: number; max: number };
  modelCalls: number;
  tokens: { input: number; output: number };
  /** null = no model calls, or prices not configured — never estimated. */
  costUsd: number | null;
  guardRejections: number;
  fallbacks: number;
  /** How often an LLM chose a non-default permitted move. */
  llmAlternativeChoices: number;
}

export interface SuiteResult {
  runId: string;
  startedAt: string;
  label: string;
  teacher: string;
  mode: "deterministic" | "llm";
  policy: PolicyVariant;
  durationMs: number;
  metrics: SuiteMetrics;
  results: ScenarioResult[];
  /** Back-compat summary fields. */
  passed: number;
  total: number;
  assertionsPassed: number;
  assertionsTotal: number;
}

export async function runScenario(sc: Scenario, teacher: TeachingModel, policy: PolicyVariant): Promise<ScenarioResult> {
  let state = createSession({ sessionId: `eval-${sc.id}`, seed: 7 });
  const traces: TurnTrace[] = [];
  try {
    for (const input of sc.inputs) {
      const ev = typeof input === "function" ? input(state) : input;
      const r = await step(state, ev, { teacher, policy, requestId: `eval-${sc.id}-${traces.length + 1}` });
      state = r.state;
      traces.push(r.trace);
    }
    const assertions = sc.check(traces, state);
    return { id: sc.id, title: sc.title, why: sc.why, passed: assertions.every((a) => a.passed), assertions, traces, turns: traces.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { id: sc.id, title: sc.title, why: sc.why, passed: false, assertions: [{ name: "scenario ran without exceptions", category: "robustness", passed: false, detail: msg }], traces, turns: traces.length, error: msg };
  }
}

export function computeMetrics(results: ScenarioResult[]): SuiteMetrics {
  const all = results.flatMap((r) => r.assertions);
  const cats: AssertionCategory[] = ["leak", "math", "diagnosis", "appropriateness", "recovery", "mastery", "robustness"];
  const byCategory = Object.fromEntries(cats.map((c) => [c, { passed: all.filter((a) => a.category === c && a.passed).length, total: all.filter((a) => a.category === c).length }])) as SuiteMetrics["byCategory"];
  const traces = results.flatMap((r) => r.traces);
  const lat = traces.map((t) => t.totalLatencyMs).sort((a, b) => a - b);
  const q = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : 0);
  const model = traces.flatMap((t) => t.llmCalls).filter((c) => c.kind === "model");
  const costs = model.map((c) => c.costUsd);
  return {
    scenarios: { passed: results.filter((r) => r.passed).length, total: results.length },
    assertions: { passed: all.filter((a) => a.passed).length, total: all.length },
    byCategory,
    scenariosWithLeak: results.filter((r) => r.assertions.some((a) => a.name === "no premature answer leak" && !a.passed)).length,
    falseMathStatements: traces.reduce((s, t) => s + falseArithmetic(t.utterance).length, 0),
    turns: traces.length,
    latencyMs: { p50: q(0.5), p95: q(0.95), max: lat[lat.length - 1] ?? 0 },
    modelCalls: model.length,
    tokens: { input: model.reduce((s, c) => s + c.inputTokens, 0), output: model.reduce((s, c) => s + c.outputTokens, 0) },
    costUsd: model.length === 0 || costs.some((c) => c === null) ? null : costs.reduce<number>((s, c) => s + (c ?? 0), 0),
    guardRejections: traces.flatMap((t) => t.llmCalls).filter((c) => c.verdict === "rejected").length,
    fallbacks: traces.filter((t) => t.fallbackUsed).length,
    llmAlternativeChoices: traces.filter((t) => t.decisionSource === "llm-choice").length,
  };
}

export async function runSuite(teacher: TeachingModel, policy: PolicyVariant = "tutor-v1", opts: { only?: string[]; label?: string } = {}): Promise<SuiteResult> {
  const t0 = performance.now();
  const startedAt = new Date().toISOString();
  const list = opts.only?.length ? SCENARIOS.filter((s) => opts.only!.includes(s.id)) : SCENARIOS;
  const results: ScenarioResult[] = [];
  for (const sc of list) results.push(await runScenario(sc, teacher, policy)); // sequential: predictable rate limits
  const metrics = computeMetrics(results);
  return {
    runId: `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    startedAt,
    label: opts.label ?? `${policy} · ${teacher.mode}`,
    teacher: teacher.name,
    mode: teacher.mode,
    policy,
    durationMs: Math.round(performance.now() - t0),
    metrics,
    results,
    passed: metrics.scenarios.passed,
    total: metrics.scenarios.total,
    assertionsPassed: metrics.assertions.passed,
    assertionsTotal: metrics.assertions.total,
  };
}
