/**
 * Tutor speech: ONE controller per page (browser speechSynthesis), with an explicit lifecycle.
 *
 *   idle ──speak(id)──▶ preparing (voices loading) ──▶ speaking ──▶ idle (finished)
 *                                                         └──stop()──▶ idle (stopped)
 *
 * What caused the old stutter, and what this does instead:
 *  1. Sentences were spoken one by one, each started from JavaScript after the previous one's `end`
 *     event plus a 120 ms pause; with Chrome's network voices every sentence also paid its own start-up
 *     latency. → All sentences of a turn are queued at once; the browser plays them back to back.
 *  2. The voice was looked up per sentence and only cached once found; Chrome loads voices
 *     asynchronously, so a turn could start in the default voice and switch mid-turn.
 *     → Voices are awaited (`voiceschanged`, with a timeout) and ONE voice is chosen per page,
 *     preferring on-device voices, which start instantly.
 *  3. Utterance objects were only held by closures; Chrome can garbage-collect them and then never fire
 *     `end`, stalling the chain. → The controller keeps strong references to every queued utterance and
 *     runs a watchdog that finishes a turn if the browser goes quiet without reporting it.
 *  - Stable utterance ids: speaking the id that is already playing is a no-op (no restart).
 *  - A cancelled turn never reports "finished"; events from older turns are ignored.
 */

export interface UtterLike {
  text: string;
  rate: number;
  pitch: number;
  lang: string;
  voice: unknown;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e?: unknown) => void) | null;
  onboundary: ((e: { charIndex: number; charLength?: number }) => void) | null;
}

export interface VoiceInfo {
  lang: string;
  name: string;
  localService?: boolean;
  default?: boolean;
}

export interface SynthLike {
  speak(u: UtterLike): void;
  cancel(): void;
  resume?(): void;
  getVoices(): VoiceInfo[];
  speaking: boolean;
  pending?: boolean;
  paused?: boolean;
  addEventListener?(type: "voiceschanged", fn: () => void): void;
  removeEventListener?(type: "voiceschanged", fn: () => void): void;
}

export interface SpeakHandlers {
  rate?: number;
  onStart?: () => void;
  onProgress?: (chars: number) => void;
  onDone?: (completed: boolean) => void;
}

export interface SpeechState {
  status: "idle" | "preparing" | "speaking" | "unsupported";
  /** Id of the utterance being spoken (or prepared). */
  id: string | null;
  /** The voice chosen for this page, for the console/tests ("Rishi (en-IN, on device)"). */
  voice: string | null;
}

