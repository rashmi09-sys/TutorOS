"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { VoiceSnapshot } from "@/lib/voice/controller";
import type { HelpOption } from "@/lib/helpOptions";

export type Presence =
  | "waiting"
  | "requesting"
  | "listening"
  | "finishing"
  | "interrupted"
  | "voice-error"
  | "processing"
  | "speaking"
  | "error"
  | "recovering";

const PRESENCE_TEXT: Record<Presence, string> = {
  waiting: "Your turn — write the next line, or tap the mic and say it",
  requesting: "Starting the microphone…",
  listening: "Listening — tap ✓ Done when you've finished, Edit to fix the words first, or ✕ to cancel",
  finishing: "Finishing what you said…",
  interrupted: "Listening stopped.",
  "voice-error": "Voice isn't available — typing works",
  processing: "Checking your line…",
  speaking: "The tutor is speaking. Stop it any time, or tap the mic to answer.",
  error: "Something went wrong — try again",
  recovering: "Connection hiccup — retrying once…",
};

/**
 * The next ruled line of the working. One row carries the whole turn-taking state, with a text
 * label for each: waiting · requesting · listening · finishing · interrupted · processing · speaking.
 *
 * While listening the row shows ✕ (cancel — always discards, never submits) on the left, what has
 * been heard in the middle (finalized words in ink, the phrase in progress lighter), and ✓ Done on
 * the right. Each control is its own element with its own key, so a re-render can never turn one
 * into another under the pointer (the cause of an earlier Cancel→Send bug).
 */
export function NextLine({
  presence,
  value,
  onChange,
  onSubmit,
  onMic,
  onCancel,
  voice,
  micSupported,
  onVoiceCancel,
  onVoiceDone,
  onVoiceResume,
  onVoiceEdit,
  inputRef,
  message,
  busy,
  help,
  onHelp,
}: {
  presence: Presence;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onMic: () => void;
  onCancel: () => void;
  voice: VoiceSnapshot;
  micSupported: boolean;
  onVoiceCancel: () => void;
  onVoiceDone: () => void;
  onVoiceResume: () => void;
  /** Move what was heard into the text box, unsent, so the student can fix it. */
  onVoiceEdit: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  message?: string | null;
  busy: boolean;
  help: HelpOption[];
  onHelp: (text: string) => void;
}) {
  const capturing = presence === "requesting" || presence === "listening" || presence === "finishing";
  const heard = [voice.finalText, voice.interim].filter(Boolean).join(" ").trim();
  const reviewing = presence === "interrupted" && !!voice.finalText;
  const doneRef = useRef<HTMLButtonElement>(null);

  // Keyboard: as soon as there is something to send, Done has focus (Enter finishes); Escape always cancels.
  const canFinish = presence === "listening" && !!heard;
  useEffect(() => {
    if (canFinish) doneRef.current?.focus({ preventScroll: true });
  }, [canFinish]);
  useEffect(() => {
    if (!capturing && !reviewing) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onVoiceCancel();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [capturing, reviewing, onVoiceCancel]);

  return (
    <div className={`nextline p-${presence}`}>
      <form
        className="nl-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!capturing && !reviewing) onSubmit();
        }}
      >
        {capturing || reviewing ? (
          <button key="voice-cancel" type="button" className="vbtn vcancel" onClick={onVoiceCancel} aria-label="Cancel — discard what I said" title="Cancel (Esc) — nothing is sent">
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        ) : (
          <button
            key="mic"
            type="button"
            className="presence"
            onClick={onMic}
            disabled={!micSupported || presence === "processing"}
            aria-label="Speak your line"
            title={!micSupported ? "Voice input needs Chrome or Edge — typing works everywhere" : presence === "speaking" ? "Stops the tutor, then listens" : "Speak instead of typing"}
          >
            <MicGlyph />
          </button>
        )}

        {capturing || reviewing ? (
          <div className="nl-live" aria-label="What I heard so far" aria-live="off">
            {heard ? (
              <>
                <span className="final">{voice.finalText}</span> {voice.interim && <span className="interim">{voice.interim}</span>}
              </>
            ) : (
              <span className="nl-live-empty">{presence === "requesting" ? "…" : "Listening…"}</span>
            )}
          </div>
        ) : (
          <input
            ref={inputRef}
            className="nl-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Your next line…"
            aria-label="Your answer or message"
            autoComplete="off"
            spellCheck={false}
            disabled={presence === "processing"}
          />
        )}

        {(reviewing || canFinish) && (
          <button key="voice-edit" type="button" className="vbtn vedit" onClick={onVoiceEdit} aria-label="Edit — put what I said in the text box without sending" title="Edit before sending — nothing is sent">
            Edit
          </button>
        )}
        {reviewing ? (
          <>
            <button key="voice-resume" type="button" className="vbtn" onClick={onVoiceResume} aria-label="Keep talking" title="Keep talking — adds to what I heard">
              <MicGlyph />
            </button>
            <button key="voice-send" type="button" className="nl-send" onClick={onVoiceDone}>
              ✓ Send
            </button>
          </>
        ) : capturing ? (
          <button key="voice-done" ref={doneRef} type="button" className="nl-send vdone" onClick={onVoiceDone} disabled={presence !== "listening" || !heard} aria-label="Done — send what I said">
            ✓ Done
          </button>
        ) : presence === "processing" ? (
          <button
            key="cancel"
            type="button"
            className="nl-send ghost"
            onClick={(e) => {
              e.preventDefault();
              onCancel();
            }}
          >
            Cancel
          </button>
        ) : (
          <button key="send" className="nl-send" type="submit" disabled={busy || !value.trim()}>
            Send
          </button>
        )}
      </form>
      <div className="nl-foot">
        <p className="nl-status" role="status">
          <span className="dot" aria-hidden />
          <span className="nl-status-text">{message ?? PRESENCE_TEXT[presence]}</span>
        </p>
        {help.length > 0 && !capturing && !reviewing && (
          <div className="help-options" role="group" aria-label="Ask for help">
            {help.map((h) => (
              <button key={h.label} type="button" className="quick-btn" onClick={() => onHelp(h.text)} disabled={busy}>
                {h.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MicGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}
