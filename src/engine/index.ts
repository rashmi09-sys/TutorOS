/**
 * Public surface of the teaching engine — framework-free TypeScript.
 */
export { createSession, step, type StepDeps, type StepResult, type PolicyVariant } from "./engine";
export type { SessionState, StudentEvent, TurnTrace, Decision, TeachingAction, BoardEntry } from "./types";
export { DeterministicTeacher, LlmTeacher, type TeachingModel } from "./llm/teacher";
export type { LlmProvider } from "./llm/provider";
export { AnthropicProvider } from "./llm/anthropic";
export { OpenAICompatibleProvider } from "./llm/openai";
export { providerFromEnv, teacherFromEnv } from "./llm/factory";
export { runSuite } from "./eval/runner";
export { SCENARIOS } from "./eval/scenarios";
export type { SessionStore } from "./store";
export { MemorySessionStore } from "./store";
