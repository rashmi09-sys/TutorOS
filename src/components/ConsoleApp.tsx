"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TurnTrace, SessionState } from "@/engine/types";
import type { ScenarioResult, SuiteResult } from "@/engine/eval/runner";
import type { LessonId, SubjectState } from "@/engine/subjects/types";
import { RULES } from "@/engine/rules";
import { SCENARIOS } from "@/engine/eval/scenarios";
import { SUBJECT_SCENARIOS } from "@/engine/subjects/eval";
import { MISCONCEPTIONS } from "@/engine/misconceptions";
import { BKT, MASTERY_THRESHOLD, MIN_TRANSFER_EVIDENCE, REQUIRED_CONSECUTIVE } from "@/engine/mastery";
import { LESSONS, lessonInfo } from "@/lib/lessons";
import { loadSession, sessionKey, type StoredSession } from "@/lib/storage";
import { Chain, Evidence } from "./console/Details";
import { describeTurn, pct, type Tone } from "./console/describe";

type Tab = "overview" | "timeline" | "eval" | "architecture";
type Health = {
  status: string;
  teacher: { mode: string; provider: string | null; model: string | null };
  pricingConfigured: boolean;
  sessionSigning: string;
  rateLimiting?: string;
  limits?: { timeoutMs: number; maxModelCallsPerSession: number; retries: number };
};
type NotRun = { notRun: string };
type SuiteKey = "A" | "B" | "C" | "G" | "P";
type Compare = { requestId: string; ranAt: string } & Partial<Record<SuiteKey, SuiteResult | NotRun>>;
const isRun = (x: SuiteResult | NotRun | undefined): x is SuiteResult => !!x && "metrics" in x;

const TABS: [Tab, string][] = [
  ["overview", "Overview"],
  ["timeline", "Decision timeline"],
  ["eval", "Evaluation lab"],
  ["architecture", "Architecture & safety"],
];

/**
 * Engineer View: how the tutor understood, checked and decided — for any lesson session stored in this
 * browser, plus live evaluations and the architecture. Every number here comes from a recorded trace,
 * a live eval run on this server, or /api/health. Nothing is simulated.
 */
export function ConsoleApp() {
  const [tab, setTab] = useState<Tab>("overview");
  const [lesson, setLesson] = useState<LessonId>("algebra");
  const [sessions, setSessions] = useState<Partial<Record<LessonId, StoredSession | null>>>({});
  const [health, setHealth] = useState<Health | null>(null);
  const [focusTurn, setFocusTurn] = useState<number | null>(null);
  const picked = useRef(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const t = q.get("tab");
    if (t && TABS.some(([k]) => k === t)) setTab(t as Tab);
    const l = q.get("lesson");
    const load = () => {
      const all = Object.fromEntries(LESSONS.map((x) => [x.id, loadSession(x.id)])) as Record<LessonId, StoredSession | null>;
      setSessions(all);
      if (!picked.current) {
        picked.current = true;
        if (l && LESSONS.some((x) => x.id === l)) setLesson(l as LessonId);
        else {
          // Default to the lesson used most recently in this browser.
          const recent = LESSONS.map((x) => ({ id: x.id, at: all[x.id]?.updatedAt ?? "" })).sort((a, b) => b.at.localeCompare(a.at))[0];
          if (recent?.at) setLesson(recent.id);
        }
      }
    };
    load();
    const onStorage = (e: StorageEvent) => e.key?.startsWith("tutoros.session") && load();
    window.addEventListener("storage", onStorage);
    const iv = setInterval(load, 1500);
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => {});
    return () => {
      window.removeEventListener("storage", onStorage);
      clearInterval(iv);
    };
  }, []);

  const session = sessions[lesson] ?? null;
  const traces = session?.traces ?? [];
  const info = lessonInfo(lesson);
  const openTurn = (n: number) => {
    setFocusTurn(n);
    setTab("timeline");
  };

  return (
    <div className="ev">
      <header className="ev-bar">
        <div className="ev-brand">
          <Link href="/" aria-label="TutorOS home">
            <b>TutorOS</b>
          </Link>
          <span>Engineer view</span>
        </div>
        <div className="ev-sessions" role="group" aria-label="Lesson session">
          {LESSONS.map((l) => {
            const n = sessions[l.id]?.traces?.length ?? 0;
            return (
              <button key={l.id} className="ev-session" aria-pressed={lesson === l.id} onClick={() => setLesson(l.id)}>
                {l.subject}
                <small>{n ? `${n} turn${n === 1 ? "" : "s"}` : "no session"}</small>
              </button>
            );
          })}
        </div>
        <div className="ev-nav">
          <Link className="ev-back" href={info.href}>
            ← Back to the lesson
          </Link>
          <Link className="ev-back" href="/">
            All lessons
          </Link>
        </div>
      </header>
      <nav className="ev-tabs" role="tablist" aria-label="Engineer view sections">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>
      <main className="ev-main">
        {tab === "overview" && <Overview lesson={lesson} session={session} traces={traces} health={health} onOpen={openTurn} />}
        {tab === "timeline" && <Timeline lesson={lesson} session={session} traces={traces} focus={focusTurn} />}
        {tab === "eval" && <EvalLab llmConfigured={health?.teacher.mode === "llm"} />}
        {tab === "architecture" && <Architecture health={health} />}
      </main>
    </div>
  );
}

