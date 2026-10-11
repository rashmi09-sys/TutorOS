"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTutorSession, type TeacherInfo } from "@/lib/useTutorSession";
import { useSpeaker, useVoiceInput } from "@/lib/voice/useVoice";
import type { VoiceMeta } from "@/lib/voice/controller";
import type { HelpOption } from "@/lib/helpOptions";
import type { LessonInfo } from "@/lib/lessons";
import type { Message } from "@/engine/types";
import type { SpeechProgress } from "../student/Notebook";
import { Conversation, actionLabel } from "../student/Conversation";
import { NextLine, type Presence } from "../student/NextLine";
import { ScratchCanvas } from "../ScratchCanvas";

/** After the tutor stops talking, wait this long before opening the mic, so the last syllable isn't recorded. */
const ECHO_TAIL_MS = 250;
/** The student's sound choice for this browser tab ("on" | "off"), and the tutor turns already handled. */
const VOICE_PREF_KEY = "tutoros.voice";
const SPOKEN_KEY = "tutoros.spoken";

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeSession(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* private mode: the choice simply isn't remembered */
  }
}

/** What every lesson state has, whatever the subject. */
export interface LessonStateBase {
  sessionId: string;
  turn: number;
  phase: "GUIDED" | "TRANSFER" | "COMPLETE";
  transcript: Message[];
  pace?: "normal" | "slow";
}

export interface Stop {
  label: string;
  sub: string;
  done: boolean;
  now: boolean;
  /** Evidence marker on a finished check: solved without help (yes) or with help (no). */
  pip?: "yes" | "no";
}

/**
 * What a lesson supplies to the shared shell. The shell owns the conversation, voice, sound, menu,
 * drawers, progress rail and error recovery; the lesson owns the working panel and its own rules.
 */
export interface LessonAdapter<S extends LessonStateBase> {
  info: LessonInfo;
  welcomePreview: ReactNode;
  workTitle: string;
  /** Offer the freehand scratch pad over the working panel. */
  scratch?: boolean;
  stops: (s: S) => Stop[];
  /** `onSay` sends words from the whiteboard (a tapped arrow, a chosen move) exactly as if the student typed them. */
  WorkPanel: (p: { state: S; hoverTurn: number | null; onRestart: () => void; onSay: (text: string) => void; busy: boolean }) => ReactNode;
  helpOptions: (s: S) => HelpOption[];
  dividers?: (s: S) => Map<number, string>;
  Profile: (p: { state: S }) => ReactNode;
}

/**
 * Student experience shared by every lesson: the working on the left, the conversation on the right.
 *
 * Audio rules (the student decides when anything makes a sound):
 *  - Nothing speaks on page load, reload, or navigation. The tutor speaks only a turn the student just
 *    caused on this page (Start, a line, a help option), once, and only if sound is on.
 *  - The microphone opens only when the student taps it. Opening it stops tutor speech first.
 *  - No automatic follow-ups: no idle "silence" turns, no automatic listening after a reply.
 *  - Stop and Replay are always one tap away on the latest tutor message.
 */
