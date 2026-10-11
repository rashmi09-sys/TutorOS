# TutorOS v1 audit (8 Oct 2026)

Method: read every engine module, API route and UI component; ran a battery of unexpected student inputs through the *real* engine (`scripts/probe.ts`, same `step()` the UI calls); compared console figures against their source code. Each finding cites the evidence. The "Fix" column links to what changed in v2 (see the bottom of this file).

## The `3x = 25` classification

**Console v1 showed:** `SIGN_ERROR_INVERSE_OP` — "Used the same operation instead of the inverse" — evidence: *"Student value 25/3 equals buggy procedure (C + B) / A."*

**What the student actually did:** from `3x + 5 = 20` they removed `+ 5` from the left and wrote `20 + 5 = 25` on the right. They *added* 5 where undoing `+ 5` requires *subtracting* it. They did not divide anything.

**Verdict:**
- The **label is defensible** — the error is a failure to apply the inverse operation (the classic "moved it across without changing the sign" transposition error).
- The **evidence was not justified**. The engine solved the student's equation (`x = 25/3`), then matched that *value* against a final-answer formula `(C + B) / A`. The explanation therefore described a division the student never performed. It was right for the wrong reason.
- **Root cause:** every invalid *step* was diagnosed by its implied solution value. Distinct step-level errors that happen to imply the same value become indistinguishable, and the stated evidence can't describe the transformation the student made.
- **Knock-on effect:** the tutor then "tested the claim" by substituting `x = 25/3` into the original equation — mathematically valid, but it introduces a fraction the student never wrote. The natural check is on the student's own line: *if 3x were 25, the left side would be 25 + 5 = 30, not 20.*

## Findings

### Working and verified
| Area | Evidence |
|---|---|
| Exact algebra (parse, solve, equivalence; rationals, no floats) | `tests/algebra.test.ts`; manual probes |
| Spoken maths normalisation ("three x equals fifteen") | `voice-transcript` scenario, unit tests |
| Teaching decisions are computed, not scripted | `decide()` is a pure function of validated observation + state; the probe battery shows different rules for different inputs from the same starting state |
| Local mode is a deterministic policy engine, not a scripted demo | The same input from different states yields different actions (e.g. `x = 15` → R5 probe on first error, R4 check when repeated). Wording is templated per decision, and labelled "Local mode · templated wording" |
| Whiteboard reflects validated state | Board entries are created only in `engine.ts` from validator output; the language layer can't write to the board |
| Eval suite exercises the same engine as the UI | `eval/runner.ts` calls the same `step()` as `/api/turn`; no parallel implementation |
| Output guard blocks answer leaks, step leaks, false arithmetic | `tests/guard.test.ts`, leaky-LLM test double in `tests/engine.test.ts` |
| Per-turn trace: intent, validation, diagnosis, decision + reason, state delta, latency | Console reads the actual trace objects returned by `/api/turn` |

### Working but limited
| Area | Limitation |
|---|---|
| LLM role | Claude only *phrased* decisions and classified free-text explanations; it never proposed a pedagogical action. And it was never exercised against the live API (no credentials). |
| Session persistence | Survives reloads (localStorage), but state was **unsigned client data**: a student could edit `mastery.pKnown` in devtools and the server would accept it. |
| Idempotency | The client blocked double-submits while a request was in flight, but the server had no notion of event identity. |
| Mastery measurement | Guided first-attempt success updated BKT (reasonable as a pre-check) but the status showed "developing" with zero independent evidence; asking for help before attempting a transfer item recorded no evidence at all; no "insufficient evidence" state. |
| Misconception tracking | Counted per id but did not distinguish *recurring across problems* from repeated within one problem, and the policy didn't use recurrence. |
| Voice | Push-to-talk with barge-in works; no hands-free turn-taking. |
| Rate limiting / abuse | None beyond a 500-character text limit. |

