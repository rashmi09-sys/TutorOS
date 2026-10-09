"use client";

import { useState } from "react";
import type { LlmCall, TurnTrace } from "@/engine/types";
import { MISCONCEPTIONS } from "@/engine/misconceptions";
import type { StoredSession } from "@/lib/storage";
import type { SessionState } from "@/engine/types";
import type { SubjectState } from "@/engine/subjects/types";

/**
 * The full technical record of one turn: every stage from what was heard to the state change, plus the
 * evidence tabs. Shown under "Technical details" on each timeline card.
 */
export function eventText(t: TurnTrace) {
  if (t.event.type === "start") return "▶ session start";
  if (t.event.type === "silence") return `… silence ${Math.round(t.event.ms / 1000)}s`;
  return `${t.event.via === "voice" ? "🎙 " : ""}${t.event.text}`;
}


function strengthWord(c: number) {
  return c >= 0.65 ? "fairly specific match" : c >= 0.45 ? "possible" : c > 0 ? "weak" : "none";
}
const BASIS: Record<string, string> = {
  step: "pattern of the transformation written",
  value: "the value reached (many routes reach the same number)",
  "implied-value": "the value the step implies — step pattern not recognised",
  explanation: "the student's own explanation",
};

function Stage({ k, cls = "", children }: { k: string; cls?: string; children: React.ReactNode }) {
  return (
    <li className={`stage ${cls}`}>
      <span className="stage-k"><i aria-hidden />{k}</span>
      <div className="stage-v">{children}</div>
    </li>
  );
}

