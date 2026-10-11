import { describe, expect, it } from "vitest";
import { createSession, step } from "@/engine/engine";
import { DeterministicTeacher } from "@/engine/llm/teacher";
import { SUBJECTS, createSubjectSession, stepSubject, type SubjectState } from "@/engine/subjects";
import type { SessionState } from "@/engine/types";
import { readAffect, affectLine, HUMOROUS, type AffectKind } from "@/engine/affect";
import { classifyIntent } from "@/engine/intent";
import { GENERIC_PRAISE, HUMOUR, languageProblems } from "@/engine/eval/language";
import { learningMessage, problemEvidence, subjectEvidence } from "@/lib/evidence";
import { parseEquation } from "@/engine/algebra";
import { normalize } from "@/engine/misconceptions";

/**
 * Teaching behaviour (v6): the teaching memory, strategy changes on repeated confusion, feelings, waiting,
 * answer requests, no repetition, whiteboard/state agreement, and the three-stage evidence.
 * Everything runs through the real engines with the deterministic teacher.
 */
const teacher = new DeterministicTeacher();
let n = 0;
const sayA = async (s: SessionState, text: string) => step(s, { type: "text", text, via: "keyboard", id: `t${++n}` }, { teacher });
const beginA = async () => (await step(createSession({ sessionId: `teach-${++n}` }), { type: "start", id: `s${n}` }, { teacher })).state;
const sayS = async (lesson: "physics" | "geometry", s: SubjectState, text: string) => stepSubject(SUBJECTS[lesson], s, { type: "text", text, via: "keyboard", id: `t${++n}` }, { teacher });
const beginS = async (lesson: "physics" | "geometry", seed = 1) => (await stepSubject(SUBJECTS[lesson], createSubjectSession(SUBJECTS[lesson], { sessionId: `teach-${lesson}-${++n}`, seed }), { type: "start", id: `s${n}` }, { teacher })).state;

describe("1 · \"I don't know\" four times: a different approach each time, in every lesson", () => {
  it("algebra: simplify → analogy → balance picture → first move worked; never repeated, never the answer", async () => {
    let s = await beginA();
    const texts: string[] = [];
    const strategies: (string | undefined)[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await sayA(s, "I don't know");
      s = r.state;
      texts.push(r.utterance);
      strategies.push(r.trace.decision.strategy);
      expect(r.utterance).not.toMatch(/x\s*=\s*5\b/);
    }
    expect(strategies).toEqual(["simplify", "analogy", "visual", "worked_part"]);
    expect(new Set(texts).size).toBe(4);
    expect(s.teaching?.confusion).toBe(4);
    expect(s.teaching?.strategies).toEqual(["simplify", "analogy", "visual", "worked_part"]);
    // The picture turn carries the balance numbers from the verified current line.
    const pic = s.transcript.find((m) => m.visual === "balance")!;
    expect(pic.figure).toEqual({ a: 3, b: 5, c: 20 });
  });
  for (const lesson of ["physics", "geometry"] as const) {
    it(`${lesson}: four different approaches, then the worked solution only after that`, async () => {
      let s = await beginS(lesson);
      const seen = new Set<string>();
      const used: string[] = [];
      for (let i = 0; i < 5 && s.current === 0; i++) {
        const r = await sayS(lesson, s, i === 1 ? "still don't know" : "I don't know");
        s = r.state;
        expect(seen.has(r.utterance)).toBe(false);
        seen.add(r.utterance);
        used.push(r.trace.decision.strategy ?? r.trace.decision.rule);
        if (i < 3) expect(r.trace.decision.revealAllowed).toBe(false);
      }
      expect(new Set(used).size).toBe(used.length);
      expect(used).toContain("visual");
      expect(used).toContain("worked_part");
      expect(used.at(-1)).toBe("worked"); // the working comes last, after every other approach
    });
  }
});

describe("2 · the same mistake again changes strategy", () => {
  it("algebra 3x = 25 ×3: question → computed check → the balance", async () => {
    let s = await beginA();
    const rules: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await sayA(s, "3x = 25");
      s = r.state;
      rules.push(r.trace.decision.rule);
    }
    expect(rules).toEqual(["R5_TARGETED_PROBE", "R4_RESPECTFUL_CHALLENGE", "R7d_SAME_MISTAKE_VISUAL"]);
    expect(s.transcript.filter((m) => m.role === "tutor").at(-1)!.visual).toBe("balance");
  });
  it("geometry: the same wrong answer three times moves up instead of repeating", async () => {
    let s = await beginS("geometry");
    const texts = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const r = await sayS("geometry", s, "100");
      s = r.state;
      texts.add(r.utterance);
    }
    expect(texts.size).toBe(3);
  });
});

