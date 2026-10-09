# Research, JD decode, and the decision

*Researched 8 Oct 2026. Every external claim below links to its source. Where something could not be verified, it says so.*

## 1. Company identity — what could and couldn't be verified

| Item | Status | Notes |
|---|---|---|
| Application link `lnkd.in/dihndZmg` | **Not resolvable** by automated tools (LinkedIn blocks crawlers). | The full JD text could not be retrieved. |
| Hiring company | **Unknown.** | Searches combining Devvarat Meena with the JD's distinctive details (Bengaluru, ~$2.5M raised, Android app, voice + shared whiteboard, two-sigma) returned no matching public posting. |
| Whitetable AI as employer | **Not assumed.** | Searching "Whitetable AI tutor" returned no matching company. Devvarat sharing the post is not evidence he works there. |
| JD details used in this project | **From the candidate's prior reading of the JD**, not independently verified. | Listed verbatim in §3. If the founder's wording differs, §3 is the place to update. |

**Bengaluru AI-tutor companies found (context only — none is claimed to be the employer):**

- **YoLearn.ai** — described as a voice-first tutor that explains concepts in real-time conversation while drawing on a digital sketchpad; raised $500K pre-seed; mobile app "YoTutor.ai" on Android and iOS. ([Ascendants](https://ascendants.in/funding-feed/yolearn-ai-raises-500k-pre-seed/)) — *Note: the funding figure ($500K) does not match the JD's $2.5M.*
- **ProLearn** — Bengaluru, ₹30 crore (~$3.5M) pre-seed led by BEENEXT, June 2026, K-12 and exam prep. ([Dealroom](https://dealroom.co/news/130878-prolearn-raises-30-crore-pre-seed-to-build-an-ai-tutor-for-indias-k-12-a/))
- **padho.ai** — founded Aug 2026, Socratic dialogue + "interactive visual notebook", grades 6–12. ([Dealroom](https://dealroom.co/just-founded/padho-ai/))
- **Stimuler** — voice-first English tutor, $3.75M. ([Inc42](https://inc42.com/?p=511851))

**Consequence:** the project is built *company-agnostic*, grounded only in the JD statements, and framed as an engine that plugs into any tutoring app. It does not claim knowledge of anyone's internal systems.

## 2. Learning science that shaped the design (verified)

| Finding | Source | Design consequence |
|---|---|---|
| ~1,000 high-school maths students: an unguarded GPT-4 tutor improved practice performance, but when access was removed students did **17% worse** than controls; a tutor with learning safeguards largely mitigated the harm. | Bastani et al., *PNAS* 2025 ([IDEAS/RePEc](https://ideas.repec.org/a/nas/journl/v122y2025pe2422633122.html), [Wharton summary](https://chibe.upenn.edu/news/without-guardrails-generative-ai-can-harm-education/)) | Answer leakage is a *learning-outcome* failure, not a style issue → a deterministic **leak guard** on every utterance and a "no premature leak" eval metric. Practice-time correctness is not learning → **mastery is measured only on independent transfer**. |
| Harvard RCT (Physical Sciences): students learned significantly more, in less time, with a custom AI tutor designed around the same pedagogical best practices as an active-learning class. The design was deliberately brief to manage cognitive load. | Kestin et al., *Scientific Reports* 2025 ([Harvard SERL](https://serl.fas.harvard.edu/publication/ai-tutoring-outperforms-class-active-learning-rct-introducing-novel-research-based), [Hechinger](https://hechingerreport.org/?p=103689)) | The pedagogy, not the model, is the active ingredient → **policy is explicit code**, the LLM only phrases. Utterances capped at ~2 sentences (**TOO_LONG guard**). Caveat: university students, not Grade 7. |
| Google's LearnLM treats pedagogy as *instruction following* and evaluates it with scenario-based, expert-rated protocols; their Eedi RCT reported LearnLM-supported students did at least as well as with human tutors on measured outcomes. | LearnLM tech reports ([arXiv 2412.16429](https://arxiv.org/html/2412.16429v2), [arXiv 2512.23633](https://arxiv.org/html/2512.23633v1)) | **Scenario-based eval suite** with property assertions, runnable against any language model. |
| Tutor CoPilot RCT (700+ tutors, ~1,000 students): students were 4 pp more likely to master topics (9 pp for lower-rated tutors); tutors asked more guiding questions and used less generic praise. ~$20/tutor/year. | Stanford NSSA ([study page](https://nssa.stanford.edu/studies/tutor-copilot-human-ai-approach-scaling-real-time-expertise)) | Policy prefers **probing questions** and **specific praise** ("you subtracted 5 from both sides") over generic praise. |
| Bloom (1984), the two-sigma problem: 1:1 tutoring combined with mastery learning outperformed conventional instruction by ~2 SD. | Canonical; cited in the JD | Mastery learning → explicit **mastery criterion** before the lesson ends. |

**Competitive context (verified at feature level only):**
- *Khanmigo* is described as answering a maths question with a question and steering students back when they push for the answer; a reviewer finds it slower than looking up answers. ([JetLearn review](https://www.jetlearn.com/blog/how-uk-students-are-using-khanmigo-socratic-and-ai-tutors----and-whats-actually-worth-your-time)) → "Just tell me" needs *nuance*, not just refusal: TutorOS shrinks the step, and reveals after real effort (rule R9).
- *Duolingo Max* offers real-time spoken "Video Call" conversations with a character, plus Roleplay with AI feedback. ([Duolingo blog](https://blog.duolingo.com/duolingo-max)) → voice is now table stakes for consumer AI learning.
- *Not researched in depth:* voice-vs-text learning outcomes. I did not find a credible head-to-head study in the time available, so no claim is made.

## 3. JD decode — line by line

*JD lines are as supplied by the candidate (not independently verified).*

| A. JD phrase | B. Problem it signals | C. What the founder needs owned | D. Convincing evidence | E. Demo feature | F. Likely interview questions | G. Defence |
|---|---|---|---|---|---|---|
| "Turn an LLM into an effective teacher, not a Q&A chatbot" | Models default to being helpful = giving answers. | The teaching brain. | A policy that controls when the model may explain, and proof it holds under pressure. | `policy.ts` returns permitted moves; the LLM may only choose among them and word them; eval shows a naive baseline leaking the answer in 25 of 50 scenarios vs 0 for the policy. | "Why not just prompt it well?" | Prompts are probabilistic and untestable; a rule table is diffable, testable, and A/B-able. The LLM still adds warmth and variety. |
| "When to ask, hint, explain, wait, probe, verify" | Needs an explicit action space and transition logic. | Pedagogical decisioning. | Typed actions with recorded reasons. | ASK/HINT/EXPLAIN/WAIT/VERIFY/RECAP + rule id + reason on every turn in the console. | "How do you choose between probe and hint?" | First error → probe; unknown error → ask for reasoning; repeated → hint ladder; bottom-out on the next step only. |
| "Agents orchestrate a complete tutoring session" | Multi-turn state, phases, end conditions. | Session orchestration. | A full lesson that starts, adapts, verifies and ends on its own. | Guided → transfer → mastery/close, with phase transitions in trace. | "Single agent or many?" | One orchestrator + deterministic tools. Multi-agent adds latency and failure modes without a clear win here. |
| "Measure real learning, not whether the conversation looks good" | Engagement metrics mislead (see Bastani). | Learning measurement. | Mastery defined on unassisted transfer; explicit criteria. | BKT estimate + "2 consecutive independent transfer solves"; assisted success not counted. | "How would you know it works in production?" | Delayed independent retest per skill; cohort comparison of retest accuracy by policy version. (Future work, not claimed.) |
| "Voice, thinking, drawing, responding with low perceived latency" | Multimodal sync, barge-in, turn-taking. | The realtime interaction loop. | Visible listening/thinking/speaking states; interruption that doesn't corrupt state. | Web Speech in/out, barge-in, silence detection; `R11_REPEAT` doesn't advance state (tested). | "How would you get to sub-second?" | Stream LLM tokens to TTS; start TTS on the first sentence; fast model for phrasing; deterministic validation adds ~1 ms. |
| "Shared whiteboard" | The board must reflect validated maths, not model text. | Board ↔ tutor coordination. | Board entries generated from validated steps. | Every step is checked and marked ✓/✗; substitution checks drawn; scratch layer for the student. | "What stops the board showing wrong maths?" | Board content is produced by the validator, never by the LLM. |
| "Child-friendly, intuitive" | Under-13 users, cognitive load. | Student UX. | Short turns, legible type, no PII. | Legible sans (Inter, plain zero), ≤2-sentence turns, contextual help options, profile with delete. | "How do you handle child data?" | No name, no audio stored, local-only demo state; transcript-only to server. |
| "Raised ~$2.5M, Android app with early positive feedback" | Small team, a live product, limited runway. | Ship without rewrites. | An engine that integrates, not a competing app. | Framework-free TS engine + HTTP contract (`docs/INTEGRATION.md`). | "How would this fit our app?" | Stateless `/api/turn` endpoint or embed the engine; no assumptions about their stack. |
| "Founding engineer owns product + engineering outcomes" | Ambiguity, no spec. | Judgement end-to-end. | Choices documented with trade-offs and known limits. | This doc, README limitations, case study. | "What would you do in week one?" | Instrument the real app: per-turn traces + one learning metric, before changing pedagogy. |
| "2–5 years; uses Claude Code / Cursor daily" | AI-assisted speed with accountability. | Velocity without slop. | Tests that fail meaningfully; evals that caught real bugs. | 96 unit/integration + 4 e2e tests; a self-audit of v1 with one regression test per finding (AUDIT.md). | "How do you review AI-written code?" | Specs as tests first, deterministic cores, read every diff, never trust untested model output. |

## 4. Options scored (1–10)

| Criterion | A: standalone tutor app | B: extension of their product | C: teaching-intelligence engine + eval lab with a student demo |
|---|---|---|---|
| JD alignment | 7 | 9 | 9 |
| Founder interest | 5 | 9 | 8 |
| Founding-engineer evidence | 6 | 7 | 9 |
| Technical sophistication | 6 | 6 | 9 |
| Realistic completion | 7 | 3 (no access to their app/APIs; company unverified) | 8 |
| Demo memorability | 6 | 8 | 8 |
| Product value | 5 | 8 | 8 |
| Ease of integration | 3 | 7 | 9 |
| Proves reliability + learning behaviour | 4 | 5 | 10 |
| Differentiation from generic AI tutors | 3 | 6 | 9 |
| **Total** | **52** | **68** | **87** |

**Challenge to the hypothesis:** B would be stronger *if* the company were verified and its app inspectable — a demo built on their product reads as ownership. It can't be done honestly without that access. C is chosen, framed as an engine *for* their product (not a competitor), with B as the obvious next step once the founder shares context.

## 5. The chosen demo

**One loop, done deeply:** Grade 7 two-step linear equations. The tutor never decides correctness; an exact-rational algebra validator does. The policy decides the move; the language model only phrases it; a guard checks every sentence for answer leaks and false maths before a child hears it. Mastery requires two consecutive independent solves on *fresh* problems with different surface forms.

## 6. Hiring-psychology notes (speculative where marked)

1. **First 30 seconds:** the tutor refusing to be dumb — student types `x = 8`, tutor says it can't tell why and asks, instead of guessing. Then flip to the console showing *why*. (Signalling theory: costly-to-fake evidence beats claims.)
2. **They'll test:** "just tell me the answer" five times; nonsense input; insisting on wrong maths; interrupting; whether the console numbers are real (run the eval live).
3. **Trust-building decisions:** LLM can't override maths; failures have deterministic fallbacks; the eval includes a baseline the suite is *supposed* to fail.
4. **Looks superficial if:** fake metrics, a "learning gain %" with no study, a scripted happy path, a dashboard with placeholder numbers.
5. **Leave out:** multi-subject, auth, payments, avatars, multi-agent diagrams.
6. **90-second walkthrough:** see `DEMO_SCRIPT.md`.
7. **Ambition without criticism:** "I don't know your stack, so I built the piece I'd want to own and made it pluggable."
8. **Implemented vs proposed:** README has a two-column table; never blur them.
9. **Week-one independence (speculative):** show you can turn ambiguity into a spec, a test and a shipped thing — which is what this repo is.
10. **Questions to ask:** see `OUTREACH.md`.