export function Chain({ t }: { t: TurnTrace }) {
  const d = t.decision;
  const v = t.validation;
  const obs = v?.observed;
  const dg = t.diagnosis;
  const intent = (t.intent ?? null) as null | { kind: string; tentative?: boolean; topic?: string; insistent?: boolean; frustrated?: boolean; question?: boolean; claims?: unknown[]; request?: string; phraseRule?: string; recognisedBy?: string; mathSegment?: string; value?: number; direction?: string; outcome?: string; concepts?: string[]; evidence?: string[]; confidence?: number };
  const sc = t.subjectCheck;
  const interpretCall = t.llmCalls.find((c) => c.purpose === "interpret");
  const ev = t.event.type === "text" ? t.event : null;
  const lastRender = [...t.llmCalls].reverse().find((c) => c.purpose === "decide");
  return (
    <>
      <ol className="stages">
        <Stage k="Input">
          <span className={t.validation?.parsed ? "mono" : ""}>{eventText(t)}</span>
          {ev?.interruptedTutor && <span className="flag phase" style={{ marginLeft: 8 }}>interrupted tutor</span>}
          {ev?.source === "help-option" && <span className="flag phase" style={{ marginLeft: 8 }}>help option</span>}
          {ev?.via === "voice" && (
            <div className="sub">
              Finalized speech transcript{ev.voice ? <> · {ev.voice.segments} final segment{ev.voice.segments === 1 ? "" : "s"} · {ev.voice.interimUpdates} interim updates (not submitted) · {ev.voice.duplicateEventsIgnored} duplicate events ignored · {ev.voice.autoResumes} silent resumes · {(ev.voice.durationMs / 1000).toFixed(1)} s · ended by {ev.voice.endedBy === "done" ? "Done" : ev.voice.endedBy === "pause" ? "pause (hands-free)" : "Send after the browser stopped"}</> : null}
            </div>
          )}
          <div className="mono" style={{ color: "var(--ink-3)", marginTop: 2 }}>{t.requestId} · event {t.event.id ?? "—"} · {t.totalLatencyMs} ms</div>
        </Stage>
        {t.context && (
          <Stage k="Context">
            Tutor was waiting for <span className="mono">{t.context.awaiting}</span>
            {t.context.lastQuestion && <> · last question “{t.context.lastQuestion}”</>}
            {t.context.lastProposal && (
              <div className="sub">
                Student&apos;s previous proposal (turn {t.context.lastProposal.turn}): <span className="mono">{t.context.lastProposal.kind ?? t.context.lastProposal.part ?? "—"}</span>
                {t.context.lastProposal.verdict && <> → {t.context.lastProposal.verdict}</>}
              </div>
            )}
            {(t.context.repeat || t.context.correction || t.context.repair || t.context.continuation) && (
              <div style={{ marginTop: 4 }}>
                {t.context.repeat && <span className="flag phase">repeat of the same proposal</span>} {t.context.correction && <span className="flag phase">correction</span>} {t.context.repair && <span className="flag phase">repair: last reply missed it</span>} {t.context.continuation && <span className="flag phase">finishes previous sentence</span>}
              </div>
            )}
          </Stage>
        )}
        {intent && (
          <Stage k="Intent" cls={intent.kind === "AMBIGUOUS" ? "s-hyp" : undefined}>
            <span className="mono">{intent.kind}</span>
            {intent.request && <> · request <span className="mono">{intent.request}</span></>}
            {intent.mathSegment && intent.kind !== "ANSWER" && intent.kind !== "STEP" && <> · mentions <span className="mono">{intent.mathSegment}</span></>}
            {intent.tentative && " · tentative"}
            {intent.topic && <> · topic <span className="mono">{intent.topic}</span></>}
            {intent.insistent && " · insistent"}
            {intent.frustrated && " · frustrated"}
            {intent.value != null && <> · value <span className="mono">{intent.value}</span></>}
            {intent.direction && <> · direction <span className="mono">{intent.direction}</span></>}
            {intent.outcome && <> · outcome <span className="mono">{intent.outcome}</span></>}
            {intent.concepts && intent.concepts.length > 0 && <> · concepts <span className="mono">{intent.concepts.join(", ")}</span></>}
            {intent.claims && intent.claims.length > 0 && <> · stated calculations: <span className="mono">{intent.claims.map((c) => (typeof c === "string" ? c : `${(c as { expr: string; stated: number }).expr} = ${(c as { stated: number }).stated}`)).join(" | ")}</span></>}
            <div className="sub sub-3">
              {intent.recognisedBy === "llm" ? (
                <>
                  <b style={{ color: "var(--ink)" }}>LLM interpretation</b> ({interpretCall?.model}) of text the word lists didn&apos;t match — schema-validated structured reading, {interpretCall?.proposal?.rationale ?? ""}. The maths check and the policy still decided.
                </>
              ) : intent.recognisedBy === "phrase rule" || intent.recognisedBy === "concept rule" ? (
                <>
                  Deterministic {intent.recognisedBy} <span className="mono">{intent.phraseRule}</span> — exact phrase match, no model.
                </>
              ) : intent.recognisedBy === "operation lexicon" ? (
                <>
                  Deterministic operation lexicon <span className="mono">{intent.phraseRule}</span> — words for operations, numbers and sides, read against the current equation. No model.
                </>
              ) : intent.recognisedBy === "subject rules" ? (
                <>
                  Deterministic {t.lesson} reader — numbers, units, directions and a closed list of words{intent.evidence?.length ? <> (<span className="mono">{intent.evidence.join(" | ")}</span>)</> : null}. No model.
                </>
              ) : intent.recognisedBy === "maths parser" ? (
                <>Deterministic maths parser — exact.</>
              ) : intent.kind === "AMBIGUOUS" ? (
                <>No rule matched and it isn&apos;t maths: ambiguous, so the tutor asks one clarifying question.</>
              ) : (
                <>Fallback classification — no phrase rule matched.</>
              )}
              {interpretCall && intent.recognisedBy !== "llm" && <> · model interpretation not used ({interpretCall.rejectionReasons?.join("; ") ?? interpretCall.error ?? "rejected"})</>}
            </div>
          </Stage>
        )}
        {t.meaning && (
          <Stage k="Meaning" cls="s-hyp">
            <span className="mono">{t.meaning.act}</span>
            {t.meaning.operation && (
              <>
                {" "}
                · <span className="mono">
                  {t.meaning.operation.kind}
                  {t.meaning.operation.operand ? ` ${t.meaning.operation.operand}` : ""}
                </span>
                {!t.meaning.operation.operand && " (no number said)"}
                {t.meaning.operation.operandSource === "inferred" && " (number inferred from the equation)"} · sides {t.meaning.operation.sides} · framed as {t.meaning.operation.framing}
              </>
            )}
            {t.meaning.part && <> · points at the {t.meaning.part}</>}
            {t.meaning.mentionsOrderOfOperations && " · appeals to BODMAS"}
            {t.meaning.isQuestion && " · question"}
            {t.meaning.isCorrection && " · correction"}
            <div className="sub sub-3">
              Read by {t.meaning.source === "llm" ? "the model (structured, schema-checked)" : "the deterministic lexicon"} · confidence {t.meaning.confidence.toFixed(2)} · evidence: <span className="mono">{t.meaning.evidence.join(" | ")}</span>
            </div>
          </Stage>
        )}
        {t.opCheck && (
          <Stage k="Operation check" cls={t.opCheck.verdict === "correct_next" ? "s-ok" : t.opCheck.verdict === "divide_first" || t.opCheck.verdict === "incomplete" ? "s-hyp" : "s-bad"}>
            <span className="fact mono">{t.opCheck.verdict}</span>
            {t.opCheck.result && <> · would give <span className="mono">{t.opCheck.result}</span></>} · needed: {t.opCheck.needed}
            <div className="sub">{t.opCheck.explanation}</div>
            <div className="sub sub-3">Computed exactly from the current equation — the interpreter can&apos;t change this verdict.</div>
          </Stage>
        )}
        {sc && (
          <Stage k="Subject check" cls={sc.verdict === "correct" ? "s-ok" : sc.verdict === "incorrect" ? "s-bad" : "s-hyp"}>
            <span className="fact mono">{sc.verdict}</span> · {sc.verifier}
            <div className="sub">{sc.detail}</div>
            {sc.misconception && <div className="sub">Hypothesis (never shown to the student): {sc.misconception.label} <span className="mono">({sc.misconception.id})</span></div>}
            {sc.claims.length > 0 && <div className="sub mono">{sc.claims.map((c) => `${c.expr} = ${c.stated} → ${c.ok ? "true" : `false (= ${c.actual})`}`).join(" · ")}</div>}
            <div className="sub sub-3">Computed by the {t.lesson} verifier — no model can change this verdict.</div>
          </Stage>
        )}
        {v?.parsed && (
          <Stage k="Validation" cls={v.equivalentToProblem ? "s-ok" : "s-bad"}>
            <span className="fact">{v.equivalentToProblem ? "Equivalent to the problem" : "Not equivalent to the problem"}</span> — parsed <span className="mono">{v.parsed}</span>
            {v.impliedValue && <> · implies x = <span className="mono">{v.impliedValue}</span> (correct x = <span className="mono">{v.correctValue}</span>)</>}
            {v.progress === false && v.equivalentToProblem && " · no simpler than before"}
            {v.claims?.map((c, i) => (
              <div key={i} className="mono" style={{ marginTop: 3 }}>
                claim {c.raw}: <span className={c.ok ? "ok" : "bad"}>{c.ok ? "sound" : c.why}</span>
              </div>
            ))}
          </Stage>
        )}
        {obs && (
          <Stage k="Observed" cls={obs.sameOnBoth && v?.equivalentToProblem ? "s-ok" : v?.equivalentToProblem ? "s-ok" : "s-bad"}>
            <span className="fact">{obs.summary}</span>
            <div className="mono" style={{ color: "var(--ink-3)", marginTop: 2 }}>
              left {obs.leftText} · right {obs.rightText} · {obs.sameOnBoth ? "same operation on both sides" : "sides changed differently"}{obs.swapped ? " · sides swapped" : ""}
            </div>
            <div className="sub sub-3">Computed from the two lines — a fact, not an interpretation.</div>
          </Stage>
        )}
        {(dg || (v?.parsed && !v.equivalentToProblem)) && (
          <Stage k="Hypothesis" cls="s-hyp">
            {dg && dg.id !== "UNCLASSIFIED" ? (
              <div className="hyp">
                <div>
                  <span className="label">Possibly: {MISCONCEPTIONS[dg.id].label.toLowerCase()}</span>{" "}
                  <span className="strength">[{strengthWord(dg.confidence)} · {dg.confidence.toFixed(2)}]</span>
                </div>
                <div className="sub sub-ink">Based on {BASIS[dg.basis ?? "value"]} · source {t.diagnosisSource}. Not confirmed unless the student explains their thinking.</div>
                <div className="mono" style={{ marginTop: 4 }}>{dg.evidence}</div>
                {dg.alternatives && dg.alternatives.length > 0 && <p className="alts">Other explanations for the same work: {dg.alternatives.join("; ")}.</p>}
              </div>
            ) : (
              <div className="hyp">
                <span className="label">No hypothesis.</span> {dg?.evidence ?? "The work matches no modelled pattern."} The policy asks rather than guesses.
              </div>
            )}
          </Stage>
        )}
        <Stage k="Permitted">
          <div className="cands">
            {t.candidates.map((c, i) => (
              <div key={c.id} className={`cand ${c.id === d.id ? "chosen" : ""}`}>
                <span>{c.id === d.id ? "●" : "○"}</span>
                <span>{c.id}{i === 0 ? "  (default)" : ""}</span>
                <span className="act">{c.action}</span>
                <span>L{c.hintLevel}</span>
              </div>
            ))}
          </div>
          <div className="perms">
            <span className={`perm ${d.revealAllowed ? "allowed" : "blocked"}`}>{d.revealAllowed ? "may state answer" : "answer blocked"}</span>
            <span className={`perm ${d.nextStepAllowed ? "allowed" : "blocked"}`}>{d.nextStepAllowed ? "may show next step" : "next step blocked"}</span>
            <span className="perm allowed">hint level ≤ {d.hintLevel}</span>
            <span className="perm blocked">no new actions outside this list</span>
          </div>
        </Stage>
        <Stage k="Chosen" cls="s-key">
          <span className="mono" style={{ fontWeight: 600 }}>{d.rule}</span> · {sourceText(t.decisionSource)}
          {d.stage && <span className="flag phase" style={{ marginLeft: 8 }}>stage {d.stage}</span>}
          {t.rationale && <div style={{ marginTop: 4 }}><b>Model rationale:</b> {t.rationale}</div>}
          <div className="sub">Goal sent to the language layer: {d.goal}</div>
        </Stage>
        <Stage k="Delivered" cls={t.fallbackUsed ? "s-bad" : "s-ok"}>
          {lastRender ? (
            <>
              {lastRender.kind === "model" ? "Model wording" : "Template wording (no model)"} · guard{" "}
              {lastRender.guard ? (lastRender.guard.ok ? <span className="ok">pass</span> : <span className="bad">{lastRender.guard.violations.map((x) => x.type).join(", ")}</span>) : "—"}
              {t.fallbackUsed && <span className="bad"> · fell back to policy default</span>}
            </>
          ) : (
            "—"
          )}
          <div className="sub">
            {t.llmCalls.some((c) => c.kind === "model") ? (
              t.llmCalls
                .filter((c) => c.kind === "model")
                .map((c, i) => (
                  <div key={i} className="mono">
                    {c.purpose} · {c.provider}:{c.model} · {c.latencyMs} ms · {c.ok ? (c.verdict ?? "ok") : `failed: ${c.error ?? "invalid"}`}
                    {c.rejectionReasons?.length ? ` (${c.rejectionReasons.join("; ")})` : ""}
                  </div>
                ))
            ) : (
              <>No model calls this turn — deterministic.</>
            )}
          </div>
          {t.errors.length > 0 && <ul className="mono" style={{ margin: "6px 0 0", paddingLeft: 18 }}>{t.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        </Stage>
        <Stage k="State">
          {Object.keys(t.stateDelta).length ? (
            <div className="delta">
              {Object.entries(t.stateDelta).map(([k, [a, b]]) => (
                <Fragment3 key={k} k={k} a={a} b={b} />
              ))}
            </div>
          ) : (
            <span style={{ color: "var(--ink-3)" }}>No learner-state change.</span>
          )}
        </Stage>
      </ol>
    </>
  );
}

function Fragment3({ k, a, b }: { k: string; a: unknown; b: unknown }) {
  return (
    <>
      <span>{k}</span>
      <span style={{ color: "var(--ink-3)" }}>{String(a)}</span>
      <span>→ {String(b)}</span>
    </>
  );
}

export function sourceText(s: TurnTrace["decisionSource"]) {
  return s === "policy-default" ? "policy default" : s === "llm-choice" ? "LLM chose a permitted alternative" : "fallback to policy default";
}

export function Evidence({ t, session }: { t: TurnTrace; session: StoredSession | null }) {
  const [tab, setTab] = useState<"maths" | "learner" | "model" | "raw">("maths");
  const v = t.validation;
  const st = session?.state && "board" in session.state ? (session.state as SessionState) : null;
  const sst = session?.state && "records" in session.state ? (session.state as SubjectState) : null;
  const entries = st?.board.filter((b) => b.turn === t.turn) ?? [];
  return (
    <>
      <div className="etabs" role="tablist">
        {(["maths", "learner", "model", "raw"] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {k === "model" ? `model (${t.llmCalls.filter((c) => c.kind === "model").length})` : k}
          </button>
        ))}
      </div>
      <div className="ebody">
        {tab === "maths" && (
          <>
            <h4>Validation</h4>
            {v?.parsed ? (
              <table className="kvt">
                <tbody>
                  <tr><td>Parsed</td><td className="mono">{v.parsed}</td></tr>
                  <tr><td>Equivalent to problem</td><td className={v.equivalentToProblem ? "ok" : "bad"}>{String(v.equivalentToProblem)}</td></tr>
                  <tr><td>Implied x</td><td className="mono">{v.impliedValue ?? "—"}</td></tr>
                  <tr><td>Correct x</td><td className="mono">{v.correctValue}</td></tr>
                  {v.progress !== undefined && <tr><td>Simpler than before</td><td>{String(v.progress)}</td></tr>}
                  {v.observed && <tr><td>Observed operation</td><td className="mono">{v.observed.summary}</td></tr>}
                </tbody>
              </table>
            ) : t.subjectCheck ? (
              <table className="kvt">
                <tbody>
                  <tr><td>Verifier</td><td>{t.subjectCheck.verifier}</td></tr>
                  <tr><td>Verdict</td><td className={t.subjectCheck.verdict === "correct" ? "ok" : t.subjectCheck.verdict === "incorrect" ? "bad" : ""}>{t.subjectCheck.verdict}</td></tr>
                  <tr><td>Detail</td><td>{t.subjectCheck.detail}</td></tr>
                </tbody>
              </table>
            ) : (
              <p className="muted">No maths in this turn.</p>
            )}
            {t.decision.facts.length > 0 && (
              <>
                <h4>Computed facts the tutor may use</h4>
                <pre className="json">{t.decision.facts.join("\n")}</pre>
              </>
            )}
            {entries.length > 0 && (
              <>
                <h4>Board entries written this turn</h4>
                <table className="kvt">
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id}><td className="mono">{e.kind} · {e.status}</td><td className="mono">{e.raw ?? e.latex}{e.note ? ` — ${e.note}` : ""}</td></tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
        {tab === "learner" && (
          <>
            <h4>Changed this turn</h4>
            {Object.keys(t.stateDelta).length ? (
              <table className="kvt"><tbody>{Object.entries(t.stateDelta).map(([k, [a, b]]) => <tr key={k}><td>{k}</td><td className="mono">{String(a)} → {String(b)}</td></tr>)}</tbody></table>
            ) : (
              <p className="muted">Nothing.</p>
            )}
            {sst && (
              <>
                <h4>Questions (whole session, now)</h4>
                <table className="kvt">
                  <tbody>
                    {sst.records.map((r, i) => (
                      <tr key={r.problemId}><td className="mono">{r.problemId} · {sst.problems[i].kind}</td><td>{r.solved ? (r.alone ? "solved alone" : r.revealed ? "worked through" : "solved with help") : "not solved"} · {r.attempts} wrong tries · {r.hints} hints</td></tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {st && (
              <>
                <h4>Mastery evidence (whole session, now)</h4>
                <table className="kvt">
                  <tbody>
                    {st.mastery.observations.map((o, i) => (
                      <tr key={i}><td className="mono">{o.problemId} · {o.kind ?? (o.assisted ? "assisted" : "")}</td><td>{o.correct ? "correct" : "incorrect"}{o.assisted ? " (assisted — not evidence)" : ""}{o.note ? ` · ${o.note}` : ""}</td></tr>
                    ))}
                    <tr><td>P(known) · status</td><td className="mono">{st.mastery.pKnown.toFixed(2)} · {st.mastery.status}</td></tr>
                  </tbody>
                </table>
                <h4>Hypotheses recorded</h4>
                {(st.misconceptionHistory ?? []).length ? (
                  <table className="kvt"><tbody>{(st.misconceptionHistory ?? []).map((m, i) => <tr key={i}><td className="mono">turn {m.turn} · {m.problemId}</td><td>{m.id}</td></tr>)}</tbody></table>
                ) : (
                  <p className="muted">None.</p>
                )}
              </>
            )}
          </>
        )}
        {tab === "model" && (
          <>
            {t.llmCalls.length === 0 && <p className="muted">No language-layer calls.</p>}
            {t.llmCalls.map((c, i) => <CallCard key={i} c={c} />)}
            {t.llmCalls.every((c) => c.kind !== "model") && <p className="muted">No model was involved in this turn: wording came from templates and classification (if any) from the keyword heuristic. Nothing here is billed or counted as tokens.</p>}
          </>
        )}
        {tab === "raw" && <pre className="json">{JSON.stringify(t, null, 2)}</pre>}
      </div>
    </>
  );
}

export function CallCard({ c }: { c: LlmCall }) {
  return (
    <div className="call">
      <div className="call-h">
        <span>{c.purpose} · attempt {c.attempt}</span>
        <span>{c.kind === "model" ? `${c.provider}:${c.model}` : c.kind === "template" ? "template (no model)" : "heuristic (no model)"}</span>
      </div>
      {c.kind === "model" && (
        <div className="mono" style={{ marginTop: 4 }}>
          {c.latencyMs} ms · {c.inputTokens} in / {c.outputTokens} out · cost {c.costUsd == null ? "unknown" : `$${c.costUsd.toFixed(5)}`}
        </div>
      )}
      {c.proposal && <div className="mono" style={{ marginTop: 4 }}>proposed {c.proposal.candidateId}{c.proposal.rationale ? ` — ${c.proposal.rationale}` : ""}</div>}
      <div style={{ marginTop: 4 }}>
        {c.verdict === "accepted" && <span className="ok">accepted</span>}
        {c.verdict === "rejected" && <span className="bad">rejected: {c.rejectionReasons?.join("; ")}</span>}
        {!c.verdict && c.guard && (c.guard.ok ? <span className="ok">guard pass</span> : <span className="bad">{c.guard.violations.map((x) => `${x.type}: ${x.detail}`).join("; ")}</span>)}
        {c.error && <div className="bad mono">{c.error}</div>}
      </div>
    </div>
  );
}

