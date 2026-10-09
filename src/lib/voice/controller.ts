/* eslint-disable @typescript-eslint/no-explicit-any -- the Web Speech API has no TypeScript DOM typings for SpeechRecognition */

/**
 * Voice input as an explicit state machine. Framework-free and unit-tested with a fake recognizer.
 *
 *   idle → requesting → listening → finishing → completed
 *                 ↘ denied | unavailable        ↘ cancelled (discarded, never submitted)
 *   listening → interrupted (browser ended the session; transcript kept; one-tap resume)
 *   any → error | unsupported
 *
 * Guarantees (each covered by tests/voice.test.ts):
 *  - One recognition session at a time. A new session detaches the old recognizer's handlers,
 *    so late events from it can never change the current state.
 *  - Final results are stored by (segment, result index): duplicate events are applied once.
 *    Interim text is kept separately and never stored as final.
 *  - Nothing is submitted until Done (or, in hands-free mode only, a pause after final speech).
 *    Cancel discards. onComplete fires at most once per session.
 *  - A browser that ends a session on its own (Chrome does this after pauses) is resumed silently
 *    at most `maxAutoResumes` times per session, never after an error, then shown honestly.
 *  - dispose() aborts the recognizer and clears every timer (unmount, React Strict Mode).
 */

export type VoiceStatus =
  | "idle"
  | "requesting"
  | "listening"
  | "finishing"
  | "completed"
  | "cancelled"
  | "interrupted"
  | "denied"
  | "unavailable"
  | "error"
  | "unsupported";

export interface VoiceSnapshot {
  status: VoiceStatus;
  /** Finalized speech, in order. Stable while the student keeps talking. */
  finalText: string;
  /** The phrase still being recognised. Replaced on every update; never submitted on its own unless Done is pressed. */
  interim: string;
  /** Human-readable status for the UI, when there's something to say. */
  message?: string;
  /** Raw browser error code, for the console. */
  errorCode?: string;
  session: number;
}

export interface VoiceMeta {
  segments: number;
  interimUpdates: number;
  duplicateEventsIgnored: number;
  autoResumes: number;
  durationMs: number;
  endedBy: "done" | "pause" | "after-interruption";
}

export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((e?: any) => void) | null;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: ((e?: any) => void) | null;
}

export interface VoiceEnv {
  /** SpeechRecognition constructor, or null when the browser has none. */
  Recognition: (new () => RecognitionLike) | null;
  /** Ask for the microphone (getUserMedia); resolves when granted. Optional: without it, the recognizer prompts itself. */
  requestMic?: () => Promise<void>;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
}

export interface VoiceOptions {
  lang?: string;
  onChange: (s: VoiceSnapshot) => void;
  onComplete: (text: string, meta: VoiceMeta) => void;
  /** Called before the mic opens — used to stop tutor speech so it isn't recorded. */
  beforeStart?: () => Promise<void> | void;
  maxAutoResumes?: number;
  /** After Done, how long to wait for the browser's last final result. */
  finishTimeoutMs?: number;
  /** If the browser never reports that it started, give up after this long. */
  startTimeoutMs?: number;
}

const TERMINAL_ERRORS: Record<string, { status: VoiceStatus; message: string }> = {
  "not-allowed": { status: "denied", message: "Microphone permission is blocked. Allow it in the browser's address bar, or just type." },
  "service-not-allowed": { status: "denied", message: "This browser isn't allowing speech recognition here. Typing works just as well." },
  "audio-capture": { status: "unavailable", message: "No microphone was found. Typing works just as well." },
  network: { status: "error", message: "Voice needs an internet connection in this browser. Typing works offline." },
  "language-not-supported": { status: "error", message: "This browser can't recognise this language. Typing works just as well." },
  "bad-grammar": { status: "error", message: "Voice stopped unexpectedly. Tap the mic to try again, or type." },
};

const ACTIVE: VoiceStatus[] = ["requesting", "listening", "finishing"];

