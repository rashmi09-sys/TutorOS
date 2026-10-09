import { describe, expect, it, beforeEach } from "vitest";
import { VoiceController, type RecognitionLike, type VoiceEnv, type VoiceMeta, type VoiceSnapshot } from "../src/lib/voice/controller";

/** A controllable SpeechRecognition: tests fire the browser events explicitly. */
class FakeRec implements RecognitionLike {
  static all: FakeRec[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  started = false;
  stopped = false;
  aborted = false;
  onstart: ((e?: unknown) => void) | null = null;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: ((e?: unknown) => void) | null = null;
  constructor() {
    FakeRec.all.push(this);
  }
  start() {
    if (this.started) throw new Error("InvalidStateError");
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
  abort() {
    this.aborted = true;
  }
  /** results: [text, isFinal][] — the browser's full results list for this session. */
  result(results: [string, boolean][], resultIndex = 0) {
    const list = results.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f }));
    this.onresult?.({ resultIndex, results: list });
  }
}

function harness(opts: { requestMic?: () => Promise<void>; noRecognition?: boolean } = {}) {
  let t = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const env: VoiceEnv = {
    Recognition: opts.noRecognition ? null : (FakeRec as unknown as new () => RecognitionLike),
    requestMic: opts.requestMic,
    now: () => t,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.push({ at: t + ms, fn, id });
      return id;
    },
    clearTimeout: (h) => {
      timers = timers.filter((x) => x.id !== h);
    },
  };
  const states: VoiceSnapshot[] = [];
  const completed: { text: string; meta: VoiceMeta }[] = [];
  const vc = new VoiceController(env, { onChange: (s) => states.push(s), onComplete: (text, meta) => completed.push({ text, meta }) });
  const advance = (ms: number) => {
    t += ms;
    for (;;) {
      const due = timers.filter((x) => x.at <= t).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((x) => x !== due);
      due.fn();
    }
  };
  const rec = () => FakeRec.all[FakeRec.all.length - 1];
  const listen = async (o?: Parameters<VoiceController["start"]>[0]) => {
    await vc.start(o);
    rec().onstart?.();
  };
  return { vc, states, completed, advance, rec, listen, pending: () => timers.length };
}

beforeEach(() => {
  FakeRec.all = [];
});

