"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LESSONS, type LessonInfo } from "@/lib/lessons";
import { clearSession, loadSession } from "@/lib/storage";
import type { SessionState } from "@/engine/types";
import type { LessonId, SubjectState } from "@/engine/subjects/types";
import { MathLine } from "./student/MathLine";
import { ForceFigure, TriangleFigure } from "./lesson/figures";
import { Capability } from "./lesson/LessonShell";
import type { TeacherInfo } from "@/lib/useTutorSession";

type Progress = { label: string; finished: boolean } | null;

/** Where the student is in a lesson, from the session saved in this browser. */
function progressOf(id: LessonId): Progress {
  const s = loadSession(id);
  const st = s?.state;
  if (!st || !s?.stateSig || st.turn === 0) return null;
  if (id === "algebra") {
    const a = st as SessionState;
    if (a.phase === "COMPLETE") return { label: `Finished: ${a.mastery.observations.filter((o) => o.kind === "transfer" && o.correct).length} fresh problems solved on your own`, finished: true };
    return { label: a.current === 0 ? "In progress: solving together" : `In progress: check ${a.current}`, finished: false };
  }
  const g = st as SubjectState;
  if (g.phase === "COMPLETE") return { label: `Finished: ${g.records.filter((r) => r.alone).length} of 2 checks without hints`, finished: true };
  return { label: `In progress: question ${g.current + 1} of ${g.problems.length}`, finished: false };
}

const FIGURES: Record<LessonId, React.ReactNode> = {
  algebra: (
    <div className="card-eq">
      <MathLine raw="3x + 5 = 20" latex="3x + 5 = 20" size="lg" focus={["constant"]} />
      <MathLine raw="3x = 15" latex="3x = 15" />
    </div>
  ),
  physics: <ForceFigure spec={{ right: 12, left: 8 }} compact title="A box pushed 12 N to the right and 8 N to the left" />,
  geometry: <TriangleFigure data={{ A: 65, B: 40, C: 75, unknown: "C" }} />,
};

export function Home() {
  const router = useRouter();
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [teacher, setTeacher] = useState<TeacherInfo | null>(null);
  useEffect(() => {
    // Read progress on mount, and again when the page is shown from the browser's back/forward cache or the
    // tab regains focus (a lesson may have moved on in another tab).
    const refresh = () => setProgress(Object.fromEntries(LESSONS.map((l) => [l.id, progressOf(l.id)])));
    refresh();
    window.addEventListener("pageshow", refresh);
    window.addEventListener("focus", refresh);
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => setTeacher({ mode: h.teacher.mode, name: h.teacher.mode === "llm" ? `${h.teacher.provider}:${h.teacher.model}` : "deterministic" }))
      .catch(() => setTeacher(null));
    return () => {
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return (
    <div className="home">
      <header className="home-bar">
        <span className="home-brand">TutorOS</span>
      </header>
      <main className="home-main">
        <section className="home-intro">
          <h1>What would you like to work on?</h1>
          <p>Each lesson is a short conversation with a tutor. You do the thinking; it checks every answer exactly and gives hints one step at a time.</p>
        </section>
        <ul className="lesson-cards" aria-label="Lessons">
          {LESSONS.map((l) => (
            <LessonCard
              key={l.id}
              l={l}
              progress={progress[l.id] ?? null}
              onStartAgain={() => {
                clearSession(l.id);
                router.push(l.href);
              }}
            />
          ))}
        </ul>
        <footer className="home-foot">
          <Capability teacher={teacher} />
          <p>No sign-up and no name. Your work stays in this browser.</p>
        </footer>
      </main>
    </div>
  );
}

function LessonCard({ l, progress, onStartAgain }: { l: LessonInfo; progress: Progress; onStartAgain: () => void }) {
  return (
    <li className={`lesson-card s-${l.id}`}>
      <div className="card-figure" aria-hidden>
        {FIGURES[l.id]}
      </div>
      <div className="card-body">
        <p className="card-subject">{l.subject}</p>
        <h2>{l.title}</h2>
        <p className="card-goal">{l.goal}</p>
        <dl className="card-meta">
          <div>
            <dt>Level</dt>
            <dd>{l.difficulty}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{l.minutes}</dd>
          </div>
        </dl>
        {progress && <p className={`card-progress ${progress.finished ? "done" : ""}`}>{progress.label}</p>}
        <div className="card-actions">
          {progress && !progress.finished ? (
            <>
              <Link className="btn primary" href={l.href}>
                Continue learning
              </Link>
              <button className="btn quiet" onClick={onStartAgain}>
                Start again
              </button>
            </>
          ) : progress?.finished ? (
            <>
              <button className="btn primary" onClick={onStartAgain}>
                Start again
              </button>
              <Link className="btn quiet" href={l.href}>
                Review
              </Link>
            </>
          ) : (
            <Link className="btn primary" href={l.href} aria-label={`Start lesson: ${l.title}`}>
              Start lesson
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}
