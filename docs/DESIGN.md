# v3 interaction design

## Concept: an exercise book, with the teacher writing in the margin

v2 was a whiteboard panel next to a chat transcript: two things competing for a twelve-year-old's attention, and the conversation won. v3 has one surface.

| | v2 | v3 |
|---|---|---|
| Layout | Two columns: board panel + chat panel | One exercise-book page: **work column** + **teacher's margin**, separated by a margin rule |
| Where the student types | A chat box under the transcript | **The next ruled line** of their working, with the presence/mic control on that line |
| Where the tutor speaks | Chat bubbles, newest at the bottom | A **margin note beside the line it is about**; older notes fold to one line |
| How the tutor points at maths | It can't | The terms the turn is about are **highlighted in the line** (e.g. `+ 5` and `20` for "subtract 5 from both sides") |
| What the student did | Only ✓/✗ | **Observed operation between lines**: "− 5 on both sides" (green) or "left − 5 · right + 5 — the two sides changed differently" (red) |
| Wrong attempts | Listed like any line | Struck through, kept in history; older ones fold ("2 earlier tries") |
| Progress | Stepper text | Rail with three stops (together / check 1 / check 2) + **"on your own" evidence pips** |
| Finished problems | Faded but full | Collapse to one line: `3x + 5 = 20 → x = 5 · with help` |
| Voice | Status text above the input | One **presence control on the input line**: waiting · listening (live transcript in the line) · processing (cancellable, line stays pencilled in) · speaking (stop) · error (text fallback) · recovering |
| Read-aloud sync | None | The active note underlines words as they're spoken (Web Speech `boundary` events — **approximate**, voice-dependent) |
| Transcript | The primary view | One click away (Transcript drawer), for review and accessibility |

**Colour has meaning and never carries it alone:** student work is blue ink; tutor writing is brown ink in the margin and in dashed "Tutor's check" boxes; accepted lines get ✓ plus green; rejected lines get ✗ plus red **and** a strike-through; the highlighter marks terms under discussion, with an underline as well as the fill.

**Typography (v3.2):** see "Visual refinement" below — one sans (Inter) for everything readable, KaTeX's serif for mathematics only.

**Motion:** only where it explains — a new line settles in, a margin note writes in, the highlighter sweeps across a term. All disabled under `prefers-reduced-motion`.

## Engine additions (all presentation-only; teaching decisions unchanged)
- `BoardEntry.raw`, `.turn`, `.observed` — the line as written, when, and the **observed operation** relative to the last accepted line (`src/engine/observe.ts`).
- `Message.anchor`, `.focus`, `.rule`, `.hintLevel` — which line a tutor turn sits beside and which terms it is about. Computed deterministically in `policy.ts → withPresentation()` from the decision and the validated observation; the language model never sets them.
- The UI renders only engine state. No transformation, highlight or annotation is generated client-side.

## Console: decision-first debugger
- One-line session metrics in the header (no KPI cards).
- **Timeline** (left): each turn as input → verdict → action → rule, with flags for LLM choice, fallback, errors, phase changes. ↑/↓ steps through turns.
- **Decision chain** (centre): Input → Intent → Validation → **Observed** (fact) → **Hypothesis** (dashed, hedged, with alternatives) → Permitted moves (chosen marked; blocked capabilities listed) → Chosen (rule, source, model rationale) → Delivered (template or model, guard verdict) → State.
- **Evidence** (right): maths, learner (whole-session mastery evidence and recorded hypotheses), model calls (with proposals, verdicts, rejection reasons), raw trace JSON.
- **Eval lab:** policy columns A / B / C with bars per measure; a **scenario × policy matrix** sorted failures-first; clicking a cell opens an inspector with failing assertions and the offending turns highlighted in the transcript. C stays "not run" with the reason.

## Known design limitations
- Speech/word sync is approximate and absent for voices that don't emit boundary events.
- Turn-based, not streaming: the tutor speaks after the whole turn is computed.
- The scratch pad is a free-drawing layer; drawings aren't read by the engine.
- Desktop margin notes can sit some distance above the input when many rejected attempts accumulate; older attempts fold to limit this.


## v3.2 visual refinement

**Why.** A rendered audit (`scripts/ui-audit.ts`) at 320 / 375 / 768 / 1024 / 1440 px and 200 % zoom found 394 layout defects in v3.1. Most were tutor notes cut off mid-sentence ("Where would you …") by the one-line folded margin notes. There were also phone-width overflow in the console tables and overlapping header controls. Visually, there were too many competing treatments: a brown italic serif for the tutor, all-caps labels, yellow highlighter blocks, dashed boxes, and a dark crowded header. Google Fonts also failed offline, so the app often rendered in fallback fonts.

**What changed (presentation only — engine, policy, evals and lesson progression untouched).**

| Area | Before | After |
|---|---|---|
| Layout | Notes beside each line in a fixed 360 px margin; input as the next ruled line | Two panels with responsive proportions (`minmax(0, 1.15fr) minmax(340px, 1fr)`). **Your working** on the left (problem → lines → checks); **Your tutor** on the right (full conversation → input → help options). Stacked below 960 px: working first, then conversation and input. |
| Conversation | Folded one-line notes with ellipsis; labels above every note; serif italic | Every message in full, in order, for the whole lesson; one sans style; only the latest tutor message has a small label ("Think", "Hint 2 of 3"); student messages right-aligned in ink blue; dividers between problems; scrolls itself to the newest message unless you've scrolled up; equations never break across lines. |
| Header | Dark bar with mode badge, Transcript, My progress, Restart, Engineer view | Light bar: brand · progress (dots on phones, with screen-reader names) · Engineer view · **Menu** (Transcript, My progress, Restart, Read aloud, mode). The "solved alone / with help" pips are now part of the progress steps. |
| Input | Underlined line with separate round buttons | One field: mic · text · Send, with clear disabled state and focus ring; ✕ · heard text · ✓ Done while listening; status line wraps instead of truncating; help options below. |
| Type | Atkinson Hyperlegible + Fraunces + JetBrains Mono, from Google Fonts | Inter (bundled with the app, works offline) for everything readable; KaTeX serif for maths; the system monospace only for ids and JSON in the console. Atkinson was dropped because its slashed zero reads as "2Ø" to a 12-year-old. Sentence case everywhere, no italics, weights 400 / 500 / 600. |
| Colour | Yellow highlighter, brown pen, red strikes, dashed boxes | Warm ivory desk, off-white panels, charcoal text, muted ink blue for the student, quiet amber for the tutor's emphasis (soft wash + amber underline on terms), fine borders. Every text colour ≥ 5.4:1 on every surface it sits on. |
| Engineer view | Uppercase monospace labels, serif quotes | Same sans; sentence-case labels; monospace kept for rule ids, equations-as-text and JSON; tables scroll inside their own box on phones; panels stack below 1180 px and 720 px. |

**Tokens.** All sizes, spacing, radii and colours are CSS custom properties at the top of `globals.css` (`--fs-*`, `--math-*`, `--sp-*`, `--r-*`, colour roles). Component rules use the tokens, not one-off values.

**Verification.** `scripts/ui-audit.ts` reports 0 defects at every width and at 200 % zoom (it checks horizontal overflow, clipped or ellipsised text, controls outside the viewport and overlapping controls in the real DOM). Screenshots: `docs/screenshots/ui/`.
