# Evaluation: what is checked, how, and what it can't tell you

Run it: `npm run eval` (writes `eval-results.json`). Results below were produced on 10 Oct 2026 in this repository, deterministic mode, no API key.

## How a scenario works

The **student is scripted** (fixed inputs, reproducible); the **tutor is the real engine** — the same `step()` / `stepSubject()` the lesson UI calls. Assertions check properties of what the tutor did, not exact wording, and accept any move the policy permits, so the same suite can run against templates and against a model.

## What is checked (assertion categories)

| Category | Checked by | Example |
|---|---|---|
| Leak | The answer (or the next step's result) never appears before it's sanctioned | `statesAnswer()` parses every equation the tutor wrote |
| Maths | Every calculation the tutor states is re-computed exactly | "25 + 5 = 30" is re-checked |
| Diagnosis | The misconception matched the student's actual error | `3x = 25` → sign error on the inverse operation |
| Appropriateness | The move fits what the student said | "let me think" → WAIT, no question |
| Recovery | Repeated errors get escalating, different help | ladder never goes down; no identical consecutive replies |
| Mastery | Evidence is counted honestly | guided success ≠ independent; worked-through ≠ independent |
| Robustness | Odd inputs don't corrupt state | off-topic isn't an attempt |
| **Context** (v6) | The reply builds on the lesson so far | after an off-topic question, the reply names the current line "3x = 15"; "105" is read as the answer to the tutor's smaller question |
| **Language** (v6) | Age-appropriate and specific (rules below) | no stock praise; no jokes when a student is worried |
| **Repetition** (v6) | Never the same reply, or the same approach, twice on a problem | four "I don't know"s → four different strategies |

### The language rules (deterministic, `src/engine/eval/language.ts`)

- No put-downs or unsuitable words (stupid, dumb, lazy, careless, "obviously", "that's easy", swearing).
- Never claims to be a human or a real teacher.
- No sentence over 35 words, no reply over 90 words.
- No stock praise: "Great job", "Good job", "You've got this", "Nice move", "Awesome", "Amazing", "Fantastic".
- No humour (a small list of the tutor's own joke words) in replies to a worried or frustrated student.

These are rules, not a judge. They catch the specific failure modes we found (the old "Nice move", "you've got this skill", "great work!" lines were caught and rewritten); they cannot tell whether a reply *feels* warm, whether an analogy is a good one, or whether a 12-year-old would understand it. That needs people.

### No model judge

There is no LLM-as-judge rubric in this repository and no qualitative score is claimed. If one is added, it should be validated against teachers rating the same transcripts first, and its model, prompt, inputs and agreement rate reported next to the scores.

## Results (10 Oct 2026)

| Suite | Scenarios | Assertions | Answer leaks | False maths | Context | Language | Repetition |
|---|---|---|---|---|---|---|---|
| A · baseline answer-giver (negative control) | 9/59 | 124/269 | 30 | 0 | 4/9 | 7/7 | 0/6 |
| B · tutor, deterministic | **59/59** | **269/269** | **0** | **0** | 9/9 | 7/7 | 6/6 |
| C · tutor + LLM | **not run** — no provider key; not simulated | | | | | | |
| G · geometry, deterministic | 17/17 | 59/59 | 0 | 0 | 1/1 | 3/3 | 1/1 |
| P · physics, deterministic | 16/16 | 53/53 | 0 | 0 | 1/1 | 3/3 | 1/1 |

A is the same engine with a naive "explain the full solution" policy. It passes the language rules (its wording is plain) but leaks the answer in 30 scenarios and fails every repetition check — which is the point of having it: the suite has teeth.

## What these numbers do not show

- **That students learn.** Every scenario is a scripted student. Learning needs real students and a delayed retest.
- **That the tutor understands open-ended language.** The scenarios were written alongside the phrase rules they test. Unseen phrasings fall back to a clarifying question (or, with a key, a model reading that is then verified).
- **How a real model behaves.** Policy C has never been run against a real model here.
- **Voice quality.** Speech is tested with mocked browser APIs and a fake Google endpoint; no real microphone, accent or audio output was evaluated.

## The behaviour cases asked for, and where each is tested

| Case | Unit test (`tests/teaching.test.ts` unless noted) | Scenario | Browser |
|---|---|---|---|
| "I don't know" four times | §1, all three lessons | `v6-dont-know-four-times`, `p-dont-know-four`, `g-dont-know-four` | `e2e/whiteboard.spec.ts` (balance on the third) |
| Same mistake repeated | §2 | `v6-same-mistake-three-times` | — |
| Unexpected correct answer | §3, `tests/journey.test.ts` | `v6-unexpected-correct`, `g-sub-question` | `e2e/lesson.spec.ts` (15 = 3x) |
| Asks for a different explanation | §4 | `v6-explain-differently-three-times` | — |
| Off-topic question | §5 | `v6-off-topic-and-back`, `p-off-topic-honest` | — |
| Asks for the answer directly | §6 | `v6-answer-request-acknowledged`, `p-answer-request` | — |
| Transfer solved independently | §7, `tests/journey.test.ts` | `v6-independent-transfer` | `e2e/lesson.spec.ts` (Grade 7 journey) |
| Voice service fails | `tests/tts.test.ts` (no key, upstream error, timeout, budget, client fallback) | — | `e2e/voice.spec.ts` (mic denied, unsupported) |
| Session restarts | §9, `tests/storage.test.ts` | — | `e2e/navigation.spec.ts`, `e2e/lesson.spec.ts` (reload, tamper) |
| Whiteboard and lesson state in sync | §10 | — | `e2e/whiteboard.spec.ts` (balance removed when the line changes; tap answers the sub-question) |
| Jokes or frustration | §11 | `v6-feelings`, `g-feelings` | — |
| No repetitive, generic replies | §12 (a long messy session in each lesson) | language + repetition categories | — |