describe("3 · unexpected correct answers are accepted", () => {
  it("algebra: reversed step, spoken form, skipping straight to the answer", async () => {
    for (const line of ["15 = 3x", "three x equals fifteen", "3x=15"]) expect((await sayA(await beginA(), line)).trace.decision.rule).toBe("R2_VALID_STEP");
    expect((await sayA(await beginA(), "x = 5")).trace.decision.rule).toBe("R1_GUIDED_SOLVED");
  });
  it("physics and geometry: reasoning with the answer, number words", async () => {
    expect((await sayS("physics", await beginS("physics"), "4 newtons to the right because 12 minus 8 is 4")).trace.subjectCheck?.verdict).toBe("correct");
    expect((await sayS("geometry", await beginS("geometry"), "180 - 65 - 40 = 75")).trace.subjectCheck?.verdict).toBe("correct");
  });
  it("physics: answering the tutor's smaller question (tap the stronger push), then finishing", async () => {
    let s = await beginS("physics");
    s = (await sayS("physics", s, "I don't know")).state;
    const tap = await sayS("physics", s, "the push to the right");
    expect(tap.trace.decision.rule).toBe("P_SUB_RIGHT");
    expect(tap.state.awaiting?.kind).toBe("difference");
    const done = await sayS("physics", tap.state, "4");
    expect(done.trace.decision.rule).toBe("P_SUB_SOLVED");
    expect(done.state.records[0].solved).toBe(true);
  });
});

describe("4 · \"explain it another way\" is a RETEACH with different words each time", () => {
  it("algebra", async () => {
    let s = await beginA();
    s = (await sayA(s, "I'm stuck")).state;
    const texts = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const r = await sayA(s, "explain it another way");
      s = r.state;
      expect(r.trace.decision.action).toBe("RETEACH");
      texts.add(r.utterance);
    }
    expect(texts.size).toBe(3);
  });
});

describe("5 · off-topic questions", () => {
  it("are not answered, don't move the lesson, and the tutor never pretends to be a person", async () => {
    let s = await beginA();
    s = (await sayA(s, "3x = 15")).state;
    const r = await sayA(s, "what's your favourite football team?");
    expect(r.trace.decision.rule).toBe("R13_REDIRECT");
    expect(r.utterance).toMatch(/3x = 15/);
    expect(r.state.current).toBe(0);
    expect(r.state.attempts).toBe(0);
    const p = await sayS("physics", await beginS("physics"), "what's your favourite food?");
    expect(p.utterance).toMatch(/AI tutor/);
  });
});

describe("6 · asking for the answer", () => {
  it("is acknowledged, scaffolded, and not given before any attempt", async () => {
    let s = await beginA();
    for (let i = 0; i < 4; i++) {
      const r = await sayA(s, "just tell me the answer");
      s = r.state;
      expect(r.trace.decision.revealAllowed).toBe(false);
      expect(r.utterance).not.toMatch(/x\s*=\s*5\b/);
    }
    expect(s.teaching?.answerRequests).toBe(4);
  });
  it("after real attempts and repeated requests, a worked solution is allowed — and not counted as independent", async () => {
    let s = await beginA();
    for (const t of ["x = 12", "x = 45", "just tell me the answer", "just tell me the answer", "just tell me the answer"]) s = (await sayA(s, t)).state;
    const last = s.transcript.filter((m) => m.role === "tutor").at(-1)!;
    expect(last.rule).toBe("R9_REVEAL_AFTER_EFFORT");
    s = (await sayA(s, "x = 5")).state;
    expect(s.mastery.observations.some((o) => o.problemId === "p0" && o.assisted)).toBe(true);
    expect(s.mastery.observations.some((o) => o.problemId === "p0" && o.kind === "transfer")).toBe(false);
  });
});

