"use client";

import { stageDone, stageLabel, stageSub } from "@/lib/stages";
import Link from "next/link";
import type { HelpOption } from "@/lib/helpOptions";
import { lessonInfo } from "@/lib/lessons";
import type { Message } from "@/engine/types";
import type { SubjectLessonId } from "@/engine/subjects/types";
import type { SubjectProblemView as SubjectProblem, SubjectView as SubjectState } from "@/engine/view-types";
import { LessonShell, type LessonAdapter, type Stop } from "./lesson/LessonShell";
import { learningMessage, subjectEvidence } from "@/lib/evidence";
import { ForceExplorer, ForceFigure, TriangleExplorer, TriangleFigure } from "./lesson/figures";

/** Geometry and physics lessons: the shared shell, a subject figure, and the student's answers per question. */
export function SubjectLesson({ lesson }: { lesson: SubjectLessonId }) {
  return <LessonShell adapter={lesson === "geometry" ? geometryAdapter : physicsAdapter} />;
}

const STUCK: HelpOption = { label: "I'm stuck", text: "I'm stuck" };
const DIFFERENT: HelpOption = { label: "Explain differently", text: "Explain it another way" };
const HINT: HelpOption = { label: "Small hint", text: "Small hint" };
const WHY: HelpOption = { label: "Why?", text: "Why?" };

function subjectHelp(s: SubjectState): HelpOption[] {
  if (s.phase === "COMPLETE") return [];
  const last = [...s.transcript].reverse().find((m) => m.role === "tutor");
  if (last?.action === "WAIT") return [];
  if (!last || last.cue === "fresh" || last.cue === "ans_done") return [HINT, STUCK];
  if (last.stage === "NOTICE") return [HINT, DIFFERENT];
  if (last.stage === "THINK") return [DIFFERENT, HINT, WHY];
  if (last.stage === "TRY") return [WHY, DIFFERENT, STUCK];
  return [HINT, WHY];
}

/** The tutor turn that presented each problem (its prompt appears in that message). */
function presentedAt(s: SubjectState): number[] {
  return s.problems.map((p) => s.transcript.find((m) => m.role === "tutor" && m.text.includes(p.prompt))?.turn ?? Infinity);
}

type Mark = "ok" | "part" | "bad";
function answersFor(s: SubjectState, i: number): { text: string; mark: Mark; via?: string }[] {
  const at = presentedAt(s);
  const from = at[i], to = at[i + 1] ?? Infinity;
  const out: { text: string; mark: Mark; via?: string }[] = [];
  for (const m of s.transcript) {
    if (m.role !== "student" || !(m.turn > from && m.turn <= to)) continue;
    const reply = s.transcript.find((x) => x.role === "tutor" && x.turn === m.turn);
    const cue = reply?.cue;
    if (cue !== "ans_done" && cue !== "ans_ok" && cue !== "ans_part" && cue !== "ans_bad") continue;
    const mark: Mark = cue === "ans_done" || cue === "ans_ok" ? "ok" : cue === "ans_part" ? "part" : "bad";
    out.push({ text: m.text, mark, via: m.via });
  }
  return out;
}

/** How a question was finished. The first one is solved together, so "alone" only applies to checks. */
function howSolved(r: SubjectState["records"][number], i: number) {
  if (r.revealed) return "worked through";
  if (r.hints > 0) return "with help";
  return i === 0 ? "solved" : "solved alone";
}

function stops(s: SubjectState): Stop[] {
  return s.problems.map((p, i) => {
    const r = s.records[i];
    const done = r.solved || i < s.current;
    const now = i === s.current && s.phase !== "COMPLETE";
    const how = howSolved(r, i);
    return { label: stageLabel(i), sub: done ? how : stageSub(i), done, now, pip: i > 0 && done ? (r.alone ? "yes" : "no") : undefined };
  });
}

interface Live {
  /** The tutor's latest turn on this question asked a sub-question the picture can answer by tapping. */
  awaiting?: string;
  visual?: Message["visual"];
  onSay?: (t: string) => void;
}

