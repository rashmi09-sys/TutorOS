"use client";

import { stageLabel, stageSub } from "@/lib/stages";
import Link from "next/link";
import { helpOptions } from "@/lib/helpOptions";
import { lessonInfo } from "@/lib/lessons";
import { MISCONCEPTION_LABELS } from "@/engine/misconception-labels";
import { learningMessage, problemEvidence } from "@/lib/evidence";
import type { AlgebraView as SessionState } from "@/engine/view-types";
import { LessonShell, type LessonAdapter, type Stop } from "./lesson/LessonShell";
import { Notebook } from "./student/Notebook";
import { MathLine } from "./student/MathLine";

/**
 * The algebra lesson (two-step equations): the shared lesson shell with the exercise-book notebook,
 * exact equation checking and the BKT mastery estimate.
 */
export function StudentApp() {
  return <LessonShell adapter={algebra} />;
}

const algebra: LessonAdapter<SessionState> = {
  info: lessonInfo("algebra"),
  welcomePreview: <MathLine raw="3x + 5 = 20" latex="3x + 5 = 20" size="lg" focus={["constant", "other-side"]} />,
  workTitle: "Your working",
  scratch: true,
  stops: (state) => {
    const base = [
      { label: stageLabel(0), sub: stageSub(0) },
      { label: stageLabel(1), sub: stageSub(1) },
      { label: stageLabel(2), sub: stageSub(2) },
    ];
    const stops: Stop[] = base.map((s, i) => {
      const p = state.problems[i];
      const done = !!p && (i < state.current || state.phase === "COMPLETE");
      const now = i === Math.min(state.current, 2) && state.phase !== "COMPLETE";
      const obs = p ? state.mastery.observations.filter((o) => o.problemId === p.id) : [];
      const alone = obs.some((o) => o.kind === "transfer" && o.correct && !o.assisted);
      const how = obs.some((o) => !o.assisted && o.correct) ? "solved alone" : obs.some((o) => o.assisted) ? "with help" : "";
      return { label: s.label, sub: done && how ? how : s.sub, done, now, pip: i > 0 && done ? (alone ? "yes" : "no") : undefined };
    });
    if (state.current > 2) stops.push({ label: "Extra check", sub: "on your own", done: false, now: true });
    return stops;
  },
  WorkPanel: ({ state, hoverTurn, onRestart, onSay, busy }) => <Notebook state={state} hoverTurn={hoverTurn} onSay={onSay} busy={busy} footer={state.phase === "COMPLETE" ? <Result state={state} onRestart={onRestart} /> : null} />,
  helpOptions,
  dividers: (state) => {
    const d = new Map<number, string>();
    state.problems.forEach((p, i) => {
      if (i === 0) return;
      const given = state.board.find((b) => b.problemId === p.id && b.kind === "problem");
      if (given?.turn != null) d.set(given.turn, `${stageLabel(i)} · ${p.text}`);
    });
    return d;
  },
  Profile: ({ state }) => <AlgebraProfile state={state} />,
};

/* ---------------- End of lesson ---------------- */

function Result({ state, onRestart }: { state: SessionState; onRestart: () => void }) {
  const m = state.mastery;
  const alone = m.observations.filter((o) => o.kind === "transfer" && o.correct).length;
  const tries = m.observations.filter((o) => o.kind === "transfer").length;
  const msg = learningMessage(problemEvidence(state));
  return (
    <section className="result" role="status" aria-label="Understanding check">
      <p className="result-kicker">Understanding check</p>
      <h2>{msg.heading}</h2>
      <p className="result-verdict">{msg.text}</p>
      <p className="result-evidence">Fresh problems on your own: {alone} of {tries} solved without help. Problems finished with help don&apos;t count towards this.</p>
      <Evidence state={state} />
      <div className="result-moves">
        <span>The two moves:</span>
        <span className="move">undo the number added or taken away</span>
        <span className="arrow">then</span>
        <span className="move">undo the multiplication</span>
      </div>
      <div className="result-actions">
        <button className="btn primary" onClick={onRestart}>Start a new lesson</button>
        <Link className="btn quiet" href="/">Choose another lesson</Link>
      </div>
    </section>
  );
}

/** What happened on each problem, from the session record — observable, not a claim about long-term learning. */
function Evidence({ state }: { state: SessionState }) {
  const rows = problemEvidence(state);
  return (
    <div className="evidence">
      <h3>What I saw</h3>
      <table className="evidence-table">
        <thead>
          <tr>
            <th scope="col">Problem</th>
            <th scope="col">Your lines</th>
            <th scope="col">Lines to fix</th>
            <th scope="col">Hints</th>
            <th scope="col">First try</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.problemId}>
              <th scope="row">
                <span className="ev-eq">{r.text}</span>
                <small>{r.stage === "guided" ? "solved together" : `${r.stage === "independent" ? "new numbers" : "new twist"} · ${r.independent ? "on your own" : "with help"}`}</small>
              </th>
              <td className="ev-steps">{r.steps.length ? r.steps.join("  →  ") : "—"}</td>
              <td>{r.wrongLines}</td>
              <td>{r.hints}</td>
              <td>{r.firstTry ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.some((r) => r.repeatedMistake) && <p className="evidence-note">The same mix-up came up more than once: {Array.from(new Set(rows.filter((r) => r.repeatedMistake).flatMap((r) => r.noticed))).join("; ").toLowerCase()}.</p>}
      <p className="evidence-note">This is what happened in this lesson. It shows you can use the two moves today; remembering them next week needs another check later.</p>
    </div>
  );
}

const STATUS_LABEL: Record<SessionState["mastery"]["status"], string> = {
  not_started: "not started",
  insufficient_evidence: "not enough evidence yet",
  developing: "developing",
  mastered: "got it",
  needs_practice: "needs practice",
};

function AlgebraProfile({ state }: { state: SessionState }) {
  const m = state.mastery;
  const h = state.misconceptionHistory ?? [];
  const recurring = Array.from(new Set(h.map((x) => x.id))).filter((id) => new Set(h.filter((x) => x.id === id).map((x) => x.problemId)).size > 1);
  return (
    <>
      <p className="muted">Everything stored about you is on this page. No name, no audio, no account — and it lives only in this browser.</p>
      <dl className="kv">
        <dt>Status</dt><dd>{STATUS_LABEL[m.status]}</dd>
        <dt>Estimated understanding</dt><dd>{Math.round(m.pKnown * 100)}%</dd>
        <dt>Fresh problems solved alone</dt><dd>{m.observations.filter((o) => o.kind === "transfer" && o.correct).length}</dd>
        <dt>Finished with help</dt><dd>{m.observations.filter((o) => o.assisted).length}</dd>
      </dl>
      <h3 className="drawer-h3">Things that might be tripping you up</h3>
      <p className="muted">These are guesses from your working, not facts about you — they help choose what to ask next.</p>
      {Object.keys(state.misconceptionCounts).length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <ul className="plain">
          {Object.entries(state.misconceptionCounts).map(([id, n]) => (
            <li key={id}>
              Maybe: {MISCONCEPTION_LABELS[id as keyof typeof MISCONCEPTION_LABELS].toLowerCase()} <span className="muted">· seen {n}×{recurring.includes(id as keyof typeof MISCONCEPTION_LABELS) ? " on more than one problem" : ""}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted" style={{ marginTop: 18 }}>
        How it&apos;s estimated: only first tries without help count. &quot;Got it&quot; needs two fresh problems in a row, solved alone. With fewer than two fresh tries, we say there isn&apos;t enough evidence yet.
      </p>
    </>
  );
}
