import { normalizeMath, rawToLatex } from "@/engine/algebra";
import type { FocusRole } from "@/engine/types";

/**
 * Split a line the student (or problem) wrote into its terms, keeping the student's own
 * form ("13 + 7x", "8x − 12"), and tag each with a role so the board can highlight exactly
 * the terms the tutor is talking about. Pure display logic — validation stays on the server.
 */
export interface Term {
  op: "+" | "−" | "";
  latex: string;
  role: FocusRole;
  key: string;
}

export interface LineTerms {
  left: Term[];
  right: Term[];
  ok: boolean;
}

function splitSide(side: string): { op: "+" | "−" | ""; body: string }[] {
  const out: { op: "+" | "−" | ""; body: string }[] = [];
  let depth = 0;
  let cur = "";
  let op: "+" | "−" | "" = "";
  const s = side.trim();
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    if (c === ")") depth--;
    const prevNonSpace = cur.trim();
    if (depth === 0 && (c === "+" || c === "-") && prevNonSpace && !/[*/]$/.test(prevNonSpace)) {
      out.push({ op, body: cur.trim() });
      op = c === "+" ? "+" : "−";
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push({ op, body: cur.trim() });
  return out;
}

export function lineTerms(raw: string | undefined): LineTerms {
  if (!raw) return { left: [], right: [], ok: false };
  const norm = normalizeMath(raw).replace(/(\d)\s+x/g, "$1x");
  const sides = norm.split("=");
  if (sides.length !== 2) return { left: [], right: [], ok: false };
  const parts = sides.map(splitSide);
  const xSide = parts.findIndex((p) => p.some((t) => /x/.test(t.body)));
  const tag = (sideIdx: number) =>
    parts[sideIdx].map((t, i): Term => ({
      op: t.op,
      latex: rawToLatex(t.body),
      role: /x/.test(t.body) ? "x-term" : sideIdx === xSide ? "constant" : "other-side",
      key: `${sideIdx}-${i}`,
    }));
  return { left: tag(0), right: tag(1), ok: true };
}
