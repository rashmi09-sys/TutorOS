/**
 * Geometry and physics lessons: number reading, problem generators, the subject verifiers, the shared
 * kernel (ladder, reveal rule, idempotency), the leak guard swept over every reply the templates can make,
 * the structured model reading with a fake provider, and the API route.
 */
import { describe, expect, it } from "vitest";
import { POST as turn } from "@/app/api/turn/route";
import { arithmeticClaims, normalizeText, numbersIn } from "@/engine/subjects/text";
import { SUBJECTS, createSubjectSession, readMessage, stepSubject, type SubjectState } from "@/engine/subjects";
import { makeGeometryProblems } from "@/engine/subjects/geometry";
import { makePhysicsProblems } from "@/engine/subjects/physics";
import { SUBJECT_SCENARIOS, runSubjectScenario } from "@/engine/subjects/eval";
import { DeterministicTeacher, LlmTeacher } from "@/engine/llm/teacher";
import type { JsonRequest, JsonResponse, LlmProvider } from "@/engine/llm/provider";
import type { LlmCall } from "@/engine/types";

const teacher = new DeterministicTeacher();

describe("reading numbers and arithmetic", () => {
  it.each([
    ["seventy five degrees", [75]],
    ["one hundred and eighty take away 105 is 75", [180, 105, 75]],
    ["a hundred and five", [105]],
    ["four newtons to the right", [4]],
    ["180−65−40=74", [180, 65, 40, 74]],
  ])("%s", (raw, nums) => expect(numbersIn(normalizeText(raw))).toEqual(nums));

  it("re-checks stated arithmetic exactly", () => {
    expect(arithmeticClaims(normalizeText("180 minus 65 minus 40 equals seventy five"))).toEqual([{ expr: "180 - 65 - 40", stated: 75, actual: 75, ok: true }]);
    expect(arithmeticClaims(normalizeText("180-65-40=74"))[0]).toMatchObject({ ok: false, actual: 75 });
    expect(arithmeticClaims(normalizeText("12 N - 8 N = 4 N"))[0]).toMatchObject({ expr: "12 - 8", ok: true });
  });
});

describe("problem generators", () => {
  it("geometry: angles sum to 180, whole degrees, the answer is never one of the givens", () => {
    for (let seed = 0; seed < 400; seed++) {
      for (const p of makeGeometryProblems(seed)) {
        const { A, B, C } = p.data as Record<string, number>;
        expect(A + B + C).toBe(180);
        const e = p.answer.value!;
        expect(Number.isInteger(e) && e > 0 && e < 180).toBe(true);
        const givens = Object.entries(p.data).filter(([k]) => ["a", "b", "p"].includes(k)).map(([, v]) => Number(v));
        expect(givens).not.toContain(e);
        if (p.kind === "right") expect(e).not.toBe(90);
      }
    }
  });
  it("physics: the answer is the exact net / missing force, never equal to a given force", () => {
    for (let seed = 0; seed < 400; seed++) {
      for (const p of makePhysicsProblems(seed)) {
        const R = Number(p.data.right), L = Number(p.data.left);
        if (p.kind === "net-force") {
          expect(p.answer.value).toBe(Math.abs(R - L));
          expect(p.answer.direction).toBe(R > L ? "right" : "left");
          expect([R, L]).not.toContain(p.answer.value);
        }
        if (p.kind === "balance-missing") {
          expect(R + p.answer.value!).toBe(L);
          expect([R, L]).not.toContain(p.answer.value);
        }
        if (p.kind === "balanced-moving") expect(R).toBe(L);
        if (p.kind === "unbalanced-rest") expect(R).not.toBe(L);
      }
    }
  });
});

