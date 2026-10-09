"use client";

import { Fragment, memo, useState, type ReactNode } from "react";
import type { BoardEntry, FocusRole, SessionState } from "@/engine/types";
import { Tex } from "../Math";
import { MathLine } from "./MathLine";

export interface SpeechProgress {
  turn: number;
  chars: number;
}

interface Props {
  state: SessionState;
  /** The tutor turn whose terms are highlighted: the one being hovered in the conversation, else the latest. */
  hoverTurn: number | null;
  footer?: ReactNode;
}

/**
 * The working, as an exercise-book page: the problem, then the student's lines in their own form.
 * Accepted lines are joined by the operation the student performed; rejected attempts are struck
 * through and show what was actually done to each side. The line the tutor's latest message is about
 * is marked, and the terms it refers to are highlighted.
 * Everything rendered here comes from validated engine state (board entries, observed operations,
 * decision focus). Nothing is generated client-side.
 */
// Memoised: read-aloud progress updates the conversation word by word, and must not re-render the
// working (with all its KaTeX) each time.
export const Notebook = memo(function Notebook({ state, hoverTurn, footer }: Props) {
  const [openPast, setOpenPast] = useState<Record<string, boolean>>({});
  const [showOlderTries, setShowOlderTries] = useState(false);

  const tutor = state.transcript.filter((m) => m.role === "tutor");
  const lastTutor = tutor[tutor.length - 1];

  return (
    <div className="notebook">
      {state.problems.map((p, i) => {
        const entries = state.board.filter((b) => b.problemId === p.id);
        const isCurrent = i === state.current;
        const pastObs = state.mastery.observations.filter((o) => o.problemId === p.id);
        const final = entries.find((e) => e.status === "final");
        if (!isCurrent && !openPast[p.id]) {
          return (
            <section key={p.id} className="nb-section past" aria-label={`Earlier problem ${p.text}`}>
              <button className="past-summary" onClick={() => setOpenPast((o) => ({ ...o, [p.id]: true }))} aria-label={`${p.role === "guided" ? "Solved together" : `Check ${i}`}: ${p.text}, ${evidenceWords(pastObs)}. Show working.`}>
                <span className="past-label">{p.role === "guided" ? "Solved together" : `Check ${i}`}</span>
                <MathLine raw={p.text} latex={p.latex} size="sm" />
                <span className="past-arrow">→</span>
                {final?.raw ? <MathLine raw={final.raw} latex={final.latex} size="sm" /> : <span>—</span>}
                <span className={`evidence-tag ${pastObs.some((o) => o.kind === "transfer" && o.correct) ? "alone" : "help"}`}>
                  {evidenceWords(pastObs)}
                </span>
                <span className="past-open">show working</span>
              </button>
            </section>
          );
        }
        const notesFor = (e: BoardEntry) => tutor.filter((m) => m.anchor === e.id);
        const invalidIdx = entries.map((e, k) => (e.status === "invalid" ? k : -1)).filter((k) => k >= 0);
        const hiddenTries = showOlderTries ? new Set<number>() : new Set(invalidIdx.slice(0, Math.max(0, invalidIdx.length - 2)).filter((k) => !entries[k] || !notesFor(entries[k]).includes(lastTutor)));
        let lastAccepted: BoardEntry | undefined;
        let stepNo = 0;
        return (
          <section key={p.id} className={`nb-section ${isCurrent ? "current" : "reopened"}`} aria-label={`Problem ${p.text}`}>
            <header className="nb-head">
              <span className="nb-kicker">{p.role === "guided" ? "Solve together" : `Check ${i} · on your own`}</span>
              {p.role === "transfer" && isCurrent && <span className="nb-sub">A fresh problem with new numbers. Hints are there if you ask, but this one shows what you can do alone.</span>}
              {!isCurrent && (
                <button className="link" onClick={() => setOpenPast((o) => ({ ...o, [p.id]: false }))}>
                  hide working
                </button>
              )}
            </header>
            <div className="nb-grid">
              {entries.map((e, k) => {
                if (hiddenTries.has(k)) {
                  if (k === invalidIdx[0])
                    return (
                      <div key={e.id} className="nb-row folded">
                        <span className="gutter" />
                        <button className="link fold" onClick={() => setShowOlderTries(true)}>
                          {hiddenTries.size} earlier {hiddenTries.size === 1 ? "try" : "tries"} — show
                        </button>
                      </div>
                    );
                  return null;
                }
                const activeHere = lastTutor?.anchor === e.id;
                const focusTurn = hoverTurn !== null ? tutor.find((m) => m.turn === hoverTurn) : lastTutor;
                const focus: FocusRole[] = focusTurn?.anchor === e.id ? (focusTurn.focus ?? []) : [];
                const prevAccepted = lastAccepted;
                if (e.status === "valid" || e.status === "final" || e.kind === "problem") lastAccepted = e;
                if (e.status === "valid") stepNo++;
                return (
                  <Fragment key={e.id}>
                    {e.observed && prevAccepted && (e.kind === "step" || (e.kind === "answer" && e.status === "final")) && <Connector entry={e} />}
                    <div className={`nb-row ${rowClass(e)} ${activeHere ? "is-active" : ""} ${focus.length ? "has-focus" : ""}`} data-entry={e.id}>
                      <span className="gutter" aria-hidden>
                        {gutterMark(e, stepNo)}
                      </span>
                      <div className="work">
                        {e.kind === "check" || e.kind === "hint" ? (
                          <div className="tutor-ink">
                            <span className="ink-label">{e.kind === "check" ? "Tutor’s check" : "Tutor showed"}</span>
                            <Tex tex={e.latex} />
                          </div>
                        ) : (
                          <>
                            <MathLine raw={e.raw} latex={e.latex} focus={focus} size={e.kind === "problem" ? "lg" : "md"} />
                            <span className="status-word">{statusWord(e)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </Fragment>
                );
              })}
            </div>
          </section>
        );
      })}
      {footer}
    </div>
  );
});

function Connector({ entry }: { entry: BoardEntry }) {
  const o = entry.observed!;
  const ok = entry.status === "valid" || entry.status === "final";
  return (
    <div className={`nb-connector ${ok ? "ok" : "bad"}`} aria-label={`What was done: ${o.summary}`}>
      <span className="gutter" />
      <div className="conn">
        <span className="conn-line" aria-hidden />
        <span className="conn-text">
          {ok ? o.summary : <>left {o.leftText} <span className="vs">·</span> right {o.rightText}</>}
          {!ok && <span className="conn-why">{o.sameOnBoth ? " — same on both sides, but not equivalent" : " — the two sides changed differently"}</span>}
        </span>
      </div>
    </div>
  );
}

function rowClass(e: BoardEntry) {
  if (e.kind === "problem") return "given";
  if (e.kind === "check" || e.kind === "hint") return "annotation";
  return e.status;
}

function gutterMark(e: BoardEntry, n: number) {
  if (e.kind === "problem") return "";
  if (e.kind === "check" || e.kind === "hint") return "✎";
  if (e.status === "valid") return <span className="mark ok">✓<small>{n}</small></span>;
  if (e.status === "final") return <span className="mark ok">✓✓</span>;
  if (e.status === "invalid") return <span className="mark bad">✗</span>;
  return "";
}

function statusWord(e: BoardEntry) {
  if (e.kind === "problem") return "";
  if (e.status === "valid") return e.note === "true, but no simpler" ? "true, but no simpler" : "balanced";
  if (e.status === "final") return e.note ?? "solved";
  if (e.status === "invalid") return e.kind === "answer" ? "doesn’t make it true" : "not balanced";
  return "";
}

function evidenceWords(obs: SessionState["mastery"]["observations"]) {
  if (obs.some((o) => o.kind === "transfer" && o.correct)) return "on your own";
  if (obs.some((o) => o.kind === "pre-check" && o.correct)) return "first try";
  return "with help";
}