describe("7 · transfer solved independently", () => {
  it("algebra: guided, independent (4x + 3 = 19) and transfer recorded separately", async () => {
    let s = await beginA();
    for (const t of ["3x = 15", "x = 5", "4x = 16", "x = 4"]) s = (await sayA(s, t)).state;
    const p = s.problems[s.current];
    s = (await sayA(s, `x = ${p.answer}`)).state;
    const ev = problemEvidence(s);
    expect(ev.map((r) => r.stage)).toEqual(["guided", "independent", "transfer"]);
    expect(ev.map((r) => r.independent)).toEqual([false, true, true]);
    expect(learningMessage(ev).text).toMatch(/without help/);
    expect(learningMessage(ev).text).toMatch(/few days/); // no claim beyond today
  });
  it("physics: the independent question is the same relationship with new numbers; the transfer one is different", async () => {
    for (let seed = 1; seed < 30; seed++) {
      const ps = SUBJECTS.physics.makeProblems(seed);
      expect(ps.map((p) => p.stage)).toEqual(["guided", "independent", "transfer"]);
      expect(ps[1].kind).toBe("net-force");
      expect(ps[2].kind).not.toBe("net-force");
      const gs = SUBJECTS.geometry.makeProblems(seed);
      expect(gs[1].kind).toBe("two-angles");
      expect(gs[2].kind).not.toBe("two-angles");
    }
  });
  it("geometry: solving both on your own is recorded as independent, with the first try right", async () => {
    let s = await beginS("geometry", 2);
    for (let i = 0; i < 3; i++) s = (await sayS("geometry", s, String(s.problems[s.current].answer.value))).state;
    const ev = subjectEvidence(s);
    expect(ev.slice(1).every((r) => r.independent && r.firstTry === "right")).toBe(true);
  });
});

describe("8 · voice service failure", () => {
  it("is covered in tests/tts.test.ts (no key → 503 and no network call; upstream error → 502 with a browser fallback; client falls back to the browser voice)", () => {
    expect(true).toBe(true);
  });
});

describe("9 · session restart and saved sessions", () => {
  it("the teaching memory survives a save/load round-trip, and a new session starts clean", async () => {
    let s = await beginA();
    s = (await sayA(s, "I don't know")).state;
    const reloaded = JSON.parse(JSON.stringify(s)) as SessionState;
    const r = await sayA(reloaded, "I don't know");
    expect(r.trace.decision.strategy).toBe("analogy"); // remembered: simplify was already tried
    expect((await beginA()).teaching?.confusion).toBe(0);
  });
  it("a session saved before the teaching memory existed still works", async () => {
    const s = await beginA();
    const old = { ...s } as SessionState;
    delete old.teaching;
    const r = await sayA(old, "I don't know");
    expect(r.trace.decision.rule).toBe("R8_HELP_BEFORE_TRYING");
    expect(r.state.teaching?.confusion).toBe(1);
  });
});

describe("10 · whiteboard and lesson state agree", () => {
  it("the balance always shows the verified current line, and every move chip is understood by the engine", async () => {
    let s = await beginA();
    s = (await sayA(s, "3x = 15")).state; // a verified step
    for (const t of ["I don't know", "I don't know", "I don't know"]) s = (await sayA(s, t)).state;
    const pic = s.transcript.filter((m) => m.visual === "balance").at(-1)!;
    const cur = normalize(parseEquation(s.lastValidRaw)!);
    expect(pic.figure).toEqual({ a: cur.A.valueOf(), b: cur.B.valueOf(), c: cur.C.valueOf() });
    // The whiteboard's move choices go through the same reading as typed words.
    const rules = await Promise.all(["Subtract 5 from both sides", "Add 5 to both sides", "Divide both sides by 3"].map(async (m) => (await sayA(await beginA(), m)).trace.decision.rule));
    expect(rules[0]).toBe("R30_OP_RIGHT_MOVE");
    expect(rules[1]).toBe("R33_OP_WRONG_INVERSE");
    expect(rules[2]).toBe("R32_OP_DIVIDE_FIRST");
  });
  it("physics: the tap sub-question is cleared when the question changes", async () => {
    let s = await beginS("physics");
    s = (await sayS("physics", s, "I don't know")).state;
    expect(s.awaiting?.kind).toBe("stronger_side");
    s = (await sayS("physics", s, "4 N to the right")).state;
    expect(s.current).toBe(1);
    expect(s.awaiting).toBeUndefined();
  });
});

describe("11 · jokes, frustration and worry", () => {
  it("feelings are read by explicit rules", () => {
    expect(readAffect("Bro, I hate algebra")).toBe("dislike");
    expect(readAffect("lol this is so boring")).toBe("bored");
    expect(readAffect("lol")).toBe("laugh");
    expect(readAffect("I'm so bad at maths")).toBe("worried");
    expect(readAffect("ugh this is so annoying")).toBe("frustrated");
    expect(readAffect("x = 5")).toBeNull();
    expect(classifyIntent("Bro, I hate algebra").kind).toBe("AFFECT");
    expect(classifyIntent("I give up").kind).toBe("HELP_REQUEST");
  });
  it("humour only for dislike, boredom and laughter — never for worry or frustration — and never a put-down", () => {
    for (const kind of ["dislike", "bored", "laugh", "worried", "frustrated"] as AffectKind[])
      for (const subject of ["algebra", "physics", "geometry"] as const)
        for (let c = 0; c < 4; c++) {
          const line = affectLine(kind, subject, c);
          expect(languageProblems(line), line).toEqual([]);
          if (!HUMOROUS.includes(kind)) expect(HUMOUR.test(line), line).toBe(false);
        }
  });
  it("\"Bro, I hate algebra\" gets an acknowledgement and the question back; the lesson carries on", async () => {
    let s = await beginA();
    const r = await sayA(s, "Bro, I hate algebra");
    expect(r.trace.decision.action).toBe("ENCOURAGE");
    expect(r.utterance).toMatch(/\?$/);
    s = r.state;
    expect((await sayA(s, "3x = 15")).trace.decision.rule).toBe("R2_VALID_STEP");
  });
  it("\"let me think\" is a WAIT with no question", async () => {
    const r = await sayA(await beginA(), "let me think");
    expect(r.trace.decision.action).toBe("WAIT");
    expect(r.utterance).not.toMatch(/\?/);
  });
});

