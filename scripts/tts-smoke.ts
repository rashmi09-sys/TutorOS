/**
 * Local check of the real Google voice through the same code path as /api/tts (no browser, no server).
 *   gcloud auth application-default login            # once
 *   GOOGLE_TTS_ENABLED=true GOOGLE_CLOUD_PROJECT=<project-id> npm run tts:smoke
 * Writes one short MP3 to your temp folder and prints where. Costs a few characters of Chirp 3 HD quota.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { synthesize, ttsConfig } from "../src/lib/server/tts";

(async () => {
  const cfg = ttsConfig();
  if (!cfg.enabled) {
    console.error("Set GOOGLE_TTS_ENABLED=true (and GOOGLE_CLOUD_PROJECT) first.");
    process.exit(1);
  }
  const text = "Okay, that didn't land. Let me try it another way.";
  const t0 = Date.now();
  const r = await synthesize(text, 1, cfg);
  if (!r.ok) {
    console.error(`Failed: ${r.kind}${r.code != null ? ` (code ${r.code})` : ""}. ${r.kind === "auth" ? "Run `gcloud auth application-default login` and check the project has the Text-to-Speech API enabled." : ""}`);
    process.exit(1);
  }
  const out = join(tmpdir(), "tutoros-sulafat.mp3");
  writeFileSync(out, r.audio);
  console.log(`OK: ${cfg.voice} via ${cfg.auth}, ${r.audio.length} bytes in ${Date.now() - t0} ms → ${out}`);
})();