/* ============================ Overview ============================ */

function engineText(h: Health | null) {
  if (!h) return "Checking…";
  return h.teacher.mode === "llm" ? `Language model ${h.teacher.provider}:${h.teacher.model}, with deterministic verification` : "Deterministic — no language model configured";
}

interface StopView {
  label: string;
  detail: string;
  state: "done" | "now" | "todo";
  evidence?: "alone" | "help";
}

function stopsFor(lesson: LessonId, st: SessionState | SubjectState | null): StopView[] {
  if (!st) return [];
  if (lesson === "algebra") {
    const s = st as SessionState;
    // Fresh problems are generated when they're reached, so the later stops may not exist yet.
    return [0, 1, 2].map((i) => {
      const p = s.problems[i];
      const obs = p ? s.mastery.observations.filter((o) => o.problemId === p.id) : [];
      const alone = obs.some((o) => !o.assisted && o.correct);
      const done = !!p && (i < s.current || s.phase === "COMPLETE");
      return { label: i === 0 ? "Solve together" : `Check ${i}`, detail: p ? p.text : "A fresh problem, generated when reached", state: done ? "done" : i === s.current ? "now" : "todo", evidence: done ? (alone ? "alone" : "help") : undefined };
    });
  }
  const s = st as SubjectState;
  return s.problems.map((p, i) => {
    const r = s.records[i];
    const done = r.solved;
    return { label: i === 0 ? "Solve together" : `Check ${i}`, detail: p.prompt, state: done ? "done" : i === s.current && s.phase !== "COMPLETE" ? "now" : "todo", evidence: done ? (r.alone ? "alone" : "help") : undefined };
  });
}