describe("the subject readers and verifiers", () => {
  const g = SUBJECTS.geometry;
  const gp = makeGeometryProblems(1)[0]; // 65°, 40° → 75°
  const check = (text: string) => g.verify(readMessage(g, text, gp), gp);
  it.each([
    ["75", "correct", undefined],
    ["it's 75 because angles in a triangle add to 180", "correct", undefined],
    ["65 + 40 + 75 = 180", "correct", undefined],
    ["105", "incorrect", "ADDED_GIVEN"],
    ["255", "incorrect", "SUM_360"],
    ["115", "incorrect", "SUBTRACTED_ONE"],
    ["180 - 65 - 40 = 74", "incorrect", "ARITHMETIC_SLIP"],
    ["200", "incorrect", "IMPOSSIBLE"],
    ["33", "incorrect", "UNEXPLAINED"],
  ])("geometry %s → %s %s", (text, v, mis) => {
    const c = check(text);
    expect(c.verdict).toBe(v);
    expect(c.misconception?.id).toBe(mis);
  });
  it("a correct value with a false written calculation is only partly right", () => {
    expect(check("65 + 40 = 100 so 75").verdict).toBe("partial");
  });

  const ph = SUBJECTS.physics;
  const pp = makePhysicsProblems(1)[0]; // 12 N right, 8 N left → 4 N right
  const pc = (text: string) => ph.verify(readMessage(ph, text, pp), pp);
  it.each([
    ["4 N to the right", "correct", undefined],
    ["4 newtons right because 12 minus 8 is 4", "correct", undefined],
    ["4", "partial", "NO_DIRECTION"],
    ["4 N left", "partial", "WRONG_DIRECTION"],
    ["20 N", "incorrect", "ADDED_OPPOSING"],
    ["zero, it's balanced", "incorrect", "CALLED_BALANCED"],
    ["12 N", "incorrect", "ONE_FORCE"],
  ])("physics %s → %s %s", (text, v, mis) => {
    const c = pc(text);
    expect(c.verdict).toBe(v);
    expect(c.misconception?.id).toBe(mis);
  });
  it("motion questions use a closed outcome list; anything else is not judged", () => {
    const moving = Array.from({ length: 50 }, (_, i) => makePhysicsProblems(i + 1)[2]).find((p) => p.kind === "balanced-moving")!;
    expect(moving.kind).toBe("balanced-moving");
    const v = (t: string) => ph.verify(readMessage(ph, t, moving), moving);
    expect(v("it keeps going at the same speed").verdict).toBe("correct");
    expect(v("it slows down").misconception?.id).toBe("MOTION_NEEDS_FORCE");
    expect(v("it speeds up").misconception?.id).toBe("BALANCED_SPEEDS_UP");
    expect(readMessage(ph, "it turns into a rocket", moving).kind).not.toBe("answer");
  });
});

