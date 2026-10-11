"use client";
import { useMemo } from "react";
import { renderTex } from "@/lib/tex";

export function Tex({ tex, label }: { tex: string; label?: string }) {
  const html = useMemo(() => renderTex(tex), [tex]);
  // MathML output gives screen readers the real expression. renderTex never returns unescaped input.
  return <span className="math" aria-label={label} dangerouslySetInnerHTML={{ __html: html }} />;
}
