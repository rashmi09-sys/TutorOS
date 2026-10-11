# Integrating the engine into another app

TutorOS assumes nothing about a host app's internals. Two ways in.

## 1. HTTP (e.g. from an Android app)

Every call needs a session: sign in first with `POST /api/auth/login` `{ "username", "password" }` and send the `tutoros_auth` cookie it sets. State-changing calls must also send this site's `Origin` header (CSRF protection). Without a session: `401 {"error":"unauthorized"}`. See [SECURITY.md](SECURITY.md).

`POST /api/turn`

```json
{
  "lesson": "algebra",
  "sealed": null,
  "event": { "type": "start", "id": "6f1c0a9e-…" },
  "mode": "llm"
}
```

- `sealed`: send back exactly what the previous response returned: an opaque, encrypted state blob bound to the lesson and the signed-in user. An edited or swapped blob gets `409 session_unverifiable`.
- `event.id`: a client-generated id per event (6–64 chars `[A-Za-z0-9_-]`). Resending an applied event against the returned state is a no-op (`duplicate: true`); retrying against the previous state after a lost response is safe.
- `mode` (optional): `"deterministic"` forces the rule-table default even when an LLM is configured.

Events:

```ts
{ type: "start", id? }
{ type: "text", text: string /* 1–500 chars */, via: "keyboard" | "voice", interruptedTutor?: boolean, id? }
{ type: "silence", ms: number, id? }
```

Response `200`:

```json
{
  "view": { "...": "redacted lesson state for drawing: board, transcript (with display cues), problems reached, mastery" },
  "sealed": "s1.…",
  "utterance": "Let's solve 3x + 5 = 20 together. Where would you start?",
  "turnId": "ses_…-t1",
  "duplicate": false,
  "teacher": { "mode": "deterministic", "name": "deterministic" },
  "requestId": "req_1a2b3c4d"
}
```

Headers: `x-request-id`, `cache-control: no-store`.
Errors (generic bodies, no internals): `400` invalid input, `401` no session, `403` wrong or missing Origin, `409` unverifiable session, `413` body too large, `429` rate limited (`retry-after`), `500` with a request id.

What the host renders: `utterance` (speak/show), `view.board` (whiteboard entries: `latex`, `status` given|valid|invalid|info|final, `note`), `view.transcript` (each tutor message's `action`, `stage` and `cue`), `view.mastery` (progress). The decision trace stays on the server; use the embedded engine (below) to read it.

`GET /api/health` (signed in) reports which teacher and which voice are active.

## 2. Embed the engine (TypeScript / Node)

```ts
import { createSession, step, DeterministicTeacher, LlmTeacher, AnthropicProvider } from "@/engine";

const teacher = process.env.ANTHROPIC_API_KEY
  ? new LlmTeacher(new AnthropicProvider(process.env.ANTHROPIC_API_KEY, { model: "claude-haiku-5-5", timeoutMs: 8000, transportRetries: 1, priceInPerMTok: null, priceOutPerMTok: null }))
  : new DeterministicTeacher();

let r = await step(createSession({ sessionId: "abc" }), { type: "start" }, { teacher });
r = await step(r.state, { type: "text", text: "x = 8", via: "voice" }, { teacher });
console.log(r.utterance, r.trace.decision.rule, r.trace.decisionSource);
```

- New model vendor: implement `LlmProvider.generateJson()` (`src/engine/llm/provider.ts`) — one class.
- Persistence: implement `SessionStore` (`load`, `save`); traces are JSON documents suitable for a `jsonb` column.

## Production notes (proposed, not built)
- Server-side state behind `SessionStore` (Postgres) with per-user accounts; keep the sealed blob for offline clients.
- Stream the guarded first sentence to TTS while the rest is generated.
- Ship traces to the existing observability stack; alert on fallback rate and guard-rejection rate per model version.
- Gate prompt/model changes in CI on `npm run eval` (exits non-zero if policy B fails; add a threshold for C).