### Incorrect or misleading
| # | Finding | Evidence (probe output) | Fix |
|---|---|---|---|
| 1 | Step errors diagnosed by implied value; evidence describes operations the student didn't do (`3x = 25` above). | `3x = 25 → evidence: "Student value 25/3 equals buggy procedure (C + B) / A"` | F1 |
| 2 | Multi-clause answers graded on the wrong clause. | `x = 5 because 20 divided by 4 is 5` → graded `20 / 4 = 5`, marked invalid, "has every solution" | F2 |
| 3 | A correct answer with invalid reasoning was accepted as independent evidence. | same probe; with `x = 5` alone, reasoning is never checked | F3 |
| 4 | Confusion and conceptual questions treated as off-topic. | `I'm confused`, `Can we divide first?`, `I don't understand negative numbers` → "Ha — let's park that for later!" | F4 |
| 5 | Questions treated as explanations. | `Why do we subtract 5?` → "Thanks for explaining! What was the very first thing you did…" | F4 |
| 6 | Arithmetic questions diagnosed as misconceptions. | `what is 3 times 5` → `MULTIPLIED_INSTEAD_OF_DIVIDING` | F4 |
| 7 | Disputes treated as explanations. | `I think your answer is wrong` → "Thanks for explaining!" | F4 |
| 8 | Malformed maths treated as an explanation. | `3x + = 20` → "Thanks for explaining!" | F4 |
| 9 | Board note for invalid steps claimed "doesn't balance with the line above" — the check was against the original problem, not the line above. | `engine.ts` | F5 |
| 10 | Console showed **"Cost $0.0000"** and template renders under **"Model calls"** in Local mode — implying model usage was measured when there was none. | `ConsoleApp.tsx` Kpis | F6 |
| 11 | "Developing" status shown with no independent evidence. | `mastery.ts statusFor` | F7 |

### Not yet implemented (v1)
- LLM proposing pedagogical actions under policy constraints; provider abstraction beyond one SDK; model timeouts with abort; transient-error retries.
- Side-by-side policy comparison with metric categories (leaks, maths, diagnosis, appropriateness, recovery, mastery, latency, cost).
- Tamper-evident session state, event idempotency, rate limiting, error boundaries, lint, structured logs without student text.

### What would fail on an unexpected response (v1)
Anything that wasn't an equation, a number, a help phrase or a reasoning verb fell through to "off-topic" or "explanation" — the tutor answered a question the student didn't ask. Every case in the probe battery above has a regression test in v2.

---

## v2 fix log

Every fix has a regression test (`tests/regressions.test.ts` unless noted).

| Fix | Finding | What changed | Test |
|---|---|---|---|
| F1 | #1 step errors judged by implied value | `diagnoseStep()` matches the student's equation against the *lines* each buggy transformation produces (same line up to scaling and orientation). Evidence uses the problem's numbers ("wrote 20 + 5 = 25 on the right"). Unrecognised shapes fall back to the implied value **and say so** (`basis: "implied-value"`, confidence × 0.6). The check shown to the student tests their own line: "if 3x were 25, the left side would be 25 + 5 = 30, not 20". | `AUDIT #1` (7 cases), scenarios `insists-wrong-transformation`, `step-diagnosis`, `arithmetic-slip` |
| F2 | #2 multi-clause answers | Intent parsing extracts every maths clause; the answer/step is chosen by role (solved form > step > bare number), the rest are kept as reasoning claims. | `AUDIT #2/#3` |
| F3 | #3 correct answer, invalid reasoning | `reasoning.ts` checks each claim: true arithmetic using only numbers from a valid solution path, or an equation equivalent to the problem. A flawed claim → rule R17: confirm by substitution, name the flaw, record as **assisted**. | `AUDIT #2/#3`, scenario `correct-answer-flawed-reasoning` |
| F4 | #4–#8 wrong intent | New intents and rules: CONFUSED (R8b), CONCEPT_QUESTION with 7 topics (R18, deterministic answers about the idea, never the step result), ARITHMETIC_QUESTION (R21, handed back), DISPUTE (R19, re-derives the last shown step with its arithmetic), MALFORMED_MATH (R20, not counted as an attempt). Unrelated questions are redirected without being answered (scope limit for a children's product). | `AUDIT #4–#8` (9 cases), 7 scenarios |
| F5 | #9 board note | Invalid steps: "not equivalent to <latest valid line>"; invalid answers: "doesn't make <problem> true". | `AUDIT #9` |
| F6 | #10 fabricated-looking metrics | `LlmCall.kind` distinguishes model / template / heuristic. Non-model calls have `costUsd: null`. Console shows "Model calls 0 — none, deterministic mode" and cost "—, no model calls". Cost is computed only from provider-reported usage *and* configured prices. | `AUDIT #10` |
| F7 | #11 status without evidence | New status `insufficient_evidence` until two independent fresh attempts exist; help/confusion before attempting a fresh problem is recorded as an unsuccessful independent attempt. | `AUDIT #11`, `tests/mastery.test.ts`, scenario `help-before-transfer` |
| F8 | found during v2 | `15 = 3x` was normalised with A = −3, B = 15, so the next-step hint would have said "subtract 15 from both sides". `normalize()` now orients the x-term to the left. | `normalisation regression`, scenario `reversed-valid-step` |
| F9 | found during v2 (by `tests/server.test.ts`) | The first HMAC implementation verified zod's re-serialised state; `.passthrough()` reorders keys, so every resumed session was rejected. Now verifies the raw body. | `/api/turn` tests |