describe("12 · no repetitive or generic replies over a long, messy session", () => {
  const messy = ["I don't know", "lol", "3x = 25", "3x = 25", "explain it another way", "what's your favourite colour", "I don't know", "I'm stuck", "explain it another way", "3x = 15", "I don't know", "I don't know", "x = 5", "I don't know", "I don't know", "I don't know"];
  it("algebra", async () => {
    let s = await beginA();
    const seen = new Map<string, string>();
    for (const t of messy) {
      const r = await sayA(s, t);
      s = r.state;
      const key = `${r.trace.decision.templateVars?.problem}|${r.utterance}`;
      expect(seen.has(key), `"${r.utterance}" repeated (first after "${seen.get(key)}", again after "${t}")`).toBe(false);
      seen.set(key, t);
      expect(GENERIC_PRAISE.test(r.utterance), r.utterance).toBe(false);
      expect(languageProblems(r.utterance), r.utterance).toEqual([]);
    }
  });
  for (const lesson of ["physics", "geometry"] as const) {
    it(lesson, async () => {
      let s = await beginS(lesson);
      const seen = new Set<string>();
      for (const t of ["I don't know", "lol", "100", "100", "explain it another way", "what's your favourite colour", "I don't know", "I'm stuck", "explain it another way", "I don't know"]) {
        const r = await sayS(lesson, s, t);
        const key = `${s.current}|${r.utterance}`;
        s = r.state;
        if (r.trace.decision.rule.startsWith("S_REPEAT")) continue;
        expect(seen.has(key), `"${r.utterance}" repeated after "${t}"`).toBe(false);
        seen.add(key);
        expect(languageProblems(r.utterance), r.utterance).toEqual([]);
      }
    });
  }
});

describe("leak guard covers the new strategies", () => {
  it("no strategy text for any generated problem states its answer", () => {
    let checked = 0;
    for (const lesson of ["physics", "geometry"] as const) {
      const mod = SUBJECTS[lesson];
      for (let seed = 1; seed <= 200; seed++)
        for (const p of mod.makeProblems(seed))
          for (const st of ["simplify", "analogy", "visual", "worked_part"] as const) {
            const got = mod.strategy?.(p, st);
            if (!got) continue;
            checked++;
            expect(mod.leaks(got.text, p), `${lesson} ${p.kind} ${st}: ${got.text}`).toBe(false);
          }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

describe("a bare \"why?\" is about the tutor's latest step", () => {
  it("physics: after the tug-of-war question, why → the stronger push wins", async () => {
    let s = await beginS("physics");
    s = (await sayS("physics", s, "I don't know")).state;
    const r = await sayS("physics", s, "why?");
    expect(r.trace.decision.rule).toBe("S_WHY_LAST_STEP");
    expect(r.utterance).toMatch(/stronger push/);
    expect(r.utterance.split(/\s+/).length).toBeLessThan(40);
  });
  it("geometry: after \"what do the two known angles add up to?\", why → they take their share of 180° first", async () => {
    let s = await beginS("geometry");
    s = (await sayS("geometry", s, "I don't know")).state;
    const r = await sayS("geometry", s, "why?");
    expect(r.trace.decision.rule).toBe("S_WHY_LAST_STEP");
    expect(r.utterance).toMatch(/share of the 180°/);
  });
  it("algebra: after \"which would you undo first?\", why → the reason for undoing the + 5", async () => {
    let s = await beginA();
    s = (await sayA(s, "I don't know")).state;
    const r = await sayA(s, "why?");
    expect(r.trace.decision.rule).toBe("R18_CONCEPT_WHY_INVERSE_CONSTANT");
    expect(r.utterance).not.toMatch(/3x = 15/);
  });
});
