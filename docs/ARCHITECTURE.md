# Architecture

TutorOS is one Next.js app (a lesson home, three lessons, an Engineer View) with a framework-free engine (`src/engine/`, ~3,800 lines of TypeScript, no React or vendor SDK imports). Every turn — from the student UI, the console, or the eval runner — goes through the same pure function:

```ts
step(state, event, deps) → { state', utterance, trace, duplicate? }
```

```
Browser (state + HMAC signature + event id)
   │  POST /api/turn
   ▼
Perceive ──► Permit ──► Choose ──► Guard ──► Update
 exact maths   policy     teaching   leaks,    learner state,
 intent        returns    model      false     mastery evidence,
 observation   permitted  (default   maths,    board, phase
 diagnosis     candidates or LLM)    length
   │                                            │
   └──────────────── trace (every stage) ◄──────┘
```

## 0. Understanding what the student says (v3.4: `understand.ts`, `intent.ts`, `engine.ts`)

Every message — typed or the finished words of a spoken one — goes through one pipeline:

```
text / final transcript
  → context        what the tutor's last message asked (awaiting: choose_part | operation | line | …),
                   its last question, the student's last proposal, repeats (state.dialog)
  → interpretation  1. exact maths parser (equations, answers)
                    2. operation lexicon: interpretDeterministic(text, currentEquation, context)
                    3. phrase rules (help, why, repeat, …)
                    4. only if 1–3 don't place it, and an LLM is configured: a structured reading
  → structured meaning   StudentMeaning {act, operation {kind, operand, operandSource, sides, framing},
                         part, mentionsOrderOfOperations, isQuestion, isCorrection, confidence, evidence, source}
  → verification   checkOperation(operation, currentEquation) → correct_next | divide_first |
                   evaluation_order | wrong_inverse | one_side | valid_unhelpful | incomplete,
                   with the exact resulting equation
  → pedagogical decision   policy operationCandidates: one move, one question, built from the
                           current equation and the verdict (R30–R39)
  → response       template (deterministic) or LLM wording inside the guard
  → state update   dialog memory: awaiting, lastQuestion (read from the reply actually sent),
                   lastRule, lastProposal, repeats
```

**Context-relative reading.** "Multiplication" in reply to "Which one would you undo first?" names a *part* of the equation (R38); the same word in reply to "What operation undoes adding 5?" is a *proposal* (R31). "Minus 3" is the answer −3 unless the tutor just asked for an operation or 3 is the constant being undone. A fragment like "both sides" right after "subtract 5 from" is read together with it (`continuation`).

**Memory and repair.** A proposal equal to the last one within four turns is a `repeat`: the tutor says it heard them and connects to their idea (R31b); a third time it names the move directly (R39), still without the result. "No, I meant subtract" is a `correction`: "Got it: subtract, not multiply." If the tutor's previous reply was a generic clarification or redirect and the student restates, the reply starts with an apology (`repair`).

**What the lexicon is.** An explicit list of operation words (including speech-recognition spellings such as "bod mass"), number words, side words, and question/correction markers. It is testable and predictable, and covers the documented phrasings and close variations — it is not general language understanding. Its numbers come from the text; an operand is *inferred* from the equation only when unambiguous (subtract/add → the constant, divide → the coefficient; never for "multiply") and marked `inferred`.

**The LLM's part (optional).** `LlmTeacher.interpret` returns `{kind, request, operation, number, sides, framing, part, mentions_order_of_operations, is_question, is_correction, confidence}` under a strict zod schema. It has no field for correctness. Rejected: unknown fields, labels outside the enums, confidence < 0.6, and **any number the student didn't say**. An accepted reading becomes a `StudentMeaning` with `source: "llm"` and goes through the same `checkOperation`. Timeouts, transport errors and invalid output fall back to the deterministic path (a clarifying question), with the error in the trace. A per-session budget (`LLM_MAX_CALLS_PER_SESSION`, default 150) switches the rest of the lesson to the deterministic teacher.

**Never.** The tutor never advances because a reading said so: board lines and phase change only when the exact parser accepts a line the student wrote. A correct move described in words is confirmed and handed back ("Go ahead: what does the equation become?"); the result is never written for them.

