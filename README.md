# TutorOS — an AI tutor that teaches instead of answering

**Live demo:** https://tutoros-dusky.vercel.app/ · Algebra lesson: https://tutoros-dusky.vercel.app/learn/algebra

## Overview

TutorOS is a 1:1 tutor for a Grade 7 student, built around a shared whiteboard and a conversation (typed or spoken). Its main lesson is two-step linear equations: the student works through **3x + 5 = 20** with the tutor, then solves **4x + 3 = 19** on their own, and the lesson ends with a plain record of what happened. Two shorter lessons (forces and balance; angles in a triangle) run on the same tutoring kernel. Every turn produces a full trace (what the student said, how it was checked, which rule fired and why), which the tests and the evaluation suites use; it is not shown to students.

## The problem

A general chatbot is helpful in the wrong way: asked about a maths problem, it solves it. That [measurably hurts later independent performance](https://ideas.repec.org/a/nas/journl/v122y2025pe2422633122.html). A tutor has to make different decisions on every turn — **ask, hint, explain, wait or assess** — and it has to be right about the maths every time. TutorOS treats those as separate jobs so each can be tested:

| Job | Who does it | Why |
|---|---|---|
| Is the maths right? Why is it wrong? | **Deterministic checking**: exact-rational parser/solver, step-level misconception matching, reasoning checks | Correctness must never depend on a model. |
| Which moves are allowed now? | **Teaching policy** (rule table) → a set of *permitted* decisions, each tagged ASK / HINT / EXPLAIN / WAIT / VERIFY / ASSESS / RECAP | Pedagogy you can diff, test and compare. Fixes reveal rules and hint progression. |
| Which permitted move, and in what words? | **LLM** (if configured) — or the policy's default + templates | Adapts to the student's words, inside the fence. |
| Is what the tutor says safe to say? | **Guard** on every reply: answer/step leaks, false arithmetic, ungrounded equations, length | One repair retry, then deterministic fallback. |
| Has the student learned it? | **Evidence from independent first attempts only** | Help-assisted success never counts. |

## Key implemented features

- **One complete algebra journey** (below), adaptive to what the student actually writes: wrong steps are diagnosed (e.g. "added 5 instead of subtracting"), equivalent forms are accepted (`15 = 3x`, `3x=15`, "three x equals fifteen"), off-topic messages don't move the lesson, and the answer is never given before the student has tried.
- **The whiteboard is the lesson state.** Each accepted line is joined by the operation the student performed ("− 5 on both sides"); rejected lines are struck through with what was actually done to each side; the terms the tutor is talking about are highlighted on the board. The text, the read-aloud voice and the highlights all come from the same server response for the same turn.
- **Teaching decisions from a teaching memory.** Each turn the policy picks one move — ASK, HINT, EXPLAIN, VISUALIZE, WAIT, RETEACH, ASSESS, ENCOURAGE or CLARIFY — from what the student just did *and* what has already been tried: how many times in a row they've been stuck, which approaches were used, whether they asked for the answer, their last verified line. Repeated "I don't know" gets a different approach each time (a smaller question → an analogy → a picture on the whiteboard → the first move worked, the student does the next), in all three lessons; the same mistake twice switches strategy; "I hate algebra" or "this is boring" gets a short, kind acknowledgement (light humour only about the subject, none when a student is worried) and the question back; "let me think" makes the tutor wait. An anti-repetition check means it never says the same thing twice on a problem.
- **A hint ladder** (NOTICE → THINK → TRY → show the step) driven by the student's responses, not a fixed script. Everyday phrases ("I'm stuck", "why?", "explain it another way", "don't tell me the answer") and moves described in words ("take five away", "BODMAS multiplication first") are understood and checked exactly.
- **Independent check and grounded assessment.** After the guided problem the tutor gives **4x + 3 = 19** to do alone, then one more fresh problem. The end screen shows a "What I saw" table built only from recorded session data: the lines written, lines that needed fixing, hints given, and whether the first try on each fresh problem was right — plus a note that this shows today's performance, not long-term retention.
- **An interactive whiteboard that follows the verified state.** The balance (bags of x and blocks, drawn from the current verified line and removed as soon as the line changes); "Pick a move" choices on the guided problem after the student hesitates (sent as words and checked like typing, so a wrong move gets its computed result); force arrows to tap when the tutor asks which push is stronger; angles to tap and a 180° strip in geometry; a box that drifts with the net force in the physics explorer.
- **Three stages in every lesson:** guided → independent (same idea, new numbers: 4x + 3 = 19) → transfer (a new twist). Guided and unaided performance are recorded and shown separately.
- **Voice.** Speech input and read-aloud use the browser's built-in Web Speech API by default. The tutor's voice is **Google Cloud Chirp 3 HD (Sulafat)** through the official `@google-cloud/text-to-speech` library behind `/api/tts` — Application Default Credentials locally, Workload Identity Federation on Vercel, no keys anywhere, rate limits and character caps, and the browser voice as the fallback for any failure. It is on when `GOOGLE_TTS_ENABLED=true`; real audio hasn't been produced in this repository's test environment (no Google credentials there) ([docs/VOICE.md](docs/VOICE.md)). Nothing plays until the student chooses; Stop and Replay; opening the mic stops the tutor first. Typing does everything voice does.
- **A student-only app.** A short welcome ("Ready to figure this out?", **Start Lesson**, a Sound on/off toggle), then the lesson. Three stages, named for the student: **Learn Together** (guided), **Try It Yourself** (a new problem, unaided), **Challenge Yourself** (a different twist). The engineering console that earlier versions had (`/console`, `/api/eval`) has been removed from the app; the evaluation suites run from the command line (`npm run eval`) and the architecture is described below and in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **Reliability:** signed client-held session state (tampering is refused), idempotent turns, timeouts and fallbacks for model calls, rate limits, per-lesson saved progress with Continue / Start again.

## The tutoring journey (algebra)

1. The student opens **Two-step equations** and chooses *Start the lesson* (read aloud) or *Read without sound*.
2. The tutor introduces **3x + 5 = 20**; it's written on the whiteboard and the tutor asks for a first step.
3. The student makes a plausible mistake — say `3x = 25`. The line is struck through on the board with what was actually done ("left − 5 · right + 5"), and the tutor asks a targeted question pointing at the **+ 5** (highlighted on the board) without giving the step.
4. If they're still unsure, help changes approach each time rather than repeating: a smaller question, an analogy ("taking off your shoes before your socks"), then **the balance** on the whiteboard — and on the board they can pick a move to try. "I'm sure 3x = 25 is right" gets a computed check (25 + 5 = 30, not 20); writing the same line a third time switches to the balance.
5. The student writes `3x = 15` (or `15 = 3x`); it's accepted and joined to the line above by "− 5 on both sides". Then `x = 5`.
6. The tutor marks the problem *solved with help* and gives **4x + 3 = 19** to try on their own (an ASSESS move).
7. The student solves it; their first attempt is recorded as independent evidence only if they didn't ask for help first. Then **a new twist** (something taken away, or the number first) — the transfer problem.
8. The end screen: a verdict that depends on the independent attempts, the "What I saw" table, and the two moves practised.

## Technology stack

Next.js 15 (App Router) · React 19 · TypeScript · zod · KaTeX · Web Speech API (browser) · Google Cloud Text-to-Speech (`@google-cloud/text-to-speech`, `google-auth-library`, `@vercel/oidc` for federation) · Lexend and Bricolage Grotesque via @fontsource · Vitest · Playwright · ESLint 9. Optional LLM providers: Anthropic SDK or any OpenAI-compatible endpoint. No database: session state lives in the browser, signed by the server. Deployed on Vercel.

> Version history. **v7** (10 Oct 2026): the engineering console and `/api/eval` removed from the app; a welcome state with Start Lesson and a sound toggle; the stages renamed Learn Together / Try It Yourself / Challenge Yourself; shorter tutor replies; a bare "why?" in physics and geometry now explains the tutor's latest step. **v6.1**: Google Chirp 3 HD (Sulafat) voice. **v6** (10 Oct 2026): a teaching memory and strategy ladder for repeated confusion in all three lessons, new actions (VISUALIZE, RETEACH, ENCOURAGE, CLARIFY, WAIT on request), feelings and answer requests handled, anti-repetition, the interactive whiteboard (balance, move choices, tappable arrows and angles), guided → independent → transfer in every lesson, the optional Chirp 3 HD voice, and evaluation categories for context, language and repetition ([docs/AUDIT.md](docs/AUDIT.md#v6-audit-does-it-teach-like-a-teacher-10-oct-2026), [docs/EVALUATION.md](docs/EVALUATION.md)). **v5** (10 Oct 2026): ASSESS as a teaching action, 4x + 3 = 19 as the fixed first independent problem, the "What I saw" evidence table, a brighter whiteboard look with new typefaces, and the Engineer view moved into the lesson Menu. **v4** (9 Oct 2026): a lesson home screen, two new lessons — physics (forces and balance) and geometry (angles in a triangle), each with its own exact verifier on a shared tutoring kernel — and a redesigned Engineer View ([docs/AUDIT.md](docs/AUDIT.md#v4-lessons-and-engineer-view)). **v3.4** (8 Oct 2026): the tutor understands moves described in words — "I'll do BODMAS multiplication", "take five away", "move the 5 to the other side", "no, I meant subtract" — reads them against the current equation and its own last question, verifies them exactly, remembers what was said, and repairs when a student repeats themselves ([docs/AUDIT.md](docs/AUDIT.md#conversational-understanding-v34)). **v3.3** (8 Oct 2026): audio under the student's control — start screen, Stop/Replay, a single speech controller that fixes the stutter ([docs/AUDIT.md](docs/AUDIT.md#tutor-speech-stutter-and-unexpected-audio-v33)). **v3.2**: visual refinement — two-panel workspace, full conversation, one type system ([docs/DESIGN.md](docs/DESIGN.md#v32-visual-refinement)). **v3.1**: voice input rebuilt as a state machine, natural student language, progressive NOTICE → THINK → TRY teaching ([docs/AUDIT.md](docs/AUDIT.md#voice-and-teaching-intelligence-upgrade-8-oct-2026)). What is and isn't verified: [docs/LIMITATIONS.md](docs/LIMITATIONS.md). v2 fixed correctness after a self-audit ([docs/AUDIT.md](docs/AUDIT.md)); v3 redesigns the interaction around a single exercise-book page with the tutor writing in the margin, separates *observed* operations from *inferred* misconceptions, and rebuilds the console as a decision debugger ([docs/DESIGN.md](docs/DESIGN.md)). Before/after: `docs/screenshots/compare-*.png`.

---

## Local installation

Works fine on a MacBook Air M1, 8 GB.

Requires Node.js 20.12+ (tested on 22) and npm.

```bash
npm install
cp .env.example .env.local     # optional — every variable is optional for local use
npm run dev                    # http://localhost:3000 (home) · /learn/algebra · /learn/physics · /learn/geometry
```

Production mode: `npm run build && npm start` (port 3000; `npm start -- -p 3100` for another).

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` / `npm start` | Production build / serve it |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm test` | Unit + integration tests (vitest) |
| `npm run test:e2e` | Browser tests (Playwright). Builds and starts the app on port 3100 unless `E2E_BASE_URL` points at a running one. First time: `npx playwright install chromium` |
| `npm run eval` | Algebra policy comparison A/B/C on 50 scenarios, plus the geometry (G, 14) and physics (P, 11) suites; writes `eval-results.json` |
| `npx tsx scripts/ui-audit.ts` | Visual audit against a running server (`BASE=http://localhost:3000`): screenshots every screen at 320–1440 px and 200 % zoom, reports overflow, clipped text and overlapping controls |

## Environment variables

All optional for local use. Names and comments are in [`.env.example`](.env.example); put values in `.env.local` (git-ignored, read by Next.js and by `npm run eval`). Keys are only read on the server.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables the LLM teacher via Anthropic (default model `claude-haiku-5-5`) |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL` | Enables it via any OpenAI-compatible endpoint (set `LLM_MODEL` too) |
| `LLM_PROVIDER`, `LLM_MODEL` | Choose provider / model explicitly |
| `LLM_TIMEOUT_MS` | Per-call timeout (default 8000) |
| `LLM_MAX_CALLS_PER_SESSION` | Cost cap: model calls one lesson may make; after that the lesson continues deterministically (default 150) |
| `PRICE_INPUT_PER_MTOK`, `PRICE_OUTPUT_PER_MTOK` | USD per million tokens; without them cost is shown as unknown, never guessed |
| `SESSION_SECRET` | HMAC key (32+ chars) for signing session state. **Required in production**; without it a fixed dev key is used and `/api/health` reports `degraded` |
| `GOOGLE_TTS_ENABLED`, `GOOGLE_CLOUD_PROJECT` | `true` turns on the Google Chirp 3 HD voice (a **paid** API) for that project. Local auth: Application Default Credentials (`gcloud auth application-default login`) — no keys |
| `GOOGLE_TTS_VOICE`, `GOOGLE_TTS_SPEAKING_RATE` | Voice (default `en-US-Chirp3-HD-Sulafat`) and pace (default 1.0) |
| `TTS_MAX_CHARS_PER_REQUEST`, `TTS_MAX_CHARS_PER_DAY`, `TTS_RATE_LIMIT_PER_MINUTE`, `TTS_TIMEOUT_MS` | Cost and reliability caps (defaults 1000, 100000, 30, 8000); over a cap the browser voice is used |
| `GCP_PROJECT_NUMBER`, `GCP_WORKLOAD_IDENTITY_POOL_ID`, `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID`, `GCP_SERVICE_ACCOUNT_EMAIL` (`GCP_OIDC_AUDIENCE`) | Vercel only: Workload Identity Federation with Vercel's OIDC token — short-lived credentials, no key files. Setup: [docs/VOICE.md](docs/VOICE.md#production-on-vercel-workload-identity-federation-short-lived-credentials) |

- **No key → Deterministic mode**, stated in the student **Menu** (the lesson itself doesn't advertise the engine). Perception, policy, guard and mastery are all real; the policy's default move is always taken and wording comes from templates. No model calls are made or reported.
- **With `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` + `LLM_MODEL`)** → LLM mode: the model chooses among permitted moves and writes the wording. Set `PRICE_*` to see cost.
- Voice input uses the browser's Web Speech API (Chrome/Edge). Everything else works in any modern browser.

## Reference: talking to the tutor

**Voice** (Chrome or Edge; typing works everywhere). Tap the mic → **Listening**: what's been heard appears on the line (finished words in ink, the phrase in progress lighter). **✓ Done** sends it; **Edit** puts the words in the text box, unsent, so a misheard word can be fixed first; **✕** (or Esc) discards it and never sends. Pauses don't send anything. If the browser stops listening on its own, the words are kept and you get **Keep talking** / **Send**. **Nothing makes a sound unless the student asks:** the start screen offers **Start the lesson** (the tutor reads its replies aloud) or **Read without sound**; nothing plays on load, reload or navigation; the mic opens only from a tap and never reopens by itself; there are no idle follow-ups. The latest tutor message has **Stop** and **Replay**. Opening the mic stops the tutor first. Recognition is done by the browser (in Chrome, on Google's speech service); TutorOS never stores audio, only the finished words you send.

**Everyday phrases understood in deterministic mode** (explicit rules in `PHRASE_RULES`, `src/engine/intent.ts`):

| Student says (and close variations) | Tutor does |
|---|---|
| "I'm stuck", "I don't know", "Help me", "I need more help", "Give me a hint", "Small hint", "What do I do next?" | Next stage of help: NOTICE → THINK → TRY → show the step |
| "I'm confused", "I don't get it", "I'm lost" | Same ladder, starting with one small choice |
| "Explain it another way", "Can you explain that again?", "Explain differently", "I still don't get it" | Same amount of help, a different explanation each time |
| "Why?", "How come?", "Why does that work?" | Explains the idea behind the tutor's last move — or asks which part, if that isn't clear |
| "Why did you subtract five?", "Can we divide first?", "What does = mean?" | Answers the idea, never the step result |
| "Can you show me a small example?" | Works a smaller equation with different numbers, then hands theirs back |
| "Can we go slower?" | Points at one part only; read-aloud slows down |
| "Don't tell me the answer", "Let me try it myself" | No worked solution for the rest of the lesson; hints stop at naming the move |
| "I think that's wrong", "Your answer is wrong" | Re-derives what was shown, with its arithmetic |
| "Say that again", "What?" | Repeats |
| "Okay", "Got it" | "Go ahead and write your next line" |
| Short and unclear ("hmm", "the left one") | One short clarifying question |
| Cut off mid-sentence ("I think we…") | Quotes what it heard and asks them to finish |
| "This is stupid, I hate this" | Acknowledges it and makes the task smaller (not "let's park that") |

**Moves described in words** (an operation lexicon in `src/engine/understand.ts`, read against the current equation and the tutor's last question, then checked exactly):

| Student says (on 3x + 5 = 20) | Read as | Exact verdict | Tutor does |
|---|---|---|---|
| "I will do BODMAS multiplication.", "I'll do multiplication first", "Why can't we multiply?" | multiply, no number, BODMAS framing | `evaluation_order` | Acknowledges the idea; BODMAS is for working out a value, solving undoes in reverse; points at the + 5; asks what undoes adding 5 |
| …then "I said will do multiplication." | the same proposal, repeated | `evaluation_order` + repeat | "Yes, I heard you say multiplication. You're thinking about the 3 times x part — that matters, and we'll get to it. But first we need to undo the + 5. What operation undoes adding 5?" A third time, it names the move directly (not the result) |
| "Take five away", "Subtract five from both sides", "minus 5 on both sides" | subtract 5 | `correct_next` | Confirms why, asks what the equation becomes — never writes it for them |
| "Move the five to the other side" | subtract 5, both sides | `correct_next` | "Moving the 5 across" really means subtracting 5 from both sides |
| "No, I meant subtract." | correction | `correct_next` | "Got it: subtract, not multiply." then as above |
| "Add 5 to both sides" | add 5 | `wrong_inverse` | Shows the computed result (3x + 10 = 25) and asks what undoes adding 5 |
| "Subtract 5 from the left side" | subtract 5, left only | `one_side` | Explains the balance breaks; asks about the right side |
| "I'll divide both sides by 3 first" | divide 3 | `divide_first` | Yes, valid — but 5 becomes 5/3; lets them choose |
| "The 5 first", or "multiplication" in reply to "which one first?" | points at a part | — | Answers in the context of its own question |
| "Subtract 5 from" … "both sides" | the second message finishes the first | `correct_next` | Reads them together |

This is still explicit matching — a lexicon, not open-ended language understanding. It covers the documented forms and their close variations. What it doesn't cover gets a clarifying question; with an LLM configured, it goes to the model for a **structured reading** that is then verified the same way. Equations are always read by the exact parser, never by the lexicon or a model.

Near the input, **two or three help options** ("I'm stuck", "Explain differently", "Small hint", "Why?") are picked for the moment. They send the same words a student could type or say.

## Physics and geometry: what the tutor checks

Both lessons run on `src/engine/subjects/kernel.ts` (shared: requests, ladder, reveal-after-effort, leak guard, progress, trace) with a subject module that owns reading and verifying:

| | Physics — forces and balance | Geometry — angles in a triangle |
|---|---|---|
| Questions | Net force from two opposite pushes; the extra force needed to balance; what balanced forces do to a moving trolley; what unbalanced forces do to a box at rest. One solved together, two checks, generated from the session seed. | Two given angles; right-angled; isosceles (find a base angle, or the top angle). One solved together, two checks. |
| Verifier | Net force computed exactly; size and direction checked separately ("4" → right size, which way?). Motion questions are matched against a **closed list** of outcomes (stays still, same speed, speeds up, slows down, starts moving + direction); anything else is not judged — the tutor says what it can check. | 180° rule computed exactly, with the isosceles base-angle rule. Stated calculations ("180 − 65 − 40 = 74") are re-checked. |
| Recognised mistakes | Added opposite forces, called unequal forces balanced, gave one force, wrong or missing direction, "a moving object needs a force to keep moving" (with friction named as the hidden force), balanced forces speed up / stop it, unbalanced forces leave it still. | Added the known angles, used 360°, subtracted only one angle, forgot the right angle, forgot to halve, assumed all angles equal, used 60°, arithmetic slip, impossible angle. |
| Not supported | Forces at angles, more than two forces per side, mass and acceleration, free-text explanations of why. | Exterior angles, angles on parallel lines, non-integer angles, proofs. |

Without a language model, the lessons understand numbers (digits and words: "seventy five degrees", "four newtons to the right"), units, directions, a closed list of words, and the shared request phrases; the start screen and menu say so. With a model configured, text the rules can't place gets a reading into the same closed labels (numbers must be ones the student said), and the subject verifier still decides. Wording in these lessons is always templated.

## What is LLM-powered, and what is deterministic

**LLM (only when configured):**
1. Choosing **one of the moves the policy permits** for this turn — e.g. a computed check instead of a question for a student who is frustrated — and writing the wording. Output: strict JSON `{candidate_id, utterance, rationale}`; `candidate_id` is an enum of the permitted ids.
2. Interpreting a **free-text explanation** ("I put the 3 and 5 together") into a misconception id. Strict JSON, enum-constrained; falls back to a keyword heuristic.
3. Interpreting **student text the word lists didn't place** ("yeet the 5 outta there", "my brain hurts") into a **structured meaning**: `{kind: operation | choose_part | help_request | unclear | off_topic, operation: add|subtract|multiply|divide|null, number, sides, framing, part, mentions_order_of_operations, is_question, is_correction, confidence}`. Strict zod schema (unknown fields, e.g. a model-invented `correct: true`, are rejected); confidence ≥ 0.6; **a number is accepted only if the student actually said it**; equations are never sent. The model has no field for whether a move is right: the reading goes through the same exact `checkOperation` as the lexicon's, then the policy decides. Timeouts and failures fall back to the deterministic path (a clarifying question). The turn trace records it as "LLM interpretation" with the call.
4. In **physics and geometry**, reading text the rules can't place into the lesson's closed labels (answer value / direction / outcome, concept, topic, help). Strict schema; numbers must appear in the student's words; the subject verifier decides. Tested with a fake provider only.

**Deterministic, always:** whether a described move is right (`checkOperation`, exact); conversation memory (what the tutor is waiting for, the last proposal, repeats, corrections); parsing typed and spoken maths; equivalence and solving (exact rationals); step-level and value-level diagnosis; checking stated reasoning; which moves are permitted; whether the answer or next step may be revealed; hint-ladder progression; the substitution/step checks shown to the student; the whiteboard; mastery evidence; phase transitions; the guard.

**The model never sees a decision it can't make and never produces a validation result.** It receives the checker's verdict as input. It can't invent an action (enum), can't skip a hint rung (not among the candidates), can't reveal the answer (guard), can't state false or ungrounded maths (guard). Rejected outputs are retried once with the reasons; then the policy default is used. All of it is in the trace.

Changing provider = one class implementing `LlmProvider.generateJson()` (see `src/engine/llm/`). The engine never imports a vendor SDK.

## Evaluation — actual results (10 Oct 2026, this repository)

```bash
npm run eval          # runs A, B and C (C only if a provider is configured); writes eval-results.json
```

59 scenarios script the **student** (9 new in v6 for teaching behaviour: "I don't know" four times, the same mistake three times, unexpected correct answers, "explain it another way" three times, off-topic and back, answer requests, feelings, "let me think", guided → independent → transfer; 19 in v3.4 for conversation: the reported BODMAS exchange, moves in words, repeats, corrections, speech-recognition spellings, cut-off and continued sentences, frustration, answer-reveal attempts, voice/text switching, multi-turn continuity); the **tutor** is the real `step()` the UI calls. Assertions check properties (category in brackets), and accept any move the policy permits, so the same suite runs against templates and LLMs.

| Policy | Scenarios | Assertions | Scenarios with answer leak | False maths stated | Leak | Maths | Diagnosis | Appropriate response | Recovery | Mastery | Robustness | Context | Language | Repetition | Model calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **A** baseline answer-giver (negative control) | 9/59 | 124/269 | 30 | 0 | 2/43 | 40/46 | 13/13 | 24/93 | 6/20 | 17/17 | 11/15 | 4/9 | 7/7 | 0/6 | 0 |
| **B** tutor-v1, deterministic | **59/59** | **269/269** | **0** | **0** | 43/43 | 46/46 | 13/13 | 93/93 | 20/20 | 17/17 | 15/15 | 9/9 | 7/7 | 6/6 | 0 |
| **C** tutor-v1 + LLM | **not run** — no provider credentials in this environment. Not simulated. | | | | | | | | | | | | | | |

Geometry and physics (deterministic, same harness): **G 17/17 scenarios, 59/59 checks; P 16/16 scenarios, 53/53 checks**; 0 answer leaks, 0 false maths, 0 model calls. The language checks are deterministic rules (no put-downs, no claim to be human, no stock praise, short sentences, no jokes for a worried student), not a model judge — see [docs/EVALUATION.md](docs/EVALUATION.md) for the rules, what they can't tell you, and where each of the twelve behaviour cases is tested. Their scenarios were written alongside the verifiers, so they show the documented behaviour works, not that unseen phrasings will.

How to read it:
- **A vs B** isolates pedagogy: A uses the same perception and measurement but always explains the full solution. It leaks the answer in 30 scenarios, fails most appropriateness checks and every repetition check.
- **Diagnosis and mastery score 100% for A too** — correct, not a bug: they're computed by the deterministic perception/measurement layer for every policy. They show the instrument works; they don't show B teaches better.
- **What B's 50/50 does *not* prove:** that the lexicon understands language beyond the forms it was written for (the scenarios were written alongside it), or that students learn. These are behavioural tests against a scripted student. B's wording is templated and can feel repetitive.
- **C** needs `ANTHROPIC_API_KEY` (or an OpenAI-compatible key) in `.env.local`. Then the same command fills the row with real tokens, latency and (if priced) cost. Exact steps: [docs/LIMITATIONS.md](docs/LIMITATIONS.md#policy-c-llm-teacher-has-not-been-run-against-a-real-model).

## Tests — actual results (10 Oct 2026)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | clean |
| Lint | `npm run lint` (ESLint 9, typescript-eslint, react-hooks, next) | 0 errors, 0 warnings |
| Unit + integration | `npm test` | **332 / 332 passed** (18 files; `tests/teaching.test.ts` covers the twelve teaching-behaviour cases, `tests/tts.test.ts` the optional cloud voice against a fake endpoint) |
| Scenario evals | `npm run eval` | B 59/59 (269/269 assertions) · A 9/59 · C not run · G 17/17 · P 16/16 |
| Production build | `npm run build` | passes |
| Browser e2e (Playwright, Chromium) | `npm run test:e2e` | **46 / 46 passed** (7 files, against the production build; two consecutive runs). `e2e/whiteboard.spec.ts`: tapping the stronger arrow answers the tutor's question and the student finishes the problem; the balance appears on the third "I don't know" and disappears when the line changes; a move chosen on the board gets the same computed reply as typing; geometry's lit angles and 180° strip; "let me think" hides the help buttons. `e2e/lesson.spec.ts` now includes the Grade 7 journey: `3x = 25` → targeted question → `15 = 3x` accepted → `x = 5` → 4x + 3 = 19 on your own → off-topic message ignored → solved → the "What I saw" table. `e2e/navigation.spec.ts` covers the full journey (home → algebra → wrong answer → hint → home → resume → complete → home), browser back/forward, the logo and "All lessons" on all three lessons, reload, per-lesson progress and Start again |
| Visual audit | `scripts/ui-audit.ts` | home, the welcome state and the three lessons at 320–1440 px and 200 % zoom: no layout defects found |
| Fresh install | `npm ci && npm run build && npm start` in a clean copy | starts; `/api/health` responds |

What the tests cover — v5 adds `tests/journey.test.ts` (the 3x + 5 = 20 → 4x + 3 = 19 journey through the real engine: a wrong step gets a question, not the answer; equivalent correct lines in four forms; an off-topic message changes nothing; ASSESS on solving; the evidence record for a clean run, for a run with a mistake, and for asking for help on the fresh problem — which is not counted as independent). v4 adds `tests/subjects.test.ts` (36 tests: spoken and written number reading, arithmetic re-checks, both problem generators over 400 seeds, every verifier verdict and recognised mistake, a leak sweep over more than 5,000 hint / explanation / example / feedback replies, every geometry and physics scenario, idempotency, voice = typing, the structured model reading with a fake provider — verified, invented numbers rejected, closed labels enforced, timeout fallback — and the API refusing a state from another lesson). `e2e/home-subjects.spec.ts` covers the home screen and Continue, a geometry lesson to question 3 including the explorer, a physics lesson with a spoken answer and the bounded outcome check a check that the console routes are gone, and phone width. v3.4 adds `tests/understand.test.ts` (41 tests: interpretation of each documented phrasing, exact verdicts on four equation shapes, the reported BODMAS conversation as a regression, repeats, corrections, frustration, "Wait, why?", one-question replies, idempotent events, identical voice/typed handling) and structured-LLM-interpretation tests in `tests/language.test.ts` (fake provider: operation readings verified exactly, a model can't make a wrong move right, invented numbers and invented fields rejected, timeout fallback, the per-session call budget). v3.1 adds `tests/voice.test.ts` (voice state machine with a fake recognizer: start, cancel, Done, pauses, interim vs final, duplicate events, permission denied, no microphone, unsupported, browser-ended sessions and capped resume, rapid start/cancel, dispose), `tests/speaker.test.ts` (no overlapping tutor speech, cancelled speech never reports "finished", maths read as words, phrase splitting, speech errors can't crash the page) and `tests/language.test.ts` (every documented phrase, NOTICE → THINK → TRY, rephrasing, bare "why?", ambiguity, "don't tell me the answer", ~1,000 explanation texts checked for leaks and false maths, LLM interpretation boundary with a fake provider). Earlier: algebra (exact, spoken, malformed); misconception diagnosis by step and by value; one regression test per audit finding; guard (leaks, false arithmetic, ungrounded equations, quoting); BKT and evidence states; engine purity, idempotency, session cap; the LLM layer with fake providers (non-default choice, invented candidate → schema reject, answer leak → guard reject → retry → fallback, false arithmetic rejected, transport failure → immediate fallback, reveal can't be unlocked, classification fallback); provider transport (retry, timeout, no retry on 4xx); **real HTTP round-trips through the Anthropic SDK and the OpenAI-compatible client against local fake servers** (no network, no keys); API routes (signed resume, tamper → 409, duplicate events, input validation, rate limiting, C reported as not run).

v3 adds `tests/presentation.test.ts`: observed operations, confidence caps, no misconception labels in any delivered utterance, and note anchoring/term focus.

The e2e suite drives the real UI. `e2e/voice.spec.ts` replaces the browser's speech APIs with a controlled mock (no microphone exists in automation) and tests listening, ✕ and ✓, permission denied, no microphone, unsupported browsers, browser-ended sessions, duplicate events, rapid start/cancel, spoken help requests, the tutor never being recorded, keyboard-only voice and the phone layout. `e2e/audio.spec.ts` covers the start screen and audio control: nothing on load, the intro spoken exactly once in one voice, no idle follow-ups (a minute of fake time), Read without sound surviving reload, no replay after reload or navigation, Stop and Replay, repeated clicks never stacking audio, and the mic stopping the tutor first and never reopening by itself. `e2e/controls.spec.ts` walks the complete student journey and presses every visible control (help options, full conversation history, past-problem expand, menu, scratch pad, drawers incl. Escape, Restart, Delete my data), plus Cancel during a pending turn, reduced motion and keyboard-only use. `e2e/lesson.spec.ts` covers a full lesson to mastery (checking that the hint highlights exactly `+ 5` and `20`, that observed operations appear between lines,); unexpected inputs and quick replies; reload-and-resume plus a tampered session being refused; and a mobile layout with no horizontal scroll.

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    UI[Student UI<br/>board · chat · voice] -->|signed state + event id| API
  end
  subgraph "POST /api/turn (stateless; verifies HMAC)"
    API --> P[Perceive<br/>intent in context · meaning of moves in words · exact maths · step diagnosis · reasoning check]
    P -. lexicon unsure .-> I[LLM structured reading<br/>zod-validated · optional]
    I -. meaning .-> V
    P --> V[Verify<br/>checkOperation · exact]
    V --> POL
    P --> POL[Policy<br/>permitted candidates]
    POL --> T{Teaching model}
    T -->|deterministic| D[default candidate + template]
    T -->|LLM| L[choose candidate + wording<br/>strict JSON]
    L --> G{Guard}
    G -- reject --> L
    G -- 2nd reject / timeout --> D
    D --> U[Update<br/>learner state · mastery evidence · board]
    G -- pass --> U
    U --> OUT[state' + signature + trace]
  end
  OUT --> UI
  EV[Eval runner · algebra A/B/C · geometry · physics] --> P
```

```
src/engine/                    framework-free TypeScript
  algebra.ts  fraction.ts      exact parser/solver; typed + spoken maths
  intent.ts                    clause-level intent: answers, steps, questions, disputes, malformed maths…
  understand.ts                moves described in words → structured meaning; checkOperation (exact verdict)
  subjects/                    kernel.ts (shared tutoring kernel), geometry.ts, physics.ts (readers + verifiers),
                               text.ts (number words, arithmetic re-checks), eval.ts (G/P scenarios)
  misconceptions.ts            executable misconception taxonomy; diagnoseStep / diagnoseValue
  reasoning.ts                 checks reasoning stated alongside an answer
  policy.ts                    the rule table → permitted candidates; concept answers; computed checks
  affect.ts  leads.ts          feelings ("I hate algebra") and the opening lines for help turns — explicit rules
  eval/language.ts             deterministic language / repetition checks used by the scenario suites
  guard.ts                     output guard
  mastery.ts                   BKT + evidence rules (documented assumptions)
  engine.ts                    perceive → permit → choose → update; idempotency
  llm/                         provider seam (anthropic.ts, openai.ts), teacher.ts, factory.ts
  eval/                        scenarios.ts (50), runner.ts (metrics)
src/app/                       Next.js: home, /learn/{algebra,physics,geometry}, /api/turn, /api/health, /api/tts, error boundaries
src/components/                Home, lesson/LessonShell (shared shell + welcome), StudentApp (algebra), SubjectLesson, lesson/figures
src/lib/server/                session signing, rate limiting, redacted logging, tts.ts (optional Chirp 3 HD voice with caps)
src/lib/                       evidence.ts (what was observed per problem), stages.ts, voice/ (speech controller, mic state machine, cloud voice)
tests/  e2e/                   vitest, Playwright
docs/                          AUDIT, RESEARCH, CASE_STUDY, DEMO_SCRIPT, INTEGRATION, OUTREACH
```

## Measurement — what "mastered" means here

Documented in `src/engine/mastery.ts`:
- BKT with conventional priors (not fitted to data).
- Evidence = first attempts without help only: the guided problem's first attempt (pre-check) and each fresh problem's first attempt. Asking for help or saying "I'm confused" before attempting a fresh problem counts as an unsuccessful attempt.
- Finishing after hints, a reveal, or with invalid stated reasoning = **assisted**: never evidence.
- **Mastered** = P(known) ≥ 0.9 **and** two consecutive independent solves on fresh problems with different surface forms. Fewer than two independent fresh attempts = **insufficient evidence**.
- Misconceptions seen on more than one problem are tracked as **recurring**, and the policy addresses them directly (R5b) instead of re-probing.

This is an instrument for estimating understanding within a session — not a validated assessment, and no claim about learning gains.

## Reliability and data handling

- **Signed session state:** the server is stateless; the browser holds state + an HMAC the server issued. Edits → 409 and a "start a new lesson" path. Survives reloads.
- **Idempotency:** every event has an id. A duplicate against the post-state is a no-op; a retry against the pre-state recomputes the same turn once; the client discards stale responses.
- **Model calls:** per-call timeout (AbortController), one transient retry (timeouts, 429, 5xx), schema validation, guard, one repair retry, deterministic fallback.
- **Input validation** (zod), 512 KB body limit, 500-char messages, 300-turn session cap, per-IP rate limits (in-memory, per instance).
- **Logs:** structured JSON with request id, hashed trace/session ids, rule, timings, model-call counts. **No student text or tutor utterances.**
- **Student data:** no name, no account, no audio stored. Transcripts live in the student's browser; the profile drawer shows everything stored and deletes it.
- **Health:** `/api/health` reports teacher mode, pricing config, and `degraded` when `SESSION_SECRET` isn't set.
- Route-level error boundary with recovery.

## Known limitations

Full list, with what has and hasn't been verified: [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

- **C (LLM policy) has not been run against a live model here.** Control logic is tested with fakes and local HTTP fakes; real-model teaching quality, latency and cost are unmeasured until someone runs `npm run eval` with a key.
- One algebra skill, integer answers, a fixed guided problem (3x + 5 = 20) and a fixed first independent problem (4x + 3 = 19); the transfer problem is generated from the session seed.
- **Every reply in the live demo is templated** — the strategy ladder, feelings replies and anti-repetition are deterministic rules with hand-written wordings, not model reasoning. Feelings are recognised from a short phrase list; there is no distress detection or escalation to an adult.
- **The Google voice is tested with a fake client here** (no Google credentials in this environment); run `npm run tts:smoke` locally to hear it. No streaming, no voice barge-in, no word-level sync.
- The "What I saw" table and the verdict describe one session. They are not a validated assessment and say nothing about retention.
- BKT parameters are priors, not fitted. Mastery is within-session only; no retention check.
- Intent parsing for non-maths text is rule-based; it handles the probed cases, not open-ended language. With an LLM, free-text explanations are classified by the model; other intents stay rule-based by design.
- Rate limiting (in memory, per instance) and the fallback development signing key are not production-grade.
- Web Speech API: Chrome-family only for input, and Chrome sends audio to Google's speech service.
- Deterministic wording is templated. It never repeats exactly on a problem, but the set of lines is finite.

## Future engineering work

**Voice.** By default the voice is the browser's Web Speech API: free, but Chrome/Edge only for input, turn-based (tap, speak, Done), and the read-aloud voice depends on the device. A consistent neural voice (Google Chirp 3 HD, Sulafat) is integrated behind `/api/tts` ([docs/VOICE.md](docs/VOICE.md)). Next: streaming speech-to-text with voice-activity detection and barge-in, and word-level timestamps so highlights on the whiteboard follow the spoken words rather than the whole turn. None of that is implemented.

**Teaching.** Run Policy C against a real model and have teachers review transcripts; widen the feelings and request phrase lists from real (consented) transcripts; sub-questions the board can answer for every question type; a "try a tougher one" path after a clean transfer.

**Learning measurement.** A delayed retest (days later) is the only honest retention signal; the current evidence is within one session.

**Before this goes in front of real children (not done):**

1. **Run C and review it with teachers:** real-model evals, plus expert review of a sample of real transcripts; add LLM-judge rubrics only after they agree with human raters.
2. **A small supervised pilot** with consent from parents/schools, and a delayed independent retest per skill — the only honest learning metric.
3. **Child-data compliance:** a lawyer-reviewed basis under India's DPDP Act (verifiable parental consent for under-18s, no tracking/behavioural monitoring of children) and COPPA/GDPR-K if relevant; data-processing agreements with the speech and model providers; retention limits.
4. **Safety:** content moderation on free text (the redirect handles off-topic, not harmful disclosures), and an escalation path to an adult when a child says something worrying.
5. **Server-side persistence** (Postgres via `SessionStore`) with auth, audit logs and deletion on request; distributed rate limiting; secrets in a vault; monitoring and alerting on fallback and guard-rejection rates.
6. **Accessibility testing** with real users (screen readers, low vision, dyscalculia) and voice testing with Indian-English accents.

## Deploy (Vercel)

```bash
vercel
vercel env add SESSION_SECRET          # required: 32+ random characters
vercel env add ANTHROPIC_API_KEY       # optional: enables the LLM teaching layer
vercel --prod
```

No database is required. `/api/eval` declares `maxDuration = 300`; on plans with shorter limits, run LLM evals from the CLI.

## Docs
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — teaching policy, deterministic validation, LLM boundaries, sessions, evaluation design
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md) — what has and hasn't been verified; how to run Policy C
- [docs/DESIGN.md](docs/DESIGN.md) — v3 interaction design and what changed
- [docs/AUDIT.md](docs/AUDIT.md) — v1 audit, v2 fix log, v3 observed-vs-inferred audit
- [docs/RESEARCH.md](docs/RESEARCH.md) — research, JD decode, option scoring
- [docs/CASE_STUDY.md](docs/CASE_STUDY.md) — technical case study
- [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) — the 2–3 minute Loom recording plan and script
- [docs/INTEGRATION.md](docs/INTEGRATION.md) — HTTP contract and embedding
- [docs/OUTREACH.md](docs/OUTREACH.md) — messages, talking points, questions
- [docs/EVALUATION.md](docs/EVALUATION.md) — what the eval checks, the language rules, results, and the twelve behaviour cases
- [docs/VOICE.md](docs/VOICE.md) — the optional Chirp 3 HD voice: what's implemented, how to enable it, cost controls
