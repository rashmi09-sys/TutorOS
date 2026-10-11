# Limitations: what has and hasn't been verified

Status as of v6 (teaching memory and strategy ladder, new actions, interactive whiteboard, optional cloud voice, three-stage lessons), 10 Oct 2026. "Verified" means a check was executed in this repository and passed. Nothing below is estimated.

## Verified in v8 (sign-in and hiding internals), 11 Oct 2026

| Area | How | Result |
|---|---|---|
| Types, lint | `npm run typecheck`, `npm run lint` | clean; 0 errors, 0 warnings |
| Unit + integration | `npm test` | 374 / 374 passed, 20 files: the 341 earlier tests (the four route/storage files updated for sealed state and sign-in) plus `tests/auth.test.ts` (22), `tests/xss.test.ts` (7) and new route checks |
| Browser | `npm run test:e2e` against the production build, signed in with a throwaway account | 56 / 56 passed, two consecutive runs (46 earlier + 10 in `e2e/auth.spec.ts`) |
| Scenario evals | `npm run eval` | unchanged: B 59/59 (269/269), A 9/59 (30 leak), C not run, G 17/17, P 16/16 |
| Visual audit | `scripts/ui-audit.ts`, now including the sign-in page with and without its error | no layout defects found |
| Real credentials | the configured hash in `.env.local`, production server, curl | correct password → 200 + cookie (Secure, HttpOnly, SameSite=Lax); wrong password or lowercase username → the same 401; signed-in `/api/tts` reaches the Google client (here `502 upstream_auth`, no credentials in this sandbox); signed-out → 401 |
| Secrets | grep of `.next/static`, `.next/`, tracked and untracked files, `git log -p` | no password, hash, secrets, env-var names, rule names, templates or prompts; no source maps |
| Dependencies | `npm audit` | no runtime advisories; 4 high in a dev-only lint chain with no fix |