## 0b. Lessons and the shared kernel (v4: `src/engine/subjects/`, `src/components/lesson/`)

Three lessons share one student shell (`LessonShell`) and one request/teaching vocabulary, but **not** a checker:

```
                    ┌─ algebra:  engine.ts step()     → exact equation parser · checkOperation · policy rule table
text / transcript ──┤
 (+ lesson id)      └─ geometry / physics: kernel.ts stepSubject(module)
                         read      shared request phrases → module.read (numbers, units, directions, closed words)
                                   → optional model reading into closed labels (numbers must be in the text)
                         verify    module.verify  — the subject's own exact rule (180°; net force on a line;
                                                    closed list of motion outcomes)
                         decide    module.respond for answers; shared ladder for help (NOTICE → THINK → TRY,
                                   worked solution only after ≥ 2 attempts or 3 help requests, never if "don't tell me")
                         guard     module.leaks(text) — the answer's number / outcome may not appear before it's earned
                         update    records per question: solved, hints, attempts, revealed → "solved alone"
```

Every subject trace has the same shape as an algebra trace (`TurnTrace` with `lesson` and `subjectCheck`), so the Engineer View renders all three lessons with one component. Problems are generated from the session seed with invariants tested over 400 seeds (angles sum to 180; the answer is never one of the givens, which is what makes the leak guard sound).

## 1. Teaching policy (`policy.ts`, `rules.ts`)

