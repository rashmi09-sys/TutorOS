"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VoiceController, browserVoiceEnv, type VoiceMeta, type VoiceSnapshot } from "./controller";
import { browserSpeaker, enableCloudVoice, type Speaker, type SpeechState } from "./speaker";

/**
 * One VoiceController per mounted page. It is created in an effect and disposed in the cleanup,
 * so React Strict Mode's mount → unmount → mount creates two controllers, never two live
 * recognizers (nothing listens until start()). Ordinary renders never touch the microphone:
 * callbacks are read from refs, so the controller is never recreated.
 */
export function useVoiceInput(opts: { onComplete: (text: string, meta: VoiceMeta) => void; beforeStart?: () => Promise<void> | void }) {
  const [snap, setSnap] = useState<VoiceSnapshot>({ status: "idle", finalText: "", interim: "", session: 0 });
  const [supported, setSupported] = useState(false);
  const vcRef = useRef<VoiceController | null>(null);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  useEffect(() => {
    const vc = new VoiceController(browserVoiceEnv(), {
      onChange: setSnap,
      onComplete: (text, meta) => optsRef.current.onComplete(text, meta),
      beforeStart: () => optsRef.current.beforeStart?.(),
    });
    vcRef.current = vc;
    // Sync the initial snapshot (e.g. "unsupported") once the browser APIs are known.
    queueMicrotask(() => {
      if (vcRef.current !== vc) return;
      setSupported(vc.supported);
      setSnap(vc.snapshot);
    });
    return () => {
      vc.dispose();
      if (vcRef.current === vc) vcRef.current = null;
    };
  }, []);

  const start = useCallback((o?: { resume?: boolean; pauseMs?: number | null }) => vcRef.current?.start(o), []);
  const done = useCallback(() => vcRef.current?.done(), []);
  const cancel = useCallback(() => vcRef.current?.cancel(), []);
  /** Stop listening without sending, with a status message saying where the words went. */
  const cancelWith = useCallback((message: string) => vcRef.current?.cancel(message), []);
  const reset = useCallback(() => vcRef.current?.reset(), []);
  return { snap, supported, start, done, cancel, cancelWith, reset };
}

/**
 * The tutor's voice: the page's single speech controller (see speaker.ts). The hook only subscribes to
 * it, so React Strict Mode's double effects, re-renders or remounts can never create a second speaker
 * or replay a turn. Leaving the student page stops speech.
 */
export function useSpeaker() {
  const ref = useRef<Speaker | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [state, setState] = useState<SpeechState>({ status: "idle", id: null, voice: null });
  useEffect(() => {
    const sp = browserSpeaker();
    ref.current = sp;
    // The tutor's voice is Google Chirp 3 HD when the server reports it configured; otherwise, and on any
    // failure, the browser's own voice is used. Never throws.
    void enableCloudVoice({ speaker: sp }).then((on) => on && setSupported(true));
    const unsub = sp.subscribe(setState);
    queueMicrotask(() => setSupported(sp.supported));
    return () => {
      unsub();
      sp.stop();
    };
  }, []);
  return { ref, supported, state };
}
