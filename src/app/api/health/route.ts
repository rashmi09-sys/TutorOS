import { NextResponse } from "next/server";
import { providerInfo } from "@/engine/llm/factory";
import { ttsConfig } from "@/lib/server/tts";
import { currentUser, unauthorized } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/**
 * What the signed-in page needs to know: which teacher and which voice are active. Nothing else — no
 * versions, keys, limits, signing modes or provider details. Requires a session.
 */
export async function GET(req: Request) {
  if (!(await currentUser(req))) return unauthorized();
  const p = providerInfo();
  const tts = ttsConfig();
  return NextResponse.json(
    {
      ok: true,
      teacher: p.configured ? { mode: "llm", name: "language model" } : { mode: "deterministic", name: "deterministic" },
      voice: tts.enabled ? { provider: "google-chirp3-hd", voice: tts.voice, limits: { maxCharsPerRequest: tts.maxCharsPerRequest } } : { provider: "browser", voice: null },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