The policy is a rule table (rule ids listed with *when / does / why* in `rules.ts` and in the console's *Policy & measurement* tab). Given the perceived observation and the learner state, it returns a **set of permitted candidate decisions**, default first. Each `Decision` carries:

- `action`: one of `ASK · HINT · EXPLAIN · WAIT · VERIFY · RECAP`
- `rule` and a human-readable `reason`
- what may be revealed (`revealAnswer`, `revealStep`) — almost always `false`
- presentation metadata: `anchor` (which board line the note belongs to) and `focus` (which terms to highlight: `x-term`, `constant`, `other-side`, `equals`)

Main behaviours:

| Situation | Rule(s) | Move |
|---|---|---|
| First wrong answer, no recognised pattern | R6 / R6b | Ask how they got it, or check their value by substitution |
| Wrong step matching a known transformation | R5 / R5c | Targeted probe, or a computed check on the student's own line |
| Same misconception on a second problem | R5b | Address it directly instead of re-probing |
| Repeated error | R7 L1→L3, R7b | Hint ladder; contrast after the bottom rung |
| "I'm stuck" / "just tell me" | R8, R9 L1→L3, R9_REVEAL_AFTER_EFFORT | Hint ladder; reveal only after real effort |
| Confusion | R8b | Smaller step |
| Questions about the idea | R18_CONCEPT_* (7 topics) | Deterministic answer about the idea, never the step result |
| "Your answer is wrong" | R19_DISPUTE_* | Re-derive what was actually shown, with its arithmetic |
| `3x + = 20` | R20 | Ask to rewrite; not counted as an attempt |
| "What's 20 − 5?" | R21 | Hand it back |
| Off-topic | R13 | Redirect without answering (scope limit for a children's product) |
| Correct answer, wrong stated reasoning | R17 | Confirm by substitution, name the flaw, record as **assisted** |
| Valid step / solved | R2, R3, R1_* | Acknowledge the operation; move on |
| A move described in words | R30–R36 by exact verdict | Confirm and hand back (R30); BODMAS vs undoing (R31); valid-but-fractions (R32); computed consequence (R33); balance (R34); true-but-unhelpful (R35); which number? (R36) |
| Repeated proposal | R31b, then R39 | Acknowledge and connect; then name the move directly |
| Pointing at a part | R37, R38 | Answer in the context of the tutor's own question |
| Cut off mid-sentence | R22c_INCOMPLETE | Quote it; ask them to finish |

Hints never skip a rung: the next rung is the only hint candidate on offer.

**Micro-teaching stages.** Help is given one stage per turn, and each teaching decision carries `stage`:

| Stage | What it does | Rung | Example (3x + 5 = 20) |
|---|---|---|---|
| NOTICE | Point at the important part | 1 | "Look at the left side, 3x + 5. Two things happen to x… Which would you undo first?" |
| THINK | One guiding question or analogy | 1 | "Think of getting dressed… like taking off your shoes before your socks. Which comes off first?" |
| TRY | Invite one move | 2 | "Try this one move: take 5 away from the left side — and do exactly the same to the right side." |
| (worked step) | Show the next step only | 3 | "If we subtract 5 from both sides, we get 3x = 15." |

The content comes from `src/engine/language/explanations.ts`: several genuinely different explanations per stage, all computed from the current equation. "Explain it another way" (R24) stays at the same stage and rung and picks a different explanation; a small example (R25) uses numbers that never match the student's step or answer. A test checks every variant on 41 problems for leaks, false arithmetic and length.

| New rule | Trigger | Move |
|---|---|---|
| R22_CLARIFY, R22_CLARIFY_WHY | Short unclear input; a bare "why?" with nothing to refer to | One clarifying question (not an attempt) |
| R23_ACK_TRY | "Okay", "got it" | Invite the next line |
| R24_REPHRASE_* | "Explain it another way" | Same help level, new explanation |
| R25_SMALL_EXAMPLE | "Show me a small example" | Worked example on different numbers |
| R26_SLOWER_ONE_IDEA | "Can we go slower?" | One part only; slower read-aloud |
| R27_NO_REVEAL_PREFERENCE | "Don't tell me the answer" | No worked solution this lesson; ladder capped at naming the move |

## 2. Deterministic validation (`algebra.ts`, `fraction.ts`, `intent.ts`, `observe.ts`, `misconceptions.ts`, `reasoning.ts`)

- **Exact arithmetic.** A small parser turns typed or spoken maths ("three x equals fifteen") into linear forms with rational coefficients (`Fraction`, no floats). It solves, checks equivalence of two lines, and normalises orientation (`15 = 3x` ≡ `3x = 15`).
- **Everyday phrases.** `PHRASE_RULES` (`intent.ts`) is an ordered list of explicit regex rules, each with example phrases that double as its unit-test fixture. Maths is always tried first by the exact parser (a phrase rule never reads an equation), except that "I'm stuck on 3x = 15" is help, not a step. Each intent records how it was recognised: `maths parser`, `phrase rule` (+ rule id), `concept rule`, `fallback`, or `llm`.
- **Intent.** Each message is split into clauses; maths clauses are classified by role (solved form > step > bare number) and the rest kept as reasoning claims. Intents: `ANSWER, STEP, HELP_REQUEST, CONFUSED, CONCEPT_QUESTION, ARITHMETIC_QUESTION, DISPUTE, MALFORMED_MATH, REPEAT_REQUEST, EXPLANATION, OFF_TOPIC, EMPTY`.
- **Observed operation (fact).** `observeOperation()` compares the student's line with the previous valid line and states what happened to each side: `− 5 on both sides`, or `left: − 5 · right: + 5`.
- **Inferred misconception (hypothesis).** `diagnoseStep()` matches the student's line against the lines each buggy transformation would produce; `diagnoseValue()` falls back to the implied answer and says so. Ten ids (e.g. `SIGN_ERROR_INVERSE_OP`, `FORGOT_TO_DIVIDE`, `ARITHMETIC_SLIP`, `UNCLASSIFIED`). Confidence is **capped** and means *specificity of the match*, not probability about the child: 0.70 unique step match, 0.45 ambiguous step, 0.55 unique value, 0.35 ambiguous value, 0.40 slip, × 0.6 when only the implied value matched. Every hypothesis carries alternatives (e.g. "a sign slip while writing"). Labels are never shown to the student.
- **Reasoning check.** Stated claims must be true arithmetic using numbers from a valid solution path, or equations equivalent to the problem.
- **Computed checks** shown to the student ("if 3x were 25, the left side would be 25 + 5 = 30, not 20") are calculated, never generated.

## 3. LLM boundaries (`src/engine/llm/`)

The LLM is optional. When configured it does exactly three things:

1. **Choose one of the permitted candidates and word it.** For a move described in words, the prompt's observation includes the student's proposal and the exact verdict (`studentProposal`, `verifiedVerdict`, `repeatedSameProposal`, `correctingThemselves`) — given as facts, not for re-judging. Output is strict JSON `{candidate_id, utterance, rationale}`; `candidate_id` is an enum of the permitted ids, so the model cannot invent a move or skip a hint rung.
2. **Classify a free-text explanation** into a misconception id (enum-constrained; keyword heuristic fallback).
3. **Read unmatched text into a structured meaning** (only when the parser, lexicon and phrase rules didn't place it; never text with `=`): a help request from a fixed list, or an operation/part — see §0. Schema-validated; below 0.6 confidence, "unclear", or an operand the student didn't say → ignored, and the tutor asks a clarifying question. Any operation is verified exactly before the policy decides.

It receives the validator's verdict as input and never produces one. Every utterance passes the **guard** (`guard.ts`): `ANSWER_LEAK`, `STEP_LEAK`, `FALSE_ARITHMETIC`, `UNGROUNDED_EQUATION`, `TOO_LONG`. On rejection: one repair retry with the reasons; then the policy default with templated wording. Transport: per-call timeout with `AbortController`, one retry on timeout/429/5xx, none on other 4xx.

Providers implement one method, `LlmProvider.generateJson()`: `AnthropicProvider` (SDK, forced tool call) and `OpenAICompatibleProvider` (`fetch`, strict `json_schema`). The engine never imports a vendor SDK. Keys are read only on the server (`factory.ts`); the browser receives the provider name and model id, nothing else.

Every call is recorded in the trace as an `LlmCall` with `kind: "model" | "template" | "heuristic"`. Non-model calls report no tokens and `costUsd: null`. Cost is computed only from provider-reported usage **and** configured `PRICE_*` values — never estimated.

## 4. Session management (`src/lib/`, `src/app/api/turn/route.ts`)

- **Stateless server.** The browser holds the session state and an HMAC-SHA256 signature the server issued (`session-token.ts`, key `SESSION_SECRET`). The server verifies the signature over the raw request body, so any edit (e.g. raising `pKnown` in devtools) → `409` and a "start a new lesson" path.
- **Persistence.** `localStorage` key `tutoros.session.v2` (state, signature, traces). Reload resumes; *Delete my data* clears it.
- **Idempotency.** Every event has an id. A duplicate against the post-state is a no-op; a retry against the pre-state recomputes the same turn; the client discards stale responses. One automatic retry on network failure.
- **Cancel.** Aborting a pending turn applies nothing (the server has no state to roll back); the line stays in the input.
- **Limits.** zod input validation, 512 KB body, 500-character messages, 300-turn cap, per-IP rate limits (in-memory, per instance).
- **Logs.** Structured JSON with request id, hashed ids, rule and timings. No student text, no tutor utterances.
- **Health.** `/api/health` reports teacher mode and `degraded` when `SESSION_SECRET` is unset.

## 5. Voice and speech (`src/lib/voice/`)

**Input — `VoiceController`** (framework-free, injectable recognizer, unit-tested):

```
idle → requesting → listening → finishing → completed
            ↘ denied | unavailable       ↘ cancelled   (✕ / Esc: discarded, never submitted)
listening → interrupted   (browser ended the session; transcript kept; Keep talking / Send)
any → error | unsupported
```

- One recognizer at a time. Starting a session detaches the previous recognizer's handlers; every event is checked against the current session id, so late events can't change state.
- `continuous = true`, `interimResults = true`. Finals are stored by (segment, result index), so duplicate events apply once; the phrase in progress is kept separately and shown lighter.
- Nothing is sent until **Done**. `onComplete` fires at most once per session. (The controller can also finish on a pause, but the app never enables it: the mic opens only from a tap and never reopens by itself.)
- If the browser ends a session on its own, it is resumed silently at most twice per session (never after an error, never within 300 ms of starting). After that, the *interrupted* state keeps the words and offers one-tap resume.
- Permission is requested with `getUserMedia` first, so "blocked" and "no microphone" are distinguishable; failures are terminal until the student taps again (no loops).
- `useVoiceInput` creates the controller in an effect and disposes it in the cleanup (React Strict Mode safe). Callbacks are read from refs, so renders never touch the microphone.

**Output — `Speaker`** (one per page, `browserSpeaker()`; the React hook only subscribes):

```
idle ──speak(id)──▶ preparing (voices loading) ──▶ speaking ──▶ idle (finished)
                                                       └── stop() ──▶ idle (stopped)
```

- Stable turn ids: speaking the id already playing is a no-op; Replay forces a restart. Turn ids the page has handled are kept in `sessionStorage`, so reloads, navigation and Strict Mode remounts never replay a turn.
- All sentences of a turn are queued with the browser at once (no gaps from JavaScript round trips); the browser plays them back to back.
- One voice per page, chosen after `voiceschanged` (1.5 s timeout), preferring on-device English voices.
- Strong references to queued utterances, plus a watchdog that finishes a turn if the browser goes quiet without firing `end`.
- Cancelled turns never report "finished"; events from older turns are ignored. Speech errors can't crash the page.
- The app speaks only a turn the student just caused on this page, and only if sound is on. Opening the mic stops speech and waits 250 ms for the echo to die away. Leaving the page stops speech.

Each spoken turn sends `voice` metadata (segments, interim updates, duplicates ignored, silent resumes, duration, how it ended) with the event; the console shows it. It is never used for teaching.

## 6. Mastery measurement (`mastery.ts`)

Bayesian Knowledge Tracing with conventional priors (P(L₀)=0.3, P(T)=0.15, P(slip)=0.1, P(guess)=0.2 — not fitted). Evidence comes **only** from unassisted first attempts: the guided problem's first attempt (pre-check) and each fresh problem's first attempt. Help or confusion before attempting a fresh problem counts as an unsuccessful attempt. Finishing with hints, a reveal or flawed reasoning is *assisted* and never evidence.

**Mastered** = P(known) ≥ 0.9 **and** two consecutive independent solves on fresh problems. Fewer than two fresh observations = `insufficient_evidence`. Up to four fresh problems per lesson.

## 7. Evaluation design (`src/engine/eval/`, `scripts/run-eval.ts`, `/api/eval`)

- **50 scenarios** script the *student* (6 cover everyday language; 19 `conv-*` cover conversation: the reported BODMAS exchange, moves in words, wrong inverse, one side, divide first, repeats, corrections, speech-recognition spellings, ambiguous numbers, frustration, "why" after an explanation, stronger hints, answer-reveal attempts, multi-turn continuity, unexpected correct answers, cut-off and continued sentences, voice/text switching, "go back"); the *tutor* is the real `step()`. No parallel implementation. Model failures and timeouts are covered by unit tests with fake providers (a scenario can't inject a transport failure).
- **Assertions are properties**, tagged by category — `leak, math, diagnosis, appropriateness, recovery, mastery, robustness` — and accept any move the policy permits, so the same suite runs against templates and an LLM.
- **Three policies:**
  - **A** — baseline answer-giver (negative control): same perception and measurement, always explains the full solution.
  - **B** — tutor-v1, deterministic teacher.
  - **C** — tutor-v1 with the LLM teacher. **Runs only when a provider is configured; otherwise reported as `not run`. Never simulated.**
- **Metrics:** scenarios and assertions passed, scenarios with an answer leak, false maths stated, per-category pass rates, latency p50/p95, model calls, tokens, cost (only if priced).
- Run from the CLI (`npm run eval`, writes `eval-results.json`, exits 1 if B fails any scenario) or the console's *Eval lab* (scenario × policy matrix with a failure inspector). In production `/api/eval` requires the `x-eval-token` header for C, because it costs money.

## Code map

```
src/engine/            algebra, fraction, intent, observe, misconceptions, reasoning,
                       policy, rules, guard, mastery, engine, store, problems, types
  language/templates.ts  deterministic wording
  llm/                   provider.ts, anthropic.ts, openai.ts, teacher.ts, factory.ts
  understand.ts          moves in words → StudentMeaning; checkOperation
  eval/                  scenarios.ts (50), runner.ts
src/app/               /, /console, /api/turn, /api/eval, /api/health, error boundaries
src/components/        StudentApp + student/* (notebook, margin notes, next line), ConsoleApp
src/lib/               useTutorSession, storage, helpOptions, terms; voice/ (controller, speaker, hooks); server/ (signing, rate limit, logs)
src/engine/language/   templates.ts, explanations.ts (NOTICE / THINK / TRY / examples)
tests/                 vitest (13 files)     e2e/   Playwright (4 files + fixtures)
scripts/               run-eval.ts, probe.ts
```
