"use client";

import Link from "next/link";
import type { HelpOption } from "@/lib/helpOptions";
import { lessonInfo } from "@/lib/lessons";
import type { Message } from "@/engine/types";
import type { SubjectLessonId, SubjectProblem, SubjectState } from "@/engine/subjects/types";
import { LessonShell, type LessonAdapter, type Stop } from "./lesson/LessonShell";
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
  if (!last || last.rule === "S0_PRESENT" || /_CORRECT$/.test(last.rule ?? "")) return [HINT, STUCK];
  if (last.stage === "NOTICE") return [HINT, DIFFERENT];
  if (last.stage === "THINK") return [DIFFERENT, HINT, WHY];
  if (last.stage === "TRY") return [WHY, DIFFERENT, STUCK];
  return [HINT, WHY];
}

/** The tutor turn that presented each problem (its prompt appears in that message). */
function presentedAt(s: SubjectState): number[] {
  return s.problems.map((p) => s.transcript.find((m) => m.role === "tutor" && m.text.includes(p.prompt))?.turn ?? Infinity);
}

const NOT_ANSWERS = /(CONCEPT|WHICH_NUMBER|BOUNDED_CHECK|SIZE_TOO|CLARIFY)/;
type Mark = "ok" | "part" | "bad";
function answersFor(s: SubjectState, i: number): { text: string; mark: Mark; via?: string }[] {
  const at = presentedAt(s);
  const from = at[i], to = at[i + 1] ?? Infinity;
  const out: { text: string; mark: Mark; via?: string }[] = [];
  for (const m of s.transcript) {
    if (m.role !== "student" || !(m.turn > from && m.turn <= to)) continue;
    const reply = s.transcript.find((x) => x.role === "tutor" && x.turn === m.turn);
    const rule = reply?.rule ?? "";
    if (!/^(G|P)_/.test(rule) || NOT_ANSWERS.test(rule)) continue;
    const mark: Mark = /_CORRECT$/.test(rule) ? "ok" : /(RIGHT_FLAWED|NO_DIRECTION|WRONG_DIRECTION)/.test(rule) ? "part" : "bad";
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
    return { label: i === 0 ? "Solve together" : `Check ${i}`, sub: done ? how : i === 0 ? "with hints" : "on your own", done, now, pip: i > 0 && done ? (r.alone ? "yes" : "no") : undefined };
  });
}

function Figure({ p, solved }: { p: SubjectProblem; solved: boolean }) {
  if (p.data.A !== undefined) return <TriangleFigure data={p.data} solved={solved} />;
  return <ForceFigure spec={{ right: Number(p.data.right), left: Number(p.data.left), missing: p.data.missing === "right" ? "right" : undefined, moving: p.data.moving ? Number(p.data.moving) : undefined }} />;
}

function WorkPanel({ state, onRestart }: { state: SubjectState; hoverTurn: number | null; onRestart: () => void }) {
  const cur = Math.min(state.current, state.problems.length - 1);
  const complete = state.phase === "COMPLETE";
  return (
    <div className="sp">
      {state.problems.slice(0, complete ? state.problems.length : cur).map((p, i) => (
        <PastQuestion key={p.id} p={p} i={i} state={state} />
      ))}
      {!complete && (
        <section className="sp-current" aria-label={`Question ${cur + 1}`}>
          <p className="sp-step">
            Question {cur + 1} of {state.problems.length}
            <span>{cur === 0 ? "Solve it together — ask for hints any time" : "On your own — hints are there if you need them"}</span>
          </p>
          <p className="sp-prompt">{state.problems[cur].prompt}</p>
          <figure className="sp-figure">
            <Figure p={state.problems[cur]} solved={false} />
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
        <span className="past-label">{i === 0 ? "Solved together" : `Check ${i}`}</span>
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
  const big = alone === checks.length ? "Got it." : alone > 0 ? "Nearly there." : "Not yet.";
  return (
    <section className="result" role="status" aria-label="Lesson summary">
      <p className="result-kicker">End of lesson</p>
      <h2>{big}</h2>
      <p className="result-verdict">Checks solved without hints: {alone} of {checks.length}.</p>
      <p className="result-evidence">A check only counts if it was solved without hints and without being shown the working. Wrong tries along the way are fine.</p>
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
              <dt>{i === 0 ? "Solved together" : `Check ${i}`}</dt>
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
    if (i > 0 && Number.isFinite(turn)) d.set(turn, `Check ${i} · on your own`);
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
  welcomeTitle: "Let's find some missing angles.",
  welcomePreview: <TriangleFigure data={{ A: 65, B: 40, C: 75, unknown: "C" }} />,
};

const physicsAdapter: LessonAdapter<SubjectState> = {
  ...base,
  info: lessonInfo("physics"),
  welcomeTitle: "Let's see what forces do.",
  welcomePreview: <ForceFigure spec={{ right: 12, left: 8 }} />,
};

export type { Message };