export class VoiceController {
  private env: VoiceEnv;
  private opts: Required<Pick<VoiceOptions, "maxAutoResumes" | "finishTimeoutMs" | "startTimeoutMs" | "lang">> & VoiceOptions;
  private snap: VoiceSnapshot = { status: "idle", finalText: "", interim: "", session: 0 };
  private rec: RecognitionLike | null = null;
  private finals = new Map<string, string>();
  private segment = 0;
  private autoResumes = 0;
  private interimUpdates = 0;
  private duplicates = 0;
  private startedAt = 0;
  private segmentStartedAt = 0;
  private lastError: string | null = null;
  private completedSession = -1;
  private pauseMs: number | null = null;
  private endedBy: VoiceMeta["endedBy"] = "done";
  private timers = new Set<unknown>();
  private pauseTimer: unknown = null;
  private disposed = false;

  constructor(env: VoiceEnv, opts: VoiceOptions) {
    this.env = env;
    this.opts = { maxAutoResumes: 2, finishTimeoutMs: 1500, startTimeoutMs: 4000, lang: "en-IN", ...opts };
    if (!env.Recognition) this.snap = { ...this.snap, status: "unsupported", message: "Voice input needs Chrome or Edge. Typing works everywhere." };
  }

  get snapshot(): VoiceSnapshot {
    return this.snap;
  }

  get supported() {
    return !!this.env.Recognition;
  }

  /** Text that Done would submit right now. */
  get text(): string {
    return joinText(this.finalText(), this.snap.interim);
  }