Not verified: sign-in on the deployed Vercel app (nothing has been deployed), and the Google voice after sign-in with real credentials (none here). See [SECURITY.md](SECURITY.md#verifying-a-deployment) for the post-deploy checks.

## Verified in v6/v7 (not all re-run in v8)

| Area | How | Result |
|---|---|---|
| Types | `npm run typecheck` | clean |
| Lint | `npm run lint` (ESLint 9: typescript-eslint, react-hooks, next) | 0 errors, 0 warnings |
| Engine, understanding of moves in words, voice state machine, tutor speech, language rules, LLM control logic (incl. structured interpretation), server routes | `npm test` (vitest) | 332 / 332 passed, 18 files (incl. `tests/teaching.test.ts`: the twelve teaching-behaviour cases; `tests/tts.test.ts`: the optional cloud voice with a fake Google endpoint) |
| Full student journey, every visible control, voice interaction with mocked speech APIs, the reported BODMAS conversation spoken end to end, Edit before sending — in a real browser against the production build | `npm run test:e2e` (Playwright, Chromium) | 46 / 46 passed, 7 files, two consecutive runs (includes the Grade 7 journey, the whiteboard interactions in `e2e/whiteboard.spec.ts`, and navigation and progress persistence across all three lessons) |
| Teaching behaviour on 59 scripted algebra scenarios | `npm run eval` | B 59/59 scenarios, 269/269 assertions, 0 answer leaks, 0 false maths, context 9/9, language 7/7, repetition 6/6. A (answer-giver control) 9/59, 30 scenarios leak the answer. |
| Geometry and physics lessons | `npm run eval` (G, P) | G 17/17 scenarios, 59/59 checks; P 16/16, 53/53; 0 leaks, 0 model calls |
| Production build | `npm run build` | passes; no key names in the client bundle (grep of `.next/static`) |
| Visual audit | `scripts/ui-audit.ts` against the production build: home, the welcome state, all three lessons, 320–1440 px and 200 % zoom | no layout defects found |
| Fresh install | `npm ci && npm run build && npm start` in a clean copy without `node_modules` or `.next` | `/api/health` responds; lesson starts |
| Logs contain no student text | grep of the server log after the e2e run | 0 matches for the inputs the tests typed |
| Mobile layout | e2e at 390 px; manual check at 320 px | no horizontal scroll |
| Contrast | computed WCAG ratios for the text colour tokens against every light background colour in `globals.css` | re-computed for the v5 palette: body, secondary text, subject labels, status colours and buttons ≥ 4.5:1 (AA) on their backgrounds (disabled controls excepted); not checked with an automated page-wide tool |
| Reduced motion, keyboard-only use | e2e | animations off under `prefers-reduced-motion`; start, answer and open a note with the keyboard only |

Voice (mocked browser APIs): start listening, partial vs final transcript, Done submits exactly once, ✕ and Esc never submit, permission denied, no microphone, unsupported browser, browser-ended sessions (silent resume capped at two, then a recovery state), duplicate result events, rapid start/cancel, spoken help requests ("I'm stuck", "explain it another way", challenging the tutor, "why"), the tutor never being recorded, nothing playing on load / reload / navigation, the intro spoken exactly once, Stop and Replay, no idle follow-ups, Read without sound, keyboard-only voice, phone layout while listening.

The e2e journey covers: start; an incorrect answer; explaining the mistake; a valid hint with highlighted terms; the *I'm stuck* quick reply; challenging the tutor; folding and opening notes; completing the guided problem; expanding the finished problem; the scratch pad; reload and resume; two independent checks; transcript and progress drawers (close button and Escape); Restart; Delete my data; Cancel during a pending turn; no uncaught page errors.

## Not verified

### Policy C (LLM teacher) has not been run against a real model

No provider credentials were available in this environment. Policy C is reported as **not run** by `npm run eval`. No results were simulated.

What *is* tested: the LLM control logic with fake providers (choosing a non-default move, rejecting invented candidates, guard rejection → repair retry → fallback, timeouts, transport errors) and real HTTP round-trips through the Anthropic SDK and the OpenAI-compatible client against **local** fake servers.

What is *unknown* until C runs: how well a real model reads unusual student language into the structured meaning (and how often it says "unclear"), real-model teaching quality, how often the guard rejects real output, latency, token usage and cost.

**To run C:**

1. Create `.env.local` in the project root (never commit it):
   ```bash
   cp .env.example .env.local
   ```
   Fill in **one** of:
   - `ANTHROPIC_API_KEY=…` (model defaults to `claude-haiku-5-5`; override with `LLM_MODEL`), or
   - `OPENAI_API_KEY=…` and `LLM_MODEL=…` (plus `OPENAI_BASE_URL` for any other OpenAI-compatible endpoint).

   Optional: `PRICE_INPUT_PER_MTOK` and `PRICE_OUTPUT_PER_MTOK` (USD per million tokens) to see cost; otherwise cost is shown as unknown.
2. Run the suite:
   ```bash
   npm run eval              # A, B and C; writes eval-results.json
   npm run eval -- --only C  # C only
   ```
3. Check `/api/health` reports `"teacher": {"mode": "llm", …}`, and the student header shows **LLM · provider:model**.
4. Record the C row (scenarios, leaks, guard rejections, p50/p95 latency, tokens, cost) in the README's evaluation table, and read a sample of transcripts before trusting the numbers.

Expect 50 scenarios × several model calls each. With a small model this is cents, not dollars, but set prices to see the exact figure.

### Physics and geometry lessons

- **Bounded on purpose.** Physics checks forces along one line (two opposite pushes, or a missing balancing push) and a closed list of motion outcomes; geometry checks the triangle angle sum including right-angled and isosceles cases. Anything else — explanations of *why*, forces at angles, mass and acceleration, exterior angles — is not judged; the tutor says what it can check.
- **Small question banks.** One guided question and two generated checks per lesson. Wording is templated; it will feel repetitive sooner than algebra.
- **No mastery estimate.** These lessons record per question whether it was solved without hints; three questions aren't enough evidence for a mastery claim, so none is made.
- **Model reading untested with a real model.** The structured reading for unplaced text has only been exercised with a fake provider.
- **Explorers can show answers.** Dragging the triangle or setting the pushes to a problem's numbers shows the result. They are learning tools; a determined student can use them to look an answer up.
- **Scenarios written alongside the code**, like the algebra conversation scenarios: they show the documented behaviour, not coverage of unseen phrasings.

### Other gaps

- **Voice on real devices.** The voice state machine is tested with a fake recognizer (unit) and a mocked browser API (e2e), firing the same events a browser fires. No real microphone, permission prompt, recognition engine or synthetic voice was used. Before recording a demo, check by hand on the demo machine (Chrome, real microphone):
  1. Tap the mic, allow the permission prompt → "Listening"; speak "three x equals fifteen" with a pause in the middle → nothing is sent during the pause; ✓ Done sends the whole line.
  2. Speak, then ✕ → nothing is sent; Esc does the same.
  3. Stay silent for ~10 s → the line stays in Listening, or shows "Listening stopped" with Keep talking (Chrome ends silent sessions; up to two silent resumes happen first).
  4. Block the microphone in the address bar → "Microphone permission is blocked"; nothing loops.
  5. Say "I will do BODMAS multiplication", ✓ Done → the reply mentions multiplication and BODMAS and asks what undoes adding 5. Then say "I said will do multiplication" → "Yes, I heard you say multiplication…". Then say "take five away" → the tutor confirms and asks what the equation becomes (nothing is solved).
  6. Speak a line, then tap **Edit** → the words are in the text box, unsent; fix a word, press Send → one turn.
  7. Start the lesson with sound: the intro plays once, smoothly, in one voice. Press Stop mid-sentence (silence at once), then Replay. Tap the mic while the tutor talks: it stops first, then listens. Use headphones if the room echoes.
  8. Say "can we go slower" → the next tutor turn is read more slowly.
  9. Safari / Firefox: the mic is disabled with an explanation; typing works.
  10. Physics: say "four newtons to the right" → read exactly and marked correct. Geometry: say "seventy five degrees" → correct.
- **Tutor speech on real speakers.** The speech controller was tested against a mocked browser speech queue (unit and browser tests) and against the dev server with React Strict Mode on. This environment has no audio output, so smooth playback on a real Chrome voice still needs a listen on the demo machine (step 7 above). Network voices ("Google …") start more slowly than on-device voices; the controller prefers on-device voices when the browser offers them. If speech is unreliable on a machine, **Read without sound** keeps the full lesson on the page, and **Replay** plays a message again.
- **Recognition accuracy** (accents, children's voices, classroom noise) is untested. Spoken maths is normalised ("three x equals fifteen") and a few known mis-spellings are mapped ("bod mass" → BODMAS), but other misrecognised words are not corrected. The student sees the transcript before sending and can **Edit** it.
- **Read-aloud** word highlighting is approximate (browser boundary events vary by voice) and was not tested against real voices.
- **Duplex conversation**: this is turn-taking (speak → Done → tutor replies), not simultaneous two-way speech. Interrupting the tutor stops its speech; the browser APIs don't allow more.
- **Language understanding** in deterministic mode is explicit matching: phrase rules (`PHRASE_RULES`) for requests, and an operation lexicon (`understand.ts`) for moves described in words, read against the current equation and the tutor's last question. It covers the documented phrasings and close variations, not open-ended language. The 19 conversation scenarios were written alongside the lexicon, so passing them shows the documented behaviour works, not that unseen phrasings will. Unplaced input gets a clarifying question; with an LLM configured, it gets a structured, schema-validated reading that is then verified exactly — **tested with fake providers only**, never with a real model.
- **Words vs written lines.** A correct move described in words is confirmed but never applied: the board changes only when the student writes the line. This is deliberate (the student does the step), but a student who only talks must still say the resulting equation.
- **Measurement of spoken moves.** A wrong move proposed in words (BODMAS multiplication, adding instead of subtracting, one side only) counts as an attempt; on a fresh problem it is an unsuccessful first attempt for the mastery estimate. A reasonable choice, but a choice.
- **Other browsers**: e2e runs on Chromium only. Safari and Firefox are untested.
- **Learning outcomes**: the eval is behavioural tests against scripted students. Nothing here shows that real students learn more. That needs a supervised pilot with a delayed retest.
- **Mastery model**: BKT priors are conventional, not fitted. Mastery is within one session; no retention check.
- **Scope**: one skill (two-step linear equations, integer answers), one fixed guided problem (`3x + 5 = 20`), generated transfer problems.
- **Conversation memory** is short: the tutor's last question, the student's last proposal (repeats within four turns) and a repeat count. It does not summarise longer history.
- **Production hardening**: one shared sign-in account (no per-person accounts or roles); sessions are stateless tokens (rotate `AUTH_SECRET` to end them all); rate limiting (sign-in, turns, voice) is in-memory per instance. No server-side persistence, moderation of free text, or escalation path to an adult. Details: [SECURITY.md](SECURITY.md#remaining-limitations-and-risks).
- **Child-data compliance** (DPDP Act, COPPA, GDPR-K) has not been reviewed.
- **Accessibility**: automated contrast, keyboard and reduced-motion checks only; no screen-reader or user testing.

### Learning evidence (v5)

- The end-of-lesson "What I saw" table is computed only from what the session recorded: lines written, lines that weren't equivalent, help turns (hint rungs, worked steps, explanations — a targeted question or a computed check is not counted as a hint), and whether the first attempt on each fresh problem was right without asking for help first. It describes one session; it is not a validated assessment and says nothing about retention. A delayed retest is not implemented.
- The first independent problem is always 4x + 3 = 19 (so the demo is repeatable); the second is generated from the session seed.

### Voice

- Voice uses the browser's Web Speech API only: input works in Chrome and Edge (in Chrome, audio goes to Google's speech service); read-aloud uses whatever voice the device has. It is turn-based (tap, speak, Done), not streaming, and there's no barge-in while the tutor speaks other than tapping the mic or Stop. Board highlights change per turn, not per spoken word. No paid voice API is integrated. Voice behaviour is tested with mocked browser speech APIs; real microphones and accents have not been tested in automation.

### Teaching behaviour (v6)

- **All wording in the live demo is templated.** The strategy ladder, feelings replies and anti-repetition are deterministic rules with several hand-written wordings each; they are not model reasoning. A long session still draws on a finite set of lines — the anti-repetition check guarantees no exact repeat on a problem, not endless variety.
- **Feelings are read by a short list of phrase rules** ("hate algebra", "boring", "lol", "I'm so bad at maths"…). Other ways of saying it fall through to a clarifying question. There is no detection of distress beyond these phrases and no escalation to an adult — needed before real children use it.
- **Humour** is a few fixed lines, used only for dislike, boredom and laughter, mostly the first time. Whether children find them funny (or annoying) hasn't been tested.
- **WAIT** happens only on an explicit signal ("let me think", "give me a sec"). The tutor never sends unprompted follow-ups, so "not interrupting while they compose" is true by construction — there is no idle timer to tune.
- **The balance picture** only draws equations it can draw honestly (whole numbers, no subtraction on the x side, right side ≤ 40); for others the tutor names the move in words instead.
- **Move choices** appear only on the guided problem after the student hesitates or slips, so the independent problems stay unaided. Picking a move still requires the student to write the resulting line.
- **Physics/geometry sub-questions** ("which push is stronger?", "what do the two known angles add up to?") exist for the net-force and two-known-angle questions; the other question types get the strategy ladder in words and pictures without a tappable sub-question.
- **Problem generation changed** (independent = same relationship with new numbers; transfer = a different relationship), so seeds from before v6 produce different second and third questions.

### Voice (v6.1: Google Chirp 3 HD)

- The Google voice uses the official client library with Application Default Credentials locally and Workload Identity Federation on Vercel. In this repository's test environment there are no Google credentials and outbound calls to Google are blocked, so **real Sulafat audio has not been produced here**. What was verified: the library loads in the production build, missing credentials give `502 upstream_auth` without crashing the server, and 27 tests cover the route and client behaviour against a fake client. Run `npm run tts:smoke` with your ADC to check real audio.
- Usage caps (per-request characters, daily characters, per-client rate) are in memory and per server instance. For a hard ceiling, set a Text-to-Speech quota and a billing budget in Google Cloud.
- No streaming, no interrupting by just speaking (tap the mic or Stop), no word-level highlight sync.
