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
 *
 * Optional cloud voice (off by default; see docs/VOICE.md): after `enableCloud()` / `enableCloudVoice()`,
 * a turn is fetched as MP3 from /api/tts and played through one audio element, with the same lifecycle
 * (stable ids, stop() aborts the fetch and pauses, a cancelled turn never reports finished). Any failure
 * before the audio starts falls back to speechSynthesis for that turn; after 2 consecutive failures the
 * cloud voice is off for the rest of the page session.
 */

import { fetchCloudAudio, resolveCloudVoice, type AudioLike, type CloudVoiceOptions, type HealthVoice, type ResolvedCloudVoice } from "./cloud-voice";

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
  /** Optional cloud voice (null = browser speechSynthesis only, the default). */
  private cloud: ResolvedCloudVoice | null = null;
  private cloudFailures = 0;
  private cloudOff = false;
  private cloudTurn: { cleanup: () => void } | null = null;
  private browserVoiceLabel: string | null = null;

  constructor(
    private synth: SynthLike | null,
    private makeUtterance: (text: string) => UtterLike,
    private timers: Timers = realTimers,
    private voiceWaitMs = 1500,
  ) {
    this.state = { status: synth ? "idle" : "unsupported", id: null, voice: null };
  }

  get supported() {
    return !!this.synth || this.cloudEnabled;
  }

  /** True while the cloud voice will be tried for the next turn. */
  get cloudEnabled() {
    return !!this.cloud && !this.cloudOff;
  }

  /**
   * Turn on the cloud voice for this controller (deps are injectable for tests; defaults are the browser's
   * fetch / Audio / object URLs). Returns false if it cannot run here or was switched off for this session.
   */
  enableCloud(opts: CloudVoiceOptions = {}): boolean {
    const cv = resolveCloudVoice(opts);
    if (!cv || this.cloudOff) return false;
    this.cloud = cv;
    if (this.state.status === "unsupported") this.set({ status: "idle" });
    return true;
  }

  /** Back to the browser voice only (takes effect from the next turn). */
  disableCloud() {
    this.cloud = null;
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
    const cloud = text.trim() ? this.cloudFor(text) : null;
    if ((!this.synth && !cloud) || !text.trim()) {
      h.onDone?.(false);
      return gen;
    }
    this.set({ status: "preparing", id });
    if (cloud) this.speakCloud(gen, cloud, text, h);
    else {
      if (this.cloud) this.set({ voice: this.browserVoiceLabel }); // e.g. a turn too long for the cloud voice
      this.speakBrowser(gen, text, h);
    }
    return gen;
  }

  /** Stop the tutor now (Stop button, the mic opening, a new turn, leaving the page). */
  stop() {
    this.halt(true);
  }

  /* ------------------------------------------------------------------ */

  private speakBrowser(gen: number, text: string, h: SpeakHandlers) {
    if (!this.synth) {
      // Cloud-only controller whose cloud turn failed: the text is on the page.
      this.handlers = null;
      this.set({ status: "idle", id: null });
      h.onDone?.(false);
      return;
    }
    void this.ensureVoices().then(() => {
      if (gen !== this.gen) return; // stopped or replaced while voices loaded
      this.enqueue(gen, text, h);
    });
  }

  /** The speakable text to send to the cloud voice, or null to use the browser voice for this turn. */
  private cloudFor(text: string): string | null {
    if (!this.cloud || this.cloudOff) return null;
    const s = speakable(text);
    return s && s.length <= this.cloud.maxChars ? s : null;
  }

  private noteCloudFailure() {
    this.cloudFailures++;
    if (this.cloud && this.cloudFailures >= this.cloud.maxFailures) this.cloudOff = true; // rest of the page session
  }

  /**
   * One cloud turn: fetch MP3 (abortable) → play through one audio element.
   * Failure before playback starts → this turn falls back to speechSynthesis. Failure after it started
   * → the turn ends (done(false)) rather than restarting from the top in another voice.
   */
  private speakCloud(gen: number, spoken: string, text: string, h: SpeakHandlers) {
    const cv = this.cloud!;
    const ac = new AbortController();
    let audio: AudioLike | null = null;
    let url: string | null = null;
    let startTimer: unknown = null;
    let watchdog: unknown = null;
    let started = false;
    let finished = false;

    const cleanup = () => {
      if (startTimer != null) this.timers.clear(startTimer);
      if (watchdog != null) this.timers.clear(watchdog);
      startTimer = watchdog = null;
      ac.abort();
      if (audio) {
        audio.onplaying = audio.onended = audio.onerror = null;
        try {
          audio.pause();
          audio.removeAttribute?.("src");
          audio.load?.();
        } catch {
          /* already gone */
        }
      }
      if (url) cv.revokeObjectURL(url);
      audio = null;
      url = null;
      if (this.cloudTurn === turn) this.cloudTurn = null;
    };
    const turn = { cleanup };
    this.cloudTurn = turn;

    const finish = (completed: boolean) => {
      if (finished || gen !== this.gen) return;
      finished = true;
      cleanup();
      if (completed) {
        this.cloudFailures = 0;
        h.onProgress?.(text.length);
      }
      this.handlers = null;
      this.set({ status: "idle", id: null });
      h.onDone?.(completed);
    };
    const fail = () => {
      if (finished || gen !== this.gen) return; // stopped/replaced: not a failure of the voice
      finished = true;
      cleanup();
      this.noteCloudFailure();
      if (started) {
        this.handlers = null;
        this.set({ status: "idle", id: null });
        h.onDone?.(false);
        return;
      }
      this.set({ voice: this.browserVoiceLabel });
      this.speakBrowser(gen, text, h);
    };

    // Covers a slow /api/tts AND audio that never starts (stalled decode, a play() that never settles).
    startTimer = this.timers.set(fail, cv.timeoutMs);

    const pace = h.rate != null ? Math.min(2, Math.max(0.25, Math.round((h.rate / 0.92) * 100) / 100)) : undefined;
    fetchCloudAudio(cv, spoken, pace, ac.signal).then(
      (blob) => {
        if (finished || gen !== this.gen) return;
        try {
          url = cv.createObjectURL(blob);
          const a = cv.makeAudio();
          audio = a;
          a.onplaying = () => {
            if (finished || gen !== this.gen || started) return;
            started = true;
            if (startTimer != null) this.timers.clear(startTimer);
            startTimer = null;
            this.set({ status: "speaking", voice: cv.label });
            h.onStart?.();
            h.onProgress?.(0);
            const tick = () => {
              if (finished || gen !== this.gen) return;
              if (a.ended) return finish(true); // `ended` event lost
              watchdog = this.timers.set(tick, 1000);
            };
            watchdog = this.timers.set(tick, 1000);
          };
          a.onended = () => finish(true);
          a.onerror = () => fail();
          a.src = url;
          const p = a.play();
          if (p && typeof p.then === "function") p.then(undefined, () => fail()); // autoplay policy, decode error
        } catch {
          fail();
        }
      },
      () => fail(),
    );
  }

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
    this.cloudTurn?.cleanup(); // abort the fetch, pause the audio
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
          this.browserVoiceLabel = `${v.name} (${v.lang}${v.localService ? ", on device" : ", network"})`;
          this.set({ voice: this.browserVoiceLabel });
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

