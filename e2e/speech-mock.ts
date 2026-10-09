import type { Page } from "@playwright/test";

/**
 * Replaces the browser's speech APIs with a controlled mock (headless Chromium has no microphone and
 * no voices). It behaves like Chrome where it matters:
 *  - speechSynthesis is a QUEUE: utterances play one after another, `cancel()` empties it and fires
 *    `error: "interrupted"` on the one playing; voices arrive late via `voiceschanged`.
 *  - SpeechRecognition fires start/result/end as tests instruct.
 * Everything is recorded in `window.__log` so tests can check ordering ("cancel" before "rec:start").
 */
export type MockOpts = { mic?: "grant" | "deny" | "none"; recognition?: boolean; tts?: boolean; utterMs?: number; voicesDelayMs?: number };

export async function mockSpeech(page: Page, o: MockOpts = {}) {
  await page.addInitScript((opts: MockOpts) => {
    const w = window as unknown as Record<string, unknown>;
    const log: string[] = [];
    w.__log = log;
    const recs: Record<string, unknown>[] = [];
    w.__recs = recs;
    w.__micRequests = 0;
    class MockRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      started = false;
      aborted = false;
      stopped = false;
      results: { 0: { transcript: string }; isFinal: boolean; length: number }[] = [];
      onstart: null | (() => void) = null;
      onresult: null | ((e: unknown) => void) = null;
      onerror: null | ((e: unknown) => void) = null;
      onend: null | (() => void) = null;
      constructor() {
        recs.push(this as unknown as Record<string, unknown>);
        log.push("rec:new");
      }
      start() {
        this.started = true;
        log.push("rec:start");
        setTimeout(() => this.onstart?.(), 20);
      }
      stop() {
        this.stopped = true;
        setTimeout(() => {
          const last = this.results[this.results.length - 1];
          if (last && !last.isFinal) {
            last.isFinal = true;
            this.onresult?.({ resultIndex: this.results.length - 1, results: this.results });
          }
          this.onend?.();
        }, 30);
      }
      abort() {
        this.aborted = true;
      }
    }
    const cur = () => recs[recs.length - 1] as unknown as MockRecognition;
    w.__say = (items: [string, boolean][]) => {
      const r = cur();
      const resultIndex = Math.max(0, r.results.findIndex((x) => !x.isFinal));
      r.results = items.map(([t, f]) => Object.assign({ 0: { transcript: t }, length: 1 }, { isFinal: f }));
      r.onresult?.({ resultIndex: resultIndex < 0 ? 0 : resultIndex, results: r.results });
    };
    w.__resend = () => cur().onresult?.({ resultIndex: 0, results: cur().results });
    w.__end = () => cur().onend?.();
    w.__error = (code: string) => cur().onerror?.({ error: code });
    if (opts.recognition !== false) {
      w.SpeechRecognition = MockRecognition;
      w.webkitSpeechRecognition = MockRecognition;
    } else {
      delete w.SpeechRecognition;
      delete w.webkitSpeechRecognition;
    }
    const md = navigator.mediaDevices as unknown as Record<string, unknown>;
    if (md) {
      md.getUserMedia = async () => {
        (w.__micRequests as number)++;
        log.push("mic:request");
        if (opts.mic === "deny") throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
        if (opts.mic === "none") throw Object.assign(new Error("no mic"), { name: "NotFoundError" });
        return { getTracks: () => [{ stop() {} }] };
      };
    }

    // ---- speechSynthesis: a real queue ----
    type U = { text: string; voice?: { name: string } | null; onstart?: () => void; onend?: () => void; onerror?: (e: unknown) => void };
    const spoken: string[] = [];
    w.__spoken = spoken;
    const queue: U[] = [];
    let playing: U | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ms = opts.utterMs ?? 300;
    let voices: { lang: string; name: string; localService: boolean }[] = [];
    const vListeners: (() => void)[] = [];
    const loadVoices = () => {
      voices = [
        { lang: "en-US", name: "Google US English", localService: false },
        { lang: "en-GB", name: "Daniel", localService: true },
      ];
      vListeners.forEach((f) => f());
    };
    if (opts.voicesDelayMs) setTimeout(loadVoices, opts.voicesDelayMs);
    else loadVoices();
    const synth = {
      get speaking() {
        return !!playing;
      },
      get pending() {
        return queue.length > 0;
      },
      paused: false,
      next() {
        if (playing || !queue.length) return;
        const u = queue.shift()!;
        playing = u;
        spoken.push(u.text);
        log.push(`start:${u.text}`);
        setTimeout(() => u.onstart?.(), 5);
        timer = setTimeout(() => {
          log.push(`end:${u.text}`);
          playing = null;
          u.onend?.();
          synth.next();
        }, ms);
      },
      speak(u: U) {
        log.push(`speak:${u.text}${u.voice ? `|${u.voice.name}` : ""}`);
        queue.push(u);
        synth.next();
      },
      cancel() {
        log.push("cancel");
        queue.length = 0;
        if (playing) {
          const p = playing;
          playing = null;
          if (timer) clearTimeout(timer);
          setTimeout(() => p.onerror?.({ error: "interrupted" }), 0);
        }
      },
      resume() {},
      getVoices: () => voices,
      addEventListener: (_t: string, f: () => void) => vListeners.push(f),
      removeEventListener: () => {},
    };
    // A plain utterance class, so the mock's voice objects can be assigned like real SpeechSynthesisVoices.
    class MockUtterance {
      text: string;
      rate = 1;
      pitch = 1;
      lang = "";
      voice: unknown = null;
      onstart = null;
      onend = null;
      onerror = null;
      onboundary = null;
      constructor(t: string) {
        this.text = t;
      }
    }
    if (opts.tts !== false) w.SpeechSynthesisUtterance = MockUtterance;
    if (opts.tts !== false) Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    else Object.defineProperty(window, "speechSynthesis", { value: undefined, configurable: true });
  }, o);
}

export const speechLog = (page: Page) => page.evaluate(() => (window as unknown as { __log: string[] }).__log);
export const spokenTexts = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
export const recCount = (page: Page) => page.evaluate(() => ((window as unknown as { __recs: unknown[] }).__recs ?? []).length);
