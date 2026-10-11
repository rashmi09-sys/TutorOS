# Loom recording plan (2–3 minutes)

Every tutor line quoted below was produced by the engine in deterministic mode (no language model) on 10 Oct 2026, using exactly these inputs. Some moves have two wordings, chosen by turn number, so a line may read slightly differently. The Challenge Yourself problem is generated per session; the first two are always 3x + 5 = 20 and 4x + 3 = 19.

## Before recording (5 minutes)

1. Run it locally with the Google voice: `gcloud auth application-default login` (once), then put `GOOGLE_TTS_ENABLED=true` and `GOOGLE_CLOUD_PROJECT=<your project id>` in `.env.local`, then `npm run build && npm start`. Check that `npm run tts:smoke` succeeds first. (The live URL shows an older version until you deploy.)
2. Chrome, one window, about 1440 px wide. Sign in before recording (the sign-in page is the only thing visible without a session; don't show the password on camera). On the home page, press **Start again** on the Algebra card if it shows.
3. Decide on sound. With the Sulafat voice on, let the tutor speak a line or two and talk over the rest; or switch **Sound off** on the welcome screen and narrate everything.
4. Inputs to paste: `Bro, I hate algebra` · `I don't know` · `why?` · `I don't know` · `I don't know` · `3x = 15` · `x = 5` · `4x = 16` · `x = 4`.
5. Do one dry run, then **Menu → Restart**, then go back to the home page.

## Recording sequence

| Time | Do | Say (natural) | Viewer sees |
|---|---|---|---|
| 0:00–0:20 | Home page | Intro (script below) | Three lessons on a grid whiteboard |
| 0:20 | Algebra → the welcome | "Every lesson starts the same way, and nothing makes a sound until you choose." | **Ready to figure this out?** · Start Lesson · Sound on |
| 0:25 | **Start Lesson** | — | The whiteboard lights up; the stages along the top read **Learn Together · Try It Yourself · Challenge Yourself**. *"Let's solve 3x + 5 = 20 together. Where would you start?"* (spoken in Sulafat if sound is on) |
| 0:32 | `Bro, I hate algebra` | "I'll be a reluctant student." | *"Fair. Sometimes it looks like maths decided to start using the alphabet…"* then the question again |
| 0:42 | `I don't know` | — | *"That's fine. Let's make it smaller: … Which one would you undo first?"* and **Pick a move** appears on the board |
| 0:50 | `why?` | "A 'why' is about what it just said." | *"Because x has 5 added to it. To get x on its own we undo that…"* |
| 1:00 | `I don't know`, then `I don't know` again | "Still stuck — it changes approach instead of repeating itself." | *"Hmm, that didn't land. Let me try it another way. Think of getting dressed…"*, then *"Words aren't helping — let's try a picture."* and **the balance** appears |
| 1:12 | Click **Add 5 to both sides** on the board | "I'll pick the wrong move on purpose." | *"That keeps both sides equal, but look: it gives 3x + 10 = 25. The 5 isn't gone — it grew."* |
| 1:20 | `3x = 15`, then `x = 5` | — | *"Exactly — you took 5 away from both sides…"*, then *"There it is — balanced all the way down to x. Now try it yourself, a new problem: 4x + 3 = 19"*; the stage moves to **Try It Yourself** |
| 1:30 | `4x = 16`, `x = 4` | "No help this time." | *"Correct — and that one was all you. Ready for a challenge? A different twist — …"*; the stage moves to **Challenge Yourself** |
| 1:38–2:15 | Stay on the lesson | Engineering explanation (script below) | |
| 2:15–2:45 | Optional: physics, `I don't know` twice, tap the right-hand arrow | Trade-offs | *"See the two arrows on the board? One is longer. Tap the stronger force."* → *"Exactly. The rightward force is stronger — 12 N beats 8 N."* |
| 2:45–3:00 | Home page | Closing | |

If there's time, solve the challenge and show the **What I saw** table: *"…That suggests you've understood the main idea. One lesson isn't proof it'll stick — a quick check in a few days would tell us."*

## Speaking script (~2:45)

**Intro (0:00–0:20).** "I built TutorOS around one question: how do you turn a language model into a teacher instead of an answer machine? A teacher decides, every turn, whether to ask, hint, explain, show a picture or just wait — and it has to be right about the maths every time."

**Lesson (0:20–1:38).** Narrate lightly as in the table. Worth saying: "It remembers how many times I've been stuck and what it already tried — a smaller question, an analogy, then a picture — so it never repeats itself." And at the hand-off: "Solving one with help isn't evidence. So: try it yourself, then a challenge with a twist."

**Engineering (1:38–2:15).** "Each turn is one function: the sealed lesson state and my message in; the new state, a reply and a trace out — the trace stays on the server. The maths is checked by an exact parser, never a model. A rule table decides which teaching moves are allowed, reading a small teaching memory — how often I've been stuck, which approaches were tried, whether I asked for the answer. A language model, when configured, can only choose among those moves and word them; a guard blocks answer leaks and wrong arithmetic, and an anti-repetition check stops it saying the same thing twice. The whiteboard and the voice come from the same turn. Over ninety scripted-student scenarios run against the real engine."

**Trade-offs (2:15–2:45).** "What you saw is deterministic — no model call — so every line is predictable and testable, but the wording is templated. The voice is Google's Chirp 3 HD, behind a server route with spending caps and the browser voice as a fallback. It's turn by turn: no streaming and no word-level sync yet. Next I'd add streaming speech with barge-in, evaluate the model path for real, and retest students days later — the only honest measure of learning."

**Closing (2:45–3:00).** "One lesson, done properly end to end — teaching decisions, maths, state, whiteboard, voice and tests. That's the kind of ownership I'd bring to the role. Thanks for watching."

## If something goes wrong on camera

- A slightly different wording → it's the other phrasing of the same move; carry on. **Menu → Restart** resets the lesson.
- The voice sounds robotic → Google wasn't reachable, so the browser voice took over. The lesson still works; switch Sound off and narrate.
- Don't claim streaming audio, word-level sync, a real-model evaluation or learning gains — none of them are verified.