  /**
   * Open the microphone. Ignored while a session is already active (no duplicate sessions).
   * `resume` keeps the transcript from an interrupted session; `pauseMs` enables hands-free auto-finish.
   */
  async start(o: { resume?: boolean; pauseMs?: number | null } = {}): Promise<void> {
    if (this.disposed || !this.env.Recognition) return;
    if (ACTIVE.includes(this.snap.status)) return;
    const session = this.snap.session + 1;
    if (!(o.resume && this.snap.status === "interrupted")) {
      this.finals.clear();
      this.segment = 0;
      this.interimUpdates = 0;
      this.duplicates = 0;
      this.autoResumes = 0;
      this.startedAt = this.env.now();
    } else {
      this.segment += 1;
    }
    this.pauseMs = o.pauseMs ?? null;
    this.lastError = null;
    this.set({ status: "requesting", session, interim: "", finalText: this.finalText(), message: undefined, errorCode: undefined });

    try {
      await this.opts.beforeStart?.();
      if (this.env.requestMic) await this.env.requestMic();
    } catch (e: any) {
      if (!this.current(session)) return;
      const name = e?.name ?? "";
      if (name === "NotAllowedError" || name === "SecurityError") return this.fail(session, "not-allowed");
      if (name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError") return this.fail(session, "audio-capture");
      return this.fail(session, "bad-grammar");
    }
    if (!this.current(session) || this.snap.status !== "requesting") return; // cancelled while asking
    this.open(session);
  }

  /** Finish and submit what was heard. Never called by Cancel. */
  done(endedBy: VoiceMeta["endedBy"] = "done"): void {
    const s = this.snap.status;
    if (s === "interrupted") return this.complete(this.snap.session, "after-interruption");
    if (s === "requesting") return this.cancel();
    if (s !== "listening") return;
    const session = this.snap.session;
    this.clearPause();
    this.endedBy = endedBy;
    this.set({ status: "finishing", message: "Finishing…" });
    try {
      this.rec?.stop(); // the browser flushes the last phrase as a final result, then ends
    } catch {
      /* already stopped */
    }
    this.later(() => {
      if (this.current(session) && this.snap.status === "finishing") this.complete(session, endedBy);
    }, this.opts.finishTimeoutMs);
  }

  /** Discard everything heard in this session. Never submits. */
  cancel(message = "Cancelled — nothing was sent."): void {
    if (this.snap.status === "idle" || this.snap.status === "unsupported") return;
    this.teardown();
    this.finals.clear();
    this.set({ status: "cancelled", finalText: "", interim: "", message, session: this.snap.session + 1 });
  }

  /** Back to idle after a terminal state was shown (e.g. the student starts typing). */
  reset(): void {
    if (ACTIVE.includes(this.snap.status) || this.snap.status === "unsupported") return;
    this.finals.clear();
    this.set({ status: "idle", finalText: "", interim: "", message: undefined, errorCode: undefined });
  }

  dispose(): void {
    this.teardown();
    this.disposed = true;
  }

  /* ------------------------------------------------------------------ */

  private open(session: number) {
    const Rec = this.env.Recognition!;
    let rec: RecognitionLike;
    try {
      rec = new Rec();
    } catch {
      return this.fail(session, "bad-grammar");
    }
    rec.lang = this.opts.lang;
    rec.continuous = true; // keep listening through normal pauses
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    const seg = this.segment;
    const mine = () => this.rec === rec && this.current(session) && !this.disposed;

    rec.onstart = () => {
      if (!mine()) return;
      if (this.snap.status === "requesting") this.set({ status: "listening", message: undefined });
    };
    rec.onresult = (e: any) => {
      if (!mine()) return;
      if (this.snap.status !== "listening" && this.snap.status !== "finishing") return;
      let interim = "";
      let added = false;
      const results = e.results;
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const t = String(r[0]?.transcript ?? "");
        if (r.isFinal) {
          const key = `${seg}:${i}`;
          if (this.finals.has(key)) {
            if (i >= e.resultIndex) this.duplicates += 1;
            continue;
          }
          const clean = t.trim();
          const prev = Array.from(this.finals.values()).pop();
          if (clean && prev && clean.toLowerCase() === prev.toLowerCase() && i >= e.resultIndex) {
            // Some Android builds re-emit the previous final under a new index.
            this.duplicates += 1;
            this.finals.set(key, "");
            continue;
          }
          this.finals.set(key, clean);
          added = true;
        } else {
          interim += t;
        }
      }
      interim = interim.trim();
      if (interim !== this.snap.interim) this.interimUpdates += 1;
      if (this.snap.status === "listening" && this.snap.message) this.snap = { ...this.snap, message: undefined };
      this.set({ finalText: this.finalText(), interim });
      if (added || interim) this.armPause(session);
    };
    rec.onerror = (e: any) => {
      if (!mine()) return;
      const code = String(e?.error ?? "unknown");
      this.lastError = code;
      if (code === "aborted" || code === "no-speech") return; // benign; onend decides what happens
      if (TERMINAL_ERRORS[code] || code !== "") this.fail(session, code);
    };
    rec.onend = () => {
      if (!mine()) return;
      const s = this.snap.status;
      if (s === "finishing") return this.complete(session, this.endedBy);
      if (s === "requesting") {
        // Ended before it ever started: usually a permission prompt that was dismissed.
        return this.fail(session, this.lastError ?? "not-allowed");
      }
      if (s !== "listening") return;
      const benign = this.lastError === null || this.lastError === "no-speech";
      const ranFor = this.env.now() - this.segmentStartedAt;
      if (benign && this.autoResumes < this.opts.maxAutoResumes && ranFor > 300) {
        this.autoResumes += 1;
        this.segment += 1;
        this.lastError = null;
        this.detach();
        this.open(session); // same session, same transcript, no visible flicker
        return;
      }
      this.detach();
      const pending = this.snap.interim;
      if (pending) this.finals.set(`${this.segment}:interim`, pending); // keep the unfinished phrase; the student decides
      const has = !!this.finalText();
      this.set({
        status: "interrupted",
        interim: "",
        finalText: this.finalText(),
        message: has ? "Listening stopped. Tap ✓ to send what I heard, or the mic to keep talking." : "Listening stopped — I didn't hear anything. Tap the mic to try again.",
      });
    };

    this.rec = rec;
    this.segmentStartedAt = this.env.now();
    try {
      rec.start();
    } catch {
      return this.fail(session, "bad-grammar");
    }
    this.later(() => {
      if (this.current(session) && this.snap.status === "requesting") this.fail(session, "bad-grammar");
    }, this.opts.startTimeoutMs);
  }