export function LessonShell<S extends LessonStateBase>({ adapter }: { adapter: LessonAdapter<S> }) {
  const lesson = adapter.info.id;
  const { state, busy, error, needsReset, teacher, resumed, recovering, lastUtterance, pendingStudent, send, restart, cancel } = useTutorSession<S>(lesson);
  const [input, setInput] = useState("");
  const [speech, setSpeech] = useState<SpeechProgress | null>(null);
  const [ttsOn, setTtsOn] = useState(true);
  const [drawer, setDrawer] = useState<null | "transcript" | "profile">(null);
  const [scratch, setScratch] = useState(false);
  const [scratchClear, setScratchClear] = useState(0);
  const [hoverTurn, setHoverTurn] = useState<number | null>(null);
  const interrupted = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const ttsOnRef = useRef(true);
  const paceRef = useRef<"normal" | "slow">("normal");
  const { ref: speakerRef, supported: ttsSupported, state: speechState } = useSpeaker();
  const speaking = speechState.status === "speaking" || speechState.status === "preparing";
  const submitRef = useRef<(text: string, via: "keyboard" | "voice", extra?: { voice?: VoiceMeta; source?: "typed" | "help-option" | "board" }) => void>(() => {});

  const voice = useVoiceInput({
    onComplete: (text, meta) => submitRef.current(text, "voice", { voice: meta }),
    // Never record the tutor: stop its speech and let the echo die away before the mic opens.
    beforeStart: async () => {
      const sp = speakerRef.current;
      if (sp?.active) {
        sp.stop();
        interrupted.current = true;
        await new Promise((r) => setTimeout(r, ECHO_TAIL_MS));
      }
    },
  });
  const voiceStatus = voice.snap.status;
  const voiceActive = voiceStatus === "requesting" || voiceStatus === "listening" || voiceStatus === "finishing";
  const voiceActiveRef = useRef(false);

  useEffect(() => {
    busyRef.current = busy;
    voiceActiveRef.current = voiceActive;
    ttsOnRef.current = ttsOn;
    paceRef.current = state?.pace ?? "normal";
  });
  // The sound choice made on the start screen (or in the menu) holds for this tab, across reloads.
  useEffect(() => {
    const pref = readSession(VOICE_PREF_KEY);
    if (pref === "off") setTtsOn(false);
  }, []);
  useEffect(() => {
    if (ttsSupported === false) setTtsOn(false);
  }, [ttsSupported]);

  const setSound = (on: boolean) => {
    setTtsOn(on);
    writeSession(VOICE_PREF_KEY, on ? "on" : "off");
    if (!on) speakerRef.current?.stop();
  };

  /** Speak one tutor turn through the page's single speech controller. */
  const play = useCallback(
    (id: string, text: string, turn: number, force = false) => {
      const sp = speakerRef.current;
      if (!sp?.supported || voiceActiveRef.current) return; // never speak while the mic is open
      sp.speak(
        id,
        text,
        {
          rate: paceRef.current === "slow" ? 0.8 : 0.92,
          onStart: () => setSpeech({ turn, chars: 0 }),
          onProgress: (chars) => setSpeech((s) => (s && s.turn === turn && s.chars === chars ? s : { turn, chars })),
          onDone: () => setSpeech(null),
        },
        { force },
      );
    },
    [speakerRef],
  );

  // A new tutor turn (only ever produced by the student's own action on this page) is spoken once —
  // and only if sound is on. Its id is recorded either way, so turning sound on later, re-rendering,
  // remounting (React Strict Mode) or reloading never plays an old turn.
  useEffect(() => {
    if (!lastUtterance) return;
    const handled = new Set((readSession(SPOKEN_KEY) ?? "").split("|").filter(Boolean));
    if (handled.has(lastUtterance.id)) return;
    handled.add(lastUtterance.id);
    writeSession(SPOKEN_KEY, Array.from(handled).slice(-200).join("|"));
    if (ttsOnRef.current) play(lastUtterance.id, lastUtterance.text, Number(lastUtterance.id.split("-t").pop()));
  }, [lastUtterance, play]);

  // After each tutor turn, put the cursor back on the next line so the next action is always one keystroke away.
  useEffect(() => {
    if (!busy && !drawer && !voiceActive && lastUtterance) inputRef.current?.focus({ preventScroll: true });
  }, [lastUtterance, busy, drawer, voiceActive]);

  const stopVoice = () => {
    speakerRef.current?.stop();
    setSpeech(null);
  };

  const lastTutor = state ? [...state.transcript].reverse().find((m) => m.role === "tutor") : undefined;
  const replay = () => {
    if (!state || !lastTutor) return;
    play(`${state.sessionId}-t${lastTutor.turn}`, lastTutor.text, lastTutor.turn, true);
  };

  const submit = async (text: string, via: "keyboard" | "voice", extra: { voice?: VoiceMeta; source?: "typed" | "help-option" | "board" } = {}) => {
    const t = text.trim();
    if (!t || busyRef.current) return;
    busyRef.current = true; // no duplicate submission before React re-renders
    stopVoice();
    const draft = input;
    setInput(t); // stays pencilled-in (input disabled) while the line is checked
    const ok = await send({ type: "text", text: t, via, interruptedTutor: interrupted.current || undefined, ...(extra.voice ? { voice: extra.voice } : {}), ...(extra.source ? { source: extra.source } : {}) });
    interrupted.current = false;
    if (ok) setInput(extra.source === "help-option" || extra.source === "board" ? draft : "");
    else if (via === "voice") setInput(t); // a failed or cancelled spoken line stays visible to edit or resend
  };
  useEffect(() => {
    submitRef.current = (text, via, extra) => void submit(text, via, extra);
  });

  /** The mic only ever opens from a tap. Tutor speech is stopped (in beforeStart) before it opens. */
  const listen = (o?: { resume?: boolean }) => {
    if (voiceActive) return;
    void voice.start({ resume: o?.resume, pauseMs: null });
  };

  const [attention, setAttention] = useState(false);
  /** Start Lesson: the first (and only) click that may produce sound. Sound follows the student's choice. */
  const startLesson = (withSound: boolean) => {
    setSound(withSound && ttsSupported !== false);
    void send({ type: "start" }).then((ok) => {
      if (!ok) return;
      // Draw the eye to the whiteboard for a moment: that's where the problem is.
      setAttention(true);
      setTimeout(() => setAttention(false), 2400);
      requestAnimationFrame(() => document.querySelector(".work-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    });
  };

  const presence: Presence =
    recovering
      ? "recovering"
      : busy
        ? "processing"
        : voiceStatus === "requesting"
          ? "requesting"
          : voiceStatus === "listening"
            ? "listening"
            : voiceStatus === "finishing"
              ? "finishing"
              : voiceStatus === "interrupted"
                ? "interrupted"
                : ["denied", "unavailable", "error"].includes(voiceStatus)
                  ? "voice-error"
                  : speaking
                    ? "speaking"
                    : "waiting";
  const statusMessage =
    presence === "processing" && pendingStudent
      ? `Checking “${pendingStudent}”…`
      : presence === "speaking" && speechState.status === "preparing"
        ? "Getting the tutor's voice ready… You can start typing — sending stops it."
      : presence === "interrupted" || presence === "voice-error" || presence === "finishing"
        ? (voice.snap.message ?? null)
        : presence === "waiting" && (voiceStatus === "cancelled" || voiceStatus === "idle") && voice.snap.message
          ? voice.snap.message
          : null;

  if (!state) {
    return (
      <div className="app">
        <TopBar info={adapter.info} stops={null} teacher={teacher} />
        <main className="welcome">
          <p className="welcome-kicker">{adapter.info.subject} · {adapter.info.title}</p>
          <h1>Ready to figure this out?</h1>
          <p className="welcome-lead">We&apos;ll work through one problem together. Then you&apos;ll get a chance to try it yourself.</p>
          <div className="welcome-preview" aria-hidden>
            {adapter.welcomePreview}
          </div>
          <div className="welcome-actions">
            <button className="btn primary big" onClick={() => startLesson(ttsOn)} disabled={busy}>
              {busy ? "Opening the lesson…" : "Start Lesson"}
            </button>
            <button
              className={`btn big quiet sound-toggle ${ttsOn && ttsSupported !== false ? "on" : "off"}`}
              aria-pressed={ttsOn && ttsSupported !== false}
              onClick={() => setSound(!ttsOn)}
              disabled={busy || ttsSupported === false}
            >
              <SoundIcon on={ttsOn && ttsSupported !== false} />
              {ttsSupported === false ? "Sound unavailable" : ttsOn ? "Sound on" : "Sound off"}
            </button>
          </div>
          <p className="welcome-fine">
            {ttsSupported === false ? "This browser can't read aloud, so the lesson is text only. " : "Nothing plays until you press Start. "}The microphone stays off until you tap it. No sign-up — your work stays in this browser. <Link href="/">All lessons</Link>
          </p>
          {error && <p className="error">{error}</p>}
        </main>
      </div>
    );
  }

  const composer = (
    <NextLine
      presence={presence}
      value={input}
      onChange={(v) => {
        setInput(v); // typing doesn't cut the tutor off; Stop, the mic or sending a line does
        if (!voiceActive) voice.reset();
      }}
      onSubmit={() => submit(input, "keyboard", { source: "typed" })}
      onMic={() => listen()}
      onCancel={cancel}
      voice={voice.snap}
      micSupported={voice.supported}
      onVoiceCancel={voice.cancel}
      onVoiceDone={voice.done}
      onVoiceResume={() => listen({ resume: true })}
      onVoiceEdit={() => {
        // What was heard goes into the text box, unsent; the student fixes it and presses Send.
        const heard = [voice.snap.finalText, voice.snap.interim].filter(Boolean).join(" ").trim();
        voice.cancelWith("Moved to the text box — fix anything, then press Send.");
        setInput(heard);
        requestAnimationFrame(() => inputRef.current?.focus());
      }}
      inputRef={inputRef}
      busy={busy}
      message={statusMessage}
      help={busy ? [] : adapter.helpOptions(state)}
      onHelp={(text) => submit(text, "keyboard", { source: "help-option" })}
    />
  );

  const { WorkPanel, Profile } = adapter;
  return (
    <div className="app">
      <TopBar
        info={adapter.info}
        stops={adapter.stops(state)}
        teacher={teacher}
        menu={{
          onRestart: restart,
          onDrawer: setDrawer,
          readAloud: { on: ttsOn, supported: ttsSupported !== false, set: setSound },
        }}
      />
      <main className="workspace">
        <section className={`work-panel ${scratch ? "scratching" : ""} ${attention ? "attention" : ""}`} aria-label="Your working">
          <header className="panel-head">
            <h2>{adapter.workTitle}</h2>
            {adapter.scratch && (
              <div className="panel-tools">
                {scratch && <button className="tool" onClick={() => setScratchClear((n) => n + 1)}>Clear scratch</button>}
                <button className={`tool ${scratch ? "on" : ""}`} aria-pressed={scratch} onClick={() => setScratch((s) => !s)}>✎ Scratch pad</button>
              </div>
            )}
          </header>
          {adapter.scratch && <ScratchCanvas active={scratch} tool="pen" clearSignal={scratchClear} />}
          <WorkPanel state={state} hoverTurn={hoverTurn} onRestart={restart} busy={busy} onSay={(text) => submit(text, "keyboard", { source: "board" })} />
        </section>
        <section className="tutor-panel" aria-label="Your tutor">
          <header className="panel-head tutor-head">
            <h2>Your tutor</h2>
          </header>
          <Conversation
            messages={state.transcript}
            dividers={adapter.dividers?.(state)}
            speech={speech}
            onHoverTurn={setHoverTurn}
            audio={
              ttsSupported
                ? {
                    speaking,
                    disabled: voiceActive || busy,
                    onStop: () => {
                      stopVoice();
                      interrupted.current = true;
                    },
                    onReplay: replay,
                  }
                : undefined
            }
            banner={resumed && !error ? <p className="note-banner" role="status">Welcome back — you&apos;re where you left off.</p> : null}
          />
          {(error || needsReset) && (
            <div className="error" role="alert">
              <span>{error}</span>
              {needsReset && <button className="btn" onClick={restart}>Start a new lesson</button>}
            </div>
          )}
          {state.phase !== "COMPLETE" && composer}
        </section>
      </main>
      {drawer === "transcript" && <TranscriptDrawer messages={state.transcript} onClose={() => setDrawer(null)} />}
      {drawer === "profile" && (
        <Drawer title="Your learning profile" onClose={() => setDrawer(null)}>
          <Profile state={state} />
          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            <button className="btn" onClick={() => setDrawer(null)}>Close</button>
            <button
              className="btn danger"
              onClick={async () => {
                setDrawer(null);
                await restart();
              }}
            >
              Delete my data
            </button>
          </div>
        </Drawer>
      )}
    </div>
  );
}

/** Honest statement of what the tutor can understand right now. */
export function Capability({ teacher }: { teacher: TeacherInfo | null }) {
  if (!teacher) return null;
  return (
    <p className="welcome-capability">
      {teacher.mode === "llm"
        ? "I can follow everyday wording, and every answer you give is checked exactly."
        : "I'm in basic mode right now: I understand numbers, maths and common phrases like “I'm stuck” or “why?”. If I don't follow you, I'll say so and tell you what I can check."}
    </p>
  );
}

/* ---------------- Top bar: brand, where am I, and one menu ---------------- */

interface MenuProps {
  onRestart: () => void;
  onDrawer: (d: "transcript" | "profile") => void;
  readAloud: { on: boolean; supported: boolean; set: (on: boolean) => void };
}

function TopBar({ info, stops, teacher, menu }: { info: LessonInfo; stops: Stop[] | null; teacher: TeacherInfo | null; menu?: MenuProps }) {
  return (
    <header className="rail">
      <nav className="rail-left" aria-label="Lessons">
        {/* Plain App Router links: client-side navigation, so browser back/forward work as usual. Progress is
            saved per lesson in this browser after every turn, so leaving never loses work. */}
        <Link href="/" className="rail-home" aria-label="All lessons">
          <span aria-hidden>←</span> All lessons
        </Link>
        <Link href="/" className="rail-brand" aria-label="TutorOS home">
          <b>TutorOS</b>
          <span>{info.title}</span>
        </Link>
      </nav>
      {stops && (
        <ol className="rail-stops" aria-label="Lesson progress">
          {stops.map((s, i) => (
            <li key={s.label} className={`stop ${s.done ? "done" : ""} ${s.now ? "now" : ""}`} aria-current={s.now ? "step" : undefined}>
              <span className={`stop-dot ${s.pip ? `pip ${s.pip}` : ""}`} aria-hidden>
                {s.done ? "✓" : s.label.startsWith("Extra") ? "+" : i + 1}
              </span>
              <span className="stop-text">
                {s.label}
                <small>{s.sub}</small>
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="rail-actions">
        {stops && menu && <Menu teacher={teacher} {...menu} />}
      </div>
    </header>
  );
}

function Menu({ teacher, onRestart, onDrawer, readAloud }: MenuProps & { teacher: TeacherInfo | null }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    const click = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", key);
    window.addEventListener("mousedown", click);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("mousedown", click);
    };
  }, [open]);
  const act = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="menu" ref={box}>
      <button ref={btn} className="rail-btn menu-btn" aria-expanded={open} aria-controls="lesson-menu" onClick={() => setOpen((o) => !o)}>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
        Menu
      </button>
      {open && (
        <div className="menu-panel" id="lesson-menu" role="group" aria-label="Lesson menu">
          <button className="menu-item" onClick={act(() => onDrawer("transcript"))}>Transcript</button>
          <button className="menu-item" onClick={act(() => onDrawer("profile"))}>My progress</button>
          <button className="menu-item" onClick={act(onRestart)}>Restart</button>
          <Link className="menu-item" href="/">All lessons</Link>
          <div className="menu-sep" role="presentation" />
          <p className="menu-label">Sound</p>
          <label className="menu-toggle">
            <input type="checkbox" checked={readAloud.on} onChange={(e) => readAloud.set(e.target.checked)} disabled={!readAloud.supported} />
            Read aloud
          </label>
          {teacher && (
            <>
              <p className="menu-fine">{teacher.mode === "deterministic" ? "Running without a language model: I understand maths, numbers and a set list of phrases. Every answer is checked exactly." : `Language model: ${teacher.name}. It helps read your words; every answer is still checked exactly.`}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- Drawers ---------------- */

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head">
          <h2>{title}</h2>
          <button className="rail-btn" onClick={onClose}>Close</button>
        </div>
        {children}
      </aside>
    </>
  );
}

function TranscriptDrawer({ messages, onClose }: { messages: Message[]; onClose: () => void }) {
  return (
    <Drawer title="Everything we said" onClose={onClose}>
      <ol className="transcript">
        {messages.map((m, i) => (
          <li key={i} className={m.role}>
            <span className="who">{m.role === "tutor" ? actionLabel(m) : m.via === "voice" ? "You (spoken)" : "You"}</span>
            <span>{m.text}</span>
          </li>
        ))}
      </ol>
    </Drawer>
  );
}

function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H3v6h3l5 4z" />
      {on ? <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /> : <path d="m16 9 5 6m0-6-5 6" />}
    </svg>
  );
}