## v2 additions (not fixes)
- **LLM teaching layer:** the policy returns *permitted candidates*; an LLM may choose one and word it (strict JSON schema, zod-validated, guard-checked, one repair retry, deterministic fallback). Providers: Anthropic (SDK, forced tool) and any OpenAI-compatible endpoint (fetch, strict `json_schema`). Tested with fake providers and real HTTP round-trips to local fake servers. **Not run against a live model in this environment** — no credentials.
- **Reliability:** HMAC-signed session state (tamper → 409), event ids (duplicates are no-ops; retries against the pre-state are safe), per-call timeouts with abort, transient-error retries, input validation, body-size limit, per-IP rate limits, `MAX_TURNS`, route-level error boundaries, structured logs with hashed ids and no student text, health endpoint that reports degraded config.
- **Evaluation:** 25 scenarios (from 12), assertions tagged by category, A/B/C comparison in the console and CLI.

## v3 audit: observed operations vs inferred misconceptions

**Finding.** v2 blurred the two. Diagnosis evidence read as fact ("the 5 was added instead of subtracted"), confidence went up to 0.9 for a step match and 0.85 for a value match, the console labelled diagnoses without hedging, and one template told the student "your method sounds right" on the strength of a weak slip inference.

**Why it matters.** The same written work has several explanations. `3x = 25` is consistent with a misunderstanding of inverse operations — and with a sign slip by a student who knows the rule. A value like `x = 25/3` can be reached by more than one route. Treating a pattern match as a finding about the child leads to the wrong teaching move and, in a parent report, to an unfair label.

**What changed.**
| | v2 | v3 |
|---|---|---|
| What the student did | Only implied by the diagnosis | `observeOperation()` computes it from the two lines and states it as fact: "left − 5 · right + 5". Shown on the board and as its own stage in the console. |
| Evidence text | "Removed + 5 … the 5 was added instead of subtracted." | "Observed: … Consistent with adding 5 where subtracting was needed." Value matches say "the value you get by …". |
| Confidence | up to 0.9 (step), 0.85 (value) | capped: 0.70 unique step pattern, 0.45 ambiguous step, 0.55 unique value, 0.35 ambiguous value, 0.40 slip, × 0.6 when a step's pattern isn't recognised. Defined as *specificity of the match*, not probability of the misconception (`CONFIDENCE` in `misconceptions.ts`). |
| Alternatives | Only other matching ids | Every diagnosis carries plausible alternative explanations (e.g. "a sign slip while writing"). |
| Console | "SIGN_ERROR_INVERSE_OP · confidence 0.90" | "Possibly: … [fairly specific match · 0.70] · Based on the pattern of the transformation written · Not confirmed unless the student explains their thinking · Other explanations: …" |
| Student-facing | Labels never shown, but slip template asserted "your method sounds right" | Still no labels (now tested across all 25 scenarios); slip template says "That's close". Profile says "Maybe: …" and "These are guesses from your working, not facts about you". |

Tests: `tests/presentation.test.ts` (observed operations, confidence caps, no labels in any delivered utterance, anchoring/focus).

## Final release audit (8 Oct 2026)

A new browser suite (`e2e/controls.spec.ts`) drives the complete student journey and every visible control. It found one real bug; the rest were polish.

