/**
 * The tutor's cloud voice (Google Chirp 3 HD via @google-cloud/text-to-speech). Never calls Google:
 * the server tests inject a fake client with the same synthesizeSpeech() shape as the official library.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionCookie } from "./helpers/auth";
import { POST as tts } from "@/app/api/tts/route";
import { GET as healthRoute } from "@/app/api/health/route";
import { classifyError, resetTtsState, setTtsClientForTests, ttsConfig, languageCodeOf, type SynthClient } from "@/lib/server/tts";
import { Speaker, enableCloudVoice, type SynthLike, type UtterLike } from "../src/lib/voice/speaker";
import type { AudioLike } from "../src/lib/voice/cloud-voice";

let ipN = 0;
const COOKIE = await sessionCookie();
const req = (body: unknown, ip = `10.77.0.${++ipN}`, cookie: string | null = COOKIE) =>
  new Request("http://x/api/tts", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) });
const health = () => healthRoute(new Request("http://x/api/health", { headers: { cookie: COOKIE } }));

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]);
type Req = Parameters<SynthClient["synthesizeSpeech"]>;
/** A stand-in for TextToSpeechClient: records requests, answers with MP3 bytes (or whatever `respond` does). */
function fakeGoogle(respond: (r: Req) => Promise<unknown> | unknown = () => [{ audioContent: MP3 }]) {
  const calls: Req[] = [];
  setTtsClientForTests({
    synthesizeSpeech: async (...a: Req) => {
      calls.push(a);
      return (await respond(a)) as Awaited<ReturnType<SynthClient["synthesizeSpeech"]>>;
    },
  });
  return calls;
}
const grpcError = (code: number, message = "x") => Object.assign(new Error(message), { code });

