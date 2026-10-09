import type { TurnTrace } from "@/engine/types";
import { MISCONCEPTIONS } from "@/engine/misconceptions";

export type Tone = "ok" | "part" | "bad" | "none";

export interface TurnSummary {
  input: string;
  via?: "voice" | "keyboard";
  understood: string;
  /** Who read it: deterministic rules or a model. */
  readBy: string;
  /** Verdict (short, coloured in the UI) and what was compared. */
  checked: { label: string; text: string; tone: Tone };
  why: string;
  response: string;
}

const REQUESTS: Record<string, string> = {
  HELP_REQUEST: "A request for help",
  HELP: "A request for help",
  CONFUSED: "Says they're confused",
  REPHRASE_REQUEST: "Asks for another explanation",
  REPHRASE: "Asks for another explanation",
  EXAMPLE_REQUEST: "Asks for an example",
  EXAMPLE: "Asks for an example",
  SLOWER_REQUEST: "Asks to go slower",
  SLOWER: "Asks to go slower",
  NO_ANSWER_PREFERENCE: "Asks not to be told the answer",
  NO_ANSWER: "Asks not to be told the answer",
  WHY_QUESTION: "Asks why",
  WHY: "Asks why",
  REPEAT_REQUEST: "Asks to hear it again",
  REPEAT: "Asks to hear it again",
  ACKNOWLEDGE: "Acknowledges",
  ACK: "Acknowledges",
  CONCEPT_QUESTION: "A question about the idea",
  ARITHMETIC_QUESTION: "Asks the tutor to do a calculation",
  DISPUTE: "Disputes the tutor",
  EXPLANATION: "Explains their thinking",
  OFF_TOPIC: "Not about the lesson, or not readable by the rules",
  AMBIGUOUS: "Unclear — no rule matched",
  UNCLEAR: "Unclear — no rule matched",
  INCOMPLETE: "Stops mid-sentence",
  MALFORMED_MATH: "Maths that can't be read",
  EMPTY: "Nothing",
};

const OUTCOME_WORDS: Record<string, string> = { stays_still: "stays still", same_speed: "keeps the same speed", speeds_up: "speeds up", slows_down: "slows down", starts_moving: "starts moving" };

/** Plain-language summary of a turn for the Engineer View timeline. Derived only from the trace. */
export function describeTurn(t: TurnTrace): TurnSummary {
  const ev = t.event;
  const input = ev.type === "start" ? "Started the lesson" : ev.type === "silence" ? `Silence (${Math.round(ev.ms / 1000)} s)` : ev.text;
  const via = ev.type === "text" ? ev.via : undefined;
  const intent = (t.intent ?? {}) as { kind?: string; recognisedBy?: string; mathSegment?: string; topic?: string; value?: number; direction?: string; outcome?: string; concepts?: string[]; request?: string; phraseRule?: string };
  const kind = intent.kind ?? "";
  let understood = ev.type === "start" ? "Start of the lesson" : REQUESTS[kind] ?? kind.toLowerCase().replace(/_/g, " ");
  if (t.meaning) {
    const m = t.meaning;
    if (m.operation) understood = `A move in words: ${m.operation.kind}${m.operation.operand ? ` ${m.operation.operand}` : " (no number said)"}${m.operation.sides !== "unspecified" ? `, ${m.operation.sides === "both" ? "both sides" : `${m.operation.sides} side only`}` : ""}${m.mentionsOrderOfOperations ? ", appealing to BODMAS" : ""}${m.isCorrection ? " — a correction" : ""}`;
    else if (m.part) understood = `Points at the ${m.part === "constant" ? "number added or taken away" : "multiplication"}`;
  } else if ((kind === "ANSWER" || kind === "STEP") && intent.mathSegment) understood = `${kind === "ANSWER" ? "An answer" : "A line of working"}: ${intent.mathSegment}`;
  else if (kind === "ANSWER" && t.lesson && t.lesson !== "algebra") {
    const parts = [intent.value != null ? `${intent.value}${t.lesson === "geometry" ? "°" : " N"}` : "", intent.outcome ? OUTCOME_WORDS[intent.outcome] ?? intent.outcome : "", intent.direction && intent.direction !== "none" ? `to the ${intent.direction}` : ""].filter(Boolean);
    understood = `An answer: ${parts.join(" ") || "nothing checkable"}`;
  } else if (kind === "CONCEPT_CLAIM") understood = `A statement about the idea (${(intent.concepts ?? []).join(", ").replace(/_/g, " ")})`;
  if (kind === "CONCEPT_QUESTION" && intent.topic) understood = `A question about the idea: ${intent.topic.replace(/_/g, " ")}`;
  if (t.context?.repeat) understood += " — said again";
  const rb = intent.recognisedBy;
  const readBy = ev.type !== "text" ? "—" : rb === "llm" ? "Language model (closed labels), then verified" : rb === "maths parser" ? "Exact maths parser" : rb === "operation lexicon" ? "Word list for moves, read against the equation" : rb === "phrase rule" || rb === "concept rule" ? "Phrase rules" : rb === "subject rules" ? `${t.lesson === "geometry" ? "Geometry" : "Physics"} reader (numbers, units, a closed word list)` : "No rule matched";

  let checked: TurnSummary["checked"] = { label: "Nothing to check", text: "", tone: "none" };
  const trim = (x: string) => x.replace(/[.\s]+$/, "");
  if (t.opCheck) {
    const ok = t.opCheck.verdict === "correct_next";
    checked = { label: ok ? "The right next move" : t.opCheck.verdict === "divide_first" ? "Valid, but makes fractions" : "Not the move that helps", text: trim(t.opCheck.explanation), tone: ok ? "ok" : t.opCheck.verdict === "divide_first" ? "part" : "bad" };
  } else if (t.subjectCheck) {
    const sc = t.subjectCheck;
    checked = { label: sc.verdict === "correct" ? "Correct" : sc.verdict === "partial" ? "Partly right" : sc.verdict === "incorrect" ? "Not correct" : "Not checkable", text: trim(sc.detail), tone: sc.verdict === "correct" ? "ok" : sc.verdict === "partial" ? "part" : sc.verdict === "incorrect" ? "bad" : "none" };
    if (sc.misconception && sc.misconception.id !== "UNEXPLAINED") checked.text += `. Possible reason: ${sc.misconception.label.charAt(0).toLowerCase()}${sc.misconception.label.slice(1)}`;
  } else if (t.validation?.parsed) {
    const v = t.validation;
    const solved = v.equivalentToProblem && v.impliedValue === v.correctValue && /^x\s*=/.test(v.parsed ?? "");
    checked = v.equivalentToProblem
      ? { label: solved ? "Correct" : v.progress === false ? "True, but no progress" : "A valid step", text: solved ? `x = ${v.correctValue}` : v.observed ? v.observed.summary : "", tone: t.decision.rule.startsWith("R17") ? "part" : "ok" }
      : { label: "Not equivalent to the problem", text: `${v.impliedValue ? `It implies x = ${v.impliedValue}, not ${v.correctValue}` : ""}${v.observed ? `${v.impliedValue ? "; " : ""}${v.observed.summary}` : ""}`, tone: "bad" };
  }
  if (t.diagnosis && t.diagnosis.id !== "UNCLASSIFIED") {
    const l = MISCONCEPTIONS[t.diagnosis.id].label;
    checked.text = `${checked.text ? `${checked.text}. ` : ""}Possible reason: ${l.charAt(0).toLowerCase()}${l.slice(1)}`;
  }
  return { input, via, understood, readBy, checked, why: t.decision.reason, response: t.utterance };
}

export function pct(arr: number[], p: number) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
