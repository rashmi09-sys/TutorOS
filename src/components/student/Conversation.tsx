"use client";

import { Fragment, useEffect, useLayoutEffect, useRef } from "react";
import type { Message } from "@/engine/types";
import type { SpeechProgress } from "./Notebook";

/**
 * The conversation with the tutor: every message in full, in order, for the whole lesson.
 * Only the latest tutor message carries a small label (what kind of help it is); earlier ones are
 * plain text. Student messages sit on the right in ink blue. The thread keeps the newest message in
 * view unless the student has scrolled up to reread something.
 */
export function Conversation({
  messages,
  dividers,
  speech,
  onHoverTurn,
  banner,
  audio,
}: {
  messages: Message[];
  /** A divider shown after the tutor turn with this number (e.g. "Check 1 · 13 + 7x = 41"). */
  dividers?: Map<number, string>;
  speech: SpeechProgress | null;
  onHoverTurn: (turn: number | null) => void;
  banner?: React.ReactNode;
  /** Stop / Replay for the latest tutor message (absent when the browser can't speak). */
  audio?: AudioControls;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastTutor = [...messages].reverse().find((m) => m.role === "tutor");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Keep the newest message in view (unless the student scrolled up to reread).
  useLayoutEffect(() => {
    const el = ref.current;
    const last = messages[messages.length - 1];
    if (el && (stick.current || last?.role === "student")) el.scrollTop = el.scrollHeight;
  }, [messages.length, messages]);

  return (
    <div className="thread" ref={ref} role="log" aria-label="Conversation with your tutor" aria-live="polite" aria-relevant="additions">
      {banner}
      {messages.map((m, i) => (
        <Fragment key={`${m.turn}-${m.role}-${i}`}>
          {m.role === "tutor" ? (
            <TutorMessage message={m} active={m === lastTutor} spokenChars={speech && speech.turn === m.turn && m === lastTutor ? speech.chars : null} onHover={onHoverTurn} audio={m === lastTutor ? audio : undefined} />
          ) : (
            <p className="msg student" aria-label={`You said: ${m.text}`}>
              {m.via === "voice" && (
                <svg className="via" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                </svg>
              )}
              {m.text}
            </p>
          )}
          {m.role === "tutor" && dividers?.has(m.turn) && (
            <p className="thread-divider" role="separator">
              <span>{dividers.get(m.turn)}</span>
            </p>
          )}
        </Fragment>
      ))}
    </div>
  );
}

export interface AudioControls {
  speaking: boolean;
  disabled: boolean;
  onStop: () => void;
  onReplay: () => void;
}

function TutorMessage({ message, active, spokenChars, onHover, audio }: { message: Message; active: boolean; spokenChars: number | null; onHover: (turn: number | null) => void; audio?: AudioControls }) {
  const text = message.text;
  const spoken = spokenChars != null ? Math.min(text.length, spokenChars) : null;
  return (
    <article
      className={`msg tutor note ${active ? "active" : "earlier"}`}
      onMouseEnter={() => onHover(message.turn)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(message.turn)}
      onBlur={() => onHover(null)}
      tabIndex={active ? -1 : 0}
      aria-label={active ? undefined : `Tutor: ${text}`}
    >
      {active && (
        <div className="note-top">
          <p className="note-kind">{actionLabel(message)}</p>
          {audio && (
            <div className="audio-ctl">
              {audio.speaking ? (
                <button key="stop" type="button" className="audio-btn" onClick={audio.onStop} aria-label="Stop speaking">
                  <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden>
                    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                  </svg>
                  Stop
                </button>
              ) : (
                <button key="replay" type="button" className="audio-btn" onClick={audio.onReplay} disabled={audio.disabled} aria-label="Replay this message">
                  <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 5 6 9H3v6h3l5 4z" />
                    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                  </svg>
                  Replay
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <p className="note-text">
        {spoken != null ? (
          <>
            <span className="spoken">{keepMathTogether(text.slice(0, spoken))}</span>
            <span className="unspoken">{keepMathTogether(text.slice(spoken))}</span>
          </>
        ) : (
          keepMathTogether(text)
        )}
      </p>
    </article>
  );
}

const MATH_RUN = /(?:[−-]?\d*\.?\d*x\b|[−-]?\d+(?:\.\d+)?)(?:\s*[+−\-×÷=≠<>]\s*(?:[−-]?\d*\.?\d*x\b|[−-]?\d+(?:\.\d+)?))+/g;

/** Equations and calculations in a message never break across lines ("3x = 15" stays on one line). */
export function keepMathTogether(text: string): React.ReactNode {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MATH_RUN)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    out.push(
      <span key={i} className="nowrap">
        {m[0]}
      </span>,
    );
    last = i + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length === 1 ? out[0] : out;
}

/** A short, plain-language label for what kind of help a tutor turn is. */
export function actionLabel(m: Message) {
  if (m.stage === "NOTICE") return "Notice";
  if (m.stage === "THINK") return m.rule === "R25_SMALL_EXAMPLE" ? "Small example" : "Think";
  if (m.stage === "TRY") return m.rule?.startsWith("R23") || m.rule?.startsWith("R27") ? "Your move" : `Try · hint ${Math.min(3, Math.max(1, m.hintLevel ?? 2))} of 3`;
  switch (m.action) {
    case "ASK":
      return "Question";
    case "HINT":
      return `Hint ${Math.min(3, Math.max(1, m.hintLevel ?? 1))} of 3`;
    case "EXPLAIN":
      return m.rule?.startsWith("R18") ? "The idea" : m.rule === "R9_REVEAL_AFTER_EFFORT" ? "Worked solution" : "Worked step";
    case "VERIFY":
      return m.rule?.startsWith("R1_") || m.rule?.startsWith("R16") ? "Checked" : "Let’s check";
    case "WAIT":
      return "Take your time";
    case "RECAP":
      return "Recap";
    default:
      return "Tutor";
  }
}
