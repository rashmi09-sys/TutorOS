# Outreach, talking points, questions

## LinkedIn message to Devvarat Meena (≤ 300 chars for a connection note; longer version for DM)

**Connection note:**
> Hi Devvarat — saw the founding engineer role you shared for the AI tutoring startup. I built a working demo of the core problem in the JD: an LLM that teaches instead of answers, with checked maths and evals. Could you point me to the right founder? — [Your name]

**DM (after connecting):**
> Thanks for connecting, Devvarat. The JD's line about turning an LLM into a teacher rather than a Q&A bot stuck with me, so I built a small proof of work around it: a teaching-policy engine for Grade 7 equations where the maths is checked deterministically, every tutor sentence is guarded against giving away the answer, and mastery is only credited on fresh problems solved without help. It includes a console with per-turn traces and a 12-scenario eval suite (it also runs a naive "answer-giver" baseline to prove the evals catch leaks).
>
> Demo: [link] · Code: [link] · 90-sec video: [link]
>
> I've been building since 2018 — full-stack products, AI workflows and mobile apps (most recently Big Fish, an AI client-discovery agent used by 50 freelancers). Would you be open to introducing me to the founder hiring for this role, or letting me know the best way to reach them? Happy to send a short write-up first.

*Don't name a company you haven't confirmed. Don't call RIA or Rove launched — they're in development.*

## Message to the hiring founder (template — company not verified)

> Hi [Name] — I'm applying for the founding engineer role. Rather than send a portfolio, I built a working piece of the problem your JD describes: the layer that decides when a tutor should ask, hint, explain, wait or verify.
>
> Three things it does that I think matter for you:
> 1. **Maths is never the model's call.** An exact algebra checker validates every student step — typed or spoken — and every equation the tutor says.
> 2. **The tutor can't leak the answer.** Every sentence passes a guard before a child hears it; failures retry once, then fall back deterministically.
> 3. **Learning is measured, not vibes.** Mastery needs two independent solves on fresh problems; 50 reproducible scenarios gate changes (the policy passes 50/50; a naive answer-giver baseline leaks the answer in 25).
>
> It's built as an engine with an HTTP contract, so it could sit behind your Android app rather than compete with it. I don't know your stack, so I didn't pretend to.
>
> 90-sec demo: [link] · Repo: [link]. Would 20 minutes this week work to show it live and hear where the real bottlenecks are?

## Five strongest technical talking points

1. **Separation of concerns that makes pedagogy testable.** Validator decides correctness, policy decides the move, LLM phrases it, guard enforces it. Prompt changes become diffs you can regression-test.
2. **Executable misconceptions, honest uncertainty.** Wrong values are matched against runnable buggy procedures; no match → ask, don't guess. The trace shows the evidence behind every diagnosis.
3. **Guard + retry + deterministic fallback.** Leaks, hallucinated equations and false arithmetic are caught per sentence; the model gets one repair attempt with the reason. The child never sees unvalidated output, and nothing stalls on an LLM timeout.
4. **Mastery that can't be inflated by scaffolding.** BKT on unassisted first attempts only, plus two consecutive transfer solves in a different surface form. Aligned with the evidence that answer-giving helps practice scores and hurts independent performance.
5. **Evals with a negative control.** The suite runs a deliberately naive policy and must fail it (B 25/25, naive A 5/25 with answer leaks in 11 scenarios). Testing caught real bugs in my own code, including a mis-justified diagnosis I found by auditing v1 (see AUDIT.md) — the same harness would gate prompt and model changes in CI.

## Questions to ask the founders

1. What does a "good session" look like in your data today — and what's the closest thing you have to a learning outcome you trust?
2. Where does the current tutor fail most often: giving away answers, wrong maths, losing the thread, or latency?
3. How are teaching decisions made today — prompt instructions, a state machine, or something else? What's hardest to change safely?
4. What's your current end-to-end voice latency, and which leg dominates: ASR, LLM, or TTS?
5. How do parents and schools currently see progress, and what are you comfortable storing about a child?
6. Which grades and subjects matter most in the next six months — and is curriculum alignment (CBSE/ICSE/state boards) a constraint?
7. What does unit economics look like per session today, and what's the target?
8. What would you want a founding engineer to have shipped by day 30 and day 90?
