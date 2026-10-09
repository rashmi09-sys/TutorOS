# Loom walkthrough (about 2 minutes)

Every tutor line quoted below was produced by the engine in deterministic mode (no key) on 9 Oct 2026. With a model configured the moves are the same and some wording differs. Check questions are generated per session, so their numbers won't match exactly.

## Before recording (5 minutes)

```bash
npm run build && npm start        # http://localhost:3000
```

1. Chrome, one window, 1440 px wide. Open `http://localhost:3000/` and clear old progress: on each card that shows **Start again**, press it, then come back home.
2. Open the Engineer View once in a second tab (`/console`) so it's ready; close the first tab's menus.
3. Use headphones if you'll speak; test the mic once (tap, say "hello", ✕ — nothing is sent).
4. Have this script on another screen. Speak over the actions; don't read the tutor's lines aloud — let the viewer read them.

## Script

| Time | Do | Say |
|---|---|---|
| 0:00 | Home page | "TutorOS is a tutor that checks every answer exactly and gives help one step at a time. Three lessons: algebra, physics and geometry. Each has its own verifier — there's no general reasoning engine pretending to grade everything." |
| 0:12 | **Start lesson** on *Two-step equations* → **Read without sound** | "The student does the thinking. They can type, or speak and press Done." |
| 0:18 | Help option **I'm stuck** | The tutor: "…the left side of 3x + 5 = 20 has a multiplication and an addition. Which one would you undo first?" — "Help comes one stage at a time." |
| 0:25 | Tap the mic, say "I will do BODMAS multiplication", **✓ Done** | The tutor: "I see why you're thinking of multiplication — BODMAS is the order for working out an expression… What operation undoes adding 5?" — "It understood a move described in words, checked it against the equation, and answered the actual misconception." |
| 0:40 | Mic: "I said will do multiplication", **✓ Done** | The tutor: "Yes, I heard you say multiplication. You're thinking about the 3 times x part…" — "It remembers what was said and repairs instead of repeating itself." |
| 0:50 | Type `take five away`, then `3x = 15` | "A correct move is confirmed but never done for them — the board only changes when the student writes the line." |
| 0:58 | Brand **TutorOS** (top left) → home → **Start lesson** on *Forces and balance* → **Read without sound**. Type `20 N` | The figure shows 12 N right, 8 N left. The tutor: "20 N would be right if both pushes went the same way. These push in opposite directions…" — "Physics has its own checker: net force on a line, size and direction separately." |
| 1:10 | Type `4`, then `to the right` | The tutor: "4 N is the right size. Which way does the box get pushed overall?", then "Yes. 12 N − 8 N = 4 N…" — "Partly right is treated as partly right, and the follow-up completes it." |
| 1:18 | Home → *Angles in a triangle* → **Read without sound**. Type `105` | The tutor: "105° is what 65° and 40° add up to — a useful step. But that's the part of 180° already used…" — "Same shell, a different verifier: the 180° rule, plus a short list of recognisable mistakes." Open **Explore the 180° rule** and drag the corner: "The angles change; the total doesn't." |
| 1:30 | **Engineer view ↗** → **Overview** (geometry session) | "For engineers: the lesson, progress, answers checked, help given, and model usage — zero model calls here, and it says so." |
| 1:38 | **Decision timeline** → the "105" card | "Each turn reads like the tutor's reasoning: what it heard, what it understood, how it checked — 'Not correct: gave 105°, expected 75°; 105 = 65 + 40' — why it replied, and what it said." Click **Technical details**: "Underneath, the full trace — every stage, the permitted moves, the guard result." |
| 1:50 | **Evaluation lab** → **Run comparison** | "Live scenario runs: a baseline answer-giver leaks the answer in 25 of 50 algebra scenarios; the tutor passes 50 of 50, and the geometry and physics suites pass. The real-model column says *not tested* — there's no key here, and I don't simulate it." |
| 2:02 | **Architecture & safety** | "Five stages. The model is optional and never decides whether an answer is right; answers are checked by each lesson's own exact code, and every reply goes through a leak guard." |

## If something goes wrong

- **The mic mishears:** tap **Edit**, fix the words, press Send — or type.
- **An old session shows:** home → **Start again** on that card.
- **"This lesson can't be resumed":** press **Start a new lesson** (the signing key changed).
- **Eval lab says rate limited:** wait a minute; it allows six runs a minute.
