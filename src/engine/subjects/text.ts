/**
 * Small, exact text utilities shared by the subject lessons (geometry, physics).
 * Spoken and typed numbers ("seventy five", "one hundred and eighty", "12 N") become digits, and simple
 * arithmetic the student states ("180 − 65 − 40 = 75") is re-checked exactly. Nothing here interprets
 * meaning beyond numbers and arithmetic.
 */

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const isNumWord = (w: string) => w in UNITS || w in TENS || w === "hundred";

/** Lower-case, unify quotes and the degree sign, and turn number words into digits. */
export function normalizeText(raw: string): string {
  const words = raw
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/−|–|—/g, "-")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/([a-z])-([a-z])/g, "$1 $2") // seventy-five → seventy five
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const m = words[i].match(/^([a-z]+)([^a-z]*)$/);
    if (!m || !isNumWord(m[1]) || (m[1] === "oh" && !isNumWord(words[i + 1] ?? ""))) {
      out.push(words[i]);
      continue;
    }
    // Read a run of number words: "one hundred and eighty", "seventy five", "a hundred".
    let total = 0;
    let trail = "";
    let j = i;
    let prevA = out.length && out[out.length - 1] === "a" && m[1] === "hundred";
    if (prevA) out.pop();
    for (; j < words.length; j++) {
      const mm = words[j].match(/^([a-z]+)([^a-z]*)$/);
      const w = mm?.[1] ?? "";
      if (w === "and" && j > i && isNumWord((words[j + 1] ?? "").replace(/[^a-z]/g, "")) && /hundred/.test(words[j - 1])) continue;
      if (!mm || !isNumWord(w)) break;
      if (w === "hundred") total = (total || 1) * 100;
      else total += UNITS[w] ?? TENS[w];
      trail = mm[2];
      prevA = false;
      if (trail) {
        j++;
        break;
      }
    }
    out.push(`${total}${trail}`);
    i = j - 1;
  }
  return out
    .join(" ")
    .replace(/(\d)\s*(?:°|º|degrees\b|degree\b|degs?\b)/g, "$1°");
}

/** All numbers in normalised text, in order. Signs are not read (directions carry the sign in physics). */
export function numbersIn(t: string): number[] {
  return Array.from(t.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)/g)).map((m) => Number(m[1]));
}

export interface ArithmeticClaim {
  /** The calculation as the student stated it, normalised ("180 - 65 - 40"). */
  expr: string;
  stated: number;
  actual: number;
  ok: boolean;
}

/** Evaluate + − × ÷ on plain numbers with the usual precedence. Returns null for anything else. */
export function evalArithmetic(expr: string): number | null {
  const tokens = expr.replace(/\s+/g, "").match(/\d+(?:\.\d+)?|[-+*/]/g);
  if (!tokens || tokens.join("") !== expr.replace(/\s+/g, "")) return null;
  const nums: number[] = [];
  const ops: string[] = [];
  let expectNum = true;
  for (const tk of tokens) {
    if (expectNum) {
      if (!/\d/.test(tk)) return null;
      nums.push(Number(tk));
    } else {
      if (!/^[-+*/]$/.test(tk)) return null;
      ops.push(tk);
    }
    expectNum = !expectNum;
  }
  if (expectNum) return null;
  // × and ÷ first
  const n2 = [nums[0]];
  const o2: string[] = [];
  ops.forEach((op, i) => {
    const b = nums[i + 1];
    if (op === "*") n2[n2.length - 1] *= b;
    else if (op === "/") n2[n2.length - 1] = b === 0 ? NaN : n2[n2.length - 1] / b;
    else {
      o2.push(op);
      n2.push(b);
    }
  });
  let v = n2[0];
  o2.forEach((op, i) => (v = op === "+" ? v + n2[i + 1] : v - n2[i + 1]));
  return Number.isFinite(v) ? Math.round(v * 1e9) / 1e9 : null;
}

/** "180 minus 65 minus 40 is 75" → [{expr: "180 - 65 - 40", stated: 75, actual: 75, ok: true}] */
export function arithmeticClaims(t: string): ArithmeticClaim[] {
  const s = t
    .replace(/°/g, "")
    .replace(/\b(\d+(?:\.\d+)?)\s*(n|newtons?)\b/g, "$1")
    .replace(/\b(minus|take away|takeaway|subtract|less)\b/g, " - ")
    .replace(/\b(plus|add)\b/g, " + ")
    .replace(/\b(times|multiplied by|x)\b/g, " * ")
    .replace(/\b(divided by|over)\b/g, " / ")
    .replace(/\b(equals?|is|makes?|gives?|leaves?|=)\b|=/g, " = ");
  const out: ArithmeticClaim[] = [];
  for (const m of s.matchAll(/(\d+(?:\.\d+)?(?:\s*[-+*/]\s*\d+(?:\.\d+)?)+)\s*=\s*(\d+(?:\.\d+)?)/g)) {
    const expr = m[1].replace(/\s+/g, " ").replace(/\s*([-+*/])\s*/g, " $1 ").trim();
    const actual = evalArithmetic(expr);
    if (actual == null) continue;
    const stated = Number(m[2]);
    out.push({ expr, stated, actual, ok: Math.abs(actual - stated) < 1e-9 });
  }
  return out;
}

/** Pick a variant deterministically. */
export function pickVariant<T>(list: T[], k: number): T {
  return list[((k % list.length) + list.length) % list.length];
}

/** Seeded PRNG (mulberry32): problems are reproducible from the session seed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const randInt = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