function Figure({ p, solved, live }: { p: SubjectProblem; solved: boolean; live?: Live }) {
  if (p.data.A !== undefined) return <TriangleFigure data={p.data} solved={solved} interactive={!solved} litKnown={live?.visual === "angle-sum" || live?.visual === "angles"} sumStrip={live?.visual === "angle-sum"} />;
  const tap = live?.awaiting === "stronger_side" && live.onSay ? (dir: "right" | "left") => live.onSay!(`the push to the ${dir}`) : undefined;
  return (
    <div className={`force-wrap ${live?.visual ? `cue-${live.visual}` : ""}`}>
      <ForceFigure spec={{ right: Number(p.data.right), left: Number(p.data.left), missing: p.data.missing === "right" ? "right" : undefined, moving: p.data.moving ? Number(p.data.moving) : undefined }} onTap={tap} />
      {tap && <p className="tap-hint">Tap the stronger push.</p>}
    </div>
  );
}

function WorkPanel({ state, onRestart, onSay, busy }: { state: SubjectState; hoverTurn: number | null; onRestart: () => void; onSay: (t: string) => void; busy: boolean }) {
  const cur = Math.min(state.current, state.problems.length - 1);
  const complete = state.phase === "COMPLETE";
  const from = presentedAt(state)[cur];
  const lastTutor = [...state.transcript].reverse().find((m) => m.role === "tutor");
  const live: Live = lastTutor && lastTutor.turn >= from ? { awaiting: lastTutor.awaiting, visual: lastTutor.visual, onSay: busy ? undefined : onSay } : {};
  return (
    <div className="sp">
      {state.problems.slice(0, complete ? state.problems.length : cur).map((p, i) => (
        <PastQuestion key={p.id} p={p} i={i} state={state} />
      ))}
      {!complete && (
        <section className="sp-current" aria-label={`Question ${cur + 1}`}>
          <p className="sp-step">
            Question {cur + 1} of {state.problems.length}
            <span>{stageLine(state.problems[cur], cur)}</span>
          </p>
          <p className="sp-prompt">{state.problems[cur].prompt}</p>
          <figure className="sp-figure">
            <Figure p={state.problems[cur]} solved={false} live={live} />
          </figure>
          <Answers items={answersFor(state, cur)} />
        </section>
      )}
      {!complete && (
        <details className="sp-explore">
          <summary>{state.lesson === "geometry" ? "Explore the 180° rule" : "Explore balanced and unbalanced forces"}</summary>
          {state.lesson === "geometry" ? <TriangleExplorer /> : <ForceExplorer />}
          <p className="sp-explore-note">{state.lesson === "geometry" ? "Drag the top corner. The angles change; their total never does." : "Change the two pushes and watch the net force."}</p>
        </details>
      )}
      {complete && <SubjectResult state={state} onRestart={onRestart} />}
    </div>
  );
}

function stageLine(p: SubjectProblem, i: number) {
  if (i === 0) return `${stageLabel(0)} — ask for hints any time`;
  if (p.stage === "transfer") return `${stageLabel(2)} — a different twist. Hints are there if you need them`;
  return `${stageLabel(1)} — a new problem. Hints are there if you need them`;
}

function Answers({ items }: { items: { text: string; mark: Mark; via?: string }[] }) {
  if (!items.length) return <p className="sp-empty">Your answers will appear here.</p>;
  return (
    <ol className="sp-answers" aria-label="Your answers to this question">
      {items.map((a, i) => (
        <li key={i} className={`sp-answer ${a.mark}`}>
          <span className="sp-mark" aria-hidden>{a.mark === "ok" ? "✓" : a.mark === "part" ? "½" : "✗"}</span>
          <span className="sp-text">{a.text}</span>
          <span className="sp-verdict">{a.mark === "ok" ? "correct" : a.mark === "part" ? "partly right" : "not yet"}</span>
        </li>
      ))}
    </ol>
  );
}

