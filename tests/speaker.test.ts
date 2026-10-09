import { describe, expect, it } from "vitest";
import { Speaker, chooseVoice, speakable, splitPhrases, type SynthLike, type UtterLike, type VoiceInfo } from "../src/lib/voice/speaker";

/** A controllable speechSynthesis: queues utterances like a browser; tests fire start/end explicitly. */
function harness(opts: { voices?: VoiceInfo[]; voicesLater?: VoiceInfo[] } = {}) {
  let t = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nid = 1;
  const queue: UtterLike[] = [];
  const spoken: UtterLike[] = [];
  let cancels = 0;
  let voices = opts.voices ?? [{ lang: "en-IN", name: "Rishi", localService: true }];
  const vListeners: (() => void)[] = [];
  const synth: SynthLike = {
    speaking: false,
    pending: false,
    speak(u) {
      spoken.push(u);
      queue.push(u);
      this.pending = true;
    },
    cancel() {
      cancels++;
      queue.length = 0;
      this.speaking = false;
      this.pending = false;
    },
    getVoices: () => voices,
    addEventListener: (_t, fn) => vListeners.push(fn),
    removeEventListener: () => {},
  };
  const timerApi = {
    set: (fn: () => void, ms: number) => {
      const id = nid++;
      timers.push({ at: t + ms, fn, id });
      return id;
    },
    clear: (h: unknown) => {
      timers = timers.filter((x) => x.id !== h);
    },
  };
  const sp = new Speaker(synth, (text) => ({ text, rate: 1, pitch: 1, lang: "", voice: null, onstart: null, onend: null, onerror: null, onboundary: null }), timerApi, 1500);
  const advance = (ms: number) => {
    t += ms;
    for (;;) {
      const due = timers.filter((x) => x.at <= t).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((x) => x !== due);
      due.fn();
    }
  };
  /** The browser plays the next queued utterance to the end. */
  const playNext = () => {
    const u = queue.shift()!;
    synth.speaking = true;
    synth.pending = queue.length > 0;
    u.onstart?.();
    u.onend?.();
    synth.speaking = queue.length > 0;
    return u;
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return {
    sp,
    synth,
    queue,
    spoken,
    cancels: () => cancels,
    advance,
    playNext,
    flush,
    loadVoices: (v: VoiceInfo[]) => {
      voices = v;
      vListeners.forEach((f) => f());
    },
  };
}

describe("speakable maths", () => {
  it("reads equations naturally, without symbols", () => {
    expect(speakable("3x + 5 = 20")).toBe("3 x plus 5 equals 20");
    expect(speakable("20 − 5 = 15")).toBe("20 minus 5 equals 15");
    expect(speakable("x = −3")).toBe("x equals negative 3");
    expect(speakable("15 ÷ 3 = 5")).toBe("15 divided by 3 equals 5");
    expect(speakable("25 + 5 = 30 ≠ 20")).toBe("25 plus 5 equals 30 is not equal to 20");
    expect(speakable("x = 3/4")).toBe("x equals 3 over 4");
    expect(speakable("Hmm — interesting.")).toBe("Hmm, interesting.");
    expect(speakable("On the left we have “+ 5”.")).not.toMatch(/[“”"+=]/);
  });
});

describe("phrase splitting", () => {
  it("splits at sentence ends and keeps offsets into the original text", () => {
    const text = "Nice move. What would you do next?";
    const p = splitPhrases(text);
    expect(p.map((x) => x.text.trim())).toEqual(["Nice move.", "What would you do next?"]);
    for (const ph of p) expect(text.slice(ph.start, ph.start + ph.text.length)).toBe(ph.text);
  });
  it("does not split decimals", () => {
    expect(splitPhrases("x = 2.5 is close.").length).toBe(1);
  });
});

describe("voice choice", () => {
  it("prefers an on-device English voice over a network one", () => {
    const v = chooseVoice([
      { lang: "en-IN", name: "Google English (India)", localService: false },
      { lang: "en-GB", name: "Daniel", localService: true },
      { lang: "fr-FR", name: "Thomas", localService: true },
    ]);
    expect(v?.name).toBe("Daniel");
  });
  it("no English voice → browser default", () => {
    expect(chooseVoice([{ lang: "fr-FR", name: "Thomas", localService: true }])).toBeNull();
  });
});

describe("Speaker: one controller, one turn at a time", () => {
  it("queues every sentence of a turn at once (no JS gaps between sentences) and finishes once", async () => {
    const h = harness();
    const done: boolean[] = [];
    h.sp.speak("t1", "Yes! That works. What next?", { onDone: (c) => done.push(c) });
    await h.flush();
    expect(h.spoken.map((u) => u.text.trim())).toEqual(["Yes!", "That works.", "What next?"]); // all queued immediately
    expect(h.sp.snapshot.status).toBe("preparing");
    h.playNext();
    expect(h.sp.snapshot.status).toBe("speaking");
    h.playNext();
    h.playNext();
    expect(done).toEqual([true]);
    expect(h.sp.snapshot).toMatchObject({ status: "idle", id: null });
  });

  it("the same turn id is never restarted while it plays (re-renders, duplicate effects)", async () => {
    const h = harness();
    h.sp.speak("t1", "One. Two.");
    await h.flush();
    h.playNext();
    h.sp.speak("t1", "One. Two.");
    h.sp.speak("t1", "One. Two.");
    await h.flush();
    expect(h.spoken).toHaveLength(2);
    expect(h.cancels()).toBe(0);
  });

  it("Replay (force) plays the turn again from the start, exactly once", async () => {
    const h = harness();
    h.sp.speak("t1", "Hello.");
    await h.flush();
    h.playNext();
    h.sp.speak("t1", "Hello.", {}, { force: true });
    await h.flush();
    expect(h.spoken.map((u) => u.text)).toEqual(["Hello.", "Hello."]);
  });

  it("a new turn cancels the old one; the old one's late events are ignored and it never reports 'finished'", async () => {
    const h = harness();
    const a: boolean[] = [];
    const b: boolean[] = [];
    h.sp.speak("t1", "First turn. Still talking.", { onDone: (c) => a.push(c) });
    await h.flush();
    const old = h.queue[0];
    h.sp.speak("t2", "Second turn.", { onDone: (c) => b.push(c) });
    expect(a).toEqual([false]);
    old.onerror?.({ error: "interrupted" });
    old.onend?.();
    await h.flush();
    expect(a).toEqual([false]);
    expect(h.queue.map((u) => u.text)).toEqual(["Second turn."]);
    h.playNext();
    expect(b).toEqual([true]);
  });

  it("stop() is immediate: done(false), queue cancelled, nothing more spoken", async () => {
    const h = harness();
    const done: boolean[] = [];
    h.sp.speak("t1", "One. Two. Three.", { onDone: (c) => done.push(c) });
    await h.flush();
    h.playNext();
    h.sp.stop();
    expect(done).toEqual([false]);
    expect(h.queue).toHaveLength(0);
    expect(h.sp.active).toBe(false);
  });

  it("stop() while voices are still loading means nothing is ever spoken", async () => {
    const h = harness({ voices: [] });
    h.sp.speak("t1", "Hello there.");
    h.sp.stop();
    h.loadVoices([{ lang: "en-GB", name: "Daniel", localService: true }]);
    await h.flush();
    expect(h.spoken).toHaveLength(0);
  });

  it("waits for voiceschanged and uses ONE voice for every sentence (no mid-turn voice switch)", async () => {
    const h = harness({ voices: [] });
    h.sp.speak("t1", "First. Second.");
    await h.flush();
    expect(h.spoken).toHaveLength(0); // waiting for the voice list
    const daniel = { lang: "en-GB", name: "Daniel", localService: true };
    h.loadVoices([daniel, { lang: "en-IN", name: "Google", localService: false }]);
    await h.flush();
    expect(h.spoken.map((u) => (u.voice as VoiceInfo)?.name)).toEqual(["Daniel", "Daniel"]);
    expect(h.sp.snapshot.voice).toMatch(/Daniel.*on device/);
  });

  it("if voiceschanged never fires, speaks with the default voice after a timeout", async () => {
    const h = harness({ voices: [] });
    h.sp.speak("t1", "Hello.");
    await h.flush();
    h.advance(1600);
    await h.flush();
    expect(h.spoken).toHaveLength(1);
  });

  it("keeps strong references to queued utterances, and a watchdog finishes a turn whose `end` never fires", async () => {
    const h = harness();
    const done: boolean[] = [];
    h.sp.speak("t1", "One. Two.", { onDone: (c) => done.push(c) });
    await h.flush();
    // The browser plays both but (Chrome GC bug) never fires `end`.
    h.queue.length = 0;
    h.synth.speaking = false;
    h.synth.pending = false;
    for (let i = 0; i < 8; i++) h.advance(500); // ~1.5 s of quiet after the first check
    expect(done).toEqual([true]);
    expect(h.sp.snapshot.status).toBe("idle");
  });

  it("a browser that throws on speak() never crashes the page: done(false)", async () => {
    const synth: SynthLike = { speaking: false, speak() { throw new Error("not allowed"); }, cancel() {}, getVoices: () => [{ lang: "en-US", name: "x" }] };
    const sp = new Speaker(synth, (text) => ({ text, rate: 1, pitch: 1, lang: "", voice: null, onstart: null, onend: null, onerror: null, onboundary: null }));
    const done: boolean[] = [];
    sp.speak("t1", "Hello.", { onDone: (c) => done.push(c) });
    await new Promise((r) => setTimeout(r, 0));
    expect(done).toEqual([false]);
  });

  it("an unusable voice object is ignored", async () => {
    const spoken: string[] = [];
    const synth: SynthLike = { speaking: false, speak(u) { spoken.push(u.text); }, cancel() {}, getVoices: () => [{ lang: "en-IN", name: "odd" }] };
    const sp = new Speaker(synth, (text) => {
      const u = { text, rate: 1, pitch: 1, lang: "", onstart: null, onend: null, onerror: null, onboundary: null } as unknown as Record<string, unknown>;
      Object.defineProperty(u, "voice", { set() { throw new TypeError("not a SpeechSynthesisVoice"); }, get() { return null; } });
      return u as never;
    });
    sp.speak("t1", "Hello.");
    await new Promise((r) => setTimeout(r, 0));
    expect(spoken).toEqual(["Hello."]);
  });

  it("without speech synthesis it reports done(false) and says unsupported", () => {
    const sp = new Speaker(null, () => ({}) as UtterLike);
    const done: boolean[] = [];
    sp.speak("t1", "Hello.", { onDone: (c) => done.push(c) });
    expect(done).toEqual([false]);
    expect(sp.snapshot.status).toBe("unsupported");
  });

  it("subscribers see a predictable lifecycle: preparing → speaking → idle", async () => {
    const h = harness();
    const seen: string[] = [];
    h.sp.subscribe((s) => seen.push(s.status));
    h.sp.speak("t1", "Hi.");
    await h.flush();
    h.playNext();
    expect(seen.filter((x, i) => x !== seen[i - 1])).toEqual(["idle", "preparing", "speaking", "idle"]);
  });
});