beforeEach(() => {
  resetTtsState();
  setTtsClientForTests(null);
  vi.unstubAllEnvs();
  vi.stubEnv("GOOGLE_TTS_ENABLED", "");
  for (const k of ["GCP_PROJECT_NUMBER", "GCP_WORKLOAD_IDENTITY_POOL_ID", "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID", "GCP_SERVICE_ACCOUNT_EMAIL"]) vi.stubEnv(k, "");
});
afterEach(() => {
  setTtsClientForTests(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("config", () => {
  it("defaults: off unless explicitly enabled, Sulafat (en-US), ADC, rate 1, limits", () => {
    const c = ttsConfig({});
    expect(c).toMatchObject({ enabled: false, auth: "adc", voice: "en-US-Chirp3-HD-Sulafat", languageCode: "en-US", speakingRate: 1, maxCharsPerRequest: 1000, maxCharsPerDay: 100000, timeoutMs: 8000 });
    expect(ttsConfig({ GOOGLE_TTS_ENABLED: "true" }).enabled).toBe(true);
    expect(ttsConfig({ GOOGLE_TTS_ENABLED: "yes please" }).enabled).toBe(false);
    expect(ttsConfig({ GOOGLE_TTS_SPEAKING_RATE: "9" }).speakingRate).toBe(2);
    expect(ttsConfig({ GOOGLE_TTS_SPEAKING_RATE: "0.1" }).speakingRate).toBe(0.25);
    expect(languageCodeOf("en-IN-Chirp3-HD-Kore")).toBe("en-IN");
    expect(ttsConfig({ GOOGLE_CLOUD_PROJECT: "p-1" }).projectId).toBe("p-1");
  });
  it("Workload Identity Federation is used only when all four GCP_* variables are set", () => {
    const wif = { GCP_PROJECT_NUMBER: "123", GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel", GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "vercel", GCP_SERVICE_ACCOUNT_EMAIL: "tts@p.iam.gserviceaccount.com" };
    expect(ttsConfig(wif).auth).toBe("vercel-oidc");
    expect(ttsConfig({ ...wif, GCP_SERVICE_ACCOUNT_EMAIL: "" }).auth).toBe("adc");
  });
  it("classifies client-library errors without keeping their messages", () => {
    expect(classifyError(grpcError(8)).kind).toBe("quota");
    expect(classifyError(grpcError(4)).kind).toBe("timeout");
    expect(classifyError(grpcError(16)).kind).toBe("auth");
    expect(classifyError(grpcError(7)).kind).toBe("auth");
    expect(classifyError(new Error("Could not load the default credentials.")).kind).toBe("auth");
    expect(classifyError(grpcError(3)).kind).toBe("upstream");
  });
});

describe("/api/tts and /api/health require a session", () => {
  it("401 without a cookie, with a forged cookie, or with an expired one — and Google is never called", async () => {
    vi.stubEnv("GOOGLE_TTS_ENABLED", "true");
    const calls = fakeGoogle();
    expect((await tts(req({ text: "Hello." }, undefined, null))).status).toBe(401);
    expect((await tts(req({ text: "Hello." }, undefined, await sessionCookie({ secret: "x".repeat(40) })))).status).toBe(401);
    expect((await tts(req({ text: "Hello." }, undefined, await sessionCookie({ ttlS: -10 })))).status).toBe(401);
    expect((await healthRoute(new Request("http://x/api/health"))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("/api/tts when not enabled", () => {
  it("returns 503 {enabled:false, fallback:'browser'} and never touches the client", async () => {
    const calls = fakeGoogle();
    const res = await tts(req({ text: "Hello there." }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ enabled: false, fallback: "browser" });
    expect(calls).toHaveLength(0);
  });
  it("health says browser voice", async () => {
    const d = await (await health()).json();
    expect(d.voice).toEqual({ provider: "browser", voice: null });
  });
});

describe("/api/tts when enabled (fake Google client)", () => {
  beforeEach(() => vi.stubEnv("GOOGLE_TTS_ENABLED", "true"));

  it("asks for MP3 in the Sulafat voice at the right rate, no retries, and returns audio/mpeg", async () => {
    vi.stubEnv("GOOGLE_TTS_SPEAKING_RATE", "1.1");
    const calls = fakeGoogle();
    const res = await tts(req({ text: "3 x plus 5 equals 20", rate: 0.87 }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(MP3);
    expect(calls).toHaveLength(1);
    const [request, options] = calls[0];
    expect(request).toEqual({ input: { text: "3 x plus 5 equals 20" }, voice: { languageCode: "en-US", name: "en-US-Chirp3-HD-Sulafat" }, audioConfig: { audioEncoding: "MP3", speakingRate: 0.96 } });
    expect(options).toMatchObject({ maxRetries: 0, timeout: 8000 });
    const d = await (await health()).json();
    expect(d.voice).toEqual({ provider: "google-chirp3-hd", voice: "en-US-Chirp3-HD-Sulafat", limits: { maxCharsPerRequest: 1000 } });
  });

  it("base64 audio (REST transport) is decoded too", async () => {
    fakeGoogle(() => [{ audioContent: Buffer.from(MP3).toString("base64") }]);
    const res = await tts(req({ text: "Hello." }));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(MP3);
  });

  it("health never shows project numbers, service accounts or pool ids", async () => {
    vi.stubEnv("GCP_PROJECT_NUMBER", "987654321");
    vi.stubEnv("GCP_WORKLOAD_IDENTITY_POOL_ID", "secret-pool");
    vi.stubEnv("GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID", "secret-provider");
    vi.stubEnv("GCP_SERVICE_ACCOUNT_EMAIL", "tts@p.iam.gserviceaccount.com");
    const txt = JSON.stringify(await (await health()).json());
    expect(txt).toContain('"provider":"google-chirp3-hd"');
    for (const s of ["987654321", "secret-pool", "secret-provider", "gserviceaccount", "vercel-oidc", "auth"]) expect(txt).not.toContain(s);
  });

  it("413 on over-long text, with no upstream call", async () => {
    const calls = fakeGoogle();
    const res = await tts(req({ text: "a".repeat(1001) }));
    expect(res.status).toBe(413);
    expect((await res.json()).fallback).toBe("browser");
    expect(calls).toHaveLength(0);
  });

  it("400 on a bad body", async () => {
    const calls = fakeGoogle();
    expect((await tts(req({}))).status).toBe(400);
    expect((await tts(req({ text: "" }))).status).toBe(400);
    expect((await tts(req({ text: "   " }))).status).toBe(400);
    expect((await tts(req({ text: 5 }))).status).toBe(400);
    expect((await tts(req({ text: "hi", rate: 9 }))).status).toBe(400);
    expect((await tts(req("{not json"))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("daily budget: 429 with fallback:'browser' once spent", async () => {
    vi.stubEnv("TTS_MAX_CHARS_PER_DAY", "25");
    const calls = fakeGoogle();
    expect((await tts(req({ text: "Twenty characters!!!" }))).status).toBe(200);
    const res = await tts(req({ text: "Another twenty chars" }));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "daily_budget_exhausted", fallback: "browser" });
    expect(calls).toHaveLength(1);
  });

  it("per-client rate limit: 429 (configurable)", async () => {
    vi.stubEnv("TTS_RATE_LIMIT_PER_MINUTE", "5");
    fakeGoogle();
    let last = 200;
    for (let i = 0; i < 6; i++) last = (await tts(req({ text: `Line ${i}.` }, "10.88.8.8"))).status;
    expect(last).toBe(429);
  });

  it("Google quota exhausted → 429 upstream_quota, fallback browser, budget refunded", async () => {
    vi.stubEnv("TTS_MAX_CHARS_PER_DAY", "10");
    fakeGoogle(() => Promise.reject(grpcError(8, "Quota exceeded for project 123")));
    const res = await tts(req({ text: "Hello." }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toEqual({ error: "upstream_quota", fallback: "browser" });
    expect((await tts(req({ text: "Again." }))).status).toBe(429); // the refund means it's Google's 429, not our budget's
  });

  it("missing or wrong credentials → 502 upstream_auth, and the error text is not returned", async () => {
    fakeGoogle(() => Promise.reject(new Error("Could not load the default credentials. project-c6fd5340")));
    const res = await tts(req({ text: "Hello." }));
    expect(res.status).toBe(502);
    const txt = await res.text();
    expect(JSON.parse(txt)).toEqual({ error: "upstream_auth", fallback: "browser" });
    expect(txt).not.toContain("project-");
  });

  it("other upstream errors → 502 upstream_error", async () => {
    fakeGoogle(() => Promise.reject(grpcError(3)));
    expect((await tts(req({ text: "Hello." }))).status).toBe(502);
    fakeGoogle(() => [{ audioContent: new Uint8Array() }]);
    expect((await tts(req({ text: "Empty." }))).status).toBe(502);
  });

  it("timeout → 504 (our own timer, even if the library never answers)", async () => {
    vi.stubEnv("TTS_TIMEOUT_MS", "20");
    fakeGoogle(() => new Promise(() => {}));
    const res = await tts(req({ text: "Hello." }));
    expect(res.status).toBe(504);
    expect((await res.json()).fallback).toBe("browser");
  });

  it("cache: the same text/voice/rate twice → one upstream call (Replay is free)", async () => {
    const calls = fakeGoogle();
    const a = await tts(req({ text: "Exactly." }));
    const b = await tts(req({ text: "Exactly." }));
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.headers.get("x-tts-cache")).toBe("hit");
    expect(new Uint8Array(await b.arrayBuffer())).toEqual(MP3);
    expect(calls).toHaveLength(1);
    await tts(req({ text: "Exactly.", rate: 0.87 })); // different rate → different audio
    expect(calls).toHaveLength(2);
  });
});

/* ---------------- Client: Speaker cloud mode ---------------- */

class FakeAudio implements AudioLike {
  src = "";
  ended = false;
  paused = true;
  pauses = 0;
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  constructor(private rejectPlay = false) {}
  play() {
    if (this.rejectPlay) return Promise.reject(new Error("NotAllowedError"));
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.pauses++;
  }
}

function client(opts: { fetchMode?: "ok" | "500" | "hang"; rejectPlay?: boolean } = {}) {
  const spoken: UtterLike[] = [];
  const synth: SynthLike = {
    speaking: false,
    pending: false,
    speak(u) {
      spoken.push(u);
    },
    cancel() {},
    getVoices: () => [{ lang: "en-IN", name: "Rishi", localService: true }],
  };
  const timers = { set: () => 0, clear: () => {} }; // timers never fire on their own here
  const sp = new Speaker(synth, (text) => ({ text, rate: 1, pitch: 1, lang: "", voice: null, onstart: null, onend: null, onerror: null, onboundary: null }), timers);
  const audios: FakeAudio[] = [];
  const requests: { body: unknown; signal: AbortSignal }[] = [];
  let mode = opts.fetchMode ?? "ok";
  const fetchImpl = async (_u: string, init: RequestInit) => {
    requests.push({ body: JSON.parse(String(init.body)), signal: init.signal! });
    if (mode === "500") return Response.json({ fallback: "browser" }, { status: 502 });
    if (mode === "hang")
      return new Promise<Response>((_r, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    return new Response(MP3, { headers: { "content-type": "audio/mpeg" } });
  };
  const revoked: string[] = [];
  let n = 0;
  sp.enableCloud({
    fetch: fetchImpl,
    makeAudio: () => {
      const a = new FakeAudio(opts.rejectPlay);
      audios.push(a);
      return a;
    },
    createObjectURL: () => `blob:${++n}`,
    revokeObjectURL: (u) => revoked.push(u),
  });
  const flush = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };
  return { sp, spoken, audios, requests, revoked, flush, setMode: (m: typeof mode) => (mode = m) };
}

describe("Speaker cloud mode", () => {
  it("plays the turn from /api/tts with the browser lifecycle: preparing → speaking → done(true)", async () => {
    const c = client();
    const ev: string[] = [];
    c.sp.speak("t1", "x = −3. Nice.", { rate: 0.8, onStart: () => ev.push("start"), onDone: (d) => ev.push(`done:${d}`) });
    expect(c.sp.snapshot.status).toBe("preparing");
    await c.flush();
    expect(c.requests[0].body).toEqual({ text: "x equals negative 3. Nice.", rate: 0.87 });
    expect(c.audios).toHaveLength(1);
    c.audios[0].onplaying?.();
    expect(c.sp.snapshot.status).toBe("speaking");
    c.audios[0].onended?.();
    expect(ev).toEqual(["start", "done:true"]);
    expect(c.sp.snapshot).toMatchObject({ status: "idle", id: null });
    expect(c.spoken).toHaveLength(0); // the browser voice was not used
    expect(c.revoked).toEqual(["blob:1"]);
  });

  it("speaking a new id cancels the old one: aborted/paused, never two at once, old one never 'finished'", async () => {
    const c = client();
    const a: boolean[] = [];
    const b: boolean[] = [];
    c.sp.speak("t1", "First turn.", { onDone: (d) => a.push(d) });
    await c.flush();
    c.audios[0].onplaying?.();
    c.sp.speak("t2", "Second turn.", { onDone: (d) => b.push(d) });
    expect(a).toEqual([false]);
    expect(c.audios[0].paused).toBe(true);
    expect(c.requests[0].signal.aborted).toBe(true);
    c.audios[0].onended?.(); // late event from the old turn
    await c.flush();
    expect(a).toEqual([false]);
    expect(c.audios).toHaveLength(2);
    expect(c.audios.filter((x) => !x.paused)).toHaveLength(1); // no overlap
    c.audios[1].onplaying?.();
    c.audios[1].onended?.();
    expect(b).toEqual([true]);
  });

  it("the same id is not restarted while it plays", async () => {
    const c = client();
    c.sp.speak("t1", "Hello.");
    await c.flush();
    c.sp.speak("t1", "Hello.");
    await c.flush();
    expect(c.requests).toHaveLength(1);
  });

  it("stop() aborts an in-flight fetch and never reports completion", async () => {
    const c = client({ fetchMode: "hang" });
    const done: boolean[] = [];
    c.sp.speak("t1", "Hello there.", { onDone: (d) => done.push(d) });
    await c.flush();
    c.sp.stop();
    await c.flush();
    expect(c.requests[0].signal.aborted).toBe(true);
    expect(done).toEqual([false]);
    expect(c.spoken).toHaveLength(0); // a stop is not a failure: no browser fallback
    expect(c.sp.cloudEnabled).toBe(true);
  });

  it("stop() while playing pauses the audio; its late `ended` never reports completion", async () => {
    const c = client();
    const done: boolean[] = [];
    c.sp.speak("t1", "Hello there.", { onDone: (d) => done.push(d) });
    await c.flush();
    const au = c.audios[0];
    au.onplaying?.();
    c.sp.stop();
    expect(au.paused).toBe(true);
    au.onended?.();
    expect(done).toEqual([false]);
    expect(c.sp.active).toBe(false);
  });

  it("a failure falls back to the browser voice for that turn", async () => {
    const c = client({ fetchMode: "500" });
    const done: boolean[] = [];
    c.sp.speak("t1", "Nice move. What next?", { onDone: (d) => done.push(d) });
    await c.flush();
    expect(c.spoken.map((u) => u.text.trim())).toEqual(["Nice move.", "What next?"]);
    expect(done).toEqual([]); // still speaking (in the browser voice)
    c.spoken[0].onstart?.();
    c.spoken[0].onend?.();
    c.spoken[1].onend?.();
    expect(done).toEqual([true]);
    expect(c.sp.cloudEnabled).toBe(true); // one failure is not enough to give up
  });

  it("an autoplay rejection also falls back to the browser voice", async () => {
    const c = client({ rejectPlay: true });
    c.sp.speak("t1", "Hello.");
    await c.flush();
    expect(c.spoken).toHaveLength(1);
  });

  it("two consecutive failures switch the cloud voice off for the rest of the session", async () => {
    const c = client({ fetchMode: "500" });
    c.sp.speak("t1", "One.");
    await c.flush();
    c.sp.speak("t2", "Two.");
    await c.flush();
    expect(c.sp.cloudEnabled).toBe(false);
    c.setMode("ok");
    c.sp.speak("t3", "Three.");
    await c.flush();
    expect(c.requests).toHaveLength(2); // t3 went straight to the browser voice
    expect(c.spoken.map((u) => u.text)).toEqual(["One.", "Two.", "Three."]);
    expect(c.sp.enableCloud({ fetch: async () => new Response(), makeAudio: () => new FakeAudio(), createObjectURL: () => "", revokeObjectURL: () => {} })).toBe(false);
  });

  it("text longer than the cloud limit goes to the browser voice (no request)", async () => {
    const c = client();
    c.sp.speak("t1", "word ".repeat(250));
    await c.flush();
    expect(c.requests).toHaveLength(0);
    expect(c.spoken.length).toBeGreaterThan(0);
  });

  it("enableCloudVoice() only turns it on when /api/health reports google-chirp3-hd", async () => {
    const mk = () => new Speaker({ speaking: false, speak() {}, cancel() {}, getVoices: () => [] }, () => ({}) as UtterLike);
    const off = mk();
    const healthFetch = (provider: string) => async () => Response.json({ voice: { provider, voice: provider === "browser" ? null : "en-IN-Chirp3-HD-Sulafat", limits: { maxCharsPerRequest: 400 } } });
    const deps = { makeAudio: () => new FakeAudio(), createObjectURL: () => "", revokeObjectURL: () => {} };
    expect(await enableCloudVoice({ speaker: off, fetch: healthFetch("browser"), ...deps })).toBe(false);
    expect(off.cloudEnabled).toBe(false);
    const on = mk();
    expect(await enableCloudVoice({ speaker: on, fetch: healthFetch("google-chirp3-hd"), ...deps })).toBe(true);
    expect(on.cloudEnabled).toBe(true);
    expect(await enableCloudVoice({ speaker: mk(), fetch: async () => { throw new Error("offline"); }, ...deps })).toBe(false);
  });
});