export interface Phrase {
  text: string;
  start: number;
}

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export class Speaker {
  private gen = 0;
  private handlers: SpeakHandlers | null = null;
  private state: SpeechState;
  private chosen: unknown = null;
  private voicesReady: Promise<void> | null = null;
  /** Strong references: Chrome may otherwise collect queued utterances and never fire `end`. */
  private queued: UtterLike[] = [];
  private watchdog: unknown = null;
  private listeners = new Set<(s: SpeechState) => void>();

  constructor(
    private synth: SynthLike | null,
    private makeUtterance: (text: string) => UtterLike,
    private timers: Timers = realTimers,
    private voiceWaitMs = 1500,
  ) {
    this.state = { status: synth ? "idle" : "unsupported", id: null, voice: null };
  }

  get supported() {
    return !!this.synth;
  }

  /** True while a turn is being prepared or spoken. */
  get active() {
    return this.state.status === "speaking" || this.state.status === "preparing";
  }

  get snapshot(): SpeechState {
    return this.state;
  }

  subscribe(fn: (s: SpeechState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  /**
   * Speak one tutor turn. `id` is stable per turn: if that turn is already playing, nothing happens.
   * `force` replays it from the start (Replay button).
   */
  speak(id: string, text: string, h: SpeakHandlers = {}, opts: { force?: boolean } = {}): number {
    if (!opts.force && this.active && this.state.id === id) return this.gen; // already playing: never restart
    this.halt(false);
    const gen = ++this.gen;
    this.handlers = h;
    if (!this.synth || !text.trim()) {
      h.onDone?.(false);
      return gen;
    }
    this.set({ status: "preparing", id });
    void this.ensureVoices().then(() => {
      if (gen !== this.gen) return; // stopped or replaced while voices loaded
      this.enqueue(gen, text, h);
    });
    return gen;
  }

  /** Stop the tutor now (Stop button, the mic opening, a new turn, leaving the page). */
  stop() {
    this.halt(true);
  }

  /* ------------------------------------------------------------------ */

  private enqueue(gen: number, text: string, h: SpeakHandlers) {
    const synth = this.synth!;
    if (synth.speaking || synth.pending) synth.cancel();
    if (synth.paused) synth.resume?.(); // Chrome can be left paused after a tab switch
    const phrases = splitPhrases(text);
    let started = false;
    let finished = false;
    const finish = (completed: boolean) => {
      if (finished || gen !== this.gen) return;
      finished = true;
      this.clearWatchdog();
      this.queued = [];
      if (completed) h.onProgress?.(text.length);
      this.handlers = null;
      this.set({ status: "idle", id: null });
      h.onDone?.(completed);
    };
    this.queued = phrases.map((ph, i) => {
      const spoken = speakable(ph.text);
      const u = this.makeUtterance(spoken);
      u.rate = h.rate ?? 0.92; // calm, patient pace
      u.pitch = 1;
      u.lang = (this.state.voice && this.voiceLang) || "en-IN";
      try {
        if (this.chosen) u.voice = this.chosen;
      } catch {
        /* an unusable voice falls back to the browser default */
      }
      const ratio = ph.text.length / Math.max(1, spoken.length);
      u.onstart = () => {
        if (gen !== this.gen) return;
        if (!started) {
          started = true;
          this.set({ status: "speaking" });
          h.onStart?.();
        }
        h.onProgress?.(ph.start);
      };
      u.onboundary = (e) => {
        if (gen !== this.gen) return;
        h.onProgress?.(ph.start + Math.min(ph.text.length, Math.round((e.charIndex + (e.charLength ?? 0)) * ratio)));
      };
      u.onend = () => {
        if (gen !== this.gen) return;
        h.onProgress?.(ph.start + ph.text.length);
        if (i === phrases.length - 1) finish(true);
      };
      u.onerror = (e) => {
        if (gen !== this.gen) return;
        const code = (e as { error?: string } | undefined)?.error;
        if (code === "interrupted" || code === "canceled") return; // our own cancel of an older turn
        finish(false);
      };
      return u;
    });
    try {
      for (const u of this.queued) synth.speak(u); // the browser queues them: no gaps, no JS round trips
    } catch {
      finish(false); // speech is an enhancement; the text is on the page
      return;
    }
    this.armWatchdog(gen, finish);
  }

  /** If the browser stops talking without reporting the end (a known Chrome bug), finish the turn. */
  private armWatchdog(gen: number, finish: (c: boolean) => void) {
    this.clearWatchdog();
    let quiet = 0;
    const tick = () => {
      if (gen !== this.gen) return;
      const s = this.synth!;
      quiet = s.speaking || s.pending ? 0 : quiet + 1;
      if (quiet >= 3) return finish(true); // ~1.5 s of silence with nothing queued
      this.watchdog = this.timers.set(tick, 500);
    };
    this.watchdog = this.timers.set(tick, 1500);
  }

  private clearWatchdog() {
    if (this.watchdog != null) this.timers.clear(this.watchdog);
    this.watchdog = null;
  }

  private halt(cancelSynth: boolean) {
    const h = this.handlers;
    const was = this.active;
    this.gen++;
    this.clearWatchdog();
    this.handlers = null;
    if (this.synth && (cancelSynth || was) && (this.synth.speaking || this.synth.pending || this.queued.length)) this.synth.cancel();
    this.queued = [];
    if (was) {
      this.set({ status: "idle", id: null });
      h?.onDone?.(false);
    }
  }

  private voiceLang: string | null = null;

  /** Wait (once) for the browser's voice list, then choose ONE voice for the whole page. */
  private ensureVoices(): Promise<void> {
    if (this.voicesReady) return this.voicesReady;
    const synth = this.synth!;
    this.voicesReady = new Promise<void>((resolve) => {
      const pick = () => {
        const v = chooseVoice(synth.getVoices());
        if (v) {
          this.chosen = v;
          this.voiceLang = v.lang;
          this.set({ voice: `${v.name} (${v.lang}${v.localService ? ", on device" : ", network"})` });
        }
      };
      if (synth.getVoices().length) {
        pick();
        return resolve();
      }
      let done = false;
      const ready = () => {
        if (done) return;
        done = true;
        synth.removeEventListener?.("voiceschanged", ready);
        pick();
        resolve();
      };
      synth.addEventListener?.("voiceschanged", ready);
      this.timers.set(ready, this.voiceWaitMs); // some browsers never fire it: use the default voice
    });
    return this.voicesReady;
  }

  private set(p: Partial<SpeechState>) {
    this.state = { ...this.state, ...p };
    for (const fn of this.listeners) fn(this.state);
  }
}

/** Prefer an on-device English voice (starts instantly, no network), Indian then British then any English. */
export function chooseVoice(voices: VoiceInfo[]): VoiceInfo | null {
  const en = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  if (!en.length) return null;
  const rank = (v: VoiceInfo) => (v.localService ? 0 : 10) + (/en[-_]IN/i.test(v.lang) ? 0 : /en[-_]GB/i.test(v.lang) ? 1 : /en[-_]US/i.test(v.lang) ? 2 : 3) - (v.default ? 0.5 : 0);
  return [...en].sort((a, b) => rank(a) - rank(b))[0];
}

/** Split into sentences, and long sentences at a dash, colon or semicolon. Offsets index the original text. */
export function splitPhrases(text: string, max = 140): Phrase[] {
  const out: Phrase[] = [];
  // Sentence ends are . ? ! followed by whitespace or the end — so "2.5" stays together.
  const re = /[.?!]+(?=\s|$)\s*/g;
  let from = 0;
  for (const m of text.matchAll(re)) {
    const end = (m.index ?? 0) + m[0].length;
    if (text.slice(from, end).trim()) pushSplit(out, text.slice(from, end), from, max);
    from = end;
  }
  if (text.slice(from).trim()) pushSplit(out, text.slice(from), from, max);
  return out.length ? out : [{ text, start: 0 }];
}

function pushSplit(out: Phrase[], s: string, start: number, max: number) {
  if (s.length <= max) {
    out.push({ text: s, start });
    return;
  }
  const cut = Math.max(s.lastIndexOf(" — ", max), s.lastIndexOf(": ", max), s.lastIndexOf("; ", max), s.lastIndexOf(", ", max));
  if (cut < 20) {
    out.push({ text: s, start });
    return;
  }
  out.push({ text: s.slice(0, cut + 2), start });
  pushSplit(out, s.slice(cut + 2), start + cut + 2, max);
}

/**
 * Make text speakable: maths read as words, no symbols or labels.
 * "3x + 5 = 20" → "3 x plus 5 equals 20" (voices say "three ex plus five equals twenty"),
 * "−3" → "negative 3", "20 − 5" → "20 minus 5", "15 ÷ 3" → "15 divided by 3".
 */
export function speakable(text: string): string {
  return text
    .replace(/[“”"]/g, "")
    .replace(/✓|✗|↗|▸|·/g, " ")
    .replace(/\(a number\)/g, "a number")
    .replace(/(\d)\s*x\b/g, "$1 x")
    .replace(/(^|[\s(=])[−-](\d)/g, "$1negative $2")
    .replace(/\s[−-]\s/g, " minus ")
    .replace(/\s\+\s/g, " plus ")
    .replace(/\s?≠\s?/g, " is not equal to ")
    .replace(/\s?=\s?/g, " equals ")
    .replace(/\s?÷\s?/g, " divided by ")
    .replace(/\s?×\s?/g, " times ")
    .replace(/(\d+)\s*\/\s*(\d+)/g, "$1 over $2")
    .replace(/\s?[⇒→]\s?/g, ", so ")
    .replace(/\s+—\s+|—/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------------- One controller per page ---------------- */

let pageSpeaker: Speaker | null = null;

/** The page's single speech controller (created on first use in the browser). */
export function browserSpeaker(): Speaker {
  if (pageSpeaker) return pageSpeaker;
  const ok = typeof window !== "undefined" && !!window.speechSynthesis && typeof SpeechSynthesisUtterance !== "undefined";
  if (!ok) return (pageSpeaker = new Speaker(null, () => ({}) as UtterLike));
  const synth = window.speechSynthesis as unknown as SynthLike;
  pageSpeaker = new Speaker(synth, (t) => new SpeechSynthesisUtterance(t) as unknown as UtterLike);
  // Leaving or hiding the page never leaves the tutor talking.
  window.addEventListener("pagehide", () => pageSpeaker?.stop());
  return pageSpeaker;
}
