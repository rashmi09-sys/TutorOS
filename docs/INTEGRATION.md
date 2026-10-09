# Integrating the engine into another app

TutorOS assumes nothing about a host app's internals. Two ways in.

## 1. HTTP (e.g. from an Android app)

`POST /api/turn`

```json
{
  "state": null,
  "stateSig": null,
  "event": { "type": "start", "id": "6f1c0a9e-…" },
  "mode": "llm"
}
```

- `state` / `stateSig`: send back exactly what the previous response returned (the server verifies an HMAC; edited state → `409 session_unverifiable`).
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
  "state": { "...": "opaque SessionState" },
  "stateSig": "base64url-hmac",
  "utterance": "Let's solve 3x + 5 = 20 together. Where would you start?",
  "trace": { "turnId": "ses_…-t1", "decision": { "action": "ASK", "rule": "R0_PRESENT_PROBLEM" }, "candidates": [ … ], "decisionSource": "policy-default", "llmCalls": [ … ] },
  "duplicate": false,
  "teacher": { "mode": "deterministic", "name": "deterministic (rule table + templates)" },
  "requestId": "req_1a2b3c4d"
}
```

Headers: `x-request-id`, `x-trace-id` (= `trace.turnId`), `cache-control: no-store`.
Errors: `400` invalid input, `409` unverifiable session, `413` body too large, `429` rate limited (`retry-after`), `500` with a request id.

What the host renders: `utterance` (speak/show), `state.board` (whiteboard entries: `latex`, `status` given|valid|invalid|info|final, `note`), `trace.decision.action` (UI affordances), `state.mastery` (progress).

`POST /api/eval` `{ "suites": ["A","B","C"] }` runs the scenario suite live. `GET /api/health` reports teacher mode, pricing and signing configuration.

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
- Server-side state behind `SessionStore` (Postgres) with auth; keep the HMAC for offline clients.
- Stream the guarded first sentence to TTS while the rest is generated.
- Ship traces to the existing observability stack; alert on fallback rate and guard-rejection rate per model version.
- Gate prompt/model changes in CI on `npm run eval` (exits non-zero if policy B fails; add a threshold for C).