| # | Finding | Fix | Test |
|---|---|---|---|
| R1 | **Cancel re-submitted the line.** React reused the same `<button>` for *Cancel* (`type="button"`) and *Send* (`type="submit"`). When the abort settled during the click, the element became a submit button before the browser ran the click's default action, so the form submitted again and the turn was applied. | Distinct `key`s for the two buttons and `preventDefault()` on Cancel. | `cancel a turn while it is being checked` |
| R2 | Phone header overflowed by 41 px at 390 px after the header compaction. | Shorter labels under 900 px ("Progress", "Engineer ↗", accessible names unchanged); buttons wrap under 380 px. | `mobile: …nothing scrolls sideways`; manual check at 320 px |
| R3 | Text contrast below AA: secondary text 3.8:1, not-yet-spoken words 2.8:1, input placeholder 2.1:1. | Darkened the three colours; each now ≥ 4.5:1 against every light background in `globals.css`. | computed ratios |
| R4 | The current tutor note didn't stand out among older notes. | Active note gets a tinted card, a left rule and a ▸ marker in the gutter. | visual check |
| R5 | After each tutor turn, focus stayed wherever it was. | Focus returns to the next-line input (not while a drawer is open or the mic is listening). | `keyboard only`, journey test |
| R6 | `npm run eval` ignored `.env.local`, so the documented way to run Policy C wouldn't have worked. | The CLI loads `.env.local` if present (shell variables win). | manual check |

## Voice and teaching-intelligence upgrade (8 Oct 2026)

### Voice instability: causes found by reading the code

| # | Symptom | Cause in the previous code (`src/lib/speech.ts`, `StudentApp.tsx`) | Fix |
|---|---|---|---|
| V1 | Recording stops unexpectedly; speech cut off | `continuous = false`, and the first final result was submitted immediately. A natural pause ("three x… equals fifteen") ended listening and sent "three x". | `continuous = true`. Nothing is submitted until **Done** (or, in hands-free mode only, a 1.8 s pause after finished speech). |
| V2 | No way to cancel | Tapping the mic while listening called `stop()`, which finalises and submits. | Separate **✕ Cancel** (aborts, discards, never submits) and **✓ Done**. Escape cancels. |
| V3 | Indicator flickers / shakes; listening stops by itself | Each tap created a new recognizer without aborting or detaching the old one. The old session's late `onend`/`onerror` set `listening = false` on the new session. | One `VoiceController` owns one recognizer. A new session detaches the old handlers first; every event is checked against the current session id. Colours no longer flip: the listening state has its own controls and a steady dot with an opacity-only ring. |
| V4 | Tutor's voice recorded as the student | `speak()` cancelled the previous utterance; Chrome reports the cancel as an end/error event, which ran the "finished speaking" handler and, in hands-free mode, opened the mic while the next sentence was starting. | `Speaker` with generation tokens: a cancelled utterance can never report "finished". Hands-free opens the mic only after a *natural* finish plus a 250 ms echo tail; opening the mic stops tutor speech first. |
| V5 | Unstable live transcript | The input showed only the latest interim chunk, replacing what was already recognised. | Finals are stored by (segment, result index) and stay fixed; the phrase in progress is shown separately (lighter, italic). Duplicate result events are applied once. |
| V6 | Confusing errors | `no-speech` and `aborted` were shown as errors and stayed on screen; permission denied and no microphone looked the same. | Distinct states: permission denied, no microphone, unsupported browser, recognition error, and *interrupted* (the browser stopped on its own; the transcript is kept, with one-tap **Keep talking** or **Send**). Benign ends are silently resumed at most twice per session, never after an error, so there is no restart loop. |
| V7 | Resources not released | No cleanup on unmount; the recognizer and speech kept running. | `dispose()` aborts the recognizer and clears every timer; the hook creates and disposes the controller in an effect (safe under React Strict Mode). |
| V8 | Long tutor turns cut off or read awkwardly | One long utterance (Chrome truncates long ones); "−" read as "dash", "=" as "equals" only with spaces. | Phrase-by-phrase speech with short pauses; maths read as words ("3 x plus 5 equals 20", "negative 3", "divided by"). Speech errors can't crash the page. |