/**
 * Opt the page's speaker into the cloud voice IF the server has one configured
 * (/api/health → voice.provider === "google-chirp3-hd"). Safe to call more than once and on every page
 * load; resolves false (browser voice stays) on the server, without a key, or on any error.
 */
export async function enableCloudVoice(opts: CloudVoiceOptions & { healthUrl?: string; speaker?: Speaker } = {}): Promise<boolean> {
  try {
    const sp = opts.speaker ?? (typeof window !== "undefined" ? browserSpeaker() : null);
    const f = opts.fetch ?? (typeof window !== "undefined" && window.fetch ? (i: string, init: RequestInit) => window.fetch(i, init) : null);
    if (!sp || !f) return false;
    const res = await f(opts.healthUrl ?? "/api/health", { cache: "no-store" });
    if (!res.ok) return false;
    const v = ((await res.json()) as { voice?: HealthVoice })?.voice;
    if (v?.provider !== "google-chirp3-hd") return false;
    const { healthUrl: _h, speaker: _s, ...rest } = opts;
    return sp.enableCloud({
      ...rest,
      maxChars: opts.maxChars ?? v.limits?.maxCharsPerRequest,
      label: opts.label ?? (v.voice ? `${v.voice} (cloud)` : undefined),
    });
  } catch {
    return false;
  }
}
