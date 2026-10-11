"use client";

import { stageDone, stageLabel, stageSub } from "@/lib/stages";
import { Fragment, memo, useState, type ReactNode } from "react";
import type { BoardEntry, FocusRole, SessionState } from "@/engine/types";
import { Tex } from "../Math";
import { MathLine } from "./MathLine";
import { BalanceFigure } from "../lesson/figures";
import { parseEquation } from "@/engine/algebra";
import { normalize } from "@/engine/misconceptions";

export interface SpeechProgress {
  turn: number;
  chars: number;
}

interface Props {
  state: SessionState;
  /** The tutor turn whose terms are highlighted: the one being hovered in the conversation, else the latest. */
  hoverTurn: number | null;
  footer?: ReactNode;
  /** Send words from the whiteboard (a chosen move) exactly as if typed. */
  onSay?: (text: string) => void;
  busy?: boolean;
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
export const Notebook = memo(function Notebook({ state, hoverTurn, footer, onSay, busy }: Props) {
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
              <button className="past-summary" onClick={() => setOpenPast((o) => ({ ...o, [p.id]: true }))} aria-label={`${stageDone(i)}: ${p.text}, ${evidenceWords(pastObs)}. Show working.`}>
                <span className="past-label">{stageDone(i)}</span>
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
              <span className="nb-kicker">{`${stageLabel(i)} · ${stageSub(i)}`}</span>
              {p.role === "transfer" && isCurrent && <span className="nb-sub">{i === 1 ? "Same idea, new numbers — this one's yours. Hints are there if you ask." : "Same idea, different shape. Let's see if it carries over — hints are there if you ask."}</span>}
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
            {isCurrent && state.phase !== "COMPLETE" && <BoardAids state={state} problemId={p.id} guided={p.role === "guided"} onSay={onSay} busy={busy} />}
          </section>
        );
      })}
      {footer}
    </div>
  );
});

/**
 * Whiteboard help that follows the lesson state:
 *  - the balance, when the tutor switched to it, for as long as the line it shows is still the current one;
 *  - on the problem solved together, once the student has hesitated or slipped, a row of possible moves to
 *    pick from (one right, the others plausible). Picking one sends those words, which are checked exactly
 *    like typed words — the student still has to work out what the equation becomes.
 * Not shown on the independent problems, which measure what the student can do without help.
 */
function BoardAids({ state, problemId, guided, onSay, busy }: { state: SessionState; problemId: string; guided: boolean; onSay?: (t: string) => void; busy?: boolean }) {
  const given = state.board.find((b) => b.problemId === problemId && b.kind === "problem");
  const since = given?.turn ?? 0;
  const pic = [...state.transcript].reverse().find((m) => m.role === "tutor" && m.visual === "balance" && m.figure && m.turn >= since);
  const moved = pic && state.board.some((b) => b.problemId === problemId && (b.status === "valid" || b.status === "final") && (b.turn ?? 0) > pic.turn);
  const tm = state.teaching;
  const hesitated = (tm?.confusion ?? 0) > 0 || state.attempts > 0 || (tm?.strategies.length ?? 0) > 0;
  const moves = guided && hesitated && onSay ? moveChoices(state.lastValidRaw, state.turn) : [];
  if (!(pic && !moved) && !moves.length) return null;
  return (
    <div className="board-aids">
      {pic && !moved && (
        <figure className="board-balance" aria-label="The equation as a balance">
          <BalanceFigure a={pic.figure!.a} b={pic.figure!.b} c={pic.figure!.c} />
          <figcaption>Both sides weigh the same. Whatever you do to one pan, do to the other.</figcaption>
        </figure>
      )}
      {moves.length > 0 && (
        <div className="move-choices" role="group" aria-label="Pick a move">
          <span className="move-q">Not sure what to do next? Pick a move:</span>
          {moves.map((m) => (
            <button key={m} className="move-chip" disabled={busy} onClick={() => onSay!(m)}>
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One right move and two plausible ones for the current line, in an order that changes with the turn. */
function moveChoices(raw: string, turn: number): string[] {
  const eq = parseEquation(raw);
  if (!eq) return [];
  const n = normalize(eq);
  if (n.A.d !== 1 || n.B.d !== 1 || n.C.d !== 1 || n.A.isZero()) return [];
  const a = n.A.valueOf(), b = n.B.valueOf();
  if (a === 1 && b === 0) return []; // already solved
  const k = Math.abs(b);
  const opts = b > 0 ? [`Subtract ${k} from both sides`, `Add ${k} to both sides`, `Divide both sides by ${a}`] : b < 0 ? [`Add ${k} to both sides`, `Subtract ${k} from both sides`, `Divide both sides by ${a}`] : [`Divide both sides by ${a}`, `Multiply both sides by ${a}`, `Subtract ${a} from both sides`];
  const r = turn % 3;
  return [...opts.slice(r), ...opts.slice(0, r)];
}

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