describe("the leak guard holds for every reply the templates can make", () => {
  it("hints, explanations, examples and feedback to wrong answers never state the answer", async () => {
    let checked = 0;
    for (const lesson of ["geometry", "physics"] as const) {
      const mod = SUBJECTS[lesson];
      for (let seed = 0; seed < 60; seed++) {
        for (const p of mod.makeProblems(seed)) {
          const texts = [...([1, 2, 3] as const).flatMap((l) => [0, 1, 2].map((v) => mod.hint(p, l, v))), mod.example(p), ...[undefined, ...mod.vocabulary.topics].map((t) => mod.explain(p, t))];
          for (const x of texts) {
            expect(mod.leaks(x, p), `${lesson} ${p.kind} ${x}`).toBe(false);
            checked++;
          }
          // Feedback to a range of wrong answers: if it would leak, the kernel's guard replaces it.
          let s: SubjectState = { ...createSubjectSession(mod, { sessionId: "leak", seed }), problems: [p, p, p] };
          for (const wrong of ["1", "2", "33", "100", "150", "it slows down", "it stays still", "it speeds up", "0", "it moves"]) {
            const r = await stepSubject(mod, s, { type: "text", text: wrong, via: "keyboard" }, { teacher });
            if (!r.trace.decision.revealAllowed) expect(mod.leaks(r.utterance, p), `${lesson} ${p.kind} "${wrong}" → ${r.utterance}`).toBe(false);
            s = r.state.current === 0 ? r.state : s;
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
  });
});

describe("the shared kernel", () => {
  it("every geometry and physics scenario passes", async () => {
    for (const sc of SUBJECT_SCENARIOS) {
      const r = await runSubjectScenario(sc, teacher);
      expect(r.assertions.filter((a) => !a.passed).map((a) => `${sc.id}: ${a.name} — ${a.detail}`)).toEqual([]);
    }
  });
  it("applies an event id once", async () => {
    const mod = SUBJECTS.geometry;
    const s0 = (await stepSubject(mod, createSubjectSession(mod, { sessionId: "idem", seed: 1 }), { type: "start" }, { teacher })).state;
    const ev = { type: "text" as const, text: "105", via: "voice" as const, id: "ev-1" };
    const a = await stepSubject(mod, s0, ev, { teacher });
    const b = await stepSubject(mod, a.state, ev, { teacher });
    expect(b.duplicate).toBe(true);
    expect(b.state.turn).toBe(a.state.turn);
  });
  it("voice and typing take the same path", async () => {
    const mod = SUBJECTS.physics;
    const s0 = (await stepSubject(mod, createSubjectSession(mod, { sessionId: "v", seed: 1 }), { type: "start" }, { teacher })).state;
    const v = await stepSubject(mod, s0, { type: "text", text: "four newtons to the right", via: "voice" }, { teacher });
    const k = await stepSubject(mod, s0, { type: "text", text: "four newtons to the right", via: "keyboard" }, { teacher });
    expect(v.utterance).toBe(k.utterance);
  });
});

/* ---------------- Structured model reading (fake provider — tests the fences, not a model) ---------------- */

class Fake implements LlmProvider {
  readonly provider = "fake";
  readonly model = "fake-1";
  calls = 0;
  constructor(private out: () => unknown) {}
  async generateJson<T>(req: JsonRequest<T>): Promise<JsonResponse<T>> {
    this.calls++;
    const base: LlmCall = { kind: "model", purpose: req.purpose, provider: "fake", model: "fake-1", latencyMs: 1, inputTokens: 40, outputTokens: 8, costUsd: null, attempt: 1, ok: false };
    const o = this.out();
    if (o instanceof Error) return { data: null, call: { ...base, error: o.message } };
    const v = req.validate(o);
    return { data: v.ok ? v.data : null, call: { ...base, ok: v.ok, error: v.ok ? undefined : `schema: ${v.error}` } };
  }
}
const reading = (o: Record<string, unknown>) => ({ kind: "unclear", number: null, direction: null, outcome: null, concept: null, topic: null, confidence: 0.9, ...o });

async function geoStart() {
  const mod = SUBJECTS.geometry;
  return (await stepSubject(mod, createSubjectSession(mod, { sessionId: "llm", seed: 1 }), { type: "start" }, { teacher })).state;
}

describe("model reading in the subject lessons", () => {
  it("an answer the model reads is still verified by the subject verifier", async () => {
    const mod = SUBJECTS.physics;
    const seed = Array.from({ length: 50 }, (_, i) => i + 1).find((k) => makePhysicsProblems(k)[2].kind === "balanced-moving")!;
    let s = createSubjectSession(mod, { sessionId: "llm-p", seed });
    s = { ...s, current: 2, phase: "TRANSFER" }; // the balanced, already-moving trolley
    const right = new Fake(() => reading({ kind: "answer", outcome: "same_speed" }));
    const r = await stepSubject(mod, s, { type: "text", text: "it just cruises along like before", via: "keyboard" }, { teacher: new LlmTeacher(right) });
    expect(right.calls).toBe(1);
    expect((r.trace.intent as { source?: string }).source).toBe("llm");
    expect(r.trace.subjectCheck?.verdict).toBe("correct");
    // The model can't make a wrong reading right: "slows_down" is checked and found wrong.
    const wrong = new Fake(() => reading({ kind: "answer", outcome: "slows_down", confidence: 0.99 }));
    const w = await stepSubject(mod, s, { type: "text", text: "it kinda chills out and gets lazy", via: "keyboard" }, { teacher: new LlmTeacher(wrong) });
    expect(w.trace.subjectCheck?.misconception?.id).toBe("MOTION_NEEDS_FORCE");
  });
  it("a number the student didn't say is rejected", async () => {
    const p = new Fake(() => reading({ kind: "answer", number: "75" }));
    const r = await stepSubject(SUBJECTS.geometry, await geoStart(), { type: "text", text: "the pointy bit thingy", via: "keyboard" }, { teacher: new LlmTeacher(p) });
    expect(r.trace.subjectCheck).toBeUndefined();
    expect(r.trace.llmCalls.find((c) => c.purpose === "interpret")?.rejectionReasons?.[0]).toMatch(/not in the student's words/);
    expect(r.state.phase).toBe("GUIDED");
  });
  it("labels outside the closed vocabulary fail the schema", async () => {
    const p = new Fake(() => reading({ kind: "answer", outcome: "explodes" }));
    const r = await stepSubject(SUBJECTS.geometry, await geoStart(), { type: "text", text: "the pointy bit thingy", via: "keyboard" }, { teacher: new LlmTeacher(p) });
    expect(r.trace.errors.join(" ")).toMatch(/interpretation failed/);
  });
  it("timeouts fall back to the deterministic reply", async () => {
    const p = new Fake(() => new Error("transport: timeout after 8000ms"));
    const r = await stepSubject(SUBJECTS.geometry, await geoStart(), { type: "text", text: "the pointy bit thingy", via: "keyboard" }, { teacher: new LlmTeacher(p) });
    expect(r.trace.decision.rule).toMatch(/^S_(CLARIFY|REDIRECT)$/);
    expect(r.trace.errors.join(" ")).toMatch(/timeout/);
  });
  it("text the rules understand never goes to the model", async () => {
    const p = new Fake(() => reading({ kind: "answer", number: "75" }));
    await stepSubject(SUBJECTS.geometry, await geoStart(), { type: "text", text: "105", via: "keyboard" }, { teacher: new LlmTeacher(p) });
    expect(p.calls).toBe(0);
  });
});

describe("/api/turn with lessons", () => {
  const req = (body: unknown, ip: string) => new Request("http://x/api/turn", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });
  it("runs a geometry lesson with signed state, and refuses a state from another lesson", async () => {
    const d1 = await (await turn(req({ lesson: "geometry", state: null, event: { type: "start", id: "evt_geo001" } }, "10.1.0.1"))).json();
    expect(d1.state.lesson).toBe("geometry");
    expect(d1.trace.lesson).toBe("geometry");
    const r2 = await turn(req({ lesson: "geometry", state: d1.state, stateSig: d1.stateSig, event: { type: "text", text: "I'm stuck", via: "keyboard", id: "evt_geo002" } }, "10.1.0.1"));
    expect(r2.status).toBe(200);
    expect((await r2.json()).trace.decision.stage).toBe("NOTICE");
    const cross = await turn(req({ lesson: "algebra", state: d1.state, stateSig: d1.stateSig, event: { type: "text", text: "x = 5", via: "keyboard" } }, "10.1.0.1"));
    expect(cross.status).toBe(400);
  });
});
