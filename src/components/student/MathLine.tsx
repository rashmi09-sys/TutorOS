"use client";
import { Tex } from "../Math";
import { lineTerms } from "@/lib/terms";
import type { FocusRole } from "@/engine/types";

/** An equation rendered term by term, so individual terms can be emphasised. */
export function MathLine({ raw, latex, focus = [], size = "md" }: { raw?: string; latex: string; focus?: FocusRole[]; size?: "lg" | "md" | "sm" }) {
  const t = lineTerms(raw);
  if (!t.ok) return <span className={`mathline ${size}`}><Tex tex={latex} /></span>;
  const term = (x: (typeof t.left)[number], first: boolean) => (
    <span key={x.key} className={`term ${focus.includes(x.role) ? "focus" : ""}`} data-role={x.role}>
      {x.op && !(first && x.op === "+") && <span className="op">{x.op}</span>}
      <Tex tex={x.latex} />
    </span>
  );
  return (
    <span className={`mathline ${size}`} aria-label={raw}>
      <span className="side">{t.left.map((x, i) => term(x, i === 0))}</span>
      <span className={`term eq ${focus.includes("equals") ? "focus" : ""}`}>=</span>
      <span className="side">{t.right.map((x, i) => term(x, i === 0))}</span>
    </span>
  );
}