function Overview({ lesson, session, traces, health, onOpen }: { lesson: LessonId; session: StoredSession | null; traces: TurnTrace[]; health: Health | null; onOpen: (turn: number) => void }) {
  const info = lessonInfo(lesson);
  const st = (session?.state ?? null) as SessionState | SubjectState | null;
  const studentTurns = traces.filter((t) => t.event.type === "text");
  const sums = studentTurns.map(describeTurn);
  const checked = sums.filter((s) => s.checked.tone !== "none");
  const count = (tone: Tone) => checked.filter((s) => s.checked.tone === tone).length;
  const helpTurns = traces.filter((t) => t.decision.assistive && t.decision.action !== "VERIFY");
  const maxHint = Math.max(0, ...traces.map((t) => (t.decision.action === "HINT" || t.decision.action === "EXPLAIN" ? t.decision.hintLevel : 0)));
  const reveals = traces.filter((t) => /REVEAL/.test(t.decision.rule)).length;
  const modelCalls = traces.flatMap((t) => t.llmCalls).filter((c) => c.kind === "model");
  const fallbacks = traces.filter((t) => t.fallbackUsed).length;
  const rejected = modelCalls.filter((c) => c.verdict === "rejected").length;
  const lat = traces.map((t) => t.totalLatencyMs);
  const cost = modelCalls.length === 0 ? null : modelCalls.some((c) => c.costUsd === null) ? "unknown (no prices set)" : `$${modelCalls.reduce((s, c) => s + (c.costUsd ?? 0), 0).toFixed(4)}`;
  const stops = stopsFor(lesson, st);
  const recent = [...traces].reverse().slice(0, 3);

  return (
    <div className="ov">
      <section className="ov-lesson">
        <p className="ov-subject">{info.subject}</p>
        <h1>{info.title}</h1>
        <p className="ov-objective">{info.objective}</p>
        <dl className="ov-facts">
          <div>
            <dt>Session</dt>
            <dd>{st ? `Started ${new Date((st as { createdAt: string }).createdAt).toLocaleString()}` : "None yet in this browser"}</dd>
          </div>
          <div>
            <dt>Tutor engine</dt>
            <dd>{engineText(health)}</dd>
          </div>
          <div>
            <dt>Answers checked by</dt>
            <dd>{info.verifier}</dd>
          </div>
        </dl>
      </section>

      {!st ? (
        <div className="ev-empty">
          <p>No {info.subject.toLowerCase()} session in this browser yet.</p>
          <p>
            <Link href={info.href}>Open the lesson</Link> and start it. Each turn appears here as it happens: what the student said, what the tutor understood, how it was checked, and why the tutor replied as it did.
          </p>
        </div>
      ) : (
        <>
          <section className="ov-block" aria-label="Student progress">
            <h2>Progress</h2>
            <ol className="ov-stops">
              {stops.map((s) => (
                <li key={s.label} className={`ov-stop ${s.state}`}>
                  <span className="ov-stop-label">{s.label}</span>
                  <span className="ov-stop-state">{s.state === "done" ? (s.evidence === "alone" ? "Solved without help" : "Solved with help") : s.state === "now" ? "In progress" : "Not started"}</span>
                  <span className="ov-stop-detail">{s.detail}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="ov-block" aria-label="Session figures">
            <h2>This session</h2>
            <div className="ov-figures">
              <Figure label="Student messages" value={String(studentTurns.length)} note={`${studentTurns.filter((t) => t.event.type === "text" && t.event.via === "voice").length} spoken, the rest typed`} />
              <Figure label="Answers checked" value={String(checked.length)} note={checked.length ? `${count("ok")} correct, ${count("part")} partly right, ${count("bad")} not correct` : "None yet"}>
                {checked.length > 0 && <SplitBar parts={[count("ok"), count("part"), count("bad")]} />}
              </Figure>
              <Figure label="Help given" value={String(helpTurns.length)} note={`Highest hint level ${maxHint} of 3${reveals ? `, ${reveals} worked solution${reveals > 1 ? "s" : ""}` : ""}`} />
              <Figure label="Model calls" value={String(modelCalls.length)} note={modelCalls.length ? `${rejected} rejected, ${fallbacks} fallbacks, cost ${cost}` : `None — every turn was deterministic (${pct(lat, 0.5)} ms median)`} />
            </div>
          </section>

          <section className="ov-block" aria-label="Recent interactions">
            <div className="ov-block-head">
              <h2>Recent interactions</h2>
              <button className="ev-link" onClick={() => onOpen(traces[traces.length - 1].turn)}>
                Open the full timeline
              </button>
            </div>
            <div className="ov-recent">
              {recent.map((t) => (
                <TurnCard key={t.turnId} t={t} compact onOpen={() => onOpen(t.turn)} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Figure({ label, value, note, children }: { label: string; value: string; note: string; children?: React.ReactNode }) {
  return (
    <div className="ov-figure">
      <p className="ov-figure-label">{label}</p>
      <p className="ov-figure-value">{value}</p>
      {children}
      <p className="ov-figure-note">{note}</p>
    </div>
  );
}

function SplitBar({ parts }: { parts: [number, number, number] | number[] }) {
  const total = parts.reduce((s, x) => s + x, 0) || 1;
  const cls = ["ok", "part", "bad"];
  return (
    <span className="splitbar" aria-hidden>
      {parts.map((p, i) => (p ? <i key={i} className={cls[i]} style={{ width: `${(p / total) * 100}%` }} /> : null))}
    </span>
  );
}

/* ============================ Decision timeline ============================ */

function Timeline({ lesson, session, traces, focus }: { lesson: LessonId; session: StoredSession | null; traces: TurnTrace[]; focus: number | null }) {
  const [sel, setSel] = useState<number | null>(focus);
  const refs = useRef(new Map<number, HTMLElement>());
  useEffect(() => {
    if (focus != null) {
      setSel(focus);
      requestAnimationFrame(() => refs.current.get(focus)?.scrollIntoView({ block: "center" }));
    }
  }, [focus]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!traces.length || !(e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "j" || e.key === "k")) return;
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const cur = sel == null ? traces.length - 1 : traces.findIndex((x) => x.turn === sel);
      const next = Math.max(0, Math.min(traces.length - 1, cur + (e.key === "ArrowDown" || e.key === "j" ? 1 : -1)));
      setSel(traces[next].turn);
      refs.current.get(traces[next].turn)?.scrollIntoView({ block: "nearest" });
      e.preventDefault();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [traces, sel]);

  if (!traces.length) {
    return (
      <div className="ev-empty">
        <p>No turns yet for {lessonInfo(lesson).title.toLowerCase()}.</p>
        <p>
          Start the lesson in <Link href={lessonInfo(lesson).href}>the student view</Link>; each turn appears here live.
        </p>
      </div>
    );
  }
  return (
    <div className="tl">
      <p className="tl-intro">Every turn, oldest first. Each card reads top to bottom the way the tutor worked: what it heard, what it understood, how it checked, why it replied. Use ↑ and ↓ to move between turns; open the technical details for the full trace.</p>
      <ol className="tl-list">
        {traces.map((t) => (
          <li
            key={t.turnId}
            ref={(el) => {
              if (el) refs.current.set(t.turn, el);
            }}
          >
            <TurnCard t={t} session={session} selected={sel === t.turn} initiallyOpen={focus === t.turn} onSelect={() => setSel(t.turn)} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function TurnCard({ t, session, compact, selected, initiallyOpen, onSelect, onOpen }: { t: TurnTrace; session?: StoredSession | null; compact?: boolean; selected?: boolean; initiallyOpen?: boolean; onSelect?: () => void; onOpen?: () => void }) {
  // A turn opened from the Overview arrives with its full trace already showing.
  const [open, setOpen] = useState(!!initiallyOpen);
  const d = describeTurn(t);
  const modelUsed = t.llmCalls.some((c) => c.kind === "model");
  return (
    <article className={`tl-item ${compact ? "compact" : ""}`} aria-current={selected || undefined} onClick={onSelect}>
      <header className="tl-head">
        <span className="tl-n">Turn {t.turn}</span>
        <span className="tl-time">{new Date(t.startedAt).toLocaleTimeString()}</span>
        {d.via === "voice" && <span className="tl-tag">spoken</span>}
        {modelUsed && <span className="tl-tag model">model used</span>}
        {t.fallbackUsed && <span className="tl-tag warn">fallback</span>}
        {t.errors.length > 0 && <span className="tl-tag warn">{t.errors.length} note{t.errors.length > 1 ? "s" : ""}</span>}
      </header>
      <dl className="tl-rows">
        <dt>Student</dt>
        <dd className="tl-student">{t.event.type === "text" ? `“${d.input}”` : d.input}</dd>
        {t.event.type === "text" && (
          <>
            <dt>Understood</dt>
            <dd>
              {d.understood}
              <span className="tl-by">{d.readBy}</span>
            </dd>
            <dt>Checked</dt>
            <dd className={`tl-check ${d.checked.tone}`}>
              <i aria-hidden />
              <span>
                <b>{d.checked.label}</b>
                {d.checked.text && <span className="tl-check-text">{d.checked.text}</span>}
              </span>
            </dd>
          </>
        )}
        {!compact && (
          <>
            <dt>Decided</dt>
            <dd>
              {d.why}
              <span className="tl-by tl-rule">{t.decision.rule}{t.decision.stage ? ` (${t.decision.stage.toLowerCase()})` : ""}</span>
            </dd>
          </>
        )}
        <dt>Tutor</dt>
        <dd className="tl-tutor">{d.response}</dd>
      </dl>
      {compact ? (
        <button className="ev-link" onClick={onOpen}>
          Open in the timeline
        </button>
      ) : (
        <>
          <button
            className="tl-details-btn"
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
          >
            {open ? "Hide technical details" : "Technical details"}
          </button>
          {open && (
            <div className="tl-details" onClick={(e) => e.stopPropagation()}>
              <div className="tl-chain">
                <Chain t={t} />
              </div>
              <div className="tl-evidence">
                <Evidence t={t} session={session ?? null} />
              </div>
            </div>
          )}
        </>
      )}
    </article>
  );
}

/* ============================ Evaluation lab ============================ */

const SUITES: { key: SuiteKey; name: string; desc: string; lesson: LessonId }[] = [
  { key: "A", name: "Baseline", desc: "Algebra. A naive answer-giver: same checking, but explains the full solution whenever the student is wrong or stuck. A negative control.", lesson: "algebra" },
  { key: "B", name: "Tutor, deterministic", desc: "Algebra. The teaching policy with templated wording. No model.", lesson: "algebra" },
  { key: "C", name: "Tutor with a real model", desc: "Algebra. A language model chooses among permitted moves and words them, inside the guard.", lesson: "algebra" },
  { key: "G", name: "Geometry lesson", desc: "Angles in a triangle: verifier, hint ladder and leak guard. Deterministic.", lesson: "geometry" },
  { key: "P", name: "Physics lesson", desc: "Forces and balance: verifier, closed outcome list and leak guard. Deterministic.", lesson: "physics" },
];

function EvalLab({ llmConfigured }: { llmConfigured: boolean }) {
  const [running, setRunning] = useState(false);
  const [data, setData] = useState<Compare | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<{ sc: string; p: SuiteKey } | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setErr(null);
    try {
      const res = await fetch("/api/eval", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ suites: ["A", "B", "C", "G", "P"] }) });
      const d = (await res.json()) as Compare & { error?: string };
      if (!res.ok) throw new Error(d.error ?? "Eval failed");
      setData(d);
      const firstFail = (["B", "G", "P", "C", "A"] as const).flatMap((p) => (isRun(d[p]) ? (d[p] as SuiteResult).results.filter((r) => !r.passed).map((r) => ({ sc: r.id, p })) : []))[0];
      setSel(firstFail ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, []);

  const resultFor = (p: SuiteKey, sc: string): ScenarioResult | undefined => {
    const r = data?.[p];
    return isRun(r) ? r.results.find((x) => x.id === sc) : undefined;
  };
  const order = useMemo(() => {
    if (!data) return SCENARIOS.map((s) => s.id);
    const failsTutor = (id: string) => resultFor("B", id)?.passed === false || resultFor("C", id)?.passed === false;
    const failsAny = (id: string) => (["A", "B", "C"] as const).some((p) => resultFor(p, id)?.passed === false);
    return [...SCENARIOS.map((s) => s.id)].sort((a, b) => Number(failsTutor(b)) - Number(failsTutor(a)) || Number(failsAny(b)) - Number(failsAny(a)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <div className="lab">
      <section className="lab-intro">
        <div>
          <h1>Evaluation lab</h1>
          <p>
            Scripted students, real tutor: each scenario plays a student&apos;s messages into the same engine the lessons use, on this server, and checks properties of the replies — no early answers, true maths, the right kind of help. {SCENARIOS.length} algebra scenarios run against three policies; {SUBJECT_SCENARIOS.filter((s) => s.lesson === "geometry").length} geometry and {SUBJECT_SCENARIOS.filter((s) => s.lesson === "physics").length} physics scenarios run against their lessons.
          </p>
          <p className="lab-honest">
            {llmConfigured ? "A language model is configured, so the real-model column runs live and costs money." : "No language model is configured on this server, so the real-model column is marked not tested. It is never simulated."} Unit tests that use a fake model provider check the fences around a model — schema, invented numbers, timeouts, the call budget — and say nothing about teaching quality, so they are not shown here as model results.
          </p>
        </div>
        <button className="btn primary runbtn" onClick={run} disabled={running}>
          {running ? "Running…" : "Run comparison"}
        </button>
      </section>
      {err && <p className="error">{err}</p>}
      {!data && !running && <div className="ev-empty">Run the comparison to see real results. Without a model it takes about a second.</div>}
      {data && (
        <>
          <section className="lab-suites" aria-label="Results by suite">
            {SUITES.map((s) => {
              const r = data[s.key];
              return (
                <article key={s.key} className={`suite ${isRun(r) ? "" : "notrun"}`}>
                  <header>
                    <h2>{s.name}</h2>
                    <p>{s.desc}</p>
                  </header>
                  {isRun(r) ? (
                    <>
                      <p className="suite-score">
                        <b>{r.metrics.scenarios.passed}</b> of {r.metrics.scenarios.total} scenarios passed
                      </p>
                      <ScenarioDots
                        results={r.results}
                        onPick={(id) => {
                          setSel({ sc: id, p: s.key });
                          requestAnimationFrame(() => document.querySelector(".inspector")?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
                        }}
                      />
                      <dl className="suite-facts">
                        <div>
                          <dt>Checks passed</dt>
                          <dd>{r.metrics.assertions.passed} of {r.metrics.assertions.total}</dd>
                        </div>
                        <div>
                          <dt>Early answer leaks</dt>
                          <dd className={r.metrics.scenariosWithLeak ? "bad" : ""}>{r.metrics.scenariosWithLeak}</dd>
                        </div>
                        <div>
                          <dt>False maths stated</dt>
                          <dd className={r.metrics.falseMathStatements ? "bad" : ""}>{r.metrics.falseMathStatements}</dd>
                        </div>
                        <div>
                          <dt>Model calls</dt>
                          <dd>{r.metrics.modelCalls ? `${r.metrics.modelCalls}, cost ${r.metrics.costUsd == null ? "unknown" : `$${r.metrics.costUsd.toFixed(4)}`}` : "none"}</dd>
                        </div>
                      </dl>
                    </>
                  ) : (
                    <p className="suite-notrun">Not tested{r && "notRun" in r ? ` — ${r.notRun}` : ""}</p>
                  )}
                </article>
              );
            })}
          </section>

          <section className="lab-detail">
            <h2>Algebra scenarios in detail</h2>
            <p className="muted">Failures first. Select a result to see which checks failed and the turn that caused it.</p>
            <div className="matrix-wrap">
              <div className="matrix mx-algebra" role="table" aria-label="Algebra scenario results by policy">
                <div className="mx-row head" role="row">
                  <span className="sc">Scenario</span>
                  <span className="cell na">Baseline</span>
                  <span className="cell na">Tutor</span>
                  <span className="cell na">Model</span>
                </div>
                {order.map((id) => {
                  const sc = SCENARIOS.find((s) => s.id === id)!;
                  return (
                    <div key={id} className="mx-row" role="row">
                      <span className="sc">
                        {sc.title}
                        <small>{id}</small>
                      </span>
                      {(["A", "B", "C"] as const).map((p) => (
                        <Cell key={p} r={resultFor(p, id)} p={p} id={id} title={sc.title} sel={sel} onPick={setSel} />
                      ))}
                    </div>
                  );
                })}
              </div>
              <Inspector sel={sel} r={sel ? resultFor(sel.p, sel.sc) : undefined} />
            </div>
            {(["G", "P"] as const).map((p) => (
              <Fragment key={p}>
                <h2 className="lab-sub">{p === "G" ? "Geometry scenarios" : "Physics scenarios"}</h2>
                <div className="matrix mx-subject" role="table" aria-label={`${p === "G" ? "Geometry" : "Physics"} scenario results`}>
                  {SUBJECT_SCENARIOS.filter((s) => s.lesson === (p === "G" ? "geometry" : "physics")).map((sc) => (
                    <div key={sc.id} className="mx-row sub" role="row">
                      <span className="sc">
                        {sc.title}
                        <small>{sc.id}</small>
                      </span>
                      <Cell r={resultFor(p, sc.id)} p={p} id={sc.id} title={sc.title} sel={sel} onPick={setSel} />
                    </div>
                  ))}
                </div>
              </Fragment>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function Cell({ r, p, id, title, sel, onPick }: { r?: ScenarioResult; p: SuiteKey; id: string; title: string; sel: { sc: string; p: SuiteKey } | null; onPick: (s: { sc: string; p: SuiteKey }) => void }) {
  if (!r) return <span className="cell na" title="not tested">—</span>;
  return (
    <button className={`cell ${r.passed ? "pass" : "fail"}`} aria-pressed={sel?.sc === id && sel.p === p} onClick={() => onPick({ sc: id, p })} aria-label={`${p} ${r.passed ? "pass" : "fail"}: ${title}`}>
      {r.passed ? "Pass" : `${r.assertions.filter((a) => !a.passed).length} failed`}
    </button>
  );
}

/** One mark per scenario: filled = passed, open = failed. */
function ScenarioDots({ results, onPick }: { results: ScenarioResult[]; onPick: (id: string) => void }) {
  return (
    <div className="dots" role="list" aria-label="Scenarios">
      {results.map((r) => (
        <button key={r.id} role="listitem" className={`dot ${r.passed ? "pass" : "fail"}`} title={`${r.title}: ${r.passed ? "passed" : "failed"}`} aria-label={`${r.title}: ${r.passed ? "passed" : "failed"}`} onClick={() => onPick(r.id)} />
      ))}
    </div>
  );
}

function Inspector({ sel, r }: { sel: { sc: string; p: string } | null; r?: ScenarioResult }) {
  if (!sel || !r) return <aside className="inspector"><div className="ev-empty">Select a result to inspect it.</div></aside>;
  const failing = r.assertions.filter((a) => !a.passed);
  const hot = new Set(failing.flatMap((a) => Array.from(`${a.name} ${a.detail}`.matchAll(/turns? (\d+)(?: and (\d+))?/g)).flatMap((m) => [m[1], m[2]].filter(Boolean).map(Number))));
  return (
    <aside className="inspector" aria-label="Scenario inspector">
      <div className="ih">
        <h3>
          {SUITES.find((s) => s.key === sel.p)?.name}: {r.title} — {r.passed ? <span className="ok">pass</span> : <span className="bad">fail ({failing.length})</span>}
        </h3>
        <p>{r.why}</p>
      </div>
      {failing.map((a, i) => (
        <div key={i} className="asr fail">
          <span className="bad">✗</span> {a.name}
          <span className="cat">{a.category}</span>
          <div className="det">{a.detail}</div>
        </div>
      ))}
      {r.assertions
        .filter((a) => a.passed)
        .map((a, i) => (
          <div key={`p${i}`} className="asr">
            <span className="ok">✓</span> {a.name}
            <span className="cat">{a.category}</span>
          </div>
        ))}
      <h4 className="inspector-sub">Transcript</h4>
      {r.traces.map((t) => (
        <div key={t.turnId} className={`tturn ${hot.has(t.turn) ? "hot" : ""}`}>
          <div className="ev-in">
            Turn {t.turn}: {t.event.type === "text" ? `“${t.event.text}”` : t.event.type}
          </div>
          <div className="mono">{t.decision.rule}</div>
          <div className="ut">{t.utterance}</div>
        </div>
      ))}
    </aside>
  );
}

/* ============================ Architecture & safety ============================ */

const PIPELINE = [
  { name: "Student input", what: "Typed, or spoken and sent with Done. Both take exactly the same path.", who: "The student; speech recognition by the browser" },
  { name: "Language understanding", what: "Maths parser, word lists for moves and requests, read against the tutor's last question.", who: "Deterministic rules. A model only for text the rules can't place, and only into closed labels" },
  { name: "Math verification", what: "Each lesson's own exact checker decides whether an answer or move is right.", who: "Deterministic code only — never a model" },
  { name: "Teaching policy", what: "Which moves are allowed now: one hint level at a time, the answer only after real effort.", who: "Rule table" },
  { name: "Tutor response", what: "Wording for the chosen move, then the leak and maths guards.", who: "Templates; in algebra a model may word the move, inside the guard" },
];

function Architecture({ health }: { health: Health | null }) {
  const mis = useMemo(() => Object.values(MISCONCEPTIONS), []);
  const llm = health?.teacher.mode === "llm";
  return (
    <div className="arch">
      <section className="arch-intro">
        <h1>How the tutor decides</h1>
        <p>Every message goes through five stages. The language model is optional and never decides whether an answer is right.</p>
      </section>
      <ol className="pipeline" aria-label="Pipeline">
        {PIPELINE.map((s, i) => (
          <li key={s.name} className={`pipe ${i === 2 ? "key" : ""}`}>
            <span className="pipe-n">{i + 1}</span>
            <h2>{s.name}</h2>
            <p>{s.what}</p>
            <p className="pipe-who">{s.who}</p>
          </li>
        ))}
      </ol>

      <section className="arch-block">
        <h2>Verifiers by lesson</h2>
        <dl className="arch-verifiers">
          {LESSONS.map((l) => (
            <div key={l.id}>
              <dt>{l.title}</dt>
              <dd>{l.verifier}</dd>
            </div>
          ))}
        </dl>
        <p className="muted">There is no general reasoning engine. Anything a lesson&apos;s verifier can&apos;t check gets a clarifying question that says what can be checked.</p>
      </section>

      <section className="arch-block">
        <h2>Safety</h2>
        <div className="safety">
          <div>
            <h3>Answer-leak protection</h3>
            <p>Every reply is checked before it is sent. If it would state the answer (or, in algebra, the result of the next step) before the student has earned it, it is rejected: a model gets one retry with the reason, then the templated reply is used. Worked solutions come only after real effort, and never if the student asked not to be told.</p>
          </div>
          <div>
            <h3>Correctness guards</h3>
            <p>Arithmetic in a reply is re-checked exactly; equations not grounded in the problem or the student&apos;s own work are rejected. A model&apos;s reading of the student is schema-validated, may only use numbers the student actually said, and has no field for whether an answer is right.</p>
          </div>
          <div>
            <h3>Fallbacks</h3>
            <p>Model timeouts, provider errors and invalid output fall back to the deterministic path, and the trace says so. A per-session call budget switches the rest of a lesson to deterministic. Session state is signed by the server, so an edited state is refused.</p>
          </div>
          <div>
            <h3>Model configuration</h3>
            <dl className="config">
              <dt>Engine</dt>
              <dd>{health ? (llm ? `${health.teacher.provider}:${health.teacher.model}` : "Deterministic — no language model configured") : "…"}</dd>
              <dt>Per-call timeout</dt>
              <dd>{health?.limits ? `${health.limits.timeoutMs} ms, ${health.limits.retries} retry on timeouts and server errors` : "—"}</dd>
              <dt>Call budget</dt>
              <dd>{health?.limits ? `${health.limits.maxModelCallsPerSession} model calls per session` : "—"}</dd>
              <dt>Cost reporting</dt>
              <dd>{health ? (health.pricingConfigured ? "From provider token counts and configured prices" : "Unknown — no prices configured, so none is estimated") : "—"}</dd>
              <dt>Session signing</dt>
              <dd>{health?.sessionSigning ?? "—"}</dd>
              <dt>Rate limiting</dt>
              <dd>{health?.rateLimiting ?? "—"}</dd>
            </dl>
          </div>
        </div>
      </section>

      <section className="arch-block">
        <h2>Reference</h2>
        <details className="ref">
          <summary>Observed vs inferred, and how mastery is measured</summary>
          <p>
            <b>Observed</b> (stated as fact everywhere): validity, the implied value, and the operation applied to each side — computed from the student&apos;s lines. <b>Inferred</b> (always hedged): the misconception. Confidence means how specifically the work matches a pattern, not the probability the student holds the misconception. Students never see misconception labels.
          </p>
          <ul>
            <li>Algebra uses BKT with conventional priors (P(init) {BKT.pInit}, transit {BKT.pTransit}, slip {BKT.pSlip}, guess {BKT.pGuess}) — not fitted to data.</li>
            <li>Evidence is first attempts without help only. Finishing after hints, a reveal, or with invalid reasoning is assisted and never evidence.</li>
            <li>
              Mastered = P(known) ≥ {MASTERY_THRESHOLD} and {REQUIRED_CONSECUTIVE} consecutive independent fresh solves. Fewer than {MIN_TRANSFER_EVIDENCE} independent fresh attempts = insufficient evidence.
            </li>
            <li>Geometry and physics don&apos;t estimate mastery: they record, per question, whether it was solved without hints.</li>
          </ul>
        </details>
        <details className="ref">
          <summary>Teaching policy rules ({RULES.length})</summary>
          <div className="hscroll">
            <table className="t">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>When</th>
                  <th>Does</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {RULES.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.id}</td>
                    <td>{r.when}</td>
                    <td>{r.does}</td>
                    <td className="muted">{r.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <details className="ref">
          <summary>Algebra misconception hypotheses ({mis.length})</summary>
          <div className="hscroll">
            <table className="t">
              <thead>
                <tr>
                  <th>Hypothesis</th>
                  <th>Kind</th>
                  <th>Probe on 3x + 5 = 20</th>
                </tr>
              </thead>
              <tbody>
                {mis.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.label}
                      <div className="mono muted">{m.id}</div>
                    </td>
                    <td>{m.category}</td>
                    <td>{m.probe.replace(/\{bSigned\}/g, "“+ 5”").replace(/\{a\}/g, "3").replace(/\{bAbs\}/g, "5").replace(/\{bOp\}/g, "+").replace(/\{aPlusB\}/g, "8").replace(/\{cMinusB\}/g, "15")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </div>
  );
}

export { sessionKey };
