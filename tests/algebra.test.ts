import { describe, expect, it } from "vitest";
import { equivalent, parseAnswer, parseEquation, solve, normalizeMath, complexity } from "@/engine/algebra";
import { Fraction } from "@/engine/fraction";

describe("algebra validator", () => {
  it("parses and solves linear equations exactly", () => {
    const s = solve(parseEquation("3x + 5 = 20")!);
    expect(s.kind).toBe("unique");
    expect(s.kind === "unique" && s.x.toString()).toBe("5");
    const t = solve(parseEquation("3x = 25")!);
    expect(t.kind === "unique" && t.x.toString()).toBe("25/3");
  });
  it("handles implicit multiplication, parentheses, decimals and negatives", () => {
    expect(equivalent(parseEquation("2(x + 1) = 10")!, parseEquation("x = 4")!)).toBe(true);
    expect(equivalent(parseEquation("0.5x = 2")!, parseEquation("x = 4")!)).toBe(true);
    expect(equivalent(parseEquation("-3x - 6 = 3")!, parseEquation("x = -3")!)).toBe(true);
  });
  it("rejects non-linear or malformed input instead of guessing", () => {
    expect(parseEquation("x*x = 4")).toBeNull();
    expect(parseEquation("3x + = 20")).toBeNull();
    expect(parseEquation("x / x = 1")).toBeNull();
    expect(parseEquation("hello = 3")).toBeNull();
  });
  it("detects identities and contradictions", () => {
    expect(solve(parseEquation("x + 1 = x + 1")!).kind).toBe("all");
    expect(solve(parseEquation("x + 1 = x + 2")!).kind).toBe("none");
  });
  it("understands spoken maths", () => {
    expect(normalizeMath("three x plus five equals twenty")).toBe("3 x + 5 = 20");
    expect(parseAnswer("x equals five")?.toString()).toBe("5");
    expect(parseAnswer("negative 3")?.toString()).toBe("-3");
    expect(parseEquation("fifteen divided by three = x")).not.toBeNull();
  });
  it("uses exact fractions, never floating point", () => {
    expect(new Fraction(1, 3).add(new Fraction(1, 6)).toString()).toBe("1/2");
    expect(new Fraction(0.1).add(0.2).eq(new Fraction(3, 10))).toBe(true);
  });
  it("measures progress toward a solved form", () => {
    expect(complexity(parseEquation("3x + 5 = 20")!)).toBeGreaterThan(complexity(parseEquation("3x = 15")!));
    expect(complexity(parseEquation("3x = 15")!)).toBeGreaterThan(complexity(parseEquation("x = 5")!));
  });
});
