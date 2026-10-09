# Case study: making an LLM teach instead of answer

## Problem

A tutoring product lives or dies on one behaviour: the tutor must make the student do the thinking. LLMs are trained to be helpful, and "helpful" defaults to giving the answer. Field evidence says that matters: in a ~1,000-student RCT, an unguarded GPT-4 tutor raised practice scores but students did 17% worse once it was removed, while a safeguarded tutor largely avoided the harm ([Bastani et al., PNAS 2025](https://ideas.repec.org/a/nas/journl/v122y2025pe2422633122.html)).

Prompting alone is a weak control: it's probabilistic, invisible in production, and impossible to regression-test. I wanted every teaching decision to be **explicit, explainable and testable**.

## Approach

**1. Split correctness, pedagogy and language.**
- Correctness: an exact-rational parser/solver. "Is 25/3 right?" is decided by arithmetic, not by a model or floating point. It also understands speech-recogniser output ("three x equals fifteen").
- Pedagogy: a rule table (`policy.ts`) maps a *validated observation* to an action — ASK, HINT, EXPLAIN, WAIT, VERIFY, RECAP — with a rule id, a reason, the facts it may use, and whether the answer or next step may be revealed.
- Language: the model gets the decision and the facts and phrases it in ≤2 sentences. It never chooses the action.

**2. Diagnose with executable misconceptions.** Each misconception is a buggy procedure that can be run: for `3x + 5 = 20`, "used the same operation instead of the inverse" produces `25/3`; "read 3x as 3 + x" produces `12`. A wrong answer is matched exactly. If nothing matches — `x = 8` — the tutor says so in effect and asks "how did you get that?" rather than inventing a diagnosis. The student's explanation ("I added 3 and 5") is then classified (Claude with schema validation, heuristic fallback).

**3. Guard every utterance.** Before a child hears anything, the guard extracts every equation and number claim:
- answer or next-step result stated before the policy allows → reject;
- an equation that is neither the student's own (quoting is fine) nor true for the problem → reject (this is the hallucinated-algebra check);
- pure arithmetic that is false → reject;
- too long → reject.
On rejection the model gets one repair attempt with the reason; then a deterministic template is used. The trace records all of it.

**4. Define mastery so it can't be faked by scaffolding.** Bayesian Knowledge Tracing counts only *unassisted first attempts*; success after hints is a learning opportunity, not evidence. The lesson ends as "mastered" only at P(known) ≥ 0.9 **and** two consecutive independent solves on fresh problems with different surface forms (`b + ax = c`, `ax − b = c`).

**5. Make the server stateless.** `step(state, event) → (state', utterance, trace)`. Every turn is reproducible, the eval runner is the same code path as production, and the demo deploys to Vercel with no database.

## Evaluation

Twelve scenarios script the *student* (reproducible) and run the *real* tutor: unknown error, "just tell me" before trying, persistent failure until reveal, insisting on `3x = 25`, silence, barge-in, spoken input, each diagnosis, arithmetic slips, true-but-useless steps. Assertions check teaching properties — not strings — so the same suite runs against templates or Claude.

To prove the suite isn't vacuous, it also runs a deliberately naive "answer-giver" policy. *(v1 numbers: tutor-v1 12/12, baseline 2/12. v2, with 25 scenarios: tutor-v1 25/25, baseline 5/25 with answer leaks in 11 — see README.)*

## What testing caught during the build (evals, unit tests and scripted simulation runs)

- The help-intent pattern required the word "answer", so "please just tell me" was treated as off-topic, and the reveal-after-effort rule never fired. Caught by the `persistent-help-reveal` scenario; fixed in the intent parser.
- After showing a step at the top of the hint ladder, a repeated error made the tutor repeat the *identical* explanation. Added rule R7b: switch to a substitution check and ask the student to compare.
- A "what?" after a substitution check was blocked by the guard, because the repeated sentence mentioned the student's implied value, which wasn't in the grounded set for the new turn. Fixed by carrying the previous turn's grounded equations into repeats.
- The explanation heuristic missed "I took away 3" (only "take away" was matched). Caught by a unit test.

## Trade-offs

- **Rules vs a learned policy.** Rules are legible and safe on day one; they won't discover new strategies. The interventions log (action → progress / no progress) is collected so a bandit over rules can be trained once real outcome data exists.
- **Client-held state.** Zero infra and perfect replay, at the cost of tamper-resistance. `SessionStore` is the seam for moving it server-side.
- **Web Speech API.** Free and runs on a laptop; not production-grade for children (browser-dependent, audio goes to a third party). The voice layer is isolated in `src/lib/voice/` (a tested state machine for input, a single-generation speaker for output).
- **One skill.** Depth over breadth: a deep loop is the right foundation, and the taxonomy pattern is the template for adding skills.

## What I'd do in week one at the company (speculative)

1. Add per-turn traces (this schema) to the existing app, behind a flag.
2. Pick one learning metric — independent accuracy on a fresh item 24 h later — and log it.
3. Run the eval-scenario pattern against the current production prompts to get a baseline before changing pedagogy.

---

## v2: auditing my own prototype

I audited v1 the way I'd want a reviewer to: ran unexpected student inputs through the real engine and checked every number the console showed against its source. Full report: [AUDIT.md](AUDIT.md).

**The most instructive bug.** `3x = 25` was labelled "used the same operation instead of the inverse" — a fair label — with evidence describing a *division* the student never did. v1 diagnosed steps by solving them (x = 25/3) and matching the value against final-answer formulas. Right label, wrong reason, and the tutor then "tested" a fraction the student never wrote. v2 diagnoses a step by the transformation written ("removed + 5 on the left but wrote 20 + 5 = 25 on the right") and tests the student's own line ("if 3x were 25, the left side would be 25 + 5 = 30, not 20"). When a step's shape isn't recognised, it falls back to the implied value *and says so*, with lower confidence.

**Other findings:** questions, confusion, disputes and malformed maths fell through to "off-topic" or "thanks for explaining"; a multi-clause answer was graded on the wrong clause; the console showed "$0.0000" for template wording, implying measured model cost; "developing" was shown with no independent evidence. All fixed; each has a regression test. Two more bugs surfaced *during* v2 because of new tests: `15 = 3x` would have produced the hint "subtract 15 from both sides", and my first HMAC implementation rejected every resumed session because zod reorders keys.

**The architectural change.** v1's LLM only phrased fixed decisions. v2's policy returns the *set of permitted moves*; the LLM picks one and words it. That gives the model real judgement (a check instead of a question for a frustrated student) without letting it reveal answers, skip hint rungs, or invent maths — those are enforced by enum, by construction of the candidate set, and by the guard. If the model fails twice, the rule-table default runs. The provider is behind a one-method interface, with Anthropic and OpenAI-compatible implementations tested through real HTTP round-trips to local fake servers.

**What I could not do:** run the LLM policy against a live model — there were no credentials in this environment. The eval row for it says "not run" rather than showing anything simulated.