function PastQuestion({ p, i, state }: { p: SubjectProblem; i: number; state: SubjectState }) {
  const r = state.records[i];
  return (
    <details className="sp-past">
      <summary>
        <span className="past-label">{stageDone(i)}</span>
        <span className="sp-past-answer">{p.answerText}</span>
        <span className={`evidence-tag ${r.alone || (i === 0 && r.hints === 0 && !r.revealed) ? "alone" : "help"}`}>{howSolved(r, i)}</span>
      </summary>
      <div className="sp-past-body">
        <p className="sp-prompt small">{p.prompt}</p>
        <figure className="sp-figure small">
          <Figure p={p} solved />
        </figure>
        <Answers items={answersFor(state, i)} />
      </div>
    </details>
  );
}

function SubjectResult({ state, onRestart }: { state: SubjectState; onRestart: () => void }) {
  const checks = state.records.filter((_, i) => state.problems[i].role === "check");
  const alone = checks.filter((r) => r.alone).length;
  const rows = subjectEvidence(state);
  const msg = learningMessage(rows);
  return (
    <section className="result" role="status" aria-label="Lesson summary">
      <p className="result-kicker">End of lesson</p>
      <h2>{msg.heading}</h2>
      <p className="result-verdict">{msg.text}</p>
      <p className="result-evidence">On your own without hints: {alone} of {checks.length}. A question only counts if it was solved without hints and without being shown the working. Wrong tries along the way are fine.</p>
      <div className="evidence">
        <h3>What I saw</h3>
        <table className="evidence-table">
          <thead>
            <tr>
              <th scope="col">Question</th>
              <th scope="col">Wrong tries</th>
              <th scope="col">Hints</th>
              <th scope="col">First try</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.problemId}>
                <th scope="row">
                  {stageLabel(i)}
                  <small>{r.workedThrough ? "worked through together" : r.stage === "guided" ? "solved together" : r.independent ? "on your own" : "with help"}</small>
                </th>
                <td>{r.tries}</td>
                <td>{r.hints}</td>
                <td>{r.firstTry ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="evidence-note">This is what happened in this lesson — not a test score, and not proof it will stick.</p>
      </div>
      <div className="result-moves">
        <span>The key idea:</span>
        <span className="move">{state.lesson === "geometry" ? "the three angles share 180°" : "opposite forces subtract; zero net force changes nothing"}</span>
      </div>
      <div className="result-actions">
        <button className="btn primary" onClick={onRestart}>Start again</button>
        <Link className="btn quiet" href="/">Choose another lesson</Link>
      </div>
    </section>
  );
}

function Profile({ state }: { state: SubjectState }) {
  return (
    <>
      <p className="muted">Everything stored about you is on this page. No name, no audio, no account — and it lives only in this browser.</p>
      <dl className="kv">
        {state.problems.map((p, i) => {
          const r = state.records[i];
          return (
            <div key={p.id} style={{ display: "contents" }}>
              <dt>{stageDone(i)}</dt>
              <dd>{r.solved ? howSolved(r, i) : i === state.current ? "in progress" : "not started"}</dd>
            </div>
          );
        })}
      </dl>
      <p className="muted" style={{ marginTop: 18 }}>
        How it&apos;s counted: a check counts as solved alone only without hints and without being shown the working. This lesson doesn&apos;t estimate mastery — three questions aren&apos;t enough evidence for that.
      </p>
    </>
  );
}

function dividers(s: SubjectState) {
  const d = new Map<number, string>();
  presentedAt(s).forEach((turn, i) => {
    if (i > 0 && Number.isFinite(turn)) d.set(turn, `${stageLabel(i)} · ${stageSub(i)}`);
  });
  return d;
}

const base = {
  workTitle: "The question",
  stops,
  WorkPanel,
  helpOptions: subjectHelp,
  dividers,
  Profile,
};

const geometryAdapter: LessonAdapter<SubjectState> = {
  ...base,
  info: lessonInfo("geometry"),
  welcomePreview: <TriangleFigure data={{ A: 65, B: 40, C: 75, unknown: "C" }} />,
};

const physicsAdapter: LessonAdapter<SubjectState> = {
  ...base,
  info: lessonInfo("physics"),
  welcomePreview: <ForceFigure spec={{ right: 12, left: 8 }} />,
};

export type { Message };