describe("voice controller: state machine", () => {
  it("start → requesting → listening; recognizer is continuous with interim results", async () => {
    const h = harness();
    const p = h.vc.start();
    expect(h.vc.snapshot.status).toBe("requesting");
    await p;
    expect(h.rec().continuous).toBe(true);
    expect(h.rec().interimResults).toBe(true);
    h.rec().onstart?.();
    expect(h.vc.snapshot.status).toBe("listening");
  });

  it("Done submits finals + the phrase in progress, exactly once", async () => {
    const h = harness();
    await h.listen();
    h.rec().result([["three x", true], ["equals fif", false]]);
    h.vc.done();
    expect(h.vc.snapshot.status).toBe("finishing");
    expect(h.rec().stopped).toBe(true);
    h.rec().result([["three x", true], ["equals fifteen", true]]);
    h.rec().onend?.();
    expect(h.completed).toHaveLength(1);
    expect(h.completed[0].text).toBe("three x equals fifteen");
    expect(h.completed[0].meta.endedBy).toBe("done");
    h.advance(5000); // the finish timeout must not complete it a second time
    expect(h.completed).toHaveLength(1);
  });

  it("Done still completes if the browser never sends onend (timeout), using what was heard", async () => {
    const h = harness();
    await h.listen();
    h.rec().result([["x equals 5", false]]);
    h.vc.done();
    h.advance(1600);
    expect(h.completed.map((c) => c.text)).toEqual(["x equals 5"]);
  });

  it("Cancel (X) discards everything and never submits — even if late results and onend arrive", async () => {
    const h = harness();
    await h.listen();
    const r = h.rec();
    r.result([["I'm stuck", true]]);
    h.vc.cancel();
    expect(h.vc.snapshot.status).toBe("cancelled");
    expect(h.vc.snapshot.finalText).toBe("");
    expect(r.aborted).toBe(true);
    r.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: "late" }], { isFinal: true })] });
    r.onend?.();
    h.advance(10000);
    expect(h.completed).toEqual([]);
  });

  it("Cancel during Finishing also discards", async () => {
    const h = harness();
    await h.listen();
    h.rec().result([["x = 4", true]]);
    h.vc.done();
    h.vc.cancel();
    h.rec()?.onend?.();
    h.advance(3000);
    expect(h.completed).toEqual([]);
  });

  it("a normal pause does not submit: finals accumulate until Done", async () => {
    const h = harness();
    await h.listen();
    h.rec().result([["three x", true]]);
    h.advance(10000);
    h.rec().result([["three x", true], ["equals fifteen", true]]);
    expect(h.completed).toEqual([]);
    expect(h.vc.snapshot.finalText).toBe("three x equals fifteen");
  });

  it("interim and final text are kept separate, and finals stay stable while the student speaks", async () => {
    const h = harness();
    await h.listen();
    h.rec().result([["I think", true], ["it's", false]]);
    expect(h.vc.snapshot).toMatchObject({ finalText: "I think", interim: "it's" });
    h.rec().result([["I think", true], ["it's five", false]], 1);
    expect(h.vc.snapshot).toMatchObject({ finalText: "I think", interim: "it's five" });
    h.rec().result([["I think", true], ["it's five", true]], 1);
    expect(h.vc.snapshot).toMatchObject({ finalText: "I think it's five", interim: "" });
  });

  it("duplicate result events are applied once", async () => {
    const h = harness();
    await h.listen();
    h.rec().result([["x equals five", true]]);
    h.rec().result([["x equals five", true]]); // same event delivered twice
    h.rec().result([["x equals five", true], ["x equals five", true]], 1); // Android re-emits the last final
    h.vc.done();
    h.rec().onend?.();
    expect(h.completed[0].text).toBe("x equals five");
    expect(h.completed[0].meta.duplicateEventsIgnored).toBeGreaterThanOrEqual(2);
  });

  it("start while listening is ignored: no duplicate recognition sessions", async () => {
    const h = harness();
    await h.listen();
    await h.vc.start();
    await h.vc.start();
    expect(FakeRec.all).toHaveLength(1);
  });

  it("rapid start/cancel/start leaves exactly one live recognizer and stale events are ignored", async () => {
    const h = harness();
    await h.listen();
    const first = h.rec();
    h.vc.cancel();
    await h.listen();
    const second = h.rec();
    expect(second).not.toBe(first);
    expect(first.onresult).toBeNull(); // detached
    first.onend?.();
    expect(h.vc.snapshot.status).toBe("listening");
    second.result([["x = 5", true]]);
    expect(h.vc.snapshot.finalText).toBe("x = 5");
  });

  it("cancel while the permission prompt is open: nothing starts afterwards", async () => {
    let grant!: () => void;
    const h = harness({ requestMic: () => new Promise<void>((r) => (grant = r)) });
    const p = h.vc.start();
    await new Promise((r) => setTimeout(r, 0)); // the permission prompt is now open
    h.vc.cancel();
    grant();
    await p;
    expect(FakeRec.all).toHaveLength(0);
    expect(h.vc.snapshot.status).toBe("cancelled");
  });

  it("permission denied → denied state, no recognizer, no retry loop", async () => {
    const h = harness({ requestMic: () => Promise.reject(Object.assign(new Error("no"), { name: "NotAllowedError" })) });
    await h.vc.start();
    expect(h.vc.snapshot.status).toBe("denied");
    expect(FakeRec.all).toHaveLength(0);
    h.advance(60000);
    expect(FakeRec.all).toHaveLength(0);
  });

  it("no microphone → unavailable", async () => {
    const h = harness({ requestMic: () => Promise.reject(Object.assign(new Error("no"), { name: "NotFoundError" })) });
    await h.vc.start();
    expect(h.vc.snapshot.status).toBe("unavailable");
  });

  it("recognizer reports not-allowed → denied, and its later onend doesn't restart", async () => {
    const h = harness();
    await h.listen();
    const r = h.rec();
    r.onerror?.({ error: "not-allowed" });
    r.onend?.();
    expect(h.vc.snapshot.status).toBe("denied");
    expect(FakeRec.all).toHaveLength(1);
  });

  it("unsupported browser → unsupported, start does nothing", async () => {
    const h = harness({ noRecognition: true });
    expect(h.vc.snapshot.status).toBe("unsupported");
    await h.vc.start();
    expect(h.vc.snapshot.status).toBe("unsupported");
  });

  it("browser ends the session on its own: resumed silently (capped), transcript kept", async () => {
    const h = harness();
    await h.listen();
    h.advance(2000);
    h.rec().result([["three x", true]]);
    h.rec().onend?.(); // Chrome stops after a pause
    expect(FakeRec.all).toHaveLength(2);
    expect(h.vc.snapshot.status).toBe("listening");
    h.rec().onstart?.();
    h.advance(2000);
    h.rec().result([["equals fifteen", true]]); // index 0 of a new browser session
    expect(h.vc.snapshot.finalText).toBe("three x equals fifteen");
    h.rec().onend?.();
    h.advance(2000);
    expect(FakeRec.all).toHaveLength(3);
    h.advance(2000);
    h.rec().onend?.(); // third unexpected end: cap reached → honest recovery state, no more restarts
    expect(FakeRec.all).toHaveLength(3);
    expect(h.vc.snapshot.status).toBe("interrupted");
    expect(h.vc.snapshot.finalText).toBe("three x equals fifteen");
    expect(h.completed).toEqual([]); // nothing submitted automatically
  });

  it("interrupted → one-tap resume keeps the transcript; Done then sends it", async () => {
    const h = harness();
    await h.listen();
    h.advance(1000);
    h.rec().result([["three x", true], ["equals", false]]);
    h.rec().onerror?.({ error: "no-speech" });
    for (let i = 0; i < 3; i++) {
      h.rec().onend?.();
      h.advance(1000);
    }
    expect(h.vc.snapshot.status).toBe("interrupted");
    await h.listen({ resume: true });
    h.rec().result([["fifteen", true]]);
    h.vc.done();
    h.rec().onend?.();
    expect(h.completed[0].text).toBe("three x equals fifteen");
  });

  it("an end right after starting is not resumed (no restart loop)", async () => {
    const h = harness();
    await h.listen();
    h.rec().onend?.();
    expect(FakeRec.all).toHaveLength(1);
    expect(h.vc.snapshot.status).toBe("interrupted");
  });

  it("Done with nothing heard submits nothing", async () => {
    const h = harness();
    await h.listen();
    h.vc.done();
    h.rec()?.onend?.();
    expect(h.completed).toEqual([]);
    expect(h.vc.snapshot.status).toBe("idle");
  });

  it("hands-free: a pause after final speech finishes; a pause mid-phrase does not", async () => {
    const h = harness();
    await h.listen({ pauseMs: 1800 });
    h.rec().result([["x equals", false]]);
    h.advance(2000);
    expect(h.vc.snapshot.status).toBe("listening");
    h.rec().result([["x equals five", true]]);
    h.advance(1900);
    expect(h.vc.snapshot.status).toBe("finishing");
    h.rec().onend?.();
    expect(h.completed.map((c) => [c.text, c.meta.endedBy])).toEqual([["x equals five", "pause"]]);
  });

  it("dispose aborts the recognizer and clears timers (unmount / Strict Mode)", async () => {
    const h = harness();
    await h.listen({ pauseMs: 1000 });
    h.rec().result([["x", true]]);
    h.vc.dispose();
    expect(h.rec().aborted).toBe(true);
    expect(h.pending()).toBe(0);
    h.advance(10000);
    expect(h.completed).toEqual([]);
  });
});
