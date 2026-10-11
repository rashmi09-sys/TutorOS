/**
 * Client side of the optional cloud voice (Google Chirp 3 HD via our own /api/tts).
 * Pure plumbing with injectable dependencies; the lifecycle lives in `Speaker` (speaker.ts).
 * Google credentials never reach the browser: the client only ever talks to /api/tts.
 */

/** The parts of HTMLAudioElement the Speaker uses (injectable for tests). */
export interface AudioLike {
  src: string;
  play(): Promise<void> | void;
  pause(): void;
  readonly ended?: boolean;
  onplaying: (() => void) | null;
  onended: (() => void) | null;
  onerror: ((e?: unknown) => void) | null;
  removeAttribute?(name: string): void;
  load?(): void;
}

export interface CloudVoiceDeps {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  makeAudio: () => AudioLike;
  createObjectURL: (b: Blob) => string;
  revokeObjectURL: (url: string) => void;
}

export interface CloudVoiceOptions extends Partial<CloudVoiceDeps> {
  /** Endpoint (default "/api/tts"). */
  endpoint?: string;
  /** Longer turns are spoken by the browser voice (the server would answer 413). Default 1000. */
  maxChars?: number;
  /** Client-side abort if /api/tts has not answered (default 10 000 ms; the server's own timeout is shorter). */
  timeoutMs?: number;
  /** Consecutive failures after which the cloud voice is switched off for this page session (default 2). */
  maxFailures?: number;
  /** Shown in SpeechState.voice while the cloud voice is in use. */
  label?: string;
}

export type ResolvedCloudVoice = CloudVoiceDeps & Required<Pick<CloudVoiceOptions, "endpoint" | "maxChars" | "timeoutMs" | "maxFailures" | "label">>;

/** Real browser dependencies; null outside a browser. */
export function browserCloudDeps(): CloudVoiceDeps | null {
  if (typeof window === "undefined" || typeof Audio === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) return null;
  return {
    fetch: (i, init) => window.fetch(i, init),
    makeAudio: () => new Audio() as unknown as AudioLike,
    createObjectURL: (b) => URL.createObjectURL(b),
    revokeObjectURL: (u) => URL.revokeObjectURL(u),
  };
}

export function resolveCloudVoice(opts: CloudVoiceOptions = {}): ResolvedCloudVoice | null {
  const base = browserCloudDeps();
  const fetchImpl = opts.fetch ?? base?.fetch;
  const makeAudio = opts.makeAudio ?? base?.makeAudio;
  const createObjectURL = opts.createObjectURL ?? base?.createObjectURL;
  const revokeObjectURL = opts.revokeObjectURL ?? base?.revokeObjectURL;
  if (!fetchImpl || !makeAudio || !createObjectURL || !revokeObjectURL) return null;
  return {
    fetch: fetchImpl,
    makeAudio,
    createObjectURL,
    revokeObjectURL,
    endpoint: opts.endpoint ?? "/api/tts",
    maxChars: opts.maxChars ?? 1000,
    timeoutMs: opts.timeoutMs ?? 10_000,
    maxFailures: opts.maxFailures ?? 2,
    label: opts.label ?? "Google Chirp 3 HD (cloud)",
  };
}

/** Fetch MP3 audio for `text`. Throws on any non-200, empty or non-audio answer, or abort. */
export async function fetchCloudAudio(cv: ResolvedCloudVoice, text: string, pace: number | undefined, signal: AbortSignal): Promise<Blob> {
  const res = await cv.fetch(cv.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(pace != null ? { text, rate: pace } : { text }),
    signal,
  });
  if (!res.ok) throw new Error(`tts ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!/audio\//i.test(type)) throw new Error("tts: not audio");
  const blob = await res.blob();
  if (!blob.size) throw new Error("tts: empty");
  return blob;
}

/** Shape of `voice` in /api/health. */
export interface HealthVoice {
  provider: "google-chirp3-hd" | "browser";
  voice: string | null;
  limits?: { maxCharsPerRequest?: number };
}