  private armPause(session: number) {
    if (this.pauseMs == null) return;
    this.clearPause();
    this.pauseTimer = this.later(() => {
      this.pauseTimer = null;
      if (!this.current(session) || this.snap.status !== "listening") return;
      if (this.finalText() && !this.snap.interim) this.done("pause");
      else this.armPause(session);
    }, this.pauseMs);
  }

  private clearPause() {
    if (this.pauseTimer != null) {
      this.env.clearTimeout(this.pauseTimer);
      this.timers.delete(this.pauseTimer);
      this.pauseTimer = null;
    }
  }

  private complete(session: number, endedBy: VoiceMeta["endedBy"]) {
    if (this.completedSession === session) return; // once per session
    const text = this.text;
    this.teardown();
    if (!text) {
      this.set({ status: "idle", finalText: "", interim: "", message: "I didn't catch anything — try again, or type." });
      return;
    }
    this.completedSession = session;
    const meta: VoiceMeta = {
      segments: Array.from(this.finals.values()).filter(Boolean).length,
      interimUpdates: this.interimUpdates,
      duplicateEventsIgnored: this.duplicates,
      autoResumes: this.autoResumes,
      durationMs: Math.max(0, Math.round(this.env.now() - this.startedAt)),
      endedBy,
    };
    this.finals.clear();
    this.set({ status: "completed", finalText: text, interim: "", message: undefined });
    this.opts.onComplete(text, meta);
  }

  private fail(session: number, code: string) {
    if (!this.current(session)) return;
    this.teardown();
    const t = TERMINAL_ERRORS[code] ?? { status: "error" as VoiceStatus, message: `Voice stopped (${code}). Tap the mic to try again, or type.` };
    this.set({ status: t.status, message: t.message, errorCode: code, interim: "", finalText: this.finalText() });
  }

  private teardown() {
    this.detach();
    for (const t of this.timers) this.env.clearTimeout(t);
    this.timers.clear();
    this.pauseTimer = null;
  }

  private detach() {
    const rec = this.rec;
    this.rec = null;
    if (!rec) return;
    rec.onstart = rec.onresult = rec.onerror = rec.onend = null;
    try {
      rec.abort();
    } catch {
      /* not running */
    }
  }

  private later(fn: () => void, ms: number) {
    const h = this.env.setTimeout(() => {
      this.timers.delete(h);
      fn();
    }, ms);
    this.timers.add(h);
    return h;
  }

  private current(session: number) {
    return !this.disposed && this.snap.session === session;
  }

  private finalText() {
    return joinText(...Array.from(this.finals.values()));
  }

  private set(p: Partial<VoiceSnapshot>) {
    const next = { ...this.snap, ...p };
    const same = next.status === this.snap.status && next.finalText === this.snap.finalText && next.interim === this.snap.interim && next.message === this.snap.message && next.session === this.snap.session && next.errorCode === this.snap.errorCode;
    this.snap = next;
    if (!same && !this.disposed) this.opts.onChange(next);
  }
}

function joinText(...parts: string[]) {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Real browser environment. */
export function browserVoiceEnv(): VoiceEnv {
  const w = typeof window !== "undefined" ? (window as any) : null;
  const Recognition = w ? (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) : null;
  let granted = false;
  return {
    Recognition,
    requestMic:
      w && w.navigator?.mediaDevices?.getUserMedia
        ? async () => {
            if (granted) return;
            const stream: MediaStream = await w.navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach((t) => t.stop()); // permission only; the recognizer opens its own stream
            granted = true;
          }
        : undefined,
    now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
}