Found during this work: the new "Read aloud" default briefly switched itself off on load (the speaker's support flag started as `false` before the browser was checked) — fixed before release and covered by a browser test.

### Language and teaching

- **Phrase rules** (`PHRASE_RULES` in `src/engine/intent.ts`): explicit, ordered, each with example phrases that are also its unit-test fixture. Maths is always read by the parser first; "I'm stuck on 3x = 15" is a help request, not a step; "the left one" is not the number 1.
- **Micro-teaching stages** NOTICE → THINK → TRY on every help path, one stage per turn, each with several genuinely different explanations (`src/engine/language/explanations.ts`). Every variant is checked on 41 problems × 2 positions (≈ 1,000 texts) for leaks, false arithmetic and length.
- **New rules:** R22 clarify, R23 acknowledge → try, R24 rephrase (same help level, new angle), R25 small example (different numbers that never match the student's step or answer), R26 slower, R27 don't-tell-me preference (no worked solution; hints stop at naming the move). A bare "why?" is resolved from the tutor's previous move, or answered with one clarifying question.
- **LLM interpretation (optional):** only for text no phrase rule matched and that contains no numbers or equations; the model picks from a fixed list of requests (schema-validated, confidence ≥ 0.6) and the policy still decides. Tested with fake providers only.


## Tutor speech stutter and unexpected audio (v3.3)

Reported: speech breaks, stutters and sometimes restarts unexpectedly. Causes found in the code (`src/lib/voice/speaker.ts` and `StudentApp.tsx` as of v3.2):

| # | Symptom | Cause | Fix |
|---|---|---|---|
| S1 | Stop-start speech between sentences | Each sentence was a separate utterance, started from JavaScript only after the previous one's `end` event plus a deliberate 120 ms timer. With Chrome's network voices ("Google …") each utterance also pays its own start-up latency. | All sentences of a turn are handed to `speechSynthesis` at once; the browser's own queue plays them back to back. |
| S2 | Voice changes partway through a reply | Chrome loads voices asynchronously. The voice was looked up per sentence and only cached once found, so the first sentence could use the default voice and later ones another. | Voices are awaited (`voiceschanged`, 1.5 s timeout) and one voice is chosen per page, preferring on-device English voices (no network start-up). |
| S3 | Speech stops mid-reply; "speaking" state stuck on | Utterances were only referenced by closures. Chrome can garbage-collect a queued utterance and never fire its `end`, which stalled the sentence chain. | The controller keeps strong references to every queued utterance, plus a watchdog that finishes the turn if the browser goes quiet without reporting it. |
| S4 | The tutor speaks again on its own | A 25-second idle timer after every reply sent a "silence" turn (up to twice), so the tutor spoke unprompted. Hands-free mode also opened the microphone automatically. | Idle timer removed from the student app (the engine still supports silence events; the eval still tests them). Hands-free removed: the mic opens only from a tap. |
| S5 | Unnecessary work while speaking | Every boundary event (each word) re-rendered the whole page, including all KaTeX. | The working panel is memoised; only the conversation updates as words are spoken. |
| S6 | Speech could start without the student choosing | The intro played as soon as the lesson started, with no way to choose silence first. | Start screen: **Start the lesson** (with sound) or **Read without sound**; the choice persists for the tab. Stop and Replay on the latest message. |

What still depends on the browser: voices and their quality, network voices' latency, and whether `boundary` events (word highlighting) fire. If Chrome's speech is unreliable on a machine, use **Read without sound** — the full text is always on the page — and **Replay** to hear a message again. There is no server-side text-to-speech fallback in this build (it would need a provider key).

## Conversational understanding (v3.4)

**Reported failure.** On 3x + 5 = 20, after "Which one would you undo first?", the student said "I will do BODMAS multiplication." and got "Let's stay with 3x + 5 = 20 for now. What's your next move?". They repeated "I said will do multiplication." and got "Let's park that for later!…".

**Reproduction before the fix** (deterministic engine, fresh session; replayed with `scripts/probe.ts`):

| Student | Classified as | Rule | Tutor |
|---|---|---|---|
| "I will do BODMAS multiplication." | OFF_TOPIC | R13_REDIRECT | "Let's stay with 3x + 5 = 20 for now. What's your next move?" |
| "I said will do multiplication." | OFF_TOPIC | R13_REDIRECT | "Let's park that for later! …" |
| "Take five away." | ANSWER 5 (bare-number rule) | R1_GUIDED_SOLVED | marked the guided problem **solved** |
| "Subtract five from both sides." | EXPLANATION | R12 | asked how they got it |
| "Wait, why?" | OFF_TOPIC | R13 | redirect |
| "No, I meant subtract.", "Go back." | AMBIGUOUS | R22 | clarifying question |

**Root causes.**
1. *No representation for a move described in words.* The pipeline had the exact equation parser, phrase rules for help requests, and a "bare number = answer" rule. A sentence proposing an operation matched none of them, so it fell through to OFF_TOPIC → a generic redirect.
2. *The bare-number rule was too eager.* Any short text with one number was an answer: "Take five away" became x = 5 — and 5 happens to be correct, so the problem was marked solved without the student writing anything.
3. *Classification ignored context.* The tutor's own pending question ("Which one would you undo first?") wasn't used to read the reply.
4. *No conversational memory.* Nothing recorded what the student had proposed, so a repeat or a correction looked like a new, unrelated message, and the tutor couldn't notice that its last reply had missed.
5. *Catch-all fallbacks.* OFF_TOPIC and AMBIGUOUS replies were generic templates — fine for "what's your favourite game?", wrong for meaningful maths talk.
6. *The LLM hook was too narrow to help.* With a key configured, unmatched text went to a model limited to an enum of help requests and barred from text with numbers, so it could not express "the student wants to multiply".

**Fix (smallest change that addresses each cause).**
- `src/engine/understand.ts` (new): `interpretDeterministic` reads operation proposals, parts, sides, BODMAS appeals, questions and corrections against the current equation and the tutor's pending question; `checkOperation` gives an exact verdict and the exact resulting equation. (Causes 1, 3.)
- `intent.ts`: an `OPERATION` intent, checked before phrase rules and the bare-number rule; the bare-number rule now requires answer-shaped words around the number ("I think it's 5"), otherwise short text is ambiguous; "what's x?" and variants are answer requests; cut-off sentences are detected. (Causes 1, 2.)
- `engine.ts` / `types.ts`: `state.dialog` — awaiting, last question (read from the reply actually sent), last rule, last proposal, repeat count; repeat / correction / repair / continuation flags on the observation and in the trace. Frustrated "off-topic" text is treated as a help request. (Causes 3, 4, 5.)
- `policy.ts`: `operationCandidates` (R30–R39), one question per reply, all numbers from the current equation and the exact check. `misconceptions.ts`: `EVALUATION_ORDER_CONFUSION`. (Causes 1, 5.)
- `llm/teacher.ts`: `interpret` returns a structured meaning under a strict zod schema; operands must appear in the student's words; the reading is verified by `checkOperation` like any other; per-session call budget. (Cause 6.)

**After** (same probe, deterministic):

| Student | Rule | Tutor |
|---|---|---|
| "I'm stuck" | R8 | "…the left side of 3x + 5 = 20 has a multiplication and an addition. Which one would you undo first?" |
| "I will do BODMAS multiplication." | R31 | "I see why you're thinking of multiplication — BODMAS is the order for working out an expression. Here we're doing the opposite: undoing what was done to x, so we go in reverse, and the + 5 was the last thing done. What operation undoes adding 5?" |
| "I said will do multiplication." | R31b | "Yes, I heard you say multiplication. You're thinking about the 3 times x part — that matters, and we'll get to it. But first we need to undo the + 5. What operation undoes adding 5?" |
| "subtract 5" | R30 | "Yes. Subtracting 5 undoes the + 5, as long as you do it to both sides. Go ahead: what does the equation become?" |
| "3x = 15" | R2 | accepted by the exact parser |

None of these strings is hard-coded for this example: the replies are assembled from the current equation and the exact verdict, and the verdicts are tested on 2x − 7 = 9, 13 + 7x = 41 and 4x = 12 as well (`tests/understand.test.ts`); the `conv-multi-turn-continuity` and `conv-voice-text-switch` scenarios also use the same rules on 3x = 15.

**Verification.** `tests/understand.test.ts` (41 tests, including the reported conversation as a regression), 12 structured-interpretation tests with a fake provider, 19 new eval scenarios (B 50/50, 212/212 assertions), and two new browser tests (the reported conversation spoken through the mocked microphone, with its Engineer View trace; Edit before sending). Results in [LIMITATIONS.md](LIMITATIONS.md).

**Still true.** The lexicon covers the phrasings it was written for and close variations; it is not open-ended understanding. The structured LLM reading has been tested with fake providers only. See LIMITATIONS.

## v4: lessons and Engineer View

**Scope decisions.** The brief asked for a redesigned Engineer View, a home screen, the algebra lesson kept intact, and physics and geometry lessons — with permission to drop the third lesson if it couldn't be finished and verified. Both new lessons were built, because the shared kernel let each one be a small, testable module; neither is a "universal reasoning engine".

**What changed.**
- Routes: `/` is now the lesson home; algebra moved to `/learn/algebra` unchanged in behaviour; `/learn/physics` and `/learn/geometry` are new. Each lesson keeps its own signed session in the browser (`sessionKey(lesson)`), so moving between lessons never loses progress. `/api/turn` takes a `lesson` and refuses a state that belongs to another lesson (400).
- `src/components/lesson/LessonShell.tsx`: the student shell (conversation, voice, sound, menu, drawers, progress rail, start screen, error recovery) extracted from the algebra page into one component every lesson uses; the algebra page is now an adapter over it.
- `src/engine/subjects/`: a shared kernel (requests via the same phrase rules as algebra, NOTICE → THINK → TRY, reveal only after real effort, "don't tell me", repeated wrong answers escalate, cut-off sentences, a leak guard, progress records, idempotency, model-call budget, trace) and two subject modules, each with its own reader and exact verifier (see README).
- Optional model reading for unplaced text in the new lessons (`LlmTeacher.interpretSubject`): closed labels, numbers must be in the student's words, verifier still decides. Tested with a fake provider only.
- Engineer View rebuilt around Overview, Decision timeline, Evaluation lab and Architecture & safety, in the lessons' own visual language. The previous stage-by-stage chain and evidence tabs are kept under each card's *Technical details*. The eval lab runs geometry and physics suites too and states plainly that the real-model column is not tested without a key and that fake-provider unit tests are not model results.
- Student view: the engine status moved out of the panel header earlier (v3.4); the start screen and menu now say what the tutor can understand without a model.

**Verified.** Typecheck, lint, 275 unit tests, eval (B 50/50, G 14/14, P 11/11, C not run), production build, 35 browser tests twice, visual audit at 320–1440 px and 200 % zoom. Details in LIMITATIONS.

## v6 audit: does it teach like a teacher? (10 Oct 2026)

Done before changing anything, by reading the code and driving the real engines with a script (deterministic teacher, no key).

### The eleven questions

| Question | Answer from the code |
|---|---|
| Which teaching decisions are deterministic? | All of them in the deployed app. The policy (`policy.ts`, rule table in `rules.ts`) lists the permitted moves for every turn; without a key the first one is taken. With a key, a model may *choose among* the permitted moves and word them; it can't add a move. Geometry and physics are fully deterministic (`subjects/kernel.ts`). |
| Which responses come from templates? | Every reply in the live demo (`language/templates.ts`, `language/explanations.ts`, and the subject modules' wording). Variety comes from several wordings per move, chosen by turn number — not from a model. |
| Is an actual LLM used? | Only if `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set. The live site has none, so no. The model path is tested with fake providers and local fake HTTP servers; it has never been run against a real model here (Policy C "not run"). |
| How is student intent interpreted? | Ordered regex phrase rules (`intent.ts` `PHRASE_RULES`), an operation lexicon read against the current equation (`understand.ts`), the exact maths parser, and per-subject readers. Unplaced text → a clarifying question, or (with a key) a schema-constrained model reading that is then verified. |
| How are misconceptions detected? | By computing what the student did to each side (`observe.ts`) and matching step-level and value-level patterns (`misconceptions.ts`); for physics/geometry, by comparing the value to known wrong computations (added the forces, used 360°, forgot to halve…). Shown in the console as hypotheses, never as labels to the student. |
| How does the tutor remember earlier turns? | Signed session state: attempts, hint level, help requests, a dialog memory (`awaiting`, last question, last proposal, repeats), misconception history, interventions. **Missing before v6:** what *approach* had been tried, how many times in a row the student had been stuck, and whether they'd asked for the answer. |
| What happens after repeated confusion? | **Defect.** A fixed ladder by hint level. Algebra moved NOTICE → THINK → TRY → show step, but never said it noticed the student was still stuck and never changed modality. Physics/geometry: four "I don't know"s gave four rungs of text hints then the answer — no picture, no smaller question the board could answer. |
| How are answers verified? | Exactly: rational-arithmetic parser/solver for algebra (equivalence, not string match); exact net-force and angle-sum computation; a closed outcome list for motion questions. Unchanged in v6. |
| How do voice and whiteboard share state? | Both are driven by the same server response: the tutor message (text, action, rule, anchor, focus terms) is spoken by the browser and drives the board highlight. There is no word-level timing; a highlight lasts for the whole turn. |
| Are learning outcomes genuinely measured? | Within a session, honestly: first attempts on fresh problems without help, BKT priors, "insufficient evidence" when there isn't enough. No retention check. Physics/geometry only count "solved without hints". |
| Which console events are real or simulated? | The decision timeline shows the student's real turns from this browser. The evaluation lab runs scripted *students* against the real engine, live. The LLM row is reported "not run" without a key, never simulated. Nothing in the console is mocked. |

### Behaviour probe (before v6), exact tutor replies

- **"Bro, I hate algebra"** → `R22_CLARIFY` "I'm not sure what you mean by “Bro, I hate algebra”. Would a small hint help…" — misread a feeling as unclear input.
- **"lol this is so boring"** → `R8_HELP_BEFORE_TRYING` — treated as a help request.
- **"3x = 25" three times** → probe, then the *identical* respectful-challenge reply twice ("I like that you're confident — let's test it…"), assuming confidence the student never expressed.
- **"Just tell me the answer" ×3** → the help ladder, without ever acknowledging what was asked.
- **Physics "I don't know" ×4** → four text hints, then the worked answer. No use of the arrows on the board.
- **"what's your favourite football team?"** → fine (redirect), but the same line every time.
- **Stock praise:** "Yes! … Nice move." on every valid step; "you've got this skill" and "great work!" at the end.

### What v6 changed, mapped to the five questions

1. **When to explain, ask, wait or intervene** — the action set is now ASK · HINT · EXPLAIN · VISUALIZE · WAIT · RETEACH · ASSESS · ENCOURAGE · CLARIFY (+ VERIFY, RECAP). A *teaching memory* in the signed state records confusion count, strategies tried, hint history, answer requests, last verified line and the current objective. Repeated confusion walks a strategy ladder (simplify → analogy → picture → first part worked → worked solution only when withholding stops helping) in all three lessons; the same mistake twice switches strategy; feelings get ENCOURAGE; "let me think" gets WAIT (explicit signal only — never inferred from elapsed time).
2. **A reliable harness** — every turn: read → verify → update evidence → permitted moves → choose → word → guard → anti-repetition → whiteboard cue → deliver. Anti-repetition is a deterministic check against everything said on the current problem; it picks another wording or the next permitted move and notes it in the trace.
3. **Measuring learning** — guided → independent (4x + 3 = 19; same relationship with new numbers in physics/geometry) → transfer (a different form or relationship). Guided and unaided performance are recorded and shown separately; the end screen says what happened today and that retention needs a later check.
4. **A whiteboard for a 12-year-old** — the balance (drawn from the verified current line, removed as soon as the line changes), move choices on the guided problem after hesitation (checked like typed words), tappable force arrows that answer the tutor's sub-question, tappable/lit angles and a 180° strip.
5. **Voice, reasoning, drawing and responding as one** — the same server turn carries text, action, the picture cue and the sub-question the board can answer. Optional Google Chirp 3 HD voice behind `/api/tts` (off without a key), with cancellation, no overlap, usage caps and fallback to the browser voice. Not implemented: streaming speech, barge-in while audio plays (other than Stop / tapping the mic), word-level sync.

## v7: student-only app (10 Oct 2026)

- **Removed from the app:** the engineering console (`/console`: overview, decision timeline, evaluation lab, architecture & safety) and `/api/eval`, plus every link to them (home header, lesson menu). Both routes now return 404 (checked in `e2e/home-subjects.spec.ts`). Kept: the engine, verifiers, session state, guard, the eval runner and scenarios (`npm run eval`), `src/engine/rules.ts` (the rule table, still tested), and the per-turn traces the tests read.
- **Welcome state:** "Ready to figure this out?" with **Start Lesson** and a Sound on/off toggle. Nothing plays until Start; the choice is kept for the tab and shown in the menu. Returning to a lesson in progress skips the welcome ("Welcome back"); Restart starts a clean lesson.
- **Stages:** Learn Together (Let's work it out) · Try It Yourself (A new problem) · Challenge Yourself (A different twist). The behaviour behind them is unchanged.
- **Tone:** shorter replies (the balance picture, help openers, the reveal, the off-topic redirect); a bare "why?" in physics and geometry now explains the tutor's latest step (`whyLast`) instead of a general paragraph.

## v8: sign-in and hiding internals (11 Oct 2026)

The full security review, architecture and remaining risks are in [SECURITY.md](SECURITY.md).

What it found:
- Every page and API was public, including the billable voice route.
- `/api/turn` returned the full decision trace, and the browser stored it.
- The browser held the full lesson state: answers to unreached problems, the generator seed and the teaching memory.
- The client bundle included the misconception probes.
- `/api/health` disclosed configuration.
- 400 responses listed schema paths.
- The maths renderer could return raw input as HTML if KaTeX threw.
- No security headers were set.
- Next 15.5.4 had critical advisories.

All of these are fixed. Each fix has a unit or browser test, listed in SECURITY.md.
