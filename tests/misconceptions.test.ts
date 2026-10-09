import { describe, expect, it } from "vitest";
import { classifyExplanationHeuristic, diagnoseValue, normalize } from "@/engine/misconceptions";
import { parseEquation } from "@/engine/algebra";
import { Fraction } from "@/engine/fraction";

const n = normalize(parseEquation("3x + 5 = 20")!);
const f = (s: string) => { const [a, b] = s.split("/").map(Number); return new Fraction(a, b ?? 1); };

describe("misconception diagnosis (3x + 5 = 20)", () => {
  it.each([
    ["25/3", "SIGN_ERROR_INVERSE_OP"],
    ["15", "FORGOT_TO_DIVIDE"],
    ["45", "MULTIPLIED_INSTEAD_OF_DIVIDING"],
    ["12", "COEFFICIENT_AS_ADDEND"],
    ["5/2", "COMBINED_UNLIKE_TERMS"],
    ["5/3", "UNDID_IN_WRONG_ORDER"],
    ["20/3", "ONE_SIDE_ONLY"],
    ["1/5", "INVERTED_DIVISION"],
    ["6", "ARITHMETIC_SLIP"],
    ["8", "UNCLASSIFIED"],
  ])("x = %s → %s", (value, id) => {
    expect(diagnoseValue(f(value), n).id).toBe(id);
  });
  it("refuses to diagnose a correct value", () => {
    expect(() => diagnoseValue(f("5"), n)).toThrow();
  });
  it("works for subtraction forms (sign error is flipped)", () => {
    const m = normalize(parseEquation("4x - 7 = 13")!); // x = 5
    expect(diagnoseValue(f("3/2"), m).id).toBe("SIGN_ERROR_INVERSE_OP"); // (13-7)/4
  });
  it("classifies free-text explanations, or admits it can't", () => {
    expect(classifyExplanationHeuristic("I added the 3 and the 5", n).id).toBe("COMBINED_UNLIKE_TERMS");
    expect(classifyExplanationHeuristic("i did 20 plus 5", n).id).toBe("SIGN_ERROR_INVERSE_OP");
    expect(classifyExplanationHeuristic("I took away 3", n).id).toBe("COEFFICIENT_AS_ADDEND");
    expect(classifyExplanationHeuristic("it just felt right", n).id).toBe("UNCLASSIFIED");
  });
});
